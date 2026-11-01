import {createHash,randomUUID} from 'node:crypto';
import {waitUntil} from '@vercel/functions';
import {getFirestoreDb} from '../firebase/admin';
import type {UState} from '../../types/uzeflife';
import {uError} from './uzeflifeService';
import {UZEFLIFE_RESULT_TOPIC_URL} from '../../lib/uzeflifeResultTopic';
import {renderUzeflifeRoundPages} from './uzeflifeRoundImages';

export const U_POST_CHANNEL='@uzeflife_turner';
const collection='uzeflife_channel_posts';
const refFor=(round:number)=>getFirestoreDb().collection(collection).doc('round-'+round);
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const caption=(round:number)=>'🏆 <b>UZEFLIFE - '+round+' tur o‘yinlari ma’lum</b>\n\n⚠️ <b>Deadline:</b>\n1 kun\n\n📃 <b>Reglament:</b>\nhttps://t.me/efluz_cards/16\n\n📊 <b>Natijalar bu yerga tashlanadi:</b>\n'+UZEFLIFE_RESULT_TOPIC_URL+'\n\n👉 '+U_POST_CHANNEL;
function roundData(state:UState,round:number) {
 if(state.format!=='LEAGUE'||!['playing','paused','completed'].includes(state.status)||!Number.isInteger(round)||round<1||round>state.round)throw uError('Faqat ochilgan liga turini yuborish mumkin.',409);
 const matches=state.matches.filter(m=>m.round===round);
 if(!matches.length)throw uError('Bu turda o‘yinlar yo‘q.',409);
 const snapshot:UState={...state,matches:matches.map(m=>({...m,proposal:null,dispute:null})),participants:state.participants.map(p=>({id:p.id,name:p.name,status:p.status})),assistants:{},channels:[],announcements:[]};
 return {snapshotJson:JSON.stringify(snapshot),totalPages:Math.ceil(matches.length/8),matchCount:matches.length,fingerprint:digest(matches.map(m=>[m.id,m.home,m.away]))};
}
const progress=(record:any,total:number)=>Math.min(total,Math.max(0,Number((record?.sentPages??(record?.state==='sent'?total:record?.telegramMessageIds?.length))||0)));
export function roundPostView(record:any,round:number,totalPages:number,matchCount:number) {
 if(!record)return {round,channel:U_POST_CHANNEL,state:'idle',sentPages:0,totalPages,matchCount,checkpoint:null,canReconcile:false};
 const sentPages=progress(record,totalPages);
 const expired=record.state==='sending'&&(!record.leaseUntil||record.leaseUntil<Date.now());
 const state=expired?'unverified':record.state||'unverified';
 return {round,channel:U_POST_CHANNEL,state,sentPages,totalPages,matchCount,error:record.error||null,
  checkpoint:digest([record.version??1,record.state,record.sentPages??null,record.leaseUntil??null,record.inFlight?[record.inFlight.start,record.inFlight.count,record.inFlight.lease]:null,record.telegramMessageIds||[],record.at??null,record.fingerprint??null]),canReconcile:state==='unverified',legacy:record.version!==2,
  minConfirmed:sentPages,maxConfirmed:record.version===2&&record.inFlight?Math.min(totalPages,record.inFlight.start+record.inFlight.count):totalPages};
}
export async function getRoundPostStatus(state:UState,round:number) {
 const data=roundData(state,round),record=(await refFor(round).get()).data();
 return roundPostView(record,round,data.totalPages,data.matchCount);
}
/** Owner-only polling needs the job receipt, not all 1,815 tournament fixtures. */
export async function getSavedRoundPostStatus(round:number) {
 if(!Number.isInteger(round)||round<1||round>15)throw uError('Tur raqami noto‘g‘ri.',400);
 const record=(await refFor(round).get()).data();
 const pages=record?.totalPages??record?.imageCount;
 const totalPages=Number.isInteger(pages)&&pages>0?pages:null;
 const matchCount=Number.isInteger(record?.matchCount)&&record.matchCount>0?record.matchCount:null;
 const view=roundPostView(record,round,totalPages??16,matchCount??0);
 return {...view,totalPages,matchCount,...(totalPages===null&&record?.version!==2?{maxConfirmed:null}:{})};
}
export async function requestRoundPost(state:UState,round:number,requestedBy:string) {
 if(process.env.MIGRATION_WRITE_FREEZE==='true')throw uError('Yuborish vaqtincha to‘xtatilgan.',503);
 if(!process.env.TELEGRAM_BOT_TOKEN)throw uError('Telegram bot tokeni sozlanmagan.',503);
 const data=roundData(state,round),db=getFirestoreDb(),ref=refFor(round);
 const record=await db.runTransaction(async tx=>{
  const old=(await tx.get(ref)).data();
  if(old?.fingerprint&&old.fingerprint!==data.fingerprint)throw uError('Bu tur tarkibi o‘zgargan. Oldingi e’lonni tekshiring.',409);
  if(old){
   const view=roundPostView(old,round,data.totalPages,data.matchCount);
   if(view.canReconcile)throw uError('Oldingi yuborish natijasi noma’lum. Avval kanalni tekshirib, yuborilgan rasmlar sonini tasdiqlang.',409);
   if(view.state!=='failed')return old;
  }
  const current=(await tx.get(db.collection('uzeflife').doc('championship'))).data();
  if(!current||current.revision!==state.revision)throw uError('Turnir yangilangan. Holatni yangilab, qayta yuboring.',409);
  const next={...old,...data,version:2,round,channel:U_POST_CHANNEL,state:'pending',sentPages:progress(old,data.totalPages),telegramMessageIds:old?.telegramMessageIds||[],requestedBy,leaseUntil:0,inFlight:null,error:null,at:new Date().toISOString()};
  tx.set(ref,next);return next;
 });
 return roundPostView(record,round,data.totalPages,data.matchCount);
}
/** Explicit owner reconciliation is required when Telegram may have accepted an album. */
export async function reconcileRoundPost(state:UState,round:number,requestedBy:string,checkpoint:string,confirmedPages:number) {
 if(process.env.MIGRATION_WRITE_FREEZE==='true')throw uError('Yuborish vaqtincha to‘xtatilgan.',503);
 const data=roundData(state,round),db=getFirestoreDb(),ref=refFor(round);
 const record=await db.runTransaction(async tx=>{
  const old=(await tx.get(ref)).data(),view=roundPostView(old,round,data.totalPages,data.matchCount);
  if(old?.fingerprint&&old.fingerprint!==data.fingerprint)throw uError('Bu tur tarkibi o‘zgargan. Oldingi e’lonni tekshiring.',409);
  if(!view.canReconcile||view.checkpoint!==checkpoint)throw uError('Yuborish holati yangilangan. Qayta tekshiring.',409);
  if(!Number.isInteger(confirmedPages)||confirmedPages<view.minConfirmed!||confirmedPages>view.maxConfirmed!)throw uError('Tasdiqlangan rasmlar soni noto‘g‘ri.',400);
  // A new album is acknowledged as a whole; never split an uncertain album.
  if(old?.version===2&&old.inFlight&&![view.minConfirmed,view.maxConfirmed].includes(confirmedPages))throw uError('Oxirgi yuborish to‘liq bajarilgan yoki bajarilmagan deb tasdiqlanadi.',400);
  const next={...old,...data,version:2,round,channel:U_POST_CHANNEL,state:confirmedPages===data.totalPages?'sent':'pending',sentPages:confirmedPages,requestedBy,leaseUntil:0,inFlight:null,error:null,reconciledAt:new Date().toISOString(),at:new Date().toISOString()};
  tx.set(ref,next);return next;
 });
 return roundPostView(record,round,data.totalPages,data.matchCount);
}
/** Owner explicitly requested replacement of the historical blank first-round
 * album. Archive its receipt and reset once; retries never reset live progress. */
