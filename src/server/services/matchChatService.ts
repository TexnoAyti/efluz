import crypto, {randomUUID} from 'node:crypto';
import type {User} from '../../types';
import type {MatchChatAdminReport,MatchChatKind,MatchChatMessage,MatchChatView} from '../../types/matchChat';
import {COLLECTIONS} from '../firebase/collections';
import {getFirestoreDb} from '../firebase/admin';
import {readUState} from './uzeflifeService';
import {createNotification} from './notificationService';
import {enqueueSmartTelegramNotification} from './smartNotificationService';
import {telegramMiniAppButton} from './telegramMiniAppButton';

const MAX_MESSAGES=200;
const QUICK_MESSAGES=['Assalomu alaykum, qachon o‘ynaymiz?','Xona ID yuboring.','Hozir o‘ynay olaman.','Hisobni tasdiqlang.'];

type Participant={id:string;name:string;username?:string|null;avatarUrl?:string|null};
type MatchContext={kind:MatchChatKind;matchId:string;seasonId:string;title:string;subtitle:string;participants:[Participant,Participant];closed:boolean};
type ChatReport={id:string;reporterId:string;reason:string;createdAt:string;status:'OPEN'|'RESOLVED'};
type ChatRoom={id:string;kind:MatchChatKind;matchId:string;seasonId:string;title:string;subtitle:string;participants:[Participant,Participant];messages:MatchChatMessage[];unread:Record<string,number>;blockedBy:string[];reports:ChatReport[];createdAt:string;updatedAt:string;lastMessageAt:string|null;closed:boolean;pinnedMessageId?:string|null};

export class MatchChatError extends Error { constructor(message:string,public statusCode=400,public code='MATCH_CHAT_ERROR'){super(message);} }
const cleanId=(value:string)=>{if(!/^[A-Za-z0-9:_-]{1,180}$/.test(value))throw new MatchChatError('O‘yin identifikatori noto‘g‘ri.',400,'INVALID_MATCH_ID');return value;};
const displayName=(user:any,id:string)=>String(user?.firstName||user?.displayName||user?.username||id).slice(0,80);
const roomId=(kind:MatchChatKind,matchId:string,ids:string[])=>`chat-${crypto.createHash('sha256').update(`${kind}:${matchId}:${[...ids].sort().join(':')}`).digest('hex').slice(0,36)}`;
const textValue=(value:unknown)=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').replace(/\r\n?/g,'\n').trim();
function chatReplyMarkup(kind:MatchChatKind,matchId:string){const button=telegramMiniAppButton('💬 O‘yin chatini ochish'),url=new URL(button.web_app.url);url.searchParams.set('chatKind',kind);url.searchParams.set('chatMatch',matchId);return {inline_keyboard:[[{...button,web_app:{url:url.toString()}}]]};}

async function currentAccount(user:User){
 const doc=await getFirestoreDb().collection(COLLECTIONS.USERS).doc(user.id).get(),account=doc.data() as User|undefined;
 if(!account||account.isSuspended||String(account.telegramId)!==String(user.telegramId))throw new MatchChatError('Akkaunt vakolati o‘zgargan.',403,'ACCOUNT_UNAVAILABLE');
 return account;
}

