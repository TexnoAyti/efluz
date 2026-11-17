import {getFirestoreDb} from '../firebase/admin';
import {UZEFLIFE_RESULT_TOPIC} from '../../lib/uzeflifeResultTopic';
import {getTopicResultStateClient} from './telegramAiDeadline';

const TOPICS=new Set([2,3,4,5,6,7,8,2335,11429,11972,UZEFLIFE_RESULT_TOPIC]);
const PREFIX='efluz:v1:telegram:topic-result:';
const MAX_TEXT=1500;
const SCORE_PATTERN=/(?:^|[^0-9])(?:[0-9]{1,2})\s*[:–—-]\s*(?:[0-9]{1,2})(?![0-9])/;

export type GroupResultEvidence={
  id:string;chatId:number;threadId:number;messageId:number;senderId:number;
  updateId:number;date:number;editDate?:number;text:string;hasPhoto:boolean;
  fileId?:string;forwarded:boolean;receivedAt:string;
  ingestionResult?:string;proposalToken?:string;fixtureId?:string;competitionId?:string;
  proposedHome?:number;proposedAway?:number;
};

/** Only records from the authenticated group webhook. Never invent source
 * identity when a message is anonymous, from another group or from a bot. */
export function groupResultEvidenceFromMessage(message:any, updateId:number):GroupResultEvidence|null {
  const thread=Number(message?.message_thread_id);
  const chat=Number(message?.chat?.id);
  const sender=Number(message?.from?.id);
  const messageId=Number(message?.message_id);
  if(message?.chat?.username?.toLowerCase()!=='efleagueuz' ||
    !TOPICS.has(thread)|| !Number.isSafeInteger(chat)||!Number.isSafeInteger(sender)||
    sender<=0||message?.from?.is_bot||message?.sender_chat||message?.is_automatic_forward||
    !Number.isSafeInteger(messageId)||messageId<=0||!Number.isSafeInteger(updateId))return null;
  const input=String(message.text||message.caption||'').trim();
  const photo=Array.isArray(message.photo)?message.photo.at(-1):null;
  const document=['image/jpeg','image/png'].includes(message.document?.mime_type)?message.document:null;
  const media=photo||document;
  if(!SCORE_PATTERN.test(input) && !media?.file_id)return null;
  const fileId=typeof media?.file_id==='string' && media.file_id.length<=256?media.file_id:undefined;
  return {
    id:`${chat}:${messageId}`,chatId:chat,threadId:thread,
    messageId,senderId:sender,updateId,
    date:Number(message.date)||0,
    ...(Number.isSafeInteger(message.edit_date)?{editDate:message.edit_date}:{}),
    text:input.slice(0,MAX_TEXT),hasPhoto:Boolean(media),
    ...(fileId?{fileId}:{}),
    forwarded:Boolean(message.forward_origin||message.forward_from||message.forward_from_chat),
    receivedAt:new Date().toISOString(),
  };
}

export async function recordGroupResultEvidence(message:any,updateId:number):Promise<GroupResultEvidence|null>{
  const record=groupResultEvidenceFromMessage(message,updateId);
  if(!record)return null;
  const db=getFirestoreDb(),ref=db.collection('telegram_result_evidence').doc(record.id);
  // Webhook may retry; retain older authoritative outcome unless this is an
  // actual edit with a newer update id.
  await db.runTransaction(async tx=>{
    const previous=(await tx.get(ref)).data() as GroupResultEvidence|undefined;
    if(previous && previous.updateId>record.updateId)return;
    tx.set(ref,{...record,...(previous?.ingestionResult&&previous.updateId===record.updateId
      ?{ingestionResult:previous.ingestionResult,proposalToken:previous.proposalToken,
        fixtureId:previous.fixtureId,competitionId:previous.competitionId,
        proposedHome:previous.proposedHome,proposedAway:previous.proposedAway}:{})});
  });
  return record;
}

export async function updateGroupResultEvidenceOutcome(
  evidence:GroupResultEvidence|null,outcome:string|undefined
):Promise<void>{
  if(!evidence||!outcome)return;
  let link:Partial<GroupResultEvidence>={};
  if(outcome==='proposal_sent'){
    const client=getTopicResultStateClient(AbortSignal.timeout(5000));
    if(client){
      const source=await client.get<{token?:string}>(`${PREFIX}source:${evidence.chatId}:${evidence.threadId}:${evidence.messageId}`);
      if(source?.token){
        const proposal=await client.get<any>(`${PREFIX}proposal:${source.token}`);
        if(proposal?.token===source.token && proposal?.plan?.targetId){
          link={
            proposalToken:source.token,fixtureId:String(proposal.plan.targetId),
            competitionId:String(proposal.plan.body?.expectedFixture?.competitionId||''),
            proposedHome:Number(proposal.plan.body?.homeScore),
            proposedAway:Number(proposal.plan.body?.awayScore),
          };
        }
      }
    }
  }
  const ref=getFirestoreDb().collection('telegram_result_evidence').doc(evidence.id);
  await getFirestoreDb().runTransaction(async tx=>{
    const snap=await tx.get(ref),current=snap.data() as GroupResultEvidence|undefined;
    if(!current || current.updateId!==evidence.updateId)return;
    tx.set(ref,{...current,ingestionResult:outcome,...link});
  });
}

/** Owner-only audit surface; never exposes Telegram source identifiers to
 * public app endpoints. No changes to fixtures or results are made here. */
export async function getGroupResultEvidenceAudit(limit=100){
  const db=getFirestoreDb();
  const rows=await db.collection('telegram_result_evidence').orderBy('receivedAt','desc').limit(Math.min(200,Math.max(1,limit))).get();
  const entries=rows.docs.map(row=>row.data() as GroupResultEvidence);
  const grouped=entries.reduce<Record<string,number>>((r,e)=>{
    const key=e.ingestionResult||'unprocessed';
    r[key]=(r[key]||0)+1;return r;
  },{});
  return {entries:entries.map(({fileId,proposalToken,...publicRow})=>publicRow),counts:grouped,limited:rows.size>=limit};
}