export async function repairLegacyFirstRoundImages():Promise<boolean> {
 if(process.env.MIGRATION_WRITE_FREEZE==='true'||process.env.DATABASE_PROVIDER==='supabase'&&process.env.SUPABASE_DATA_NAMESPACE==='preview'&&process.env.NODE_ENV!=='test')return false;
 const db=getFirestoreDb(),ref=refFor(1),repair=db.collection('uzeflife_channel_post_repairs').doc('first-round-20261101-font-fix');
 return db.runTransaction(async tx=>{
  const old=(await tx.get(ref)).data();
  // Match only the exact legacy publication reported by the owner. New jobs,
  // partial deliveries and other rounds never qualify for this replacement.
  if(!old||old.version===2||old.at!=='2026-10-31T18:05:20.617Z'||old.sentPages!==16||old.totalPages!==16||!Array.isArray(old.telegramMessageIds)||old.telegramMessageIds.length!==16)return false;
  if((await tx.get(repair)).exists)return false;
  const state=(await tx.get(db.collection('uzeflife').doc('championship'))).data() as UState|undefined;
  if(!state||state.format!=='LEAGUE'||state.round<1||!['playing','paused','completed'].includes(state.status))return false;
  const data=roundData(state,1);if(data.matchCount!==121||data.totalPages!==16)return false;
  const at=new Date().toISOString();
  tx.set(repair,{ownerTelegramId:'5209126900',reason:'Owner reported blank/identical images and explicitly requested corrected repost',previous:old,at});
  tx.set(ref,{...data,version:2,round:1,channel:U_POST_CHANNEL,state:'pending',sentPages:0,telegramMessageIds:[],requestedBy:'owner-authorized-repair-20261101',repairId:repair.id,leaseUntil:0,inFlight:null,error:null,at});
  return true;
 });
}
type Pages=Awaited<ReturnType<typeof renderUzeflifeRoundPages>>;
type Dependencies={render?:(state:UState,round:number)=>Promise<Pages>;send?:(pages:Pages,round:number)=>Promise<number[]>};
class RejectedPost extends Error {}
export async function sendUzeflifeRoundPages(pages:Pages,round:number):Promise<number[]> {
 const token=process.env.TELEGRAM_BOT_TOKEN;
 if(!token)throw new RejectedPost('Bot tokeni sozlanmagan.');
 if(pages.length!==1)throw new RejectedPost('Har bir rasm alohida yuborilishi kerak.');
 const page=pages[0],form=new FormData();form.set('chat_id',U_POST_CHANNEL);
 form.set('photo',new Blob([new Uint8Array(page.buffer)],{type:'image/png'}),'uzeflife-'+round+'-'+page.first+'.png');
 form.set('caption',caption(round));form.set('parse_mode','HTML');
 const response=await fetch('https://api.telegram.org/bot'+token+'/sendPhoto',{method:'POST',body:form,signal:AbortSignal.timeout(15000)});
 const result=await response.json() as any;
 if(result?.ok===false&&[400,401,403,404,429].includes(Number(result.error_code)))throw new RejectedPost(result.error_code===429?'Telegram limiti. Birozdan keyin davom ettiring.':'Telegram kanalga yuborishni rad etdi. Botning kanaldagi admin huquqini tekshiring.');
 const messages=[result.result];
 if(!response.ok||result.ok!==true||!Array.isArray(messages)||messages.length!==pages.length||messages.some((m:any)=>!Number.isSafeInteger(m?.message_id)||m.message_id<1))throw Error('TELEGRAM_DELIVERY_UNCERTAIN');
 return messages.map((m:any)=>m.message_id);
}
/** One separately captioned photo per lease/request. The in-flight checkpoint is persisted BEFORE sending. */
export async function processRoundPost(round:number,deps:Dependencies={}):Promise<boolean> {
 const db=getFirestoreDb(),ref=refFor(round),old=(await ref.get()).data();
 if(!old||old.version!==2||old.state!=='pending')return false;
 if(process.env.MIGRATION_WRITE_FREEZE==='true'||process.env.DATABASE_PROVIDER==='supabase'&&process.env.SUPABASE_DATA_NAMESPACE==='preview'&&!(process.env.NODE_ENV==='test'&&deps.send))return false;
 let pages:Pages;
 try{pages=await (deps.render||renderUzeflifeRoundPages)(old.snapshotJson?JSON.parse(old.snapshotJson):old.snapshot,round);if(pages.length!==old.totalPages||pages.reduce((n,p)=>n+p.count,0)!==old.matchCount)throw Error('INCOMPLETE_IMAGES');}
 catch{await db.runTransaction(async tx=>{const current=(await tx.get(ref)).data();if(current?.state==='pending'&&current.fingerprint===old.fingerprint)tx.update(ref,{state:'failed',error:'Rasmlarni tayyorlab bo‘lmadi. Qayta urinib ko‘ring.'});});return false;}
 const lease=randomUUID();
 const claimed=await db.runTransaction(async tx=>{
  const current=(await tx.get(ref)).data();
  if(!current||current.state!=='pending'||current.sentPages!==old.sentPages||current.fingerprint!==old.fingerprint)return null;
  const start=current.sentPages,count=Math.min(1,pages.length-start);
  if(count<=0){tx.update(ref,{state:'sent'});return null;}
  const {snapshot,...compact}=current;
  const next={...compact,snapshotJson:current.snapshotJson||JSON.stringify(snapshot),state:'sending',leaseUntil:Date.now()+90000,inFlight:{start,count,lease},at:new Date().toISOString()};tx.set(ref,next);return next;
 });
 if(!claimed)return false;
 let ids:number[];
 try{ids=await (deps.send||sendUzeflifeRoundPages)(pages.slice(claimed.inFlight.start,claimed.inFlight.start+claimed.inFlight.count),round);}
 catch(error){
  const rejected=error instanceof RejectedPost;
  await db.runTransaction(async tx=>{const current=(await tx.get(ref)).data();if(current?.inFlight?.lease!==lease)return;tx.update(ref,{state:rejected?'failed':'unverified',leaseUntil:0,...(rejected?{inFlight:null}:{}),error:rejected?error.message:'Telegram javobi tasdiqlanmadi. Takror yuborishdan oldin kanalni tekshiring.'});});
  return false;
 }
 // A failed checkpoint write leaves the durable in-flight marker untouched.
 // The next request shows "unverified" rather than sending the same photo again.
 return db.runTransaction(async tx=>{
  const current=(await tx.get(ref)).data();if(current?.inFlight?.lease!==lease)return false;
  const sentPages=claimed.inFlight.start+claimed.inFlight.count,pending=sentPages<pages.length;
  tx.update(ref,{sentPages,state:pending?'pending':'sent',telegramMessageIds:[...(current.telegramMessageIds||[]),...ids],leaseUntil:0,inFlight:null,error:null,at:new Date().toISOString()});return pending;
 });
}
export async function processPendingRoundPost():Promise<boolean> {
 const jobs=await getFirestoreDb().collection(collection).where('state','==','pending').limit(1).get();
 if(jobs.empty)return false;
 if(process.env.VERCEL==='1'){await triggerRoundPostWorker(jobs.docs[0].data().round,0);return false;}
 await processRoundPost(jobs.docs[0].data().round);
 return true;
}
export async function triggerRoundPostWorker(round:number,hop=0) {
 if(!Number.isInteger(round)||round<1||round>15||!Number.isInteger(hop)||hop<0||hop>32)throw Error('INVALID_ROUND_POST_WORKER_REQUEST');
 const host=process.env.VERCEL_ENV==='production'?process.env.VERCEL_PROJECT_PRODUCTION_URL||process.env.VERCEL_URL:process.env.VERCEL_URL;
 const secret=process.env.CRON_SECRET;
 if(!host||!/^[a-zA-Z0-9.-]+\.vercel\.app$/.test(host)||!secret)throw Error('ROUND_POST_WORKER_CONFIG_REQUIRED');
 const headers:Record<string,string>={authorization:'Bearer '+secret};
 if(process.env.VERCEL_AUTOMATION_BYPASS_SECRET)headers['x-vercel-protection-bypass']=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
 const response=await fetch(`https://${host}/api/internal/uzeflife-post-worker?round=${round}&hop=${hop}`,{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(5000)});
 if(!response.ok)throw Error('ROUND_POST_WORKER_UNAVAILABLE');
}
/** A fresh function invocation supplies the complete time budget for one album. */
export async function runRoundPostWorker(round:number,hop=0):Promise<void> {
 const pending=await processRoundPost(round);
 if(pending&&hop<32){if(process.env.VERCEL==='1')await triggerRoundPostWorker(round,hop+1);else await runRoundPostWorker(round,hop+1);}
}
export function scheduleRoundPost(round:number) {
 if(process.env.VERCEL!=='1'&&!process.env.K_SERVICE)return;
 const work=(process.env.VERCEL==='1'?triggerRoundPostWorker(round):runRoundPostWorker(round)).catch(()=>console.warn('[UZEFLIFE_CHANNEL_POST_DEFERRED]'));
 if(process.env.VERCEL==='1')waitUntil(work);else void work;
}
