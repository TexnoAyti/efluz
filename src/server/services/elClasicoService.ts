import {writeClasicoNotices} from './teamCompetitionNotices';
import {getFirestoreDb} from '../firebase/admin';
import {teamActor,readTeamActor,requireTeamGroup,teamGroupInfo,teamError,teamLeagueAdminName} from './teamAccess';
import {canSeeTeamPreview} from '../../types/teamLeaguePreview';
import type {ClasicoEvent,ClasicoView} from '../../types/elClasico';
export const CLASICO_COLLECTION='el_clasico_events';
const blank=():ClasicoEvent=>({id:'el-clasico',status:'REGISTRATION',players:[],bouts:[],version:0,updatedAt:''});
const view=(event:ClasicoEvent,telegramId:string):ClasicoView=>({event,canManage:canSeeTeamPreview(telegramId),...teamGroupInfo()});
export async function getElClasico(actorId:string){const actor=await teamActor(actorId),event=(await getFirestoreDb().collection(CLASICO_COLLECTION).doc('el-clasico').get()).data() as ClasicoEvent|undefined;return view(event||blank(),actor.telegramId);}
export async function checkElClasicoSubscription(actorId:string){const actor=await teamActor(actorId);await requireTeamGroup(actor.telegramId);return {eligible:true};}
export async function actElClasico(actorId:string,body:any){
 const actor=await teamActor(actorId),action=body?.action;
 if(!['JOIN','LEAVE','START','SCORE','CANCEL'].includes(action))throw teamError('Event amali noto‘g‘ri.');
 if(action==='JOIN'){if(!['REAL','BARCA'].includes(body.side))throw teamError('Real Madrid yoki Barcelonani tanlang.');await requireTeamGroup(actor.telegramId);}
 const ownerAction=['START','SCORE','CANCEL'].includes(action);
 if(ownerAction&&!canSeeTeamPreview(actor.telegramId))throw teamError('Eventni faqat loyiha egasi boshqaradi.',403);
 const db=getFirestoreDb(),ref=db.collection(CLASICO_COLLECTION).doc('el-clasico');
 // Verify every selected account and its live subscription before starting; the
 // version check inside the transaction rejects a roster changed during checks.
 if(action==='START'){
  const before=(await ref.get()).data() as ClasicoEvent|undefined;
  if(!before||before.version!==body.version)throw teamError('Ro‘yxat yangilandi. Qayta yuklang.',409);
  for(let i=0;i<before.players.length;i+=6)await Promise.all(before.players.slice(i,i+6).map(async p=>{const user=await teamActor(p.userId);await requireTeamGroup(user.telegramId);}));
 }
 return db.runTransaction(async tx=>{
  const fresh=await readTeamActor(tx,actorId);
  if(ownerAction&&!canSeeTeamPreview(fresh.telegramId))throw teamError('Boshqaruvga kirish yopiq.',403);
  const event=((await tx.get(ref)).data()||blank()) as ClasicoEvent;
  const before=structuredClone(event);
  if(ownerAction&&event.version!==body.version)throw teamError('Event yangilandi. Qayta yuklang.',409);
  if(action==='JOIN'||action==='LEAVE'){
   if(event.status!=='REGISTRATION')throw teamError('Eventga yozilish yopilgan.',409);
   const existing=event.players.find(p=>p.userId===actorId);
   if(action==='JOIN'){
    if(existing?.side===body.side)return view(event,fresh.telegramId);
    if(event.players.filter(p=>p.side===body.side).length>=11)throw teamError('Bu tomonda 11 ta o‘rin to‘lgan. Boshqa tomonni tanlang.',409);
    event.players=event.players.filter(p=>p.userId!==actorId);
    event.players.push({userId:actorId,name:teamLeagueAdminName(fresh),side:body.side});
   }else event.players=event.players.filter(p=>p.userId!==actorId);
  }else if(action==='START'){
   if(event.status!=='REGISTRATION'||event.players.filter(p=>p.side==='REAL').length!==11||event.players.filter(p=>p.side==='BARCA').length!==11)throw teamError('Boshlash uchun har ikki tomonda 11 tadan o‘yinchi bo‘lsin.',409);
   // Recheck account suspension atomically too; clients never supply identities.
   for(const player of event.players)await readTeamActor(tx,player.userId);
   const real=event.players.filter(p=>p.side==='REAL'),barca=event.players.filter(p=>p.side==='BARCA');
   event.bouts=real.map((p,i)=>({id:i+1,homeUserId:p.userId,awayUserId:barca[i].userId,homeScore:null,awayScore:null}));event.status='ACTIVE';
  }else if(action==='SCORE'){
   if(!['ACTIVE','COMPLETED'].includes(event.status))throw teamError('Event hali boshlanmagan.',409);
   const bout=event.bouts.find(b=>b.id===body.boutId);
   if(!bout||![body.homeScore,body.awayScore].every(n=>Number.isInteger(n)&&n>=0&&n<=99))throw teamError('Hisob 0–99 oralig‘ida bo‘lsin.');
   bout.homeScore=body.homeScore;bout.awayScore=body.awayScore;
   event.status=event.bouts.every(b=>b.homeScore!==null&&b.awayScore!==null)?'COMPLETED':'ACTIVE';
  }else{
   if(['CANCELLED','COMPLETED'].includes(event.status))throw teamError('Yakunlangan eventni bekor qilib bo‘lmaydi.',409);
   event.status='CANCELLED';
  }
  event.version++;event.updatedAt=new Date().toISOString();writeClasicoNotices(tx,before,event);tx.set(ref,event);return view(event,fresh.telegramId);
 });
}
