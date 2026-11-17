import {getFirestoreDb} from '../firebase/admin';
import {getTopicResultStateClient} from './telegramAiDeadline';
import {editFixtureResult} from './adminService';
import {sendTelegramMessage} from './telegramBotService';
import {safeFixtureSnapshotForTopicRetry,TOPIC_RESULT_REBASE,TOPIC_RESULT_CLAIM,TOPIC_RESULT_RELEASE,isDefinitiveTopicResultRejection} from './telegramTopicResults';
import {readBacklogResultAccess} from './backlogResultEntry';
import type {User} from '../../types';

const PREFIX='efluz:v1:telegram:topic-result:';
const TTL=86400;
type CandidateProposal={
  token:string;state:string;kind?:string;chat:number;thread:number;sourceMessage:number;
  originalSourceMessage?:number;originalSourceUpdateId?:number;
  deliveredMessage:number;updateId:number;expiresAt:number;plan:{
    action:string;targetId:string;body:{
      homeScore:number;awayScore:number;homeExtraTimeScore?:number|null;awayExtraTimeScore?:number|null;
      homePenaltyScore?:number|null;awayPenaltyScore?:number|null;
      expectedFixture:any;
    };
  };
};
export type GroupBacklogItem={
  fixtureId:string;competitionId:string;seasonId:string;status:string;
  homeClubId:string;awayClubId:string;homeScore:number;awayScore:number;
  sourceMessage:number;thread:number;sourceUrl:string;token:string;
  reason:'ready'|'conflict'|'changed'|'locked'|'disabled'|'already_saved';
};

/** Only unfinished Season 2 fixtures or retained Season 1 European/Super Cup
 * matches may be recovered. Old domestic seasons are never re-opened. */
export function isEligibleTopicBacklogCompetition(seasonId:string,competitionId:string){
  return seasonId==='season-2027-28' ||
    seasonId==='season-2026-27' && /(?:champions|europa|super-cup)/i.test(competitionId);
}
export function groupBacklogScoreKey(p:{plan:{body:{homeScore:number;awayScore:number}}}){
  return `${p.plan.body.homeScore}:${p.plan.body.awayScore}`;
}
const sourceKey=(p:CandidateProposal)=>`${PREFIX}source:${p.chat}:${p.thread}:${p.sourceMessage}`;
const proposalKey=(token:string)=>`${PREFIX}proposal:${token}`;
const leaseKey=(fixtureId:string)=>`${PREFIX}fixture:${fixtureId}`;

