import {getFirestoreDb} from '../firebase/admin';
import {getNotificationStore} from './postgresNotificationStore';
import {KEY_PREFIX} from '../readModel/readModelStore';
import {withinAiDeadline} from './telegramAiDeadline';
import type {UState} from '../../types/uzeflife';

export interface DailyReportOperations {
 locks?: any[]; deadlines?:any[]; uzeflife?: UState|null; channelPosts?: any[];
 teams?: any[]; clasico?: any|null;
 users?: {total:number;newUsers:number}; payments?: any[]; broadcasts?: any[];
 unavailable: string[];
}
/** Private owner report only. No initialization, migrations, queue drains or writes. */
export async function loadDailyReportOperations(now:Date):Promise<DailyReportOperations>{
 const db=getFirestoreDb(),start=new Date(now.getTime()-86400000).toISOString();
 const result:DailyReportOperations={unavailable:[]};
 const rows=async(collection:string,query:any=db.collection(collection),limit=501)=>{
  const docs=(await query.limit(limit).get()).docs;
  if(docs.length===limit)throw Error('REPORT_SOURCE_LIMIT');
  return docs.map((d:any)=>({...d.data(),id:d.id}));
 };
 const sources: Array<[keyof Omit<DailyReportOperations,'unavailable'>,string,()=>Promise<any>]>= [
  ['locks','Tur muddatlari',()=>rows('matchday_locks',db.collection('matchday_locks').where('seasonId','==','season-2026-27'),2001)],
  ['deadlines','Alohida o‘yin muddatlari',()=>rows('match_deadlines',db.collection('match_deadlines').where('seasonId','==','season-2026-27'),2001)],
  ['uzeflife','UZEFLIFE',async()=>{const data=(await db.collection('uzeflife').doc('championship').get()).data();if(data&&(!Array.isArray(data.matches)||!Array.isArray(data.participants)||!Number.isInteger(data.round)))throw Error('INVALID_REPORT_SOURCE');return data||null;}],
  ['channelPosts','Kanal e’lonlari',()=>rows('uzeflife_channel_posts')],
  ['teams','TEAMS',()=>rows('team_league_preview_leagues')],
  ['clasico','El-Clasico',async()=>{const doc=await db.collection('el_clasico_events').doc('el-clasico').get();return doc.data()||null;}],
  ['users','Foydalanuvchilar',async()=>{const [total,fresh]=await Promise.all([db.collection('users').count().get(),db.collection('users').where('createdAt','>',start).where('createdAt','<=',now.toISOString()).count().get()]);return {total:total.data().count,newUsers:fresh.data().count};}],
  ['payments','Premium to‘lovlar',()=>rows('premium_payments',db.collection('premium_payments').where('paidAt','>=',start).where('paidAt','<=',now.toISOString()))],
  ['broadcasts','Telegram yetkazilishi',async()=>{const store=getNotificationStore();if(!store)throw Error('NOTIFICATION_STORE_UNAVAILABLE');const records=await store.hgetall(`${KEY_PREFIX}:telegram:broadcasts`);return Object.values(records||{});}],
 ];
 const outcomes=await Promise.allSettled(sources.map(([, ,load])=>withinAiDeadline(AbortSignal.timeout(12000),load)));
 outcomes.forEach((outcome,index)=>{const [key,label]=sources[index];if(outcome.status==='fulfilled')(result as any)[key]=outcome.value;else result.unavailable.push(label);});
 return result;
}
