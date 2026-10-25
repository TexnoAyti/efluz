import {publishLiveUserNotifications} from './liveNotifications';
import {createHash,randomUUID} from 'node:crypto';
import type {Transaction} from 'firebase-admin/firestore';
import {getFirestoreDb} from '../firebase/admin';
import {enqueueSmartTelegramNotification} from './smartNotificationService';
import {invalidateFirestoreCache} from '../firebase/firestoreStore';
export const COMPETITION_OUTBOX='competition_notification_intents';
export const noticeHash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v??null)).digest('hex');
type Guard={collection:string;id:string;paths:string[];hash:string};
export type CompetitionNotice={userId:string;title:string;body:string;url:string;entityType:string;entityId:string;fixtureId?:string;guard?:Guard;guards?:Guard[];expiresAt?:number};
const at=(v:any,path:string)=>path.split('.').reduce((o,k)=>o?.[k],v)??null;
export function noticeGuard(collection:string,id:string,paths:string[],record:any):Guard{return {collection,id,paths,hash:noticeHash(paths.map(p=>at(record,p)))};}
/** Domain changes and delivery intents commit together. Batches stay below document limits. */
export function writeCompetitionNotices(tx:Transaction,key:string,notices:CompetitionNotice[]){
 const unique=[...new Map(notices.filter(n=>!!n.userId).map(n=>[noticeHash(n),n])).values()];
 for(let i=0;i<unique.length;i+=40)tx.set(getFirestoreDb().collection(COMPETITION_OUTBOX).doc(noticeHash([key,i])),{status:'pending',cursor:0,leaseUntil:0,createdAt:new Date().toISOString(),notices:unique.slice(i,i+40)});
}
const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function processCompetitionNotices(limit=40,enqueue=enqueueSmartTelegramNotification,deadline=Date.now()+8000,onlyId?:string){
 const db=getFirestoreDb(),jobs=onlyId?{docs:[await db.collection(COMPETITION_OUTBOX).doc(onlyId).get()]}:await db.collection(COMPETITION_OUTBOX).where('status','==','pending').orderBy('createdAt','asc').limit(4).get();let budget=limit;
 for(const job of jobs.docs){
  if(!budget||Date.now()>=deadline)break;const ref=job.ref,lease=randomUUID();
  const claimed=await db.runTransaction(async tx=>{const value=(await tx.get(ref)).data();if(!value||value.status!=='pending'||value.leaseUntil>Date.now())return null;tx.set(ref,{...value,lease,leaseUntil:Date.now()+90000});return value;});if(!claimed)continue;
  let cursor=claimed.cursor as number;const sources=new Map<string,any>(),signatures=new Map<string,string>();
  try{
   while(cursor<claimed.notices.length&&budget>0&&Date.now()<deadline){
    const notice=claimed.notices[cursor] as CompetitionNotice;let userId=notice.userId;
    if(userId==='@owner'){const owners=await db.collection('users').where('telegramId','==','5209126900').limit(2).get();userId=owners.size===1?owners.docs[0].id:'';}
    const actor=userId?(await db.collection('users').doc(userId).get()).data():null;
    let valid=!!actor&&!actor.isSuspended&&(!notice.expiresAt||notice.expiresAt>Date.now());
    for(const g of [notice.guard,...(notice.guards||[])].filter((g):g is Guard=>!!g)){
     if(!valid)break;const key=g.collection+'/'+g.id;if(!sources.has(key))sources.set(key,(await db.collection(g.collection).doc(g.id).get()).data());const value=sources.get(key),signatureKey=key+':'+JSON.stringify(g.paths);if(!signatures.has(signatureKey))signatures.set(signatureKey,noticeHash(g.paths.map(p=>at(value,p))));valid=!!value&&signatures.get(signatureKey)===g.hash&&!(value.status==='CANCELLED'&&!g.paths.includes('status'));
    }
    if(valid){
     const id='competition-'+noticeHash([job.id,cursor,userId]),notification=db.collection('notifications').doc(id);
     // A delivery retry must never turn an already-read in-app item unread.
     await db.runTransaction(async tx=>{if(!(await tx.get(notification)).exists)tx.set(notification,{id,userId,type:'COMPETITION_UPDATE',title:notice.title,message:notice.body,entityType:notice.entityType,entityId:notice.entityId,...(notice.fixtureId?{fixtureId:notice.fixtureId}:{}),isRead:false,createdAt:claimed.createdAt});});
     await publishLiveUserNotifications(userId);
     invalidateFirestoreCache(`firestore:notifications:${userId}`);
     await enqueue({userId,seasonId:'season-2026-27',eventId:id,title:notice.title,body:escape(notice.body),deferDrain:true,replyMarkup:{inline_keyboard:[[{text:'O‘yin / turnirni ochish',url:notice.url}]]}});
    }
    cursor++;budget--;
   }
  }finally{await db.runTransaction(async tx=>{const value=(await tx.get(ref)).data();if(value?.lease===lease)tx.set(ref,{...value,cursor,leaseUntil:0,status:cursor>=value.notices.length?'done':'pending',...(cursor>=value.notices.length?{completedAt:new Date().toISOString(),notices:[]}: {})});});}
 }
 return !(await db.collection(COMPETITION_OUTBOX).where('status','==','pending').limit(1).get()).empty;
}
