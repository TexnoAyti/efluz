import {createHash,randomBytes} from 'node:crypto';
import {getFirestoreDb} from '../firebase/admin';
import {isPrimaryOwner} from './telegramAiConfigService';
const BANS='club_selection_bans',CONTROLS='club_selection_ban_controls',RECEIPTS='club_selection_ban_receipts';
const error=(message:string,statusCode=409)=>Object.assign(new Error(message),{statusCode});
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function validId(value:unknown):asserts value is string{if(typeof value!=='string'||!/^user-\d{1,20}$/.test(value))throw error('Aniq foydalanuvchi ID kerak.',400);}
async function owner(tx:any,id:string){const user=(await tx.get(getFirestoreDb().collection('users').doc(id))).data();if(!user||!isPrimaryOwner(user.telegramId)||!user.isAdmin||user.isSuspended)throw error('Bu amal faqat asosiy admin uchun.',403);return user;}
export async function isClubSelectionBanned(tx:any,userId:string){return (await tx.get(getFirestoreDb().collection(BANS).doc(userId))).data()?.isBanned===true;}
export type BanReadOutput={banControls?:{tokens:string[];replyMarkup:any}};
export async function setClubSelectionBan(actorId:string,targetId:string,body:any){
 validId(actorId);validId(targetId);if(typeof body.isBanned!=='boolean'||typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{8,150}$/.test(body.requestId))throw error('Ban holati yoki so‘rov kodi noto‘g‘ri.',400);
 const reason=typeof body.reason==='string'?body.reason.trim().slice(0,500):'';
 const db=getFirestoreDb(),ref=db.collection(BANS).doc(targetId),receipt=db.collection(RECEIPTS).doc(hash(actorId+':'+body.requestId)),digest=hash(JSON.stringify([targetId,body.isBanned,reason]));
 return db.runTransaction(async tx=>{
  await owner(tx,actorId);const target=(await tx.get(db.collection('users').doc(targetId))).data(),old=(await tx.get(ref)).data(),prior=(await tx.get(receipt)).data();
  if(!target||!/^\d{1,20}$/.test(String(target.telegramId)))throw error('Foydalanuvchi topilmadi.',404);
  if(isPrimaryOwner(target.telegramId)&&body.isBanned)throw error('Asosiy adminga ban berib bo‘lmaydi.');
  if(body.expectedUsername&&String(target.username||'').replace(/^@/,'').toLowerCase()!==String(body.expectedUsername).replace(/^@/,'').toLowerCase())throw error('Username o‘zgargan. Qayta tanlang.');
  if(prior){if(prior.digest!==digest)throw error('So‘rov kodi boshqa amal uchun ishlatilgan.');return {success:true,ban:prior.ban,replayed:true};}
  const ban={userId:targetId,telegramId:String(target.telegramId),isBanned:body.isBanned,reason,revision:(old?.revision||0)+1,updatedAt:new Date().toISOString(),actorId};
  tx.set(ref,ban);tx.set(receipt,{digest,ban});tx.set(db.collection('club_selection_ban_audit').doc(hash(actorId+':'+body.requestId)),{...ban,previousIsBanned:old?.isBanned===true});return {success:true,ban};
 });
}
export async function prepareMissingOwnerBanControls(payload:any,data:any):Promise<BanReadOutput['banControls']>{
 if(data?.success!==true||!Array.isArray(data.owners)||!data.owners.length||payload.chatId!==payload.fromUser.id||payload.threadId!==0||!isPrimaryOwner(payload.fromUser.id))return;
 const db=getFirestoreDb(),tokens:string[]=[],rows:any[]=[];const actorId='user-'+payload.fromUser.id;
 await db.runTransaction(async tx=>{
  await owner(tx,actorId);const entries:any[]=[];
  for(const [i,item] of data.owners.slice(0,20).entries()){
   validId(item.userId);const target=(await tx.get(db.collection('users').doc(item.userId))).data(),ban=(await tx.get(db.collection(BANS).doc(item.userId))).data();
   if(!target||String(target.telegramId)!==String(item.telegramId)||isPrimaryOwner(target.telegramId))continue;
   const token=randomBytes(16).toString('hex');entries.push({token,record:{actorId,targetId:item.userId,targetTelegramId:String(item.telegramId),chatId:payload.chatId,threadId:0,isBanned:ban?.isBanned!==true,expectedRevision:ban?.revision||0,expiresAt:Date.now()+3600000,deliveredMessageId:null,consumed:false,reason:'Guruhda yo‘q klub egasi'},label:`${(data.page-1)*data.limit+i+1}. ${ban?.isBanned?'Banni olib tashlash':'Klub tanlashga ban'} · ${target.username?'@'+target.username:item.displayName||item.telegramId}`.slice(0,100)});
  }
  // Keep all reads before any writes for the production transaction adapter.
  tokens.length=0;rows.length=0;for(const entry of entries){tokens.push(entry.token);rows.push([{text:entry.label,callback_data:'clubban:'+entry.token}]);tx.set(db.collection(CONTROLS).doc(entry.token),entry.record);}
 });
 return tokens.length?{tokens,replyMarkup:{inline_keyboard:rows}}:undefined;
}
export async function markBanControlsDelivered(tokens:string[],messageId:number){
 if(!Number.isSafeInteger(messageId)||messageId<=0)throw error('Xabar yetkazilgani tasdiqlanmadi.');
 const db=getFirestoreDb();await db.runTransaction(async tx=>{const refs=tokens.map(t=>db.collection(CONTROLS).doc(t));const docs=await Promise.all(refs.map(ref=>tx.get(ref)));for(let i=0;i<docs.length;i++)if(docs[i].exists&&!docs[i].data().deliveredMessageId)tx.update(refs[i],{deliveredMessageId:messageId});});
}
export async function applyBanControl(callback:any){
 if(!isPrimaryOwner(callback.from?.id)||callback.from?.is_bot||!Number.isSafeInteger(callback.from?.id)||callback.message?.chat?.type!=='private'||callback.message.chat.id!==callback.from.id||callback.message.message_thread_id)throw error('Bu tugma faqat asosiy adminning shaxsiy chatida ishlaydi.',403);
 const token=/^clubban:([a-f0-9]{32})$/.exec(callback.data||'')?.[1];if(!token)throw error('Tugma noto‘g‘ri.',400);
 const db=getFirestoreDb(),controlRef=db.collection(CONTROLS).doc(token);
 return db.runTransaction(async tx=>{
  const actorId='user-'+callback.from.id;await owner(tx,actorId);const control=(await tx.get(controlRef)).data();
  if(!control||control.actorId!==actorId||control.chatId!==callback.message.chat.id||control.deliveredMessageId!==callback.message.message_id||control.expiresAt<Date.now())throw error('Tugma eskirgan yoki bu xabarga tegishli emas. Ro‘yxatni yangilang.');
  if(control.consumed)return {success:true,isBanned:control.isBanned,replayed:true,targetId:control.targetId};
  const ref=db.collection(BANS).doc(control.targetId),target=(await tx.get(db.collection('users').doc(control.targetId))).data(),old=(await tx.get(ref)).data();
  if(!target||String(target.telegramId)!==control.targetTelegramId||isPrimaryOwner(target.telegramId))throw error('Akkaunt o‘zgargan. Ro‘yxatni yangilang.');
  if((old?.revision||0)!==control.expectedRevision)throw error('Ban holati o‘zgargan. Ro‘yxatni yangilang.');
  const ban={userId:control.targetId,telegramId:control.targetTelegramId,isBanned:control.isBanned,reason:control.reason,revision:(old?.revision||0)+1,updatedAt:new Date().toISOString(),actorId};
  tx.set(ref,ban);tx.update(controlRef,{consumed:true,consumedAt:ban.updatedAt});tx.set(db.collection('club_selection_ban_audit').doc(token),{...ban,previousIsBanned:old?.isBanned===true});return {success:true,isBanned:ban.isBanned,replayed:false,targetId:control.targetId};
 });
}
