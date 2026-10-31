import {NotificationOutboxCursor} from './notificationOutboxCursor';
import {persistLiveUserNotification,publishLiveUserNotifications} from './liveNotifications';
import {isULeague,uMatchFinished,uLeagueStandings} from '../../lib/uzeflifeLeague';
import {sweepCustomCompetitionDeadlines} from './customCompetitionNotices';
import {processCompetitionNotices} from './competitionNotices';
import {createHash,randomUUID} from 'node:crypto';
import type {Transaction} from 'firebase-admin/firestore';
import {waitUntil} from '@vercel/functions';
import {getFirestoreDb} from '../firebase/admin';
import type {UState,UMatch} from '../../types/uzeflife';
import {uzeflifeMatchLink} from '../../lib/uzeflifeLinks';
import {uRoundLabel,uMatchNumber} from '../../lib/uzeflifePresentation';
import {enqueueSmartTelegramNotification} from './smartNotificationService';

type Kind='opponent'|'proposal'|'confirmed'|'dispute'|'reminder'|'overdue'|'champion';
export type UNotice={userId:string;kind:Kind;matchId:string;version:string;adminOnly?:boolean;title:string;body:string;};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value??null)).digest('hex');
export const uNoticeText=(v:string)=>v.replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|#39);/g,(_,key:string)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[key]!));
const html=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const admins=(s:UState)=>[...new Set(['@primary-owner',s.superAdmin,...Object.keys(s.assistants).filter(id=>s.assistants[id].includes('results'))].filter((v):v is string=>!!v))];
export function uNoticeVersion(kind:Kind,m:UMatch){return hash([m.home,m.away,...(kind==='proposal'?[m.proposal?[m.proposal.by,m.proposal.home,m.proposal.away,m.proposal.penaltyHome,m.proposal.penaltyAway]:null]:kind==='dispute'?[m.dispute?.at]:kind==='confirmed'||kind==='champion'?[m.homeScore,m.awayScore,m.penaltyHome,m.penaltyAway,m.winner]:[m.deadlineAt||null,...(kind==='opponent'?[m.scheduledAt]:[])])]);}
export function uTransitionNotices(before:UState,after:UState):UNotice[]{
 const events:UNotice[]=[];const player=(id:string|null)=>html(after.participants.find(p=>p.id===id)?.name||'Ishtirokchi');
 const add=(m:UMatch,kind:Kind,ids:(string|null)[],title:string,body:string,adminOnly=false)=>{for(const id of new Set(ids))if(id)events.push({userId:id,kind,matchId:m.id,version:uNoticeVersion(kind,m),title,body,...(adminOnly?{adminOnly:true}:{})});};
 for(const m of after.matches){
  const old=before.matches.find(o=>o.id===m.id);
  const label=`${m.bracket?m.bracket+'-setka · ':''}${uRoundLabel(m.round,after.format)} · ${uMatchNumber(m)}-o‘yin`;
  if(after.status==='playing'&&m.round===after.round&&!uMatchFinished(m)&&m.home&&m.away&&(before.status!=='playing'||before.round!==after.round||old?.home!==m.home||old?.away!==m.away||old?.deadlineAt!==m.deadlineAt||old?.scheduledAt!==m.scheduledAt)){
   for(const id of [m.home,m.away])add(m,'opponent',[id],'UZEFLIFE · Raqibingiz aniqlandi',`${label}\nRaqibingiz: <b>${player(id===m.home?m.away:m.home)}</b>${m.deadlineAt?'\nHisob topshirish muddati: '+new Date(m.deadlineAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'}):''}${m.scheduledAt?'\nO‘yin vaqti: '+new Date(m.scheduledAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'}):''}\nO‘yin sahifasida hisob kiritishingiz mumkin.`);
  }
  if(m.proposal&&hash(m.proposal)!==hash(old?.proposal)){
   const body=`${label}\n${player(m.home)} ${m.proposal.home}:${m.proposal.away} ${player(m.away)}\nHisobni tekshirib tasdiqlang yoki e’tiroz bildiring.`;
   add(m,'proposal',[m.proposal.by===m.home?m.away:m.home],'UZEFLIFE · Hisob tasdiq kutmoqda',body);
   add(m,'proposal',admins(after),'UZEFLIFE · Hisob tasdiq kutmoqda',body,true);
  }
  if(uMatchFinished(m)&&(!old||!uMatchFinished(old)||uNoticeVersion('confirmed',old)!==uNoticeVersion('confirmed',m)))add(m,'confirmed',[m.home,m.away],'UZEFLIFE · Natija tasdiqlandi',`${label}\n${player(m.home)} ${m.homeScore}:${m.awayScore} ${player(m.away)}${m.penaltyHome!==null?'\nPenaltilar: '+m.penaltyHome+':'+m.penaltyAway:''}${m.winner?'\nG‘olib: <b>'+player(m.winner)+'</b>':'\nDurang · har ikkala o‘yinchiga 1 ochko'}`);
  if(m.dispute?.status==='open'&&old?.dispute?.at!==m.dispute.at){const body=`${label}\n${player(m.home)} — ${player(m.away)}\nNatijaga e’tiroz yuborildi. Admin tekshirishi kerak.`;add(m,'dispute',[m.home,m.away],'UZEFLIFE · Bahsli natija',body);add(m,'dispute',admins(after),'UZEFLIFE · E’tirozni tekshiring',body,true);}
  if(!isULeague(after)&&after.status==='completed'&&before.status!=='completed'&&m.round===8&&m.winner)add(m,'champion',after.participants.filter(p=>p.status==='approved').map(p=>p.id),'UZEFLIFE · Turnir yakunlandi',`Chempion: <b>${player(m.winner)}</b>\nFinalchi: ${player(m.winner===m.home?m.away:m.home)}\nFinal hisobi: ${m.homeScore}:${m.awayScore}\nBarcha natijalar turnir tarixida saqlandi.`);
 }
 if(isULeague(after)&&after.status==='completed'&&before.status!=='completed'){const champion=uLeagueStandings(after)[0],m=after.matches.at(-1);if(m&&champion)add(m,'champion',after.participants.filter(p=>p.status==='approved').map(p=>p.id),'UZEFLIFE · Liga yakunlandi',`15 tur yakunlandi. Chempion: ${html(champion.name)} · ${champion.points} ochko. Yakuniy jadvalni oching.`);}
 return events;
}
/** Stored in the same transaction as the draw/result: rollback cannot send a message. */
export function writeUNotices(tx:Transaction,before:UState,after:UState,id:string){
 const notices=uTransitionNotices(before,after);
 if(notices.length)tx.set(getFirestoreDb().collection('uzeflife_notifications').doc(id),{status:'pending',cursor:0,leaseUntil:0,createdAt:new Date().toISOString(),deliveryVersion:2,notices});
}
export async function sweepUDeadlines(now=Date.now()){
 const db=getFirestoreDb(),ref=db.collection('uzeflife').doc('championship'),checkpoint=db.collection('uzeflife_worker').doc('reminders');
 await db.runTransaction(async tx=>{
  const [snap,check]=await Promise.all([tx.get(ref),tx.get(checkpoint)]);const s=snap.data() as UState|undefined;
  if(!s||s.status!=='playing'||Number(check.data()?.nextAt||0)>now)return;
  const notices:UNotice[]=[];const seen=new Set<string>(check.data()?.seen||[]);
  for(const m of s.matches){const deadline=Date.parse(m.deadlineAt||'');if(m.round!==s.round||uMatchFinished(m)||m.proposal||m.dispute?.status==='open'||!m.home||!m.away||!Number.isFinite(deadline)||deadline-now>86400000)continue;
   const kind=deadline>now?'reminder':'overdue';
   const body=`${uRoundLabel(m.round,s.format)} · ${uMatchNumber(m)}-o‘yin\nHisob topshirish muddati: ${new Date(deadline).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'})}\n${kind==='reminder'?'Hisobni kiritishni unutmang.':'Muddat tugadi. Raqib yoki admin bilan bog‘laning.'}`;
   for(const userId of [m.home,m.away]){const version=uNoticeVersion(kind,m),key=hash([userId,kind,m.id,version]);if(!seen.has(key)){notices.push({userId,kind,matchId:m.id,version,title:kind==='reminder'?'UZEFLIFE · O‘yin eslatmasi':'UZEFLIFE · O‘yin muddati tugadi',body});seen.add(key);}}
  }
  tx.set(checkpoint,{nextAt:now+3600000,seen:[...seen].slice(-2048)});
  if(notices.length)tx.set(db.collection('uzeflife_notifications').doc('reminder-'+hash(notices.map(n=>[n.userId,n.kind,n.matchId,n.version]))),{status:'pending',cursor:0,leaseUntil:0,createdAt:new Date().toISOString(),deliveryVersion:2,notices});
 });
}
export function validUNotice(n:UNotice,s:UState,ownerId?:string){
 const m=s.matches.find(m=>m.id===n.matchId);if(!m||uNoticeVersion(n.kind,m)!==n.version)return false;
 if(n.adminOnly&&!(n.userId===ownerId||n.userId===s.superAdmin||s.assistants[n.userId]?.includes('results')===true))return false;
 if(!n.adminOnly&&(!s.participants.some(p=>p.id===n.userId&&p.status==='approved')||n.kind!=='champion'&&![m.home,m.away].includes(n.userId)))return false;
 if(n.kind==='reminder'&&(Date.parse(m.deadlineAt||'')<=Date.now()||m.proposal||m.dispute?.status==='open'))return false;
 if(n.kind==='overdue'&&(Date.parse(m.deadlineAt||'')>Date.now()||m.proposal||m.dispute?.status==='open'))return false;
 if(['opponent','reminder','overdue'].includes(n.kind))return s.status==='playing'&&m.round===s.round&&!uMatchFinished(m);
 if(n.kind==='proposal')return !!m.proposal&&!uMatchFinished(m)&&m.dispute?.status!=='open';
 if(n.kind==='dispute')return m.dispute?.status==='open';
 return n.kind!=='champion'||s.status==='completed';
}
export async function processUNotices(limit=25,enqueue=enqueueSmartTelegramNotification,deadline=Infinity):Promise<boolean>{
 const db=getFirestoreDb();const jobs=await db.collection('uzeflife_notifications').where('status','==','pending').limit(3).get();
 let budget=limit;const failures:unknown[]=[];
 for(const job of jobs.docs){
  if(!budget||Date.now()>=deadline)break;const lease=randomUUID();
  const claimed=await db.runTransaction(async tx=>{const snap=await tx.get(db.collection('uzeflife_notifications').doc(job.id)),v=snap.data();if(!v||v.status!=='pending'||v.leaseUntil>Date.now())return null;const claimed={...v,cursor:Number(v.cursor||0),notices:v.notices as UNotice[],deliveryVersion:Number(v.deliveryVersion||1),retryIndices:Array.isArray(v.retryIndices)?v.retryIndices:[],createdAt:String(v.createdAt||new Date().toISOString())};tx.set(db.collection('uzeflife_notifications').doc(job.id),{...claimed,lease,leaseUntil:Date.now()+90000});return claimed;});
  if(!claimed)continue;
  const progress=new NotificationOutboxCursor(claimed.notices.length,claimed.cursor,claimed.retryIndices);
  try{
   const s=(await db.collection('uzeflife').doc('championship').get()).data() as UState;
   const owner=await db.collection('users').where('telegramId','==','5209126900').limit(2).get();const ownerId=owner.docs.length===1?owner.docs[0].id:undefined;
   const notices=claimed.notices as UNotice[];
   while(budget>0&&Date.now()<deadline){
    const index=progress.next();if(index===null)break;
    try{
    const raw=notices[index];const n=raw.userId==='@primary-owner'?{...raw,userId:ownerId||''}:raw;
    if(n.userId&&s&&validUNotice(n,s,ownerId)){
     const actor=(await db.collection('users').doc(n.userId).get()).data();
     if(actor&&!actor.isSuspended){
      const eventId='uzeflife:'+hash([...(claimed.deliveryVersion>=2?[job.id]:[]),n.userId,n.kind,n.matchId,n.version]);
      await persistLiveUserNotification({id:eventId,userId:n.userId,type:'COMPETITION_UPDATE',title:n.title,message:uNoticeText(n.body),entityType:'uzeflife',entityId:n.matchId,isRead:false,createdAt:claimed.createdAt});
      await enqueue({userId:n.userId,seasonId:'season-2026-27',deferDrain:true,eventId,title:n.title,body:n.body,replyMarkup:{inline_keyboard:[[{text:'O‘yin sahifasini ochish',url:uzeflifeMatchLink(n.matchId)}]]}});
      await publishLiveUserNotifications(n.userId);
     }
    }
    }catch(error){progress.retry(index);failures.push(error);}
    budget--;
   }
  }catch(error){failures.push(error);}finally{await db.runTransaction(async tx=>{const snap=await tx.get(db.collection('uzeflife_notifications').doc(job.id)),v=snap.data();if(v?.lease===lease)tx.set(db.collection('uzeflife_notifications').doc(job.id),{...v,cursor:progress.cursor,retryIndices:progress.retryIndices,leaseUntil:0,status:progress.done?'done':'pending'});});}
 }
 if(failures.length)throw failures[0];
 return !(await db.collection('uzeflife_notifications').where('status','==','pending').limit(1).get()).empty;
}
/** A failure in one tournament must not starve the other durable outboxes. */
export async function runNoticePreparations(phases:readonly (()=>Promise<boolean|void>)[]){
 let pending=false;const failures:unknown[]=[];
 for(const phase of phases){try{pending=!!(await phase())||pending;}catch(error){failures.push(error);}}
 if(failures.length)throw Object.assign(new AggregateError(failures,'Notification preparation deferred'),{pendingWork:pending});
 return pending;
}
/** Prepare domain intents separately: the existing Telegram drain remains database-free. */
export async function prepareUNotifications(){
 if(process.env.MIGRATION_WRITE_FREEZE==='true'||process.env.DATABASE_PROVIDER==='supabase'&&process.env.SUPABASE_DATA_NAMESPACE==='preview')return false;
 return runNoticePreparations([
  ()=>processCompetitionNotices(40,enqueueSmartTelegramNotification,Date.now()+7000),
  ()=>sweepCustomCompetitionDeadlines(),
  ()=>sweepUDeadlines(),
  ()=>processUNotices(60,enqueueSmartTelegramNotification,Date.now()+8000),
 ]);
}
export function scheduleUNotices(hop=0){
 if(process.env.VERCEL!=='1'&&!process.env.K_SERVICE)return;
 const task=(async()=>{
  const queue=await import('./telegramNotificationQueue');
  let pending=false;
  try{pending=await prepareUNotifications();}
  catch(error:any){pending=error?.pendingWork===true;console.warn('[NOTIFICATION_PREPARATION_DEFERRED]',error?.message);if(!pending&&hop<3&&process.env.VERCEL==='1')await queue.triggerNotificationContinuation(hop+1);}
  finally{queue.scheduleNotificationQueueDrain(hop);}
  if(pending&&hop<256){if(process.env.VERCEL==='1')await queue.triggerNotificationContinuation(hop+1);else scheduleUNotices(hop+1);}
 })().catch(()=>console.warn('[UZEFLIFE_OUTBOX_DEFERRED]'));
 if(process.env.VERCEL==='1')waitUntil(task);else void task;
}
