import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import {once} from 'node:events';
import {getFirestoreDb,resetFirebaseAdminCache} from '../firebase/admin';
import {authMiddleware,requireAdmin} from '../middleware/authMiddleware';
import {createSessionToken} from '../auth/sessionToken';
import {customTournamentTicketsRouter} from '../routes/customTournamentTickets.routes';
import {customTournamentsRouter} from '../routes/customTournaments.routes';
import {customTournamentApi} from '../../lib/customTournamentApi';
import {spendTicketForTournament} from '../services/customTournamentTicketService';
import {archiveCommunityMessage,communityFacts,communitySourceStats} from '../services/telegramAiCommunitySources';
import {getTelegramAiConfig,updateTelegramAiConfig} from '../services/telegramAiConfigService';
import {checkAndIncrementAiRateLimits,getAiRateLimitMetrics} from '../services/telegramAiRateLimitService';
import {claimDeliveryState} from '../services/telegramAiService';
import {getAiRedisClient} from '../services/telegramAiDeadline';
import {AI_ADMIN_PLAN_REPLACE_LUA} from '../services/telegramAiPlanRevision';
import {createAiSnapshotReader} from '../services/telegramAiSnapshotReader';
import {redisSetRaw,ReadModelKeys,invalidateDataset} from '../readModel/readModelStore';
import {enqueueSmartTelegramNotification} from '../services/smartNotificationService';
import {processNotificationQueue,getBroadcastHistory} from '../services/telegramNotificationQueue';
import {getNotificationStore} from '../services/postgresNotificationStore';

// Native PostgreSQL SQL and service transactions, isolated HTTP transport.
delete process.env.FIREBASE_FORCE_LOCAL_FALLBACK;
process.env.NODE_ENV='production';
process.env.DATABASE_PROVIDER='supabase';
process.env.SUPABASE_DATA_NAMESPACE='preview';
process.env.SUPABASE_URL='https://ticket.test.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='isolated-key';
process.env.SESSION_SECRET='isolated-ticket-auth-secret-32bytes';
resetFirebaseAdminCache();
const pg=new PGlite();
await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
for(const file of ['20261009044907_postgres_document_runtime.sql','20261009125000_nonblocking_runtime_reads.sql',
 '20261009134500_patch_snapshot_rows.sql','20261010091409_application_runtime_commit_conflicts.sql',
 '20261010161456_stop_postgrest_conflict_retries.sql','20261010172440_conditional_snapshot_reads.sql',
 '20261104143845_atomic_notification_operations.sql'])await pg.exec(await readFile('supabase/migrations/'+file,'utf8'));