async function fixtureContext(matchId:string):Promise<MatchContext>{
 const db=getFirestoreDb(),snap=await db.collection(COLLECTIONS.FIXTURES).doc(matchId).get(),fixture=snap.data() as any;
 if(!snap.exists||!fixture)throw new MatchChatError('O‘yin topilmadi.',404,'MATCH_NOT_FOUND');
 const seasonId=String(fixture.seasonId||'season-2026-27'),clubIds=[fixture.homeClubId,fixture.awayClubId];
 if(!clubIds[0]||!clubIds[1])throw new MatchChatError('Raqib hali aniqlanmagan.',409,'OPPONENT_UNAVAILABLE');
 const [homeOcc,awayOcc]=await Promise.all(clubIds.map(id=>db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${id}`).get()));
 const ids=[homeOcc.data()?.userId||fixture.homeOwnerId,awayOcc.data()?.userId||fixture.awayOwnerId];
 if(!ids[0]||!ids[1]||ids[0]===ids[1])throw new MatchChatError('Ikki raqibning akkaunti topilmadi.',409,'PARTICIPANTS_UNAVAILABLE');
 const [homeUser,awayUser,homeClub,awayClub]=await Promise.all([db.collection(COLLECTIONS.USERS).doc(ids[0]).get(),db.collection(COLLECTIONS.USERS).doc(ids[1]).get(),db.collection(COLLECTIONS.CLUBS).doc(clubIds[0]).get(),db.collection(COLLECTIONS.CLUBS).doc(clubIds[1]).get()]);
 const homeName=String(homeClub.data()?.name||clubIds[0]).slice(0,80),awayName=String(awayClub.data()?.name||clubIds[1]).slice(0,80);
 return {kind:'fixture',matchId,seasonId,title:`${homeName} — ${awayName}`,subtitle:`${fixture.competitionName||fixture.competitionId||'EFLUZ'} · ${fixture.roundName||`${fixture.matchday||1}-tur`}`,participants:[{id:ids[0],name:displayName(homeUser.data(),ids[0]),username:homeUser.data()?.username||null,avatarUrl:homeUser.data()?.photoUrl||null},{id:ids[1],name:displayName(awayUser.data(),ids[1]),username:awayUser.data()?.username||null,avatarUrl:awayUser.data()?.photoUrl||null}],closed:['CONFIRMED','CANCELLED'].includes(String(fixture.status))};
}

async function uzeflifeContext(matchId:string):Promise<MatchContext>{
 const state=await readUState(),match=state.matches.find(item=>item.id===matchId);
 if(!match)throw new MatchChatError('UZEFLIFE o‘yini topilmadi.',404,'MATCH_NOT_FOUND');
 if(!match.home||!match.away||match.home===match.away)throw new MatchChatError('Raqib hali aniqlanmagan.',409,'OPPONENT_UNAVAILABLE');
 const names=new Map(state.participants.map(p=>[p.id,p.name]));
 return {kind:'uzeflife',matchId,seasonId:'season-2026-27',title:`${names.get(match.home)||'O‘yinchi'} — ${names.get(match.away)||'O‘yinchi'}`,subtitle:`UZEFLIFE · ${match.round}-tur`,participants:[{id:match.home,name:String(names.get(match.home)||match.home).slice(0,80)},{id:match.away,name:String(names.get(match.away)||match.away).slice(0,80)}],closed:state.status==='completed'||!!match.winner};
}

async function context(kind:MatchChatKind,rawId:string,user:User){
 await currentAccount(user);const matchId=cleanId(rawId),value=kind==='fixture'?await fixtureContext(matchId):await uzeflifeContext(matchId);
 if(!value.participants.some(p=>p.id===user.id))throw new MatchChatError('Bu chat faqat ushbu o‘yindagi ikki raqib uchun.',403,'NOT_MATCH_PARTICIPANT');
 return value;
}

function initialRoom(value:MatchContext):ChatRoom{const now=new Date().toISOString();return {id:roomId(value.kind,value.matchId,value.participants.map(p=>p.id)),kind:value.kind,matchId:value.matchId,seasonId:value.seasonId,title:value.title,subtitle:value.subtitle,participants:value.participants,messages:[],unread:Object.fromEntries(value.participants.map(p=>[p.id,0])),blockedBy:[],reports:[],createdAt:now,updatedAt:now,lastMessageAt:null,closed:value.closed,pinnedMessageId:null};}
function view(room:ChatRoom,userId:string):MatchChatView{const opponent=room.participants.find(p=>p.id!==userId)!;const messages=room.messages||[];return {roomId:room.id,kind:room.kind,matchId:room.matchId,title:room.title,subtitle:room.subtitle,opponentId:opponent.id,opponentName:opponent.name,opponentUsername:opponent.username||null,messages,pinnedMessage:messages.find(m=>m.id===room.pinnedMessageId)||null,unreadCount:Number(room.unread?.[userId]||0),blocked:(room.blockedBy||[]).length>0,blockedByMe:(room.blockedBy||[]).includes(userId),closed:!!room.closed,reportedByMe:(room.reports||[]).some(r=>r.reporterId===userId&&r.status==='OPEN'),canSend:!room.closed&&!(room.blockedBy||[]).length,quickMessages:QUICK_MESSAGES,updatedAt:room.updatedAt};}

export async function readMatchChat(kind:MatchChatKind,matchId:string,user:User):Promise<MatchChatView>{
 const value=await context(kind,matchId,user),db=getFirestoreDb(),base=initialRoom(value),ref=db.collection(COLLECTIONS.MATCH_CHAT_ROOMS).doc(base.id);
 return db.runTransaction(async tx=>{const snap=await tx.get(ref);let room=(snap.exists?snap.data():base) as ChatRoom;room={...room,title:value.title,subtitle:value.subtitle,closed:value.closed,unread:{...(room.unread||{}),[user.id]:0},updatedAt:new Date().toISOString()};tx.set(ref,room);return view(room,user.id);});
}

export async function sendMatchChatMessage(kind:MatchChatKind,matchId:string,user:User,rawText:unknown,rawReplyToId?:unknown):Promise<MatchChatView>{
 const text=textValue(rawText);if(!text)throw new MatchChatError('Xabar yozing.');if(text.length>500)throw new MatchChatError('Xabar 500 belgidan oshmasin.');
 const value=await context(kind,matchId,user),db=getFirestoreDb(),base=initialRoom(value),ref=db.collection(COLLECTIONS.MATCH_CHAT_ROOMS).doc(base.id),now=new Date().toISOString();
 const result=await db.runTransaction(async tx=>{const snap=await tx.get(ref),room=(snap.exists?snap.data():base) as ChatRoom;
  if((room.blockedBy||[]).length)throw new MatchChatError('Chat bloklangan. Blokni olib tashlang yoki adminga murojaat qiling.',409,'CHAT_BLOCKED');
  if(value.closed)throw new MatchChatError('Bu o‘yin chati yopilgan.',409,'CHAT_CLOSED');
  const recent=(room.messages||[]).filter(m=>m.senderId===user.id&&Date.now()-Date.parse(m.createdAt)<10000);if(recent.length>=5)throw new MatchChatError('Juda tez yozyapsiz. Bir necha soniya kuting.',429,'CHAT_RATE_LIMIT');
  const sender=value.participants.find(p=>p.id===user.id)!,opponent=value.participants.find(p=>p.id!==user.id)!;
  const replyId=typeof rawReplyToId==='string'?rawReplyToId.trim():'';const replied=(replyId?(room.messages||[]).find(m=>m.id===replyId):null)||null;
  const message:MatchChatMessage={id:randomUUID(),senderId:user.id,senderName:sender.name,avatarUrl:sender.avatarUrl||null,text,createdAt:now,replyTo:replied?{id:replied.id,senderName:replied.senderName,text:replied.text.slice(0,180)}:null};const previous=Number(room.unread?.[opponent.id]||0);
  const next:ChatRoom={...room,title:value.title,subtitle:value.subtitle,participants:value.participants,messages:[...(room.messages||[]),message].slice(-MAX_MESSAGES),unread:{...(room.unread||{}),[opponent.id]:previous+1,[user.id]:0},lastMessageAt:now,updatedAt:now,closed:false};tx.set(ref,next);return {room:next,opponent,notify:previous===0};});
 if(result.notify){const body=`${result.room.title}\n${result.opponent.name}, raqibingiz sizga chatda xabar yubordi.`;await Promise.allSettled([createNotification(result.opponent.id,'MATCH_CHAT','Raqibingizdan yangi xabar',body,{kind,matchId,fixtureId:`${kind}:${matchId}`,roomId:result.room.id}),enqueueSmartTelegramNotification({userId:result.opponent.id,seasonId:value.seasonId,eventId:`match-chat:${result.room.id}:${now}`,title:'💬 Raqibingizdan yangi xabar',body:`<b>${result.room.title}</b>\nEFLUZ ichidagi o‘yin chatini ochib javob bering.`,replyMarkup:chatReplyMarkup(kind,matchId)})]);}
 return view(result.room,user.id);
}

export async function pinMatchChatMessage(kind:MatchChatKind,matchId:string,user:User,rawMessageId:unknown):Promise<MatchChatView>{const value=await context(kind,matchId,user),db=getFirestoreDb(),base=initialRoom(value),ref=db.collection(COLLECTIONS.MATCH_CHAT_ROOMS).doc(base.id),messageId=typeof rawMessageId==='string'?rawMessageId.trim():'';return db.runTransaction(async tx=>{const snap=await tx.get(ref),room=(snap.exists?snap.data():base) as ChatRoom;if(messageId&&!(room.messages||[]).some(m=>m.id===messageId))throw new MatchChatError('Xabar topilmadi.',404,'MESSAGE_NOT_FOUND');const next={...room,pinnedMessageId:messageId||null,updatedAt:new Date().toISOString()};tx.set(ref,next);return view(next,user.id);});}

export async function setMatchChatBlock(kind:MatchChatKind,matchId:string,user:User,blocked:boolean){const value=await context(kind,matchId,user),db=getFirestoreDb(),base=initialRoom(value),ref=db.collection(COLLECTIONS.MATCH_CHAT_ROOMS).doc(base.id);return db.runTransaction(async tx=>{const snap=await tx.get(ref),room=(snap.exists?snap.data():base) as ChatRoom,set=new Set(room.blockedBy||[]);blocked?set.add(user.id):set.delete(user.id);const next={...room,blockedBy:[...set],updatedAt:new Date().toISOString()};tx.set(ref,next);return view(next,user.id);});}
export async function reportMatchChat(kind:MatchChatKind,matchId:string,user:User,rawReason:unknown){const reason=textValue(rawReason);if(reason.length<3||reason.length>300)throw new MatchChatError('Shikoyat sababini 3–300 belgi bilan yozing.');const value=await context(kind,matchId,user),db=getFirestoreDb(),base=initialRoom(value),ref=db.collection(COLLECTIONS.MATCH_CHAT_ROOMS).doc(base.id);return db.runTransaction(async tx=>{const snap=await tx.get(ref),room=(snap.exists?snap.data():base) as ChatRoom;if((room.reports||[]).some(r=>r.reporterId===user.id&&r.status==='OPEN'))throw new MatchChatError('Bu chat bo‘yicha shikoyatingiz allaqachon yuborilgan.',409,'ALREADY_REPORTED');const next={...room,reports:[...(room.reports||[]),{id:randomUUID(),reporterId:user.id,reason,createdAt:new Date().toISOString(),status:'OPEN' as const}],updatedAt:new Date().toISOString()};tx.set(ref,next);return view(next,user.id);});}

export async function listMatchChatReports(user:User):Promise<MatchChatAdminReport[]>{const account=await currentAccount(user);if(!account.isAdmin)throw new MatchChatError('Faqat administrator ko‘ra oladi.',403,'ADMIN_REQUIRED');const snap=await getFirestoreDb().collection(COLLECTIONS.MATCH_CHAT_ROOMS).limit(500).get(),rows:MatchChatAdminReport[]=[];for(const doc of snap.docs){const room=doc.data() as ChatRoom;for(const report of room.reports||[])if(report.status==='OPEN')rows.push({roomId:room.id,kind:room.kind,matchId:room.matchId,title:room.title,participantNames:(room.participants||[]).map(p=>p.name),reportId:report.id,reporterId:report.reporterId,reason:report.reason,createdAt:report.createdAt,status:report.status,lastMessageAt:room.lastMessageAt,blocked:(room.blockedBy||[]).length>0,messages:(room.messages||[]).slice(-30)});}return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100);}
export async function resolveMatchChatReport(user:User,roomIdValue:string,reportId:string){const account=await currentAccount(user);if(!account.isAdmin)throw new MatchChatError('Faqat administrator bajara oladi.',403,'ADMIN_REQUIRED');cleanId(roomIdValue);cleanId(reportId);const db=getFirestoreDb(),ref=db.collection(COLLECTIONS.MATCH_CHAT_ROOMS).doc(roomIdValue);await db.runTransaction(async tx=>{const snap=await tx.get(ref),room=snap.data() as ChatRoom|undefined;if(!room)throw new MatchChatError('Chat topilmadi.',404);const reports=(room.reports||[]).map(r=>r.id===reportId?{...r,status:'RESOLVED' as const}:r);if(!reports.some(r=>r.id===reportId))throw new MatchChatError('Shikoyat topilmadi.',404);tx.set(ref,{...room,reports,updatedAt:new Date().toISOString()});});}
export async function setMatchChatAdminBlock(user:User,roomIdValue:string,blocked:boolean){const account=await currentAccount(user);if(!account.isAdmin)throw new MatchChatError('Faqat administrator bajara oladi.',403,'ADMIN_REQUIRED');cleanId(roomIdValue);const db=getFirestoreDb(),ref=db.collection(COLLECTIONS.MATCH_CHAT_ROOMS).doc(roomIdValue);await db.runTransaction(async tx=>{const snap=await tx.get(ref),room=snap.data() as ChatRoom|undefined;if(!room)throw new MatchChatError('Chat topilmadi.',404);const set=new Set(room.blockedBy||[]);blocked?set.add('admin'):set.delete('admin');tx.set(ref,{...room,blockedBy:[...set],updatedAt:new Date().toISOString()});});}
