import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {encodeValue,decodeValue} from '../migration/firestoreArchive';
import {getFirestoreDb,resetFirebaseAdminCache} from '../firebase/admin';
import {authMiddleware,requireAdmin} from '../middleware/authMiddleware';
import {createSessionToken} from '../auth/sessionToken';
import {customTournamentTicketsRouter} from '../routes/customTournamentTickets.routes';
import {spendTicketForTournament} from '../services/customTournamentTicketService';
import {archiveCommunityMessage,communityFacts,communitySourceStats} from '../services/telegramAiCommunitySources';
import {getTelegramAiConfig,updateTelegramAiConfig} from '../services/telegramAiConfigService';
import {checkAndIncrementAiRateLimits,getAiRateLimitMetrics} from '../services/telegramAiRateLimitService';
import {claimDeliveryState} from '../services/telegramAiService';
import {getAiRedisClient} from '../services/telegramAiDeadline';
import {AI_ADMIN_PLAN_REPLACE_LUA} from '../services/telegramAiPlanRevision';
import {createAiSnapshotReader} from '../services/telegramAiSnapshotReader';
import {redisSetRaw,ReadModelKeys} from '../readModel/readModelStore';
import {enqueueSmartTelegramNotification} from '../services/smartNotificationService';
import {processNotificationQueue,getBroadcastHistory} from '../services/telegramNotificationQueue';
import {getNotificationStore} from '../services/postgresNotificationStore';