await pg.exec('set role service_role');
const originalFetch=globalThis.fetch;
let telegramRequests=0;
let telegramReject=true;
globalThis.fetch=async(input:any,init?:any)=>{
 if(typeof input==='string'&&input.startsWith('/api/'))return originalFetch(base+input,init);
 const url=new URL(typeof input==='string'?input:input.url);
 if(url.origin==='https://api.telegram.org'){
  telegramRequests++;
  return telegramReject?Response.json({ok:false,error_code:429,description:'retry',parameters:{retry_after:1}},{status:429}):Response.json({ok:true,result:{message_id:telegramRequests}});
 }
 if(url.origin!=='https://ticket.test.invalid')return originalFetch(input,init);
 const body=JSON.parse(init.body);
 try{
  const name=url.pathname.split('/').at(-1);let result;
  if(name==='efl_runtime_notification')result=await pg.query('select public.efl_runtime_notification($1,$2,$3::text[],$4::jsonb) value',[body.p_space,body.p_action,body.p_ids,JSON.stringify(body.p_args)]);
  else if(name==='efl_runtime_snapshot_read')result=await pg.query('select public.efl_runtime_snapshot_read($1,$2::jsonb,$3::jsonb) value',[body.p_space,JSON.stringify(body.p_ids),JSON.stringify(body.p_versions)]);
  else if(name==='efl_runtime_read')result=await pg.query('select public.efl_runtime_read($1,$2::jsonb) value',[body.p_space,JSON.stringify(body.p_query)]);
  else if(name==='efl_runtime_commit_safe')result=await pg.query('select public.efl_runtime_commit_safe($1,$2::jsonb,$3) value',[body.p_space,JSON.stringify(body.p_operations),body.p_generation]);
  else throw Error('UNEXPECTED_RPC');
  return Response.json(result.rows[0].value);
 }catch(error:any){return Response.json({code:error.code,message:error.message},{status:400});}
};
const db=getFirestoreDb();
const user=(id:string,telegramId:string,isAdmin=false)=>({id,telegramId,isAdmin,isSuspended:false,username:'recipient',firstName:'Test',createdAt:'',updatedAt:''});
const owner=user('user-5209126900','5209126900',true),recipient=user('user-12345','12345'),other=user('user-222','222',true);
for(const u of [owner,recipient,other])await db.collection('users').doc(u.id).set(u);
const app=express();app.use(express.json());app.use(authMiddleware);
app.use('/api/admin/custom-tournaments/tickets',requireAdmin,customTournamentTicketsRouter);
app.use('/api/custom-tournaments/tickets',customTournamentTicketsRouter);
app.use('/api/custom-tournaments',customTournamentsRouter);
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
 assert.equal((await balance.json() as any).account.balance,4);
 const spend={userId:recipient.id,tournamentId:'ct-test',idempotencyKey:'publish-test'};
 assert.equal((await spendTicketForTournament(spend)).newBalance,3);
 assert.equal((await spendTicketForTournament(spend)).newBalance,3);
 assert.equal((await post('refund',{targetUserId:'12345',tournamentId:'ct-test'})).body.newBalance,4);
 assert.equal((await post('refund',{targetUserId:'12345',tournamentId:'ct-test'})).status,409);
 assert.equal((await post('refund',{targetUserId:'12345',tournamentId:'ct-never-spent'})).status,404);
 assert.equal((await db.collection('user_tickets').doc(recipient.id).get()).data()?.balance,4);
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
await invalidateDataset(fixtureKey); // Real fixture-delta writes mark the read snapshot dirty before AI re-reads.
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
 // Exercise the actual browser API against authenticated HTTP routes, rather than
 // manually constructing headers as the wizard used to do incorrectly.
 const savedWindow=(globalThis as any).window;
 const savedSession=(globalThis as any).sessionStorage;
 const savedLocal=(globalThis as any).localStorage;
 try{
  (globalThis as any).window={};
  const values=new Map<string,string>();
  (globalThis as any).sessionStorage={getItem:(key:string)=>values.get(key)||null};
  (globalThis as any).localStorage={getItem:()=>null};
  await assert.rejects(customTournamentApi.getTicketBalance(),/Unauthorized/,'Missing authentication is an error, not a zero balance');
  values.set('efootball_session_token',createSessionToken(recipient));
  const before=await customTournamentApi.getTicketBalance();
  assert.equal(before.balance,4);
  const payload={name:'Authenticated wizard test',format:'LEAGUE',leagueScope:'TOP5_ALL',maxParticipants:8,visibility:'PUBLIC_OPEN',rules:{roundsCount:1,playoffLegMode:'SINGLE_LEG',matchDurationHours:36},idempotencyKey:'wizard-create'};
  const tournament=await customTournamentApi.createTournament(payload);
  assert.equal(tournament.organizerUserId,recipient.id);
  assert.equal(tournament.status,'REGISTRATION_OPEN');
  assert.ok((await customTournamentApi.getMyTournaments()).some(t=>t.id===tournament.id));
  assert.equal((await customTournamentApi.getTournamentDetails(tournament.id)).canManage,true);
  assert.ok((await customTournamentApi.getPublicTournaments()).some(t=>t.id===tournament.id));
  assert.equal((await customTournamentApi.createTournament(payload)).id,tournament.id);
  await assert.rejects(customTournamentApi.createTournament({...payload,name:'Changed payload'}),/IDEMPOTENCY_CONFLICT/);
  assert.equal((await customTournamentApi.getTicketBalance()).balance,3,'Direct creation and retry spend exactly one ticket');
  const disabled=await fetch(base+'/api/custom-tournaments/draft',{method:'POST',headers:{authorization:'Bearer '+createSessionToken(recipient),'content-type':'application/json'},body:JSON.stringify(payload)});
  assert.equal(disabled.status,410);
  console.log('PASS actual browser API: authenticated free ticket once, direct creation, retries, conflicting payload, disabled draft.');
 }finally{
  (globalThis as any).window=savedWindow;
  (globalThis as any).sessionStorage=savedSession;
  (globalThis as any).localStorage=savedLocal;
 }
}finally{server.close();globalThis.fetch=originalFetch;await pg.close();}
