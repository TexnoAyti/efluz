import {createUzeflifeMatches,UZEFLIFE_CHAMPION_MATCHES} from '../../lib/uzeflifeBracket';
import {randomUUID, randomInt} from 'node:crypto';
import {z} from 'zod';
import {getFirestoreDb} from '../firebase/admin';
import {isPrimaryOwner} from './customTournamentTicketService';
import {UZEFLIFE_PERMISSIONS, type UState, type UMatch, type UPermission, type UChannel} from '../../types/uzeflife';
import type {User} from '../../types';
import {writeUNotices,scheduleUNotices} from './uzeflifeNotifications';
import {normalizeUEvidence} from './uzeflifeEvidence';

export const initialUState=():UState=>({name:'UZEFLIFE',description:'256 ishtirokchi · 8 ta 32 kishilik saralash · 8 g‘olib o‘rtasida final bosqichi',status:'draft',round:0,superAdmin:null,assistants:{},channels:[],subscriptionsEnabled:false,customNavigationEnabled:false,roundHours:48,history:[],participants:[],matches:[],announcements:[],revision:0});
export function uError(message:string,statusCode=400){return Object.assign(new Error(message),{statusCode});}
export function uPermissions(s:UState,u:User):UPermission[]{return isPrimaryOwner(u.telegramId)||s.superAdmin===u.id?[...UZEFLIFE_PERMISSIONS]:(Object.hasOwn(s.assistants,u.id)?s.assistants[u.id]:[]);}
export function requireUPermission(s:UState,u:User,p:UPermission|'super'|'owner'){
 const owner=isPrimaryOwner(u.telegramId);
 if(p==='owner'?owner:p==='super'?(owner||s.superAdmin===u.id):uPermissions(s,u).includes(p))return;
 throw uError('Bu amal uchun ruxsatingiz yo‘q.',403);
}
export function generateUBracket(ids:string[]):UMatch[]{
 if(ids.length!==256||new Set(ids).size!==256)throw uError('256 ta tasdiqlangan ishtirokchi kerak.');
 return createUzeflifeMatches(ids);
}
const score=z.number().int().min(0).max(99);
const schemas={
 roundSettings:z.object({hours:z.number().int().min(24).max(168)}),
 deadline:z.object({matchId:z.string(),deadlineAt:z.iso.datetime()}),
 approveResult:z.object({matchId:z.string(),expected:z.object({by:z.string(),home:score,away:score,penaltyHome:score.nullable(),penaltyAway:score.nullable()})}),
 dispute:z.object({matchId:z.string(),reason:z.string().trim().min(5).max(1000),evidence:z.string().max(400000).nullable().optional()}),
 resolveDispute:z.object({matchId:z.string(),resolution:z.string().trim().min(5).max(1000)}),
 settings:z.object({description:z.string().trim().max(2000)}),
 superAdmin:z.object({target:z.string().min(1).max(100).nullable()}),
 assistant:z.object({target:z.string().min(1).max(100),permissions:z.array(z.enum(UZEFLIFE_PERMISSIONS)).max(8)}),
 removeAssistant:z.object({target:z.string().min(1).max(100)}),
 clearProposal:z.object({matchId:z.string()}),
 customNavigation:z.object({enabled:z.boolean()}),
 subscriptions:z.object({enabled:z.boolean()}),
 addChannel:z.object({id:z.string().regex(/^(@[A-Za-z][A-Za-z0-9_]{4,31}|-100\d{5,17})$/),title:z.string().trim().min(1).max(100),url:z.url().refine(v=>{const u=new URL(v);return u.protocol==='https:'&&u.hostname==='t.me'&&!u.username&&!u.password;})}),
 removeChannel:z.object({id:z.string().min(1).max(100)}),
 addParticipant:z.object({target:z.string().trim().min(1).max(100)}),
 register:z.object({}),review:z.object({target:z.string().min(1).max(100),status:z.enum(['approved','removed'])}),
 open:z.object({}),close:z.object({}),generate:z.object({}),pause:z.object({}),resume:z.object({}),next:z.object({}),complete:z.object({}),
 schedule:z.object({matchId:z.string(),scheduledAt:z.iso.datetime()}),
 result:z.object({matchId:z.string(),home:score,away:score,penaltyHome:score.nullable().default(null),penaltyAway:score.nullable().default(null)}),
 announce:z.object({text:z.string().trim().min(1).max(2000)}),
};
export type UAction=keyof typeof schemas;
export function validateUAction(action:string,body:unknown):{action:UAction;data:any}{
 if(!Object.hasOwn(schemas,action))throw uError('Noma’lum amal.');
 const parsed=schemas[action as UAction].safeParse(body);if(!parsed.success)throw uError('Kiritilgan ma’lumotlar noto‘g‘ri.');
 return {action:action as UAction,data:parsed.data};
}
export async function verifyUChannels(channels:UChannel[],telegramId:string,token=process.env.TELEGRAM_BOT_TOKEN,fetcher:typeof fetch=fetch){
 if(!/^\d+$/.test(telegramId)||!token)throw uError('Telegram obunasini tekshirish hozir imkonsiz. Qayta urinib ko‘ring.',503);
 const missing=await Promise.all(channels.map(async channel=>{
 // No success cache: every protected participation rechecks the current channel set.

  let payload:any;try{const response=await fetcher(`https://api.telegram.org/bot${token}/getChatMember`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:channel.id,user_id:telegramId}),signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error();payload=await response.json();}catch{throw uError('Telegram obunasini tekshirib bo‘lmadi. Bot kanal administratori ekanini tekshiring.',503);}
  if(!payload.ok||!payload.result)throw uError('Kanal a’zoligi tasdiqlanmadi. Bot huquqlarini tekshiring.',503);
  const member=payload.result;
  if(!['creator','administrator','member'].includes(member.status)&&!(member.status==='restricted'&&member.is_member===true))return channel;
 return null;
 }));
 return missing.filter((c):c is UChannel=>c!==null);
}
export async function checkUSubscriptions(s:UState,u:User){
 if(!s.subscriptionsEnabled||!s.channels.length)return [];
 return verifyUChannels(s.channels,u.telegramId||'');
}
export function applyUAction(s:UState,u:User,action:UAction,d:any):void{
 const guard=(p:UPermission|'super'|'owner')=>requireUPermission(s,u,p);
 const beforeStart=()=>{if(!['draft','registration'].includes(s.status)||s.matches.length)throw uError('Turnir boshlangan.');};
 const openRound=()=>{for(const m of s.matches.filter(m=>m.round===s.round&&!m.winner))m.deadlineAt=new Date(Date.now()+(s.roundHours||48)*3600000).toISOString();};
 switch(action){
 case 'roundSettings':guard('schedules');s.roundHours=d.hours;break;
 case 'deadline':guard('schedules');{const m=s.matches.find(m=>m.id===d.matchId);if(!m||m.winner||s.status==='completed')throw uError('O‘yin topilmadi yoki yakunlangan.');if(Date.parse(d.deadlineAt)<=Date.now()||Date.parse(d.deadlineAt)>Date.now()+30*86400000)throw uError('Kelajakdagi muddatni belgilang (30 kungacha).');m.deadlineAt=d.deadlineAt;}break;
 case 'approveResult':{guard('results');const m=s.matches.find(m=>m.id===d.matchId);if(!m?.proposal)throw uError('Tasdiq kutayotgan natija topilmadi.',409);if(['by','home','away','penaltyHome','penaltyAway'].some(k=>m.proposal![k]!==d.expected[k]))throw uError('Hisob taklifi yangilangan. Ro‘yxatni yangilab qayta tekshiring.',409);if(m.dispute?.status==='open')throw uError('Avval e’tirozni hal qiling.',409);applyUAction(s,u,'result',{matchId:m.id,...m.proposal});return;}
 case 'dispute':{
  const m=s.matches.find(m=>m.id===d.matchId);if(!m||s.status!=='playing'||m.round!==s.round||m.winner||!m.proposal)throw uError('Bu o‘yin natijasiga e’tiroz qabul qilinmaydi.');
  if(![m.home,m.away].includes(u.id)||s.participants.find(p=>p.id===u.id)?.status!=='approved')throw uError('Bu sizning o‘yiningiz emas.',403);
  if(m.dispute?.status==='open')throw uError('E’tiroz allaqachon yuborilgan.');
  m.dispute={by:u.id,reason:d.reason,at:new Date().toISOString(),evidenceId:d.evidenceId||null,status:'open'};break;
 }
 case 'resolveDispute':{guard('results');const m=s.matches.find(m=>m.id===d.matchId);if(!m||m.dispute?.status!=='open')throw uError('Ochiq e’tiroz topilmadi.',409);m.dispute={...m.dispute,status:'resolved',resolution:d.resolution,resolvedBy:u.id,resolvedAt:new Date().toISOString()};m.proposal=null;break;}
 case 'settings':guard('super');s.description=d.description;break;
 case 'customNavigation':guard('owner');s.customNavigationEnabled=d.enabled;break;
 case 'superAdmin':guard('owner');if(d.target===u.id)throw uError('Platforma egasiga alohida rol kerak emas.');s.superAdmin=d.target;if(d.target)delete s.assistants[d.target];break;
 case 'assistant':guard('super');if(d.target===s.superAdmin||d.target===u.id)throw uError('Bu foydalanuvchining rolini o‘zgartirib bo‘lmaydi.');if(!Object.hasOwn(s.assistants,d.target)&&Object.keys(s.assistants).length>=32)throw uError('Ko‘pi bilan 32 yordamchi.');s.assistants[d.target]=[...new Set(d.permissions)] as UPermission[];break;
 case 'removeAssistant':guard('super');delete s.assistants[d.target];break;
 case 'subscriptions':guard('channels');s.subscriptionsEnabled=d.enabled;break;
 case 'addChannel':guard('channels');if(s.channels.length>=8&&!s.channels.some(c=>c.id===d.id))throw uError('Ko‘pi bilan 8 ta kanal.');s.channels=s.channels.filter(c=>c.id!==d.id).concat(d);break;
 case 'removeChannel':guard('channels');s.channels=s.channels.filter(c=>c.id!==d.id);break;
 case 'open':guard('registrations');beforeStart();s.status='registration';break;
 case 'close':guard('registrations');beforeStart();s.status='draft';break;
 case 'register':{
  if(s.status!=='registration')throw uError('Ro‘yxatdan o‘tish yopiq.');
  if(s.participants.some(p=>p.id===u.id&&p.status!=='removed'))throw uError('Siz allaqachon ro‘yxatdan o‘tgansiz.');
  if(s.participants.length>=512)throw uError('Arizalar chegarasiga yetildi.');
  if(s.participants.filter(p=>p.status!=='removed').length>=256)throw uError('Barcha 256 o‘rin band.');
  s.participants=s.participants.filter(p=>p.id!==u.id);s.participants.push({id:u.id,name:(u.firstName||u.username||'Ishtirokchi').slice(0,100),status:'pending'});break;
 }
 case 'addParticipant':{
  guard('participants');beforeStart();
  const p=s.participants.find(p=>p.id===d.participant.id);
  if(p?.status==='approved')throw uError('Bu o‘yinchi allaqachon qo‘shilgan.');
  if((!p||p.status==='removed')&&s.participants.filter(p=>p.status!=='removed').length>=256)throw uError('Barcha 256 o‘rin band.');
  if(!p&&s.participants.length>=512)throw uError('Arizalar chegarasiga yetildi.');
  if(p){p.name=d.participant.name;p.status='approved';}
  else s.participants.push({...d.participant,status:'approved'});
  break;
 }
 case 'review':guard('participants');if(d.status==='approved')beforeStart();if(s.status==='completed')throw uError('Turnir yakunlangan.');{const p=s.participants.find(p=>p.id===d.target);if(!p)throw uError('Ishtirokchi topilmadi.',404);if(d.status==='approved'&&p.status==='removed'&&s.participants.filter(p=>p.status!=='removed').length>=256)throw uError('Barcha 256 o‘rin band.');p.status=d.status;}break;
 case 'generate':guard('brackets');beforeStart();{const ids=s.participants.filter(p=>p.status==='approved').map(p=>p.id);for(let i=ids.length-1;i>0;i--){const j=randomInt(i+1);[ids[i],ids[j]]=[ids[j],ids[i]];}s.matches=generateUBracket(ids);s.status='playing';s.round=1;openRound();}break;
 case 'pause':guard('super');if(s.status!=='playing')throw uError('Turnir davom etmayapti.');s.status='paused';break;
 case 'resume':guard('super');if(s.status!=='paused')throw uError('Turnir to‘xtatilmagan.');s.status='playing';break;
 case 'next':guard('brackets');if(s.status!=='playing'||s.round>=UZEFLIFE_CHAMPION_MATCHES||s.matches.some(m=>m.round===s.round&&!m.winner))throw uError('Joriy bosqich o‘yinlari tugamagan.');s.round++;openRound();break;
 case 'complete':guard('super');if(s.status!=='playing'||!s.matches.find(m=>m.round===8)?.winner)throw uError('Final yakunlanmagan.');{const final=s.matches.find(m=>m.round===8)!;const runnerUp=final.winner===final.home?final.away!:final.home!;const player=(id:string)=>s.participants.find(p=>p.id===id)?.name||'Ishtirokchi';s.history=[{id:'uzeflife-'+randomUUID(),completedAt:new Date().toISOString(),champion:final.winner!,runnerUp,championName:player(final.winner!),runnerUpName:player(runnerUp),matchCount:s.matches.filter(m=>m.winner).length},...(s.history||[])].slice(0,20);}s.status='completed';break;
 case 'clearProposal':if(!uPermissions(s,u).includes('results'))guard('matches');{const m=s.matches.find(m=>m.id===d.matchId);if(!m||m.winner)throw uError('O‘yin topilmadi yoki yakunlangan.');if(m.dispute?.status==='open')throw uError('Avval e’tirozni hal qiling.',409);m.proposal=null;}break;
 case 'schedule':guard('schedules');{const m=s.matches.find(m=>m.id===d.matchId);if(!m)throw uError('O‘yin topilmadi.',404);if(s.status==='completed'||m.winner)throw uError('O‘yin yakunlangan.');m.scheduledAt=d.scheduledAt;}break;
 case 'result':{
  const m=s.matches.find(m=>m.id===d.matchId);if(!m)throw uError('O‘yin topilmadi.',404);
  if(s.status!=='playing'||m.round!==s.round||!m.home||!m.away)throw uError('Bu o‘yin uchun natija qabul qilinmaydi.');
  if(m.dispute?.status==='open')throw uError('Avval e’tirozni admin hal qilishi kerak.',409);
  const admin=uPermissions(s,u).includes('results');
  if(!admin&&s.participants.find(p=>p.id===u.id)?.status!=='approved')throw uError('Ishtirokingiz bekor qilingan.',403);
  if(!admin&&u.id!==m.home&&u.id!==m.away)throw uError('Bu sizning o‘yiningiz emas.',403);
  if(m.winner&&!admin)throw uError('Natija allaqachon tasdiqlangan.');
  const winner=d.home===d.away?(d.penaltyHome!==null&&d.penaltyAway!==null&&d.penaltyHome!==d.penaltyAway?(d.penaltyHome>d.penaltyAway?m.home:m.away):null):d.home>d.away?m.home:m.away;
  if(!winner)throw uError('Durangda penaltilar g‘olibini ko‘rsating.');
  if(!admin){if(!m.proposal){m.proposal={by:u.id,home:d.home,away:d.away,penaltyHome:d.penaltyHome,penaltyAway:d.penaltyAway};break;}
   if(m.proposal.by===u.id)throw uError('Raqib yoki administrator tasdig‘ini kuting.');
   if(['home','away','penaltyHome','penaltyAway'].some(k=>m.proposal![k]!==d[k]))throw uError('Natija mos kelmadi. Administratorga murojaat qiling.');
  }
  const index=Number(m.id.split('m')[1]),next=s.matches.find(n=>n.id===`r${m.round+1}m${Math.floor(index/2)}`);
  if(next&&(next.proposal||next.winner))throw uError('Keyingi o‘yin boshlangan, natijani o‘zgartirish mumkin emas.');
  m.homeScore=d.home;m.awayScore=d.away;m.penaltyHome=d.penaltyHome;m.penaltyAway=d.penaltyAway;m.winner=winner;m.proposal=null;
  if(next)next[index%2===0?'home':'away']=winner;
  break;
 }
 case 'announce':guard('announcements');if(s.announcements.length>=100)throw uError('E’lonlar chegarasiga yetildi.');s.announcements.unshift({id:randomUUID(),text:d.text,at:new Date().toISOString()});break;
 }
 s.revision++;
}
export async function readUState():Promise<UState>{const snap=await getFirestoreDb().collection('uzeflife').doc('championship').get();return snap.exists?snap.data() as UState:initialUState();}
async function resolveTarget(target:string):Promise<string>{
 const db=getFirestoreDb();const doc=await db.collection('users').doc(target).get();
 if(doc.exists&&!doc.data()?.isSuspended&&doc.data()?.telegramId)return doc.id;
 const users=await db.collection('users').where('telegramId','==',target).limit(2).get();
 if(users.docs.length!==1||users.docs[0].data().isSuspended)throw uError('Tasdiqlangan EFLUZ akkaunti topilmadi.',404);
 return users.docs[0].id;
}
export async function mutateUState(u:User,action:string,body:unknown){
 const parsed=validateUAction(action,body),d=parsed.data;
 const db=getFirestoreDb(),ref=db.collection('uzeflife').doc('championship');
 // Resolve role targets only after permission checks. Never accept a caller-supplied identity.
 if(['superAdmin','assistant','removeAssistant'].includes(action)){
  requireUPermission(await readUState(),u,action==='superAdmin'?'owner':'super');
  if(d.target&&action!=='removeAssistant')d.target=await resolveTarget(d.target);
 }
 let subscriptionRevision:number|undefined;let participantTelegramId:string|undefined;
 if(action==='addParticipant'){
  const current=await readUState();requireUPermission(current,u,'participants');
  d.target=await resolveTarget(d.target);
  const target=(await db.collection('users').doc(d.target).get()).data() as User|undefined;
  if(!target||target.isSuspended||!target.telegramId)throw uError('Tasdiqlangan EFLUZ akkaunti topilmadi.',404);
  participantTelegramId=target.telegramId;
  const missing=await checkUSubscriptions(current,target);
  if(missing.length)throw uError('O‘yinchi avval barcha majburiy kanallarga obuna bo‘lishi kerak.',403);
  subscriptionRevision=current.revision;
 }
 if(action==='dispute')d.evidence=await normalizeUEvidence(d.evidence);
 if(action==='register'||action==='result'||action==='dispute'){
  const current=await readUState();
  if(action==='register'||!uPermissions(current,u).includes('results')){
   const missing=await checkUSubscriptions(current,u);if(missing.length)throw Object.assign(uError('Avval barcha majburiy kanallarga obuna bo‘ling.',403),{channels:missing});
   subscriptionRevision=current.revision;
  }
 }
 const auditId=randomUUID();
 await db.runTransaction(async tx=>{
  const snap=await tx.get(ref);const s=snap.exists?snap.data() as UState:initialUState();
  if(subscriptionRevision!==undefined&&subscriptionRevision!==s.revision)throw uError('Turnir yangilandi. Obunani qayta tekshiring.',409);
  if(action==='addParticipant'){
   requireUPermission(s,u,'participants');
   const target=await tx.get(db.collection('users').doc(d.target));const account=target.data() as User|undefined;
   if(!target.exists||!account||account.isSuspended||!account.telegramId)throw uError('Tasdiqlangan EFLUZ akkaunti topilmadi.',404);
   if(account.telegramId!==participantTelegramId)throw uError('O‘yinchi akkaunti yangilandi. Qayta urinib ko‘ring.',409);
   d.participant={id:target.id,name:(account.firstName||account.username||'Ishtirokchi').slice(0,100)};
  }
  const before=structuredClone(s);
  if(action==='dispute'&&d.evidence)d.evidenceId='evidence-'+auditId;
  applyUAction(s,u,parsed.action,d);
  if(action==='dispute'&&d.evidence)tx.set(db.collection('uzeflife_evidence').doc(d.evidenceId),{matchId:d.matchId,by:u.id,jpegBase64:d.evidence,at:new Date().toISOString()});
  writeUNotices(tx,before,s,auditId);
  if(action==='complete'){const entry=s.history![0];tx.set(db.collection('uzeflife_history').doc(entry.id),{...entry,name:s.name,participants:s.participants.filter(p=>p.status==='approved'||s.matches.some(m=>[m.home,m.away].includes(p.id))),matches:s.matches.map(m=>({...m,proposal:null,dispute:null}))});}
  tx.set(ref,s);
  tx.set(db.collection('uzeflife_audit').doc(auditId),{actor:u.id,action:parsed.action,details:Object.fromEntries(Object.entries(d).filter(([k])=>k!=='evidence')),revision:s.revision,at:new Date().toISOString()});
 });
 scheduleUNotices();
}
export function publicUState(s:UState,u?:User){
 const permissions=u?uPermissions(s,u):[];const participantAdmin=permissions.includes('participants')||permissions.includes('registrations');const resultAdmin=permissions.includes('results')||permissions.includes('matches');
 return {...s,superAdmin:u&&(isPrimaryOwner(u.telegramId)||s.superAdmin===u.id)?s.superAdmin:null,assistants:u&&(isPrimaryOwner(u.telegramId)||s.superAdmin===u.id)?s.assistants:{},participants:s.participants.filter(p=>p.status==='approved'||(p.status==='removed'&&s.matches.some(m=>m.home===p.id||m.away===p.id))||participantAdmin||p.id===u?.id),matches:s.matches.map(m=>({...m,dispute:resultAdmin||m.home===u?.id||m.away===u?.id?m.dispute||null:null,proposal:resultAdmin||m.home===u?.id||m.away===u?.id?m.proposal:null})),permissions,isOwner:!!u&&isPrimaryOwner(u.telegramId),isSuper:!!u&&(isPrimaryOwner(u.telegramId)||s.superAdmin===u.id)};
}