// Real PostgreSQL adapter and service transactions, isolated RPC transport.
delete process.env.FIREBASE_FORCE_LOCAL_FALLBACK;
process.env.NODE_ENV='production';
process.env.DATABASE_PROVIDER='supabase';
process.env.SUPABASE_DATA_NAMESPACE='preview';
process.env.SUPABASE_URL='https://ticket.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='isolated-key';
process.env.SESSION_SECRET='isolated-ticket-auth-secret-32bytes';
resetFirebaseAdminCache();
let generation=0;
let rows=new Map<string,any>();
const originalFetch=globalThis.fetch;
let telegramRequests=0;
let telegramReject=true;
globalThis.fetch=async(input:any,init?:any)=>{
 const url=new URL(typeof input==='string'?input:input.url);
 if(url.origin==='https://api.telegram.org'){
  telegramRequests++;
  return telegramReject?Response.json({ok:false,error_code:429,description:'retry',parameters:{retry_after:1}},{status:429}):Response.json({ok:true,result:{message_id:telegramRequests}});
 }
 if(url.origin!=='https://ticket.test.invalid')return originalFetch(input,init);
 const body=JSON.parse(init.body);
 if(url.pathname.endsWith('/efl_runtime_snapshot_read')){
  return Response.json({documents:body.p_ids.map((id:string)=>({id,version:String(generation),value:rows.has('durable_read_snapshots/'+id)?decodeValue(rows.get('durable_read_snapshots/'+id)):null}))});
 }
 if(url.pathname.endsWith('/efl_runtime_read')){
  const q=body.p_query;
  let documents=[...rows].filter(([path])=>q.path?path===q.path:path.split('/').slice(0,-1).join('/')===q.collection).map(([path,encoded])=>({id:path.split('/').at(-1)!,encoded}));
  for(const f of q.filters||[])documents=documents.filter(d=>{const value=f.field==='__name__'?d.id:decodeValue(d.encoded)[f.field];return f.op==='in'?f.value.includes(value):value===f.value;});
  if(q.limit)documents=documents.slice(0,q.limit);
  return Response.json({generation:String(generation),documents,count:documents.length});
 }
 if(url.pathname.endsWith('/efl_runtime_commit_safe')){
  if(body.p_generation!==null&&body.p_generation!==String(generation))return Response.json({conflict:true});
  const next=new Map(rows);
  for(const op of body.p_operations){
   if(op.kind==='delete')next.delete(op.path);
   else next.set(op.path,op.merge||op.kind==='update'?encodeValue({...decodeValue(next.get(op.path)||encodeValue({})),...decodeValue(op.encoded)}):op.encoded);
  }
  rows=next;if(body.p_operations.length)generation++;return Response.json({generation:String(generation)});
 }
 throw Error('UNEXPECTED_RPC');
};
const db=getFirestoreDb();
const user=(id:string,telegramId:string,isAdmin=false)=>({id,telegramId,isAdmin,isSuspended:false,username:'recipient',firstName:'Test',createdAt:'',updatedAt:''});
const owner=user('user-5209126900','5209126900',true),recipient=user('user-12345','12345'),other=user('user-222','222',true);
for(const u of [owner,recipient,other])await db.collection('users').doc(u.id).set(u);
const app=express();app.use(express.json());app.use(authMiddleware);
app.use('/api/admin/custom-tournaments/tickets',requireAdmin,customTournamentTicketsRouter);
app.use('/api/custom-tournaments/tickets',customTournamentTicketsRouter);
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base='http://127.0.0.1:'+(server.address() as any).port;
const post=async(path:string,body:any,actor=owner)=>{
 const r=await fetch(base+'/api/admin/custom-tournaments/tickets/'+path,{method:'POST',headers:{authorization:'Bearer '+createSessionToken(actor),'content-type':'application/json'},body:JSON.stringify(body)});
 return {status:r.status,body:await r.json() as any};
};
try{
 const payload={targetUserId:'12345',amount:3,idempotencyKey:'ticket-regression'};
 const first=await post('grant',payload);assert.equal(first.status,200,JSON.stringify(first.body));
 assert.equal(first.body.account.userId,recipient.id);assert.equal(first.body.account.balance,3);
 assert.equal((await db.collection('user_tickets').doc('12345').get()).exists,false);
 assert.equal((await db.collection('ticket_transactions').doc(first.body.transactionId).get()).data()?.amount,3);
 const repeat=await post('grant',payload);assert.equal(repeat.body.account.balance,3);assert.equal(repeat.body.transactionId,first.body.transactionId);
 const conflict=await post('grant',{...payload,amount:4});assert.equal(conflict.status,409);
 assert.equal((await post('grant',{...payload,targetTelegramId:'999'})).status,400);
 assert.equal((await post('grant',{...payload,targetUserId:'missing'})).status,400);
 assert.equal((await post('grant',payload,other)).status,403);
 const balance=await fetch(base+'/api/custom-tournaments/tickets/balance',{headers:{authorization:'Bearer '+createSessionToken(recipient)}});
 assert.equal((await balance.json() as any).account.balance,3);
 const spend={userId:recipient.id,tournamentId:'ct-test',idempotencyKey:'publish-test'};
 assert.equal((await spendTicketForTournament(spend)).newBalance,2);
 assert.equal((await spendTicketForTournament(spend)).newBalance,2);
 assert.equal((await post('refund',{targetUserId:'12345',tournamentId:'ct-test'})).body.newBalance,3);
 assert.equal((await post('refund',{targetUserId:'12345',tournamentId:'ct-test'})).status,409);
 assert.equal((await post('refund',{targetUserId:'12345',tournamentId:'ct-never-spent'})).status,404);
 assert.equal((await db.collection('user_tickets').doc(recipient.id).get()).data()?.balance,3);
 const message={message_id:42,date:Math.floor(Date.now()/1000),text:'Kubok yarim final',chat:{type:'channel',username:'efl_uz'}};
 await archiveCommunityMessage({...message,edit_date:message.date+1,text:'Kubok final'});
 await archiveCommunityMessage(message);
 assert.match(await communityFacts('efl_uz kubok'),/Kubok final/);
 assert.equal((await communitySourceStats())[0].count,1);
 assert.equal((await getTelegramAiConfig()).config.enabled,false);
 assert.equal((await updateTelegramAiConfig({enabled:true,allowedChatId:-1001,allowedThreadId:42},owner.telegramId)).success,true);
 assert.equal((await getTelegramAiConfig()).config.allowedThreadId,42);
 assert.equal((await updateTelegramAiConfig({enabled:false},other.telegramId)).success,false);
 const limits={chatId:-1001,threadId:42,userId:12345,userLimitPerMin:3,topicLimitPerMin:15,maxDailyRequests:3};
 const concurrent=await Promise.all(Array.from({length:4},()=>checkAndIncrementAiRateLimits(limits)));
 assert.equal(concurrent.filter(result=>result.allowed).length,3);
 assert.equal((await getAiRateLimitMetrics()).dailyRequests,3);
 const control=await checkAndIncrementAiRateLimits({...limits,countDaily:false,control:true});assert.equal(control.allowed,true);
 await claimDeliveryState(998,'pending');
 const claims=await Promise.all(Array.from({length:6},()=>claimDeliveryState(998,'sending')));
 assert.equal(claims.filter(result=>result==='ok').length,1);
 await claimDeliveryState(998,'unknown_timeout');assert.equal(await claimDeliveryState(998,'sending'),'already_handled');
 const client=getAiRedisClient()!;
 const old={token:'old',state:'pending',owner:5209126900,chat:-1001,thread:42,expiresAt:Date.now()+300000};
 const next={...old,token:'new'};
 await client.set('plan-old',old,{ex:300});await client.set('plan-latest',{token:'old'},{ex:300});
 assert.equal(await client.eval(AI_ADMIN_PLAN_REPLACE_LUA,['plan-old','plan-new','plan-latest'],[Date.now(),old.owner,old.chat,old.thread,old.token,JSON.stringify(next)]),1);
 assert.equal((await client.get<any>('plan-old')).state,'cancelled');
 assert.equal(await client.eval(AI_ADMIN_PLAN_REPLACE_LUA,['plan-old','plan-again','plan-latest'],[Date.now(),old.owner,old.chat,old.thread,old.token,JSON.stringify(next)]),0);
 const fixtureKey=ReadModelKeys.competitionFixtures('comp-test','season-2026-27');
 await redisSetRaw(fixtureKey,{data:[{id:'fixture-test',homeScore:0,seasonId:'season-2026-27',competitionId:'comp-test',updatedAt:'2026-10-09T00:00:00Z'}]});
 await db.collection('durable_fixture_overrides').doc('fixture-test').set({id:'fixture-test',homeScore:2,seasonId:'season-2026-27',competitionId:'comp-test',updatedAt:'2026-10-09T01:00:00Z'});
 assert.equal((await createAiSnapshotReader().read<any>(fixtureKey)).data[0].homeScore,2);
 const aborted=new AbortController();aborted.abort();await assert.rejects(getAiRedisClient(aborted.signal)!.set('must-not-save',true));
 assert.equal(await client.get('must-not-save'),null);
 process.env.TELEGRAM_BOT_TOKEN='999999:isolated-not-a-real-bot-token';
 await db.collection('runtime_settings').doc('recipient-directory-season-2026-27').set({entries:[{userId:recipient.id,telegramId:recipient.telegramId,username:'recipient',displayName:'Recipient',messageable:true,updatedAt:new Date().toISOString()}]});
 const event={userId:recipient.id,seasonId:'season-2026-27',eventId:'result-confirmed:pg-test',title:'Test',body:'Test only'};
 assert.equal(await enqueueSmartTelegramNotification(event),true);
 assert.equal(await enqueueSmartTelegramNotification(event),false);
 assert.equal((await processNotificationQueue(1)).processed,1);
 assert.equal(telegramRequests,1);
 assert.equal((await getBroadcastHistory())[0].recipients[0].status,'PENDING');
 const queueKey='efluz:v1:telegram:queue';
 const notificationClient=getNotificationStore()!;
 const jobs=await notificationClient.get<any[]>(queueKey);
 assert.equal(jobs?.length,1);
 await notificationClient.set(queueKey,jobs!.map(job=>({...job,availableAt:0})));
 telegramReject=false;
 assert.equal((await processNotificationQueue(1)).succeeded,1);
 assert.equal((await getBroadcastHistory())[0].recipients[0].status,'SENT');
 assert.equal((await processNotificationQueue(1)).processed,0);
 assert.equal(telegramRequests,2);
 console.log('PASS PostgreSQL smart notification queue: duplicate event protection, mocked 429 retry, durable receipt and no resend after completion; no real Telegram messages.');
 console.log('PASS PostgreSQL AI config/owner checks, rate-limit concurrency/control exemption, at-most-once delivery, plan replacement, fixture deltas and cancelled writes with no Redis/model/Telegram network.');
 console.log('PASS authenticated ticket grant, canonical recipient, visible balance, correct audit amount, retry dedupe/conflict, invalid recipient rejection, owner restriction, spend/retry/refund.');
}finally{server.close();globalThis.fetch=originalFetch;}
