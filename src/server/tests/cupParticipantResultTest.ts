import { startMockUpstashBridge } from './mockUpstashBridge';
import { processPendingMutations } from '../sync/mutationQueue';
import { getDurableMutation } from '../outbox/redisOutbox';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { initDatabase, queryGet, queryRun, upsertFixtureToSqlite } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { fixturesRouter } from '../routes/fixtures.routes';
import { adminRouter } from '../routes/admin.routes';
import { setSeasonLifecycleOverride } from '../services/seasonLifecycleService';
import { getFixtureByIdFirestore, invalidateFirestoreCache, submitFixtureResultFirestore } from '../firebase/firestoreStore';

await initDatabase();
const db = getFirestoreDb();
const seasonId = 'season-2026-27';
const competitionId = 'comp-copa-del-rey-2026';
const homeClubId = 'club-barcelona', awayClubId = 'club-real-sociedad';
const now = new Date().toISOString();
await db.collection('competitions').doc(competitionId).set({ id: competitionId, seasonId, type: 'KNOCKOUT', name: 'Copa del Rey', status: 'active', currentMatchday: 3, isMatchdayOpen: true });
await setSeasonLifecycleOverride(seasonId, 'DOMESTIC_CUPS', 'Cup participant regression', 'cup-test-admin', 3);
for (const [id, clubId] of [['cup-home', homeClubId], ['cup-away', awayClubId], ['cup-outsider', 'club-real-madrid']]) {
  await db.collection('users').doc(id).set({id,isAdmin:false,isSuspended:false});
  await db.collection('user_memberships').doc(`${seasonId}_${id}`).set({userId:id,clubId,seasonId,status:'active'});
}
async function createMatch(index: number) {
  const id = `fix-${competitionId}-r3-m${index}`;
  const targetId = `fix-${competitionId}-r4-m${Math.floor(index / 2)}`;
  if (!(await db.collection('fixtures').doc(targetId).get()).exists) await db.collection('fixtures').doc(targetId).set({id:targetId,seasonId,competitionId,matchday:4,roundName:'Semi-final',homeClubId:null,awayClubId:null,status:'SCHEDULED',scheduledAt:now,createdAt:now,updatedAt:now});
  await db.collection('fixtures').doc(id).set({id,seasonId,competitionId,matchday:3,roundName:'Quarter-final',homeClubId,awayClubId,status:'SCHEDULED',homeScore:null,awayScore:null,winnerClubId:null,scheduledAt:now,createdAt:now,updatedAt:now});
  await db.collection('fixtures').doc(targetId).update(index % 2 === 0 ? {homeSourceFixtureId:id} : {awaySourceFixtureId:id});
  invalidateFirestoreCache();
  return {id,targetId};
}
const app=express();app.use(express.json());
app.use((req,_res,next)=>{req.user={id:String(req.headers['x-test-user']),isAdmin:false,isSuspended:false} as any;next();});
app.use('/api/fixtures',fixturesRouter);app.use('/api/admin',adminRouter);
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as any).port}`;
const post=(id:string,user:string,score:any)=>fetch(`${base}/api/fixtures/${id}/result`,{method:'POST',headers:{'content-type':'application/json','x-test-user':user},body:JSON.stringify(score)});
async function submit(id:string,user:string,score:any,status:string) {
  const response=await post(id,user,score);const body=await response.json() as any;
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.fixture.status,status);
  return body.fixture;
}
try {
  const decisive=await createMatch(0);
  const outsider=await post(decisive.id,'cup-outsider',{homeScore:2,awayScore:0,userId:'cup-home',isAdmin:true});
  assert.equal(outsider.status,403);assert.equal((await outsider.json() as any).code,'RESULT_NOT_PARTICIPANT');
  assert.equal((await db.collection('result_submissions').where('fixtureId','==',decisive.id).get()).size,0);
  const adminOnly=await fetch(`${base}/api/admin/fixtures/${decisive.id}/result`,{method:'POST',headers:{'content-type':'application/json','x-test-user':'cup-home'},body:JSON.stringify({homeScore:2,awayScore:0})});
  assert.equal(adminOnly.status,403,'Participants cannot use the admin editor endpoint');
  await submit(decisive.id,'cup-home',{homeScore:2,awayScore:0},'PENDING_CONFIRMATION');
  await submit(decisive.id,'cup-away',{homeScore:2,awayScore:0},'CONFIRMED');
  assert.equal((await db.collection('fixtures').doc(decisive.targetId).get()).data()?.homeClubId,homeClubId);
  const penalty=await createMatch(1);
  assert.equal((await post(penalty.id,'cup-home',{homeScore:1,awayScore:1})).status,400,'Unresolved cup draw must not be submitted');
  const score={homeScore:1,awayScore:1,homeExtraTimeScore:2,awayExtraTimeScore:2,homePenaltyScore:3,awayPenaltyScore:1,proofUrl:'https://example.com/cup-proof.png'};
  await submit(penalty.id,'cup-home',score,'PENDING_CONFIRMATION');
  const reopened=await getFixtureByIdFirestore(penalty.id,'cup-away');
  assert.equal(reopened?.opponentSubmission?.homePenaltyScore,3);
  assert.equal(reopened?.opponentSubmission?.homeExtraTimeScore,2);
  await submit(penalty.id,'cup-away',{...score,homePenaltyScore:1,awayPenaltyScore:3},'DISPUTED');
  assert.equal((await db.collection('fixtures').doc(penalty.id).get()).data()?.winnerClubId,null);
  const confirmed=await submit(penalty.id,'cup-away',score,'CONFIRMED');
  assert.equal(confirmed.homeScore,1);assert.equal(confirmed.homeExtraTimeScore,2);assert.equal(confirmed.homePenaltyScore,3);assert.equal(confirmed.winnerClubId,homeClubId);
  assert.equal((await db.collection('fixtures').doc(penalty.targetId).get()).data()?.awayClubId,homeClubId);
  assert.equal(queryGet<any>('SELECT * FROM result_submissions WHERE fixture_id = ? LIMIT 1',[penalty.id]).home_penalty_score,3);
  const extra=await createMatch(2);
  const et={homeScore:1,awayScore:1,homeExtraTimeScore:2,awayExtraTimeScore:1};
  await submit(extra.id,'cup-home',et,'PENDING_CONFIRMATION');
  const etResult=await submit(extra.id,'cup-away',et,'CONFIRMED');
  assert.equal(etResult.winnerClubId,homeClubId);assert.equal(etResult.homePenaltyScore,null);
  const retry=await post(penalty.id,'cup-home',{homeScore:9,awayScore:0});assert.equal(retry.status,409);
  const offline = await createMatch(3);
  upsertFixtureToSqlite({ id:offline.id, seasonId, competitionId, matchday:3, homeClubId, awayClubId, status:'SCHEDULED' });
  for (const [userId,clubId] of [['cup-home',homeClubId],['cup-away',awayClubId]]) {
    queryRun('INSERT OR REPLACE INTO users (id,telegram_id,username,first_name,is_admin,is_suspended,created_at,updated_at) VALUES (?,?,?,?,0,0,?,?)',[userId,userId,userId,userId,now,now]);
    queryRun("INSERT OR REPLACE INTO club_memberships (id,season_id,club_id,user_id,status,claimed_at) VALUES (?,?,?,?,'active',?)",[`${seasonId}_${userId}`,seasonId,clubId,userId,now]);
  }
  const bridge = await startMockUpstashBridge();
  try {
    firestoreCircuitBreaker.forceState('OPEN');
    const queued = await submitFixtureResultFirestore('cup-home',offline.id,1,1,undefined,score);
    assert.equal(queued.status,'PENDING_CONFIRMATION');
    const mutationId=`sub_${offline.id}_cup-home`;
    assert.equal((await getDurableMutation(mutationId))?.payload.homePenaltyScore,3);
    assert.equal(queryGet<any>('SELECT * FROM result_submissions WHERE fixture_id = ?',[offline.id]).home_extra_time_score,2);
    firestoreCircuitBreaker.forceState('CLOSED');
    const replayed=await processPendingMutations();
    assert.equal(replayed.failed,0,JSON.stringify(replayed.errors));
    assert.equal((await getDurableMutation(mutationId))?.status,'SYNCED');
    const final=await submitFixtureResultFirestore('cup-away',offline.id,1,1,undefined,score);
    assert.equal(final.status,'CONFIRMED');assert.equal(final.homePenaltyScore,3);assert.equal(final.winnerClubId,homeClubId);
  } finally { await bridge.close(); }
  console.log('PASS cup normal participant flow: outsider/admin-editor denial, decisive result, ET/shootout matching, mismatch dispute, full submission reload, SQLite metadata, progression, unresolved draw and final overwrite guards.');
} finally {server.close();}
