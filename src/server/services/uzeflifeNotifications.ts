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
const html=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const admins=(s:UState)=>[...new Set(['@primary-owner',s.superAdmin,...Object.keys(s.assistants).filter(id=>s.assistants[id].includes('results'))].filter((v):v is string=>!!v))];
export function uNoticeVersion(kind:Kind,m:UMatch){return hash([m.home,m.away,...(kind==='proposal'?[m.proposal?[m.proposal.by,m.proposal.home,m.proposal.away,m.proposal.penaltyHome,m.proposal.penaltyAway]:null]:kind==='dispute'?[m.dispute?.at]:kind==='confirmed'||kind==='champion'?[m.homeScore,m.awayScore,m.penaltyHome,m.penaltyAway,m.winner]:[m.deadlineAt||null,...(kind==='opponent'?[m.scheduledAt]:[])])]);}
export function uTransitionNotices(before:UState,after:UState):UNotice[]{
 const events:UNotice[]=[];const player=(id:string|null)=>html(after.participants.find(p=>p.id===id)?.name||'Ishtirokchi');
 const add=(m:UMatch,kind:Kind,ids:(string|null)[],title:string,body:string,adminOnly=false)=>{for(const id of new Set(ids))if(id)events.push({userId:id,kind,matchId:m.id,version:uNoticeVersion(kind,m),title,body,...(adminOnly?{adminOnly:true}:{})});};
 for(const m of after.matches){
  const old=before.matches.find(o=>o.id===m.id);
  const label=`${m.bracket?m.bracket+'-setka · ':''}${uRoundLabel(m.round)} · ${uMatchNumber(m)}-o‘yin`;
  if(after.status==='playing'&&m.round===after.round&&!m.winner&&m.home&&m.away&&(before.status!=='playing'||before.round!==after.round||old?.home!==m.home||old?.away!==m.away||old?.deadlineAt!==m.deadlineAt||old?.scheduledAt!==m.scheduledAt)){
   for(const id of [m.home,m.away])add(m,'opponent',[id],'UZEFLIFE · Raqibingiz aniqlandi',`${label}\nRaqibingiz: <b>${player(id===m.home?m.away:m.home)}</b>${m.deadlineAt?'\nHisob topshirish muddati: '+new Date(m.deadlineAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'}):''}${m.scheduledAt?'\nO‘yin vaqti: '+new Date(m.scheduledAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'}):''}\nO‘yin sahifasida hisob kiritishingiz mumkin.`);
  }
  if(m.proposal&&hash(m.proposal)!==hash(old?.proposal)){
   const body=`${label}\n${player(m.home)} ${m.proposal.home}:${m.proposal.away} ${player(m.away)}\nHisobni tekshirib tasdiqlang yoki e’tiroz bildiring.`;
   add(m,'proposal',[m.proposal.by===m.home?m.away:m.home],'UZEFLIFE · Hisob tasdiq kutmoqda',body);
   add(m,'proposal',admins(after),'UZEFLIFE · Hisob tasdiq kutmoqda',body,true);
  }
  if(m.winner&&(!old?.winner||uNoticeVersion('confirmed',old)!==uNoticeVersion('confirmed',m)))add(m,'confirmed',[m.home,m.away],'UZEFLIFE · Natija tasdiqlandi',`${label}\n${player(m.home)} ${m.homeScore}:${m.awayScore} ${player(m.away)}${m.penaltyHome!==null?'\nPenaltilar: '+m.penaltyHome+':'+m.penaltyAway:''}\nG‘olib: <b>${player(m.winner)}</b>`);
  if(m.dispute?.status==='open'&&old?.dispute?.at!==m.dispute.at){const body=`${label}\n${player(m.home)} — ${player(m.away)}\nNatijaga e’tiroz yuborildi. Admin tekshirishi kerak.`;add(m,'dispute',[m.home,m.away],'UZEFLIFE · Bahsli natija',body);add(m,'dispute',admins(after),'UZEFLIFE · E’tirozni tekshiring',body,true);}
  if(after.status==='completed'&&before.status!=='completed'&&m.round===8&&m.winner)add(m,'champion',after.participants.filter(p=>p.status==='approved').map(p=>p.id),'UZEFLIFE · Turnir yakunlandi',`Chempion: <b>${player(m.winner)}</b>\nFinalchi: ${player(m.winner===m.home?m.away:m.home)}\nFinal hisobi: ${m.homeScore}:${m.awayScore}\nBarcha natijalar turnir tarixida saqlandi.`);
 }
 return events;
}
/** Stored in the same transaction as the draw/result: rollback cannot send a message. */
export function writeUNotices(tx:Transaction,before:UState,after:UState,id:string){
 const notices=uTransitionNotices(before,after);
 if(notices.length)tx.set(getFirestoreDb().collection('uzeflife_notifications').doc(id),{status:'pending',cursor:0,leaseUntil:0,notices});
}
export async function sweepUDeadlines(now=Date.now()){
 const db=getFirestoreDb(),ref=db.collection('uzeflife').doc('championship'),checkpoint=db.collection('uzeflife_worker').doc('reminders');
 await db.runTransaction(async tx=>{
  const [snap,check]=await Promise.all([tx.get(ref),tx.get(checkpoint)]);const s=snap.data() as UState|undefined;
  if(!s||s.status!=='playing'||Number(check.data()?.nextAt||0)>now)return;
  const notices:UNotice[]=[];const seen=new Set<string>(check.data()?.seen||[]);
  for(const m of s.matches){const deadline=Date.parse(m.deadlineAt||'');if(m.round!==s.round||m.winner||m.proposal||m.dispute?.status==='open'||!m.home||!m.away||!Number.isFinite(deadline)||deadline-now>86400000)continue;
   const kind=deadline>now?'reminder':'overdue';
   const body=`${uRoundLabel(m.round)} · ${uMatchNumber(m)}-o‘yin\nHisob topshirish muddati: ${new Date(deadline).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'})}\n${kind==='reminder'?'Hisobni kiritishni unutmang.':'Muddat tugadi. Raqib yoki admin bilan bog‘laning.'}`;
   for(const userId of [m.home,m.away]){const version=uNoticeVersion(kind,m),key=hash([userId,kind,m.id,version]);if(!seen.has(key)){notices.push({userId,kind,matchId:m.id,version,title:kind==='reminder'?'UZEFLIFE · O‘yin eslatmasi':'UZEFLIFE · O‘yin muddati tugadi',body});seen.add(key);}}
  }
  tx.set(checkpoint,{nextAt:now+3600000,seen:[...seen].slice(-2048)});
  if(notices.length)tx.set(db.collection('uzeflife_notifications').doc('reminder-'+hash(notices.map(n=>[n.userId,n.kind,n.matchId,n.version]))),{status:'pending',cursor:0,leaseUntil:0,notices});
 });
}
export function validUNotice(n:UNotice,s:UState,ownerId?:string){
 const m=s.matches.find(m=>m.id===n.matchId);if(!m||uNoticeVersion(n.kind,m)!==n.version)return false;
 if(n.adminOnly&&!(n.userId===ownerId||n.userId===s.superAdmin||s.assistants[n.userId]?.includes('results')===true))return false;
 if(!n.adminOnly&&!s.participants.some(p=>p.id===n.userId&&p.status==='approved'))return false;
 if(n.kind==='reminder'&&(Date.parse(m.deadlineAt||'')<=Date.now()||m.proposal||m.dispute?.status==='open'))return false;
 if(n.kind==='overdue'&&(Date.parse(m.deadlineAt||'')>Date.now()||m.proposal||m.dispute?.status==='open'))return false;
 if(['opponent','reminder','overdue'].includes(n.kind))return s.status==='playing'&&m.round===s.round&&!m.winner;
 if(n.kind==='proposal')return !!m.proposal&&!m.winner&&m.dispute?.status!=='open';
 if(n.kind==='dispute')return m.dispute?.status==='open';
 return n.kind!=='champion'||s.status==='completed';
}
export async function processUNotices(limit=25,enqueue=enqueueSmartTelegramNotification,deadline=Infinity):Promise<boolean>{
 const db=getFirestoreDb();const jobs=await db.collection('uzeflife_notifications').where('status','==','pending').limit(3).get();
 let budget=limit;
 for(const job of jobs.docs){
  if(!budget||Date.now()>=deadline)break;const lease=randomUUID();
  const claimed=await db.runTransaction(async tx=>{const snap=await tx.get(db.collection('uzeflife_notifications').doc(job.id)),v=snap.data();if(!v||v.status!=='pending'||v.leaseUntil>Date.now())return null;tx.set(db.collection('uzeflife_notifications').doc(job.id),{...v,lease,leaseUntil:Date.now()+90000});return v;});
  if(!claimed)continue;
  let cursor=claimed.cursor as number;
  try{
   const s=(await db.collection('uzeflife').doc('championship').get()).data() as UState;
   const owner=await db.collection('users').where('telegramId','==','5209126900').limit(2).get();const ownerId=owner.docs.length===1?owner.docs[0].id:undefined;
   const notices=claimed.notices as UNotice[];
   while(cursor<notices.length&&budget>0&&Date.now()<deadline){
    const raw=notices[cursor];const n=raw.userId==='@primary-owner'?{...raw,userId:ownerId||''}:raw;
    if(n.userId&&validUNotice(n,s,ownerId))await enqueue({userId:n.userId,seasonId:'season-2026-27',deferDrain:true,eventId:'uzeflife:'+hash([n.userId,n.kind,n.matchId,n.version]),title:n.title,body:n.body,replyMarkup:{inline_keyboard:[[{text:'O‘yin sahifasini ochish',url:uzeflifeMatchLink(n.matchId)}]]}});
    cursor++;budget--;
   }
  }finally{await db.runTransaction(async tx=>{const snap=await tx.get(db.collection('uzeflife_notifications').doc(job.id)),v=snap.data();if(v?.lease===lease)tx.set(db.collection('uzeflife_notifications').doc(job.id),{...v,cursor,leaseUntil:0,status:cursor>=v.notices.length?'done':'pending'});});}
 }
 return !(await db.collection('uzeflife_notifications').where('status','==','pending').limit(1).get()).empty;
}
/** Prepare domain intents separately: the existing Telegram drain remains database-free. */
export async function prepareUNotifications(){
 if(process.env.MIGRATION_WRITE_FREEZE==='true'||process.env.DATABASE_PROVIDER==='supabase'&&process.env.SUPABASE_DATA_NAMESPACE==='preview')return false;
 await sweepUDeadlines();
 return processUNotices(60,enqueueSmartTelegramNotification,Date.now()+8000);
}
export function scheduleUNotices(hop=0){
 if(process.env.VERCEL!=='1'&&!process.env.K_SERVICE)return;
 const task=(async()=>{
  const queue=await import('./telegramNotificationQueue');
  const pending=await prepareUNotifications();
  queue.scheduleNotificationQueueDrain(hop);
  if(pending&&hop<256){if(process.env.VERCEL==='1')await queue.triggerNotificationContinuation(hop+1);else scheduleUNotices(hop+1);}
 })().catch(()=>console.warn('[UZEFLIFE_OUTBOX_DEFERRED]'));
 if(process.env.VERCEL==='1')waitUntil(task);else void task;
}
