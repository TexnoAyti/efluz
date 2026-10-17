import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { resolveCupResult } from '../../lib/cupResult';
import { initDatabase, queryGet, upsertFixtureToSqlite } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { adminEditFixtureResultFirestore, adminApproveFixtureResultFirestore, getFixtureByIdFirestore, submitFixtureResultFirestore } from '../firebase/firestoreStore';
import { normalizeFixtureSnapshot } from '../readModel/readModelStore';
import { advanceDomesticCupWinnerSafe } from '../tournament/domesticCupService';
import { adminRouter } from '../routes/admin.routes';
import { fixturesRouter } from '../routes/fixtures.routes';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';

await initDatabase();
const db = getFirestoreDb();
const competitionId = 'comp-copa-del-rey-2026';
const fixtureId = `fix-${competitionId}-r3-m0`;
const targetId = `fix-${competitionId}-r4-m0`;
const seasonId = 'season-2026-27';
const now = new Date().toISOString();
const fixture = { id: fixtureId, seasonId, competitionId, matchday: 3, roundName: 'Quarter-final', homeClubId: 'club-barcelona', awayClubId: 'club-real-sociedad', homeScore: 1, awayScore: 1, status: 'CONFIRMED', winnerClubId: null, scheduledAt: now, createdAt: now, updatedAt: now };
const score = { homeScore: 1, awayScore: 1, homePenaltyScore: 3, awayPenaltyScore: 1 };
assert.equal(resolveCupResult(score, fixture, true).winnerClubId, fixture.homeClubId);
assert.equal(resolveCupResult({homeScore: 1, awayScore: 1, homeExtraTimeScore: 2, awayExtraTimeScore: 3}, fixture, true).winnerClubId, fixture.awayClubId);
assert.equal(resolveCupResult({...score,homeExtraTimeScore:2,awayExtraTimeScore:2}, fixture, true).winnerClubId, fixture.homeClubId);
assert.equal(resolveCupResult({homeScore: 1,awayScore: 1}, fixture, false).winnerClubId, null);
for (const invalid of [
  {homeScore:1,awayScore:1}, {...score,awayPenaltyScore:3}, {...score,homePenaltyScore:null},
  {...score,homeScore:2}, {...score,homeExtraTimeScore:0,awayExtraTimeScore:0},
  {...score,homeExtraTimeScore:2}, {...score,homePenaltyScore:-1}, {...score,homePenaltyScore:1.5},
]) assert.throws(() => resolveCupResult(invalid, fixture, true), /./);
assert.throws(() => resolveCupResult(score, fixture, false));
await db.collection('competitions').doc(competitionId).set({id: competitionId, seasonId, name:'Copa del Rey', type:'KNOCKOUT', status:'active', currentMatchday:3, isMatchdayOpen:true});
await db.collection('fixtures').doc(fixtureId).set(fixture);
await db.collection('fixtures').doc(targetId).set({...fixture,id:targetId,matchday:4,roundName:'Semi-final',status:'SCHEDULED',homeClubId:null,awayClubId:null,homeScore:null,awayScore:null,homeSourceFixtureId:fixtureId});
for (const id of ['cup-admin','cup-viewer']) await db.collection('users').doc(id).set({id,username:id,isAdmin:id==='cup-admin',isSuspended:false});
// The production PostgreSQL path commits the score, audit, visible delta and refresh job atomically.
process.env.DATABASE_PROVIDER = 'supabase';
const app=express();app.use(express.json());
app.use((req,_res,next)=>{req.user={id:String(req.headers['x-test-user']),isAdmin:req.headers['x-test-user']==='cup-admin',isSuspended:false} as any;next();});
app.use('/api/admin',adminRouter);app.use('/api/fixtures',fixturesRouter);
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as any).port}`;
const post=(path:string,user:string,body:any)=>fetch(`${base}${path}`,{method:'POST',headers:{'content-type':'application/json','x-test-user':user},body:JSON.stringify(body)});
try {
 const url=`/api/admin/fixtures/${fixtureId}/result`;
 assert.equal((await post(url,'cup-viewer',score)).status,403);
 assert.equal((await post(`/api/fixtures/${fixtureId}/result`,'cup-viewer',score)).status,403);
 assert.equal((await db.collection('fixtures').doc(fixtureId).get()).data()?.winnerClubId,null);
 const invalid=await post(url,'cup-admin',{homeScore:1,awayScore:1});
 assert.equal(invalid.status,400);
 const saved=await post(url,'cup-admin',score);
 assert.equal(saved.status,200,await saved.clone().text());
 const data=(await saved.json() as any).fixture;
 assert.equal(data.homeScore,1);assert.equal(data.awayScore,1);
 assert.equal(data.homePenaltyScore,3);assert.equal(data.awayPenaltyScore,1);
 assert.equal(data.winnerClubId,fixture.homeClubId);
 assert.equal((await getFixtureByIdFirestore(fixtureId))?.homePenaltyScore,3);
 const row=queryGet<any>('SELECT * FROM fixtures WHERE id = ?',[fixtureId]);
 assert.equal(row.home_penalty_score,3);
 assert.equal(normalizeFixtureSnapshot(row).awayPenaltyScore,1);
 upsertFixtureToSqlite({id:fixtureId,updatedAt:now});
 assert.equal(queryGet<any>('SELECT * FROM fixtures WHERE id = ?',[fixtureId]).home_penalty_score,3);
 assert.ok((await db.collection('result_refresh_jobs').doc(fixtureId).get()).exists);
 const advanced=await advanceDomesticCupWinnerSafe(fixtureId,{adminUserId:'cup-admin'});
 assert.equal(advanced.advanced,true);
 assert.equal((await db.collection('fixtures').doc(targetId).get()).data()?.homeClubId,fixture.homeClubId);
 await assert.rejects(()=>adminEditFixtureResultFirestore('cup-admin','admin',fixtureId,{homeScore:1,awayScore:1}), (error:any)=>error.code==='INVALID_CUP_RESULT');
 await assert.rejects(()=>adminApproveFixtureResultFirestore('cup-admin',fixtureId,1,1),(error:any)=>error.code==='INVALID_CUP_RESULT');
 const extra=await adminEditFixtureResultFirestore('cup-admin','admin',fixtureId,{homeScore:1,awayScore:1,homeExtraTimeScore:2,awayExtraTimeScore:1});
 assert.equal(extra.fixture.homeExtraTimeScore,2);assert.equal(extra.fixture.homePenaltyScore,null);
 assert.equal(extra.fixture.homeScore,1);assert.equal(extra.fixture.winnerClubId,fixture.homeClubId);
 assert.equal(queryGet<any>('SELECT * FROM fixtures WHERE id = ?',[fixtureId]).home_penalty_score,null);
 firestoreCircuitBreaker.forceState('OPEN');
 await assert.rejects(()=>submitFixtureResultFirestore('cup-viewer',fixtureId,1,1),(error:any)=>error.code==='CUP_ADMIN_ONLY');
 console.log('PASS cup result validation, admin-only HTTP, legacy 1–1 repaired as pens 3–1, persistence/reload/SQLite metadata and Barcelona semifinal advancement; fallback submissions denied.');
} finally {server.close();}
