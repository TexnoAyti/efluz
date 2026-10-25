import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {getFirestoreDb} from '../firebase/admin';
import {authMiddleware,requireAuth} from '../middleware/authMiddleware';
import {androidAuthRouter} from '../routes/androidAuth.routes';
import {telegramRouter} from '../routes/telegram.routes';
import {answerAndroidLogin,offerAndroidLogin,markAndroidOfferDelivered} from '../services/androidAuth';
import {verifySessionToken} from '../auth/sessionToken';
export async function verifyAndroidAuth(failNextCommit:()=>void){
 const db=getFirestoreDb(),beforeFetch=globalThis.fetch,env={token:process.env.TELEGRAM_BOT_TOKEN,secret:process.env.TELEGRAM_WEBHOOK_SECRET,username:process.env.TELEGRAM_BOT_USERNAME};
 process.env.TELEGRAM_BOT_TOKEN='isolated-android-auth-test-token';process.env.TELEGRAM_WEBHOOK_SECRET='isolated-android-webhook';delete process.env.TELEGRAM_BOT_USERNAME;
 let messageId=400,updateId=1900000000;const deliveries:any[]=[];
 globalThis.fetch=(async(input:any,init:any)=>{const u=new URL(String(input));if(u.origin==='https://api.telegram.org'&&u.pathname.startsWith('/botisolated-android-auth-test-token/')){if(u.pathname.endsWith('/getMe'))return Response.json({ok:true,result:{is_bot:true,username:'actual_efluz_test_bot'}});if(u.pathname.endsWith('/sendMessage')){deliveries.push(JSON.parse(init.body));return Response.json({ok:true,result:{message_id:++messageId}});}return Response.json({ok:true,result:true});}return beforeFetch(input,init);}) as typeof fetch;
 const app=express();app.use(express.json());app.use(authMiddleware);app.use('/api/auth/android',androidAuthRouter);app.use('/api/telegram',telegramRouter);app.get('/private',requireAuth,(req,res)=>res.json({user:req.user}));const server=app.listen(0,'127.0.0.1');await once(server,'listening');const host=`http://127.0.0.1:${(server.address() as any).port}`;
 const cookies=(r:Response)=>r.headers.getSetCookie();const value=(r:Response,name:string)=>cookies(r).find(c=>c.startsWith(name+'='))?.split(';')[0]||'';
 const loginName='__Host-efluz_android_login',accessName='__Host-efluz_android_access',refreshName='__Host-efluz_android_refresh';
 const request=async(path:string,jar='',body?:any,extra:Record<string,string>={})=>{const r=await fetch(host+path,{method:body===undefined?'GET':'POST',headers:{origin:'https://efluz.vercel.app','content-type':'application/json',cookie:jar,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {r,body:await r.json() as any};};
 const start=async(jar='')=>{const result=await request('/api/auth/android/start',jar,{});assert.equal(result.r.status,200,JSON.stringify(result.body));return {...result,jar:value(result.r,loginName)};};
 const callback=(challengeId:string,who=981001,mid=messageId,action='approve')=>({id:'android_callback_'+updateId,from:{id:who,is_bot:false},message:{message_id:mid,chat:{id:who,type:'private'}},data:`android_login:${action}:${challengeId}`});
 const webhook=async(update:any)=>{const r=await fetch(host+'/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':process.env.TELEGRAM_WEBHOOK_SECRET!},body:JSON.stringify({update_id:++updateId,...update})});assert.equal(r.status,200);return r.json() as any;};
 const tg={id:981001,first_name:'Android player',username:'android_player'};
 try{
  assert.equal((await request('/private','',undefined,{'user-agent':'EFLUZAndroid/1.0.0'})).r.status,401);
  assert.equal((await request('/private')).r.status,401,'User agent and URL do not authenticate');
  assert.equal((await request('/api/auth/android/start','',{}, {origin:'https://evil.test','sec-fetch-site':'cross-site'})).r.status,403);
  const first=await start();assert.match(first.body.botUrl,/actual_efluz_test_bot\?start=android_[a-f0-9]{32}$/);assert.match(first.body.code,/^\d{6}$/);
  for(const c of cookies(first.r)){assert.match(c,/HttpOnly/);assert.match(c,/Secure/);assert.match(c,/SameSite=Strict/);assert.equal(c.includes('Domain='),false);}
  const ref=db.collection('android_login_challenges').doc(first.body.challengeId),stored=(await ref.get()).data();assert.equal(stored.secretHash,createHash('sha256').update(first.jar.split('.')[1]).digest('hex'));assert.equal(JSON.stringify(stored).includes(first.jar.split('.')[1]),false);
  assert.equal((await request('/api/auth/android/status')).r.status,401);assert.equal((await request('/api/auth/android/complete',first.jar,{userId:'user-5209126900',isAdmin:true})).r.status,409);
  assert.equal((await request('/api/auth/android/status',first.jar+'; '+first.jar)).r.status,401,'Duplicate cookies fail closed');
  await webhook({message:{message_id:10,text:'/start android_'+first.body.challengeId,from:tg,chat:{id:-100111,type:'supergroup'}}});assert.equal(deliveries.length,0);assert.equal((await ref.get()).data().candidate,null);
  await webhook({message:{message_id:11,text:'/start android_'+first.body.challengeId,from:tg,chat:{id:tg.id,type:'private'},forward_origin:{type:'user'}}});assert.equal(deliveries.length,0);
  await webhook({message:{message_id:12,text:'/start android_'+first.body.challengeId,from:tg,chat:{id:tg.id,type:'private'}}});assert.equal(deliveries.length,1);assert.ok(deliveries[0].text.includes(first.body.code));assert.equal(deliveries[0].chat_id,tg.id);
  await assert.rejects(offerAndroidLogin(first.body.challengeId,{...tg,id:981002}),(e:any)=>e.statusCode===403);
  await assert.rejects(answerAndroidLogin(callback(first.body.challengeId,981002)),(e:any)=>e.statusCode===403);
  await assert.rejects(answerAndroidLogin(callback(first.body.challengeId,tg.id,messageId+1)),(e:any)=>e.statusCode===403);
  const cb=callback(first.body.challengeId);await webhook({callback_query:cb});assert.equal((await request('/api/auth/android/status',first.jar)).body.status,'APPROVED');
  failNextCommit();assert.ok((await request('/api/auth/android/complete',first.jar,{})).r.status>=500);assert.equal((await ref.get()).data().status,'APPROVED','Failed SQL commit does not consume login');assert.equal((await db.collection('android_login_sessions').where('userId','==','user-'+tg.id).get()).size,0,'Failed SQL commit grants no session');
  const complete=await request('/api/auth/android/complete',first.jar,{isAdmin:true,userId:'user-5209126900'});assert.equal(complete.r.status,200,JSON.stringify(complete.body));assert.deepEqual(complete.body,{success:true});const access=value(complete.r,accessName),refresh=value(complete.r,refreshName);assert.ok(access&&refresh);assert.match(value(complete.r,loginName),/=$/);
  const verified=verifySessionToken(access.slice(access.indexOf('=')+1));assert.equal(verified.claims?.id,'user-'+tg.id);assert.equal(verified.claims?.isAdmin,false);
  assert.equal((await request('/private',access)).body.user.id,'user-'+tg.id);assert.equal((await request('/private',refresh)).body.user.id,'user-'+tg.id,'Refresh cookie recovers access');
  assert.equal((await request('/api/auth/android/complete',first.jar,{})).r.status,409,'A completed challenge cannot be replayed');
  const account=db.collection('users').doc('user-'+tg.id);await account.update({isSuspended:true});assert.equal((await request('/private',refresh)).r.status,403);assert.equal((await request('/api/auth/android/logout',refresh,{})).r.status,200,'Suspended account can still logout');await account.update({isSuspended:false});assert.equal((await request('/private',refresh)).r.status,401,'Revoked refresh cannot login');
  const second=await start(),restarted=await start(second.jar);assert.equal((await request('/api/auth/android/status',second.jar)).body.status,'DENIED','Restart invalidates prior device challenge');
  await offerAndroidLogin(restarted.body.challengeId,tg);await markAndroidOfferDelivered(restarted.body.challengeId,tg.id,700);const denied=callback(restarted.body.challengeId,tg.id,700,'deny');await answerAndroidLogin(denied);assert.equal((await request('/api/auth/android/complete',restarted.jar,{})).r.status,409);
  const expired=await start();await db.collection('android_login_challenges').doc(expired.body.challengeId).update({expiresAt:Date.now()-1});assert.equal((await request('/api/auth/android/status',expired.jar)).body.status,'EXPIRED');await assert.rejects(offerAndroidLogin(expired.body.challengeId,tg));
  const concurrent=await start();await offerAndroidLogin(concurrent.body.challengeId,tg);await markAndroidOfferDelivered(concurrent.body.challengeId,tg.id,701);await answerAndroidLogin(callback(concurrent.body.challengeId,tg.id,701));const completes=await Promise.all([request('/api/auth/android/complete',concurrent.jar,{}),request('/api/auth/android/complete',concurrent.jar,{})]);assert.deepEqual(completes.map(x=>x.r.status).sort(),[200,409],'Only one concurrent completion grants cookies');
  const pending=await start();await request('/api/auth/android/logout',pending.jar,{});assert.equal((await request('/api/auth/android/status',pending.jar)).body.status,'DENIED','Logout closes pending login too');
  console.log('PASS Android HTTP/PostgreSQL: actual bot lookup, private Telegram approval, identity binding, hashed device secrets, cross-site/foreign callback denial, atomic rollback, one-time concurrent completion, secure cookies, suspension, refresh, logout, restart and expiry');
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));globalThis.fetch=beforeFetch;for(const [key,v] of Object.entries({TELEGRAM_BOT_TOKEN:env.token,TELEGRAM_WEBHOOK_SECRET:env.secret,TELEGRAM_BOT_USERNAME:env.username})){if(v===undefined)delete process.env[key];else process.env[key]=v;}}
}