export async function previewGroupResultBacklog(maxItems=80){
  const db=getFirestoreDb(),client=getTopicResultStateClient(AbortSignal.timeout(18000));
  if(!client)throw Error('TELEGRAM_RESULT_STATE_UNAVAILABLE');
  // The isolated in-memory test adapter cannot query dotted fields; the
  // production PostgreSQL adapter can. Keep the production scan selective.
  const query=process.env.FIREBASE_FORCE_LOCAL_FALLBACK==='true'
    ? db.collection('telegram_ai_state').limit(250)
    : db.collection('telegram_ai_state').where('value.state','==','pending').limit(250);
  const snap=await query.get();
  const proposals=snap.docs.map(row=>row.data()?.value as CandidateProposal)
    .filter(p=>p && p.kind!=='uzeflife' && p.plan?.action==='result_edit' &&
      Number.isSafeInteger(p.chat) && Number.isSafeInteger(p.thread) &&
      Number.isSafeInteger(p.sourceMessage) && Number.isSafeInteger(p.deliveredMessage) &&
      /^[a-f0-9]{24}$/.test(p.token||'') && p.expiresAt>Date.now() &&
      Number.isInteger(Number(p.plan.body?.homeScore)) && Number.isInteger(Number(p.plan.body?.awayScore)));
  const byFixture=new Map<string,CandidateProposal[]>();
  for(const p of proposals){
    const list=byFixture.get(p.plan.targetId)||[];
    list.push(p);byFixture.set(p.plan.targetId,list);
  }
  const items:GroupBacklogItem[]=[];
  let conflicted=0,skipped=0;
  for(const [fixtureId,candidates] of [...byFixture].slice(0,maxItems)){
    const scores=new Set(candidates.map(groupBacklogScoreKey));
    if(scores.size!==1){conflicted++;continue;}
    const p=[...candidates].sort((a,b)=>b.updateId-a.updateId)[0];
    const fixtureSnap=await db.collection('fixtures').doc(fixtureId).get();
    const fixture=fixtureSnap.data() as any;
    if(!fixture){skipped++;continue;}
    const seasonId=String(fixture.seasonId||'');
    const competitionId=String(fixture.competitionId||'');
    if(!isEligibleTopicBacklogCompetition(seasonId,competitionId)){skipped++;continue;}
    const fresh=safeFixtureSnapshotForTopicRetry(p.plan as any,fixture);
    if(!fresh){skipped++;continue;}
    const source=await client.get<{token?:string}>(sourceKey(p));
    if(source?.token!==p.token){skipped++;continue;}
    const allowed=await readBacklogResultAccess(fixture).catch(()=>false);
    if(!allowed){skipped++;continue;}
    const held=await client.get<string>(leaseKey(fixtureId));
    if(held&&held!==p.token){
      const older=await client.get<CandidateProposal&{receipt?:{status:number}}>(proposalKey(held));
      if(!older||older.token!==held || older.plan.targetId!==fixtureId ||
        !['done','rejected'].includes(older.state)||older.receipt?.status!==409){skipped++;continue;}
    }
    items.push({
      fixtureId,competitionId,seasonId,status:fixture.status,
      homeClubId:fixture.homeClubId,awayClubId:fixture.awayClubId,
      homeScore:Number(p.plan.body.homeScore),awayScore:Number(p.plan.body.awayScore),
      sourceMessage:p.sourceMessage,thread:p.thread,sourceUrl:`https://t.me/efleagueuz/${p.sourceMessage}`,
      token:p.token,reason:'ready',
    });
  }
  return {items,conflicted,skipped,scanned:proposals.length,limited:snap.size>=250};
}

/** A bounded, explicit owner action. Replays no arbitrary score: only the
 * latest source-linked, unresolved proposal. Every save executes the same
 * server CAS, audit and downstream refresh as a normal admin fixture edit. */
