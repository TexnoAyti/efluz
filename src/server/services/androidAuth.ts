import {createHash,randomBytes,randomInt,timingSafeEqual} from 'node:crypto';
import type {Request,Response} from 'express';
import {getFirestoreDb} from '../firebase/admin';
import {getOrCreateTelegramUser,type TelegramUserParsed} from '../auth/telegramAuth';
import {createSessionToken,verifySessionToken} from '../auth/sessionToken';
import type {User} from '../../types';
const CHALLENGES='android_login_challenges',SESSIONS='android_login_sessions';
const LOGIN='__Host-efluz_android_login',ACCESS='__Host-efluz_android_access',REFRESH='__Host-efluz_android_refresh';
const TTL=5*60_000,SESSION_TTL=30*86400_000;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const failure=(message:string,statusCode=401)=>Object.assign(new Error(message),{statusCode});
const secret=()=>randomBytes(32).toString('base64url');
const id=()=>randomBytes(16).toString('hex');
const equal=(a:unknown,b:string)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
function cookie(req:Request,name:string){const values=String(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));return values.length===1?values[0].slice(name.length+1):'';}
function parse(value:string){const parts=/^([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/.exec(value);if(!parts)throw failure('Kirish so‘rovini yangilang.');return {id:parts[1],hash:hash(parts[2])};}
function setCookie(res:Response,name:string,value:string,seconds:number){res.append('Set-Cookie',`${name}=${value}; Path=/; Max-Age=${seconds}; Secure; HttpOnly; SameSite=Strict`);}
function activeUser(value:any,userId:string):User{if(!value||value.id&&value.id!==userId||value.isSuspended||!/^\d{1,20}$/.test(String(value.telegramId)))throw failure('Akkauntga kirish yopilgan.',403);return {...value,id:userId,telegramId:String(value.telegramId),username:String(value.username||''),firstName:String(value.firstName||'')};}
export function assertAndroidOrigin(req:Request){
 const origin=req.headers.origin,site=req.headers['sec-fetch-site'];
 const configured=process.env.WEBAPP_URL||process.env.APP_URL||'https://efluz.vercel.app';
 const allowed=new Set(['https://efluz.vercel.app']);try{const u=new URL(configured);if(u.protocol==='https:')allowed.add(u.origin);}catch{}
 if(site==='cross-site'||origin&&!allowed.has(String(origin)))throw failure('Bu manbadan kirish so‘roviga ruxsat yo‘q.',403);
}
let botIdentity:{tokenHash:string;username:string;expiresAt:number}|undefined;
async function androidBotUsername(){
 const configured=String(process.env.TELEGRAM_BOT_USERNAME||'').trim().replace(/^@/,'');
 if(configured){if(!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(configured))throw failure('Bot sozlamasi topilmadi.',503);return configured;}
 const token=String(process.env.TELEGRAM_BOT_TOKEN||'').trim();if(!token)throw failure('Bot sozlamasi topilmadi.',503);
 const tokenHash=hash(token);if(botIdentity?.tokenHash===tokenHash&&botIdentity.expiresAt>Date.now())return botIdentity.username;
 try{const response=await fetch(`https://api.telegram.org/bot${token}/getMe`,{signal:AbortSignal.timeout(8000)}),body=await response.json() as any;
  const username=body.result?.username;if(!response.ok||!body.ok||!body.result?.is_bot||typeof username!=='string'||!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username))throw Error();
  botIdentity={tokenHash,username,expiresAt:Date.now()+3600_000};return username;
 }catch{throw failure('Telegram botiga hozir ulanib bo‘lmadi. Qayta urinib ko‘ring.',503);}
}
export async function beginAndroidLogin(req:Request,res:Response){
 assertAndroidOrigin(req);const db=getFirestoreDb(),challengeId=id(),pollSecret=secret(),code=String(randomInt(100000,1000000)),createdAt=Date.now();
 const username=await androidBotUsername();
 const previous=cookie(req,LOGIN);let old:{id:string;hash:string}|undefined;try{old=parse(previous);}catch{}
 await db.runTransaction(async tx=>{
  const oldRef=old?db.collection(CHALLENGES).doc(old.id):undefined,oldRow=oldRef?(await tx.get(oldRef)).data():undefined;
  const expired=await tx.get(db.collection(CHALLENGES).where('expiresAt','<',createdAt-86400_000).limit(20)),expiredSessions=await tx.get(db.collection(SESSIONS).where('expiresAt','<',createdAt-86400_000).limit(20));
  if(oldRef&&oldRow&&equal(oldRow.secretHash,old!.hash)&&!['USED','DENIED'].includes(oldRow.status))tx.update(oldRef,{status:'DENIED'});
  for(const row of [...expired.docs,...expiredSessions.docs])tx.delete(row.ref);
  tx.set(db.collection(CHALLENGES).doc(challengeId),{id:challengeId,secretHash:hash(pollSecret),code,status:'PENDING',createdAt,expiresAt:createdAt+TTL,candidate:null,deliveredMessageId:null});
 });
 setCookie(res,LOGIN,challengeId+'.'+pollSecret,TTL/1000);
 return {success:true,challengeId,code,expiresAt:createdAt+TTL,botUrl:`https://t.me/${username}?start=android_${challengeId}`};
}
export async function androidLoginStatus(req:Request){
 assertAndroidOrigin(req);const token=parse(cookie(req,LOGIN)),row=(await getFirestoreDb().collection(CHALLENGES).doc(token.id).get()).data();
 if(!row||!equal(row.secretHash,token.hash))throw failure('Kirish so‘rovini yangilang.');
 return {success:true,status:row.expiresAt<=Date.now()?'EXPIRED':row.status,expiresAt:row.expiresAt};
}
export async function offerAndroidLogin(challengeId:string,telegram:TelegramUserParsed){
 if(!/^[a-f0-9]{32}$/.test(challengeId)||!Number.isSafeInteger(telegram.id)||Number(telegram.id)<=0)throw failure('Kirish so‘rovi noto‘g‘ri.');
 const db=getFirestoreDb(),ref=db.collection(CHALLENGES).doc(challengeId);
 return db.runTransaction(async tx=>{
  const row=(await tx.get(ref)).data();if(!row||row.expiresAt<=Date.now()||row.status!=='PENDING')throw failure('Kirish so‘rovi tugagan. APK ichida qaytadan boshlang.',409);
  if(row.candidate&&String(row.candidate.id)!==String(telegram.id))throw failure('Bu kirish so‘rovi boshqa akkauntga bog‘langan.',403);
  const candidate={id:Number(telegram.id),first_name:String(telegram.first_name||'').slice(0,100),last_name:String(telegram.last_name||'').slice(0,100),username:String(telegram.username||'').slice(0,64)};
  if(!row.candidate)tx.update(ref,{candidate});return {code:row.code,challengeId,deliveredMessageId:row.deliveredMessageId};
 });
}
export async function markAndroidOfferDelivered(challengeId:string,telegramId:number,messageId:number){
 if(!Number.isSafeInteger(messageId)||messageId<=0)throw failure('Tasdiqlash xabari yuborilmadi.',503);
 const db=getFirestoreDb(),ref=db.collection(CHALLENGES).doc(challengeId);await db.runTransaction(async tx=>{const row=(await tx.get(ref)).data();if(!row||row.status!=='PENDING'||String(row.candidate?.id)!==String(telegramId)||row.expiresAt<=Date.now())throw failure('Kirish so‘rovi tugagan.',409);tx.update(ref,{deliveredMessageId:messageId});});
}
export async function answerAndroidLogin(callback:any){
 const match=/^android_login:(approve|deny):([a-f0-9]{32})$/.exec(callback.data||'');
 if(!match||!Number.isSafeInteger(callback.from?.id)||callback.from.is_bot||callback.message?.chat?.type!=='private'||callback.message.chat.id!==callback.from.id)throw failure('Bu tasdiq faqat o‘z shaxsiy chatingizda ishlaydi.',403);
 const db=getFirestoreDb(),ref=db.collection(CHALLENGES).doc(match[2]);
 return db.runTransaction(async tx=>{const row=(await tx.get(ref)).data();if(!row||row.expiresAt<=Date.now())throw failure('Kirish so‘rovi tugagan. APK ichida yangilang.',409);
  if(String(row.candidate?.id)!==String(callback.from.id)||row.deliveredMessageId!==callback.message.message_id)throw failure('Bu so‘rov yoki xabar sizga tegishli emas.',403);
  const status=match[1]==='approve'?'APPROVED':'DENIED';if(row.status===status)return {status,replayed:true};if(row.status!=='PENDING')throw failure('Bu kirish so‘rovi allaqachon yopilgan.',409);
  tx.update(ref,{status,answeredAt:Date.now()});return {status,replayed:false};
 });
}
export async function completeAndroidLogin(req:Request,res:Response){
 assertAndroidOrigin(req);const token=parse(cookie(req,LOGIN)),db=getFirestoreDb(),ref=db.collection(CHALLENGES).doc(token.id),preview=(await ref.get()).data();
 if(!preview||!equal(preview.secretHash,token.hash)||preview.expiresAt<=Date.now()||preview.status!=='APPROVED'||!preview.candidate)throw failure('Kirish hali tasdiqlanmagan yoki so‘rov tugagan.',409);
 // Only Telegram's authenticated private callback supplies this profile. Client
 // body, URL, user agent and device markers never grant an identity or a role.
 const account=await getOrCreateTelegramUser(preview.candidate),sessionId=id(),refreshSecret=secret(),expiresAt=Date.now()+SESSION_TTL;
 const result=await db.runTransaction(async tx=>{
  const row=(await tx.get(ref)).data(),user=activeUser((await tx.get(db.collection('users').doc(account.id))).data(),account.id);
  if(!row||!equal(row.secretHash,token.hash)||row.status!=='APPROVED'||row.expiresAt<=Date.now()||String(row.candidate?.id)!==user.telegramId)throw failure('Kirish so‘rovi ishlatilgan yoki o‘zgargan.',409);
  const accessToken=createSessionToken(user);tx.update(ref,{status:'USED',consumedAt:Date.now()});tx.set(db.collection(SESSIONS).doc(sessionId),{id:sessionId,userId:user.id,secretHash:hash(refreshSecret),expiresAt,createdAt:Date.now(),revoked:false});return {accessToken,user};
 });
 setCookie(res,ACCESS,result.accessToken,900);setCookie(res,REFRESH,sessionId+'.'+refreshSecret,SESSION_TTL/1000);setCookie(res,LOGIN,'',0);
 return {success:true};
}
export async function authenticateAndroidCookies(req:Request,res:Response):Promise<User|null>{
 const access=cookie(req,ACCESS),refresh=cookie(req,REFRESH);if(!access&&!refresh)return null;
 assertAndroidOrigin(req);
 if(access){const verified=verifySessionToken(access);if(verified.isValid&&verified.claims)return {...verified.claims,createdAt:'',updatedAt:''};}
 if(!refresh)return null;const token=parse(refresh),db=getFirestoreDb();
 const row=(await db.collection(SESSIONS).doc(token.id).get()).data();if(!row||!equal(row.secretHash,token.hash)||row.revoked||row.expiresAt<=Date.now())return null;
 const user=activeUser((await db.collection('users').doc(row.userId).get()).data(),row.userId);const lifetime=Math.max(1,Math.min(900,Math.ceil((row.expiresAt-Date.now())/1000)));setCookie(res,ACCESS,createSessionToken(user,lifetime),lifetime);return user;
}
export async function logoutAndroid(req:Request,res:Response){
 assertAndroidOrigin(req);const db=getFirestoreDb(),tokens=[REFRESH,LOGIN].flatMap(name=>{try{return [{name,...parse(cookie(req,name))}];}catch{return [];}});
 if(tokens.length)await db.runTransaction(async tx=>{const records=await Promise.all(tokens.map(async token=>{const ref=db.collection(token.name===REFRESH?SESSIONS:CHALLENGES).doc(token.id);return {token,ref,row:(await tx.get(ref)).data()};}));for(const {token,ref,row} of records)if(row&&equal(row.secretHash,token.hash)){if(token.name===REFRESH)tx.update(ref,{revoked:true});else if(row.status!=='USED')tx.update(ref,{status:'DENIED'});}});
 for(const name of [LOGIN,ACCESS,REFRESH])setCookie(res,name,'',0);return {success:true};
}
