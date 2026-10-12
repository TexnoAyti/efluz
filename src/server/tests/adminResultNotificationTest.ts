import assert from 'node:assert/strict';
import {initDatabase} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {SEED_CLUBS} from '../db/seed';
import {ReadModelKeys,redisSetRaw} from '../readModel/readModelStore';
import {adminEditFixtureResultFirestore,adminApproveFixtureResultFirestore} from '../firebase/firestoreStore';
import {processPendingResultRefresh} from '../services/resultRefreshJobs';
import {getNotificationStore} from '../services/postgresNotificationStore';
import {processNotificationQueue} from '../services/telegramNotificationQueue';
await initDatabase();const db=getFirestoreDb();
process.env.DATABASE_PROVIDER='supabase';process.env.SUPABASE_DATA_NAMESPACE='preview';
process.env.TELEGRAM_BOT_TOKEN='isolated-result-notification-test';
const seasonId='season-2026-27',competitionId='comp-premier-league-2026';
for(const [id,telegramId] of [['home-owner','1001'],['away-owner','1002'],['old-owner','1003']])await db.collection('users').doc(id).set({id,telegramId,username:id,isSuspended:false});
for(const [clubId,userId] of [['club-arsenal','home-owner'],['club-chelsea','away-owner']])await db.collection('club_occupancies').doc(`${seasonId}_${clubId}`).set({seasonId,clubId,userId,status:'active'});
await redisSetRaw(ReadModelKeys.clubsWithOwners(),{data:SEED_CLUBS.map(c=>({...c,ownerUserId:c.id==='club-arsenal'?'home-owner':c.id==='club-chelsea'?'away-owner':null}))});
await db.collection('competitions').doc(competitionId).set({id:competitionId,name:'Premier League',seasonId,type:'LEAGUE',status:'active',formatConfig:{}});
const fixtureId='result-notify-fixture';
await db.collection('fixtures').doc(fixtureId).set({id:fixtureId,seasonId,competitionId,matchday:1,roundName:'1-tur',homeClubId:'club-arsenal',awayClubId:'club-chelsea',homeOwnerId:'old-owner',status:'SCHEDULED',scheduledAt:'2026-10-12T20:00:00Z',createdAt:'2026-10-12T00:00:00Z'});
const result=await adminEditFixtureResultFirestore('admin','admin',fixtureId,{homeScore:2,awayScore:1,idempotencyKey:'admin-score-one'});
assert.equal(result.success,true);assert.equal((await db.collection('result_refresh_jobs').doc(fixtureId).get()).data()?.notifyResult,true,'Notification intent is committed with the score');
await processPendingResultRefresh();
const queue=getNotificationStore()!;let jobs:any[]=await queue.get('efluz:v1:telegram:queue')||[];
assert.equal(jobs.length,2);assert.deepEqual(jobs.map(j=>j.userId).sort(),['away-owner','home-owner']);
assert.ok(jobs.every(j=>j.body.includes('2')&&j.body.includes('1')&&j.replyMarkup));
assert.ok(!jobs.some(j=>j.userId==='old-owner'));
await adminEditFixtureResultFirestore('admin','admin',fixtureId,{homeScore:2,awayScore:1,idempotencyKey:'admin-score-one'});
await processPendingResultRefresh();jobs=await queue.get('efluz:v1:telegram:queue')||[];assert.equal(jobs.length,2,'Replay must not enqueue twice');
const originalFetch=globalThis.fetch;const delivered:number[]=[];
globalThis.fetch=(async(input:any,options:any)=>{
 assert.ok(String(input).startsWith('https://api.telegram.org/'));const body=JSON.parse(options.body);delivered.push(Number(body.chat_id));
 return new Response(JSON.stringify({ok:true,result:{message_id:delivered.length}}),{status:200});
}) as typeof fetch;
try {const sent=await processNotificationQueue();assert.equal(sent.succeeded,2);assert.deepEqual(delivered.sort(),[1001,1002]);}finally{globalThis.fetch=originalFetch;}
const approvalId='approved-result-notify';
await db.collection('fixtures').doc(approvalId).set({id:approvalId,seasonId,competitionId,matchday:2,homeClubId:'club-arsenal',awayClubId:'club-chelsea',status:'SCHEDULED',scheduledAt:'2026-10-13T20:00:00Z',createdAt:'2026-10-12T00:00:00Z'});
await adminApproveFixtureResultFirestore('admin',approvalId,1,1);
assert.equal((await db.collection('result_refresh_jobs').doc(approvalId).get()).data()?.notifyResult,true);
await processPendingResultRefresh();jobs=await queue.get('efluz:v1:telegram:queue')||[];assert.equal(jobs.length,2,'Approval also notifies both owners');
globalThis.fetch=(async()=>new Response(JSON.stringify({ok:true,result:{message_id:99}}),{status:200})) as typeof fetch;
try {assert.equal((await processNotificationQueue()).succeeded,2);} finally {globalThis.fetch=originalFetch;}
const originalBatch=db.batch.bind(db);
(db as any).batch=()=>{const batch=originalBatch();batch.commit=async()=>{throw Error('SCORE_COMMIT_FAILED');};return batch;};
await assert.rejects(adminEditFixtureResultFirestore('admin','admin',fixtureId,{homeScore:9,awayScore:9,idempotencyKey:'failed-score'}),/SCORE_COMMIT_FAILED/);
(db as any).batch=originalBatch;
assert.equal((await db.collection('fixtures').doc(fixtureId).get()).data()?.homeScore,2);assert.equal((await queue.get<any[]>('efluz:v1:telegram:queue'))?.length,0,'Failed scores do not enqueue alerts');
// Inject queue persistence failure after the score is safely saved. The intent
// survives, while derived standings can still proceed and the API stays successful.
await adminEditFixtureResultFirestore('admin','admin',fixtureId,{homeScore:3,awayScore:1,idempotencyKey:'admin-score-two'});
const originalTransaction=db.runTransaction.bind(db);
(db as any).runTransaction=(callback:any)=>originalTransaction(async(tx:any)=>{
 const set=tx.set.bind(tx);tx.set=(ref:any,...args:any[])=>{if(ref.colName==='telegram_ai_state'||String(ref.path||'').startsWith('telegram_ai_state/'))throw Error('QUEUE_UNAVAILABLE');return set(ref,...args);};
 return callback(tx);
});
await processPendingResultRefresh();
(db as any).runTransaction=originalTransaction;
assert.equal((await db.collection('fixtures').doc(fixtureId).get()).data()?.homeScore,3);
const retained=(await db.collection('result_refresh_jobs').doc(fixtureId).get()).data();assert.equal(retained?.notifyResult,true);
await db.collection('result_refresh_jobs').doc(fixtureId).update({leaseUntil:0});
await db.collection('users').doc('away-owner').update({isSuspended:true});
await processPendingResultRefresh();jobs=await queue.get('efluz:v1:telegram:queue')||[];
assert.equal(jobs.length,1);assert.equal(jobs[0].userId,'home-owner');
console.log('PASS admin saved result → durable intent → current owners → deduplicated Telegram queue → mocked deliveries; retry preserves result, stale owner excluded and suspension respected');