export async function applyGroupResultBacklog(admin:User,tokens:string[]){
  if(!admin?.isAdmin || admin.isSuspended || admin.telegramId!=='5209126900')
    throw Error('MAIN_OWNER_ONLY');
  if(!Array.isArray(tokens)||tokens.length<1||tokens.length>5||
     new Set(tokens).size!==tokens.length||tokens.some(t=>!(/^[a-f0-9]{24}$/.test(t))))
    throw Error('INVALID_BACKLOG_SELECTION');
  const results:Array<{fixtureId:string;outcome:'saved'|'skipped'|'failed';reason?:string}>=[];
  const initial=await previewGroupResultBacklog(100);
  for(const token of tokens){
    let fixtureId='unknown';
    try{
      const item=initial.items.find(i=>i.token===token);
      if(!item){results.push({fixtureId,outcome:'skipped',reason:'Proposal changed, expired or unavailable'});continue;}
      fixtureId=item.fixtureId;
      const db=getFirestoreDb(),client=getTopicResultStateClient(AbortSignal.timeout(23000));
      if(!client)throw Error('STATE_UNAVAILABLE');
      let p=await client.get<CandidateProposal>(proposalKey(token));
      if(!p || p.state!=='pending')throw Error('PROPOSAL_NOT_PENDING');
      const freshDoc=await db.collection('fixtures').doc(fixtureId).get();
      const fresh=safeFixtureSnapshotForTopicRetry(p.plan as any,freshDoc.data());
      if(!fresh)throw Error('FIXTURE_CHANGED');
      if(!await readBacklogResultAccess(freshDoc.data()))throw Error('RESULT_ENTRY_NOT_OPEN');
      const lease=leaseKey(fixtureId),held=await client.get<string>(lease);
      if(held&&held!==token){
        const previous=await client.get<CandidateProposal&{receipt?:{status:number}}>(proposalKey(held));
        if(previous?.token===held && previous.plan.targetId===fixtureId &&
          ['done','rejected'].includes(previous.state)&&previous.receipt?.status===409)
          await client.eval(TOPIC_RESULT_RELEASE,[lease],[held]);
      }
      const rebased=await client.eval(TOPIC_RESULT_REBASE,
        [proposalKey(token),sourceKey(p),lease],[token,JSON.stringify(fresh),Date.now(),TTL]);
      if(Number(rebased)!==1)throw Error('PROPOSAL_NO_LONGER_CURRENT');
      const claimed=await client.eval(TOPIC_RESULT_CLAIM,
        [proposalKey(token),lease,sourceKey(p),
          `${PREFIX}source:${p.chat}:${p.thread}:${p.originalSourceMessage||p.sourceMessage}`],
        [Date.now(),p.chat,p.thread,p.deliveredMessage,'executing',TTL]);
      if(Number(claimed)!==1)throw Error('PROPOSAL_ALREADY_CLAIMED');
      p=(await client.get<CandidateProposal>(proposalKey(token)))||p;
      try{
        const saved=await editFixtureResult(admin.id,admin.username||'admin',fixtureId,{
          homeScore:Number(p.plan.body.homeScore),awayScore:Number(p.plan.body.awayScore),
          status:'CONFIRMED',expectedFixture:fresh,
          idempotencyKey:`telegram-backlog-${token}`,
          ...(p.plan.body.homeExtraTimeScore!=null?{homeExtraTimeScore:p.plan.body.homeExtraTimeScore}:{}),
          ...(p.plan.body.awayExtraTimeScore!=null?{awayExtraTimeScore:p.plan.body.awayExtraTimeScore}:{}),
          ...(p.plan.body.homePenaltyScore!=null?{homePenaltyScore:p.plan.body.homePenaltyScore}:{}),
          ...(p.plan.body.awayPenaltyScore!=null?{awayPenaltyScore:p.plan.body.awayPenaltyScore}:{}),
        });
        if(saved.success!==true || saved.fixture?.status!=='CONFIRMED')throw Error('RESULT_NOT_VERIFIED');
        await client.set(proposalKey(token),{...p,state:'done',receipt:{status:200}},{ex:TTL});
        const replyGate=await client.set(`${PREFIX}backlog-reply:${token}`,1,{nx:true,ex:604800});
        if(replyGate==='OK'){
          try{
            const posted=await sendTelegramMessage(p.chat,
              `Natija tasdiqlandi va Web App bazasiga saqlandi.\nHisob: ${p.plan.body.homeScore}:${p.plan.body.awayScore}.\nUchrashuv: ${fixtureId}`,
              {parse_mode:null,message_thread_id:p.thread,reply_to_message_id:p.sourceMessage});
            if(!posted.ok)console.warn('[TOPIC_BACKLOG_REPLY_REJECTED]',{fixtureId,thread:p.thread});
          }catch(error:any){console.warn('[TOPIC_BACKLOG_REPLY_UNCONFIRMED]',String(error?.message||error).slice(0,120));}
        }
        results.push({fixtureId,outcome:'saved'});
      }catch(error:any){
        // Unknown write outcomes must retain their lease until reconciled.
        const status=Number(error?.statusCode||error?.status);
        const rejected=isDefinitiveTopicResultRejection(status);
        await client.set(proposalKey(token),{...p,state:rejected?'rejected':'unknown',...(rejected?{receipt:{status}}:{})},{ex:TTL});
        if(rejected)await client.eval(TOPIC_RESULT_RELEASE,[lease],[token]);
        throw error;
      }
    }catch(error:any){
      results.push({fixtureId,outcome:'failed',reason:String(error?.message||error).slice(0,180)});
      // Stop on any uncertainty; never bulk-overwrite other fixtures.
      break;
    }
  }
  return {results,saved:results.filter(r=>r.outcome==='saved').length};
}
