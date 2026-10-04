import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { initDatabase, queryRun } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { clearProcessMemoryForTest, redisSetRaw, ReadModelKeys, getFreshKey, getUpstashClient } from '../readModel/readModelStore';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { meRouter } from '../routes/me.routes';
import { addFixtureTombstone } from '../services/fixtureTombstoneService';

await initDatabase();
const bridge = await startMockUpstashBridge();
const season='season-2026-27';
const league='comp-premier-league-2026',cup='comp-fa-cup-2026';
const owner='quota-home-owner';
const stamp='2026-10-04T12:00:00Z';
const fixture=(id:string,comp:string,md:number,status:string,home='club-arsenal',away='club-chelsea')=>({
  id,seasonId:season,competitionId:comp,matchday:md,status,homeClubId:home,awayClubId:away,
  homeScore:status==='CONFIRMED'?2:null,awayScore:status==='CONFIRMED'?1:null,scheduledAt:stamp,createdAt:stamp,updatedAt:stamp,
  userSubmission:{submittedByUserId:'foreign-user',homeScore:99,awayScore:99},
});
const rows=[fixture('saved-result',league,1,'CONFIRMED'),fixture('saved-next',league,10,'SCHEDULED'),
  fixture('old-cup-opponent',cup,1,'SCHEDULED'),fixture('other-user-match',league,2,'CONFIRMED','club-liverpool'),
  {...fixture('old-season',league,1,'CONFIRMED'),seasonId:'season-2025-26'},fixture('deleted-game',league,2,'CONFIRMED')];
await redisSetRaw(ReadModelKeys.clubsWithOwners(season),{data:[{id:'club-arsenal',name:'Arsenal',shortName:'ARS',leagueId:'league-premier-league',ownerUserId:owner,ownerUsername:'quota_owner',isOccupied:true},
  {id:'club-chelsea',name:'Chelsea',leagueId:'league-premier-league',ownerUserId:'other',ownerUsername:'other_owner',isOccupied:true}]});
await redisSetRaw(ReadModelKeys.competitions(season),{data:[{id:league,seasonId:season,leagueId:'league-premier-league',type:'LEAGUE',name:'Premier League',currentMatchday:10,isMatchdayOpen:false,formatConfig:{}},
  {id:cup,seasonId:season,leagueId:'league-premier-league',type:'KNOCKOUT',name:'FA Cup',isMatchdayOpen:false,formatConfig:{}}]});
await redisSetRaw(ReadModelKeys.adminFixtures(season),{data:rows,generatedAt:stamp});
await redisSetRaw(ReadModelKeys.competitionFixtures(cup,season),{data:[fixture('new-cup-draw',cup,1,'SCHEDULED','club-arsenal','club-liverpool')],generatedAt:'2026-10-04T13:00:00Z'});
await addFixtureTombstone({fixtureId:'deleted-game',seasonId:season,deletedAt:stamp});
await getUpstashClient()!.del(getFreshKey(ReadModelKeys.adminFixtures(season)),getFreshKey(ReadModelKeys.competitionFixtures(cup,season)),getFreshKey(ReadModelKeys.clubsWithOwners(season)));
clearProcessMemoryForTest();
queryRun('DELETE FROM fixtures');
const db=getFirestoreDb(); const original=db.collection.bind(db);let reads=0;
db.collection=(()=>{reads++;throw Object.assign(new Error('RESOURCE_EXHAUSTED'),{code:8});}) as any;
firestoreCircuitBreaker.forceState('OPEN');
const app=express();
app.use((req:any,_res,next)=>{if(req.headers['x-test-owner'])req.user={id:String(req.headers['x-test-owner'])};next();});
app.use('/api/me',meRouter);
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as any).port}`;
try{
  assert.equal((await fetch(base+'/api/me/matches')).status,401);
  const response=await fetch(base+'/api/me/matches',{headers:{'x-test-owner':owner}});
  assert.equal(response.status,200);
  const data=await response.json() as any;
  assert.equal(data.source,'redis');assert.equal(data.stale,true);
  assert.deepEqual(new Set(data.fixtures.map((f:any)=>f.id)),new Set(['saved-result','saved-next','new-cup-draw']));
  assert.equal(data.fixtures.find((f:any)=>f.id==='saved-result').homeScore,2);
  assert.equal(data.fixtures.find((f:any)=>f.id==='saved-next').isPlayable,false,'Closed round must stay closed');
  assert.equal(data.fixtures.find((f:any)=>f.id==='new-cup-draw').isPlayable,false,'Stale cup canonicalization must preserve the closed matchday gate');
  assert.ok(data.fixtures.every((f:any)=>!f.userSubmission));
  const confirmed=await fetch(base+'/api/me/matches?status=CONFIRMED',{headers:{'x-test-owner':owner}});
  assert.deepEqual((await confirmed.json() as any).fixtures.map((f:any)=>f.id),['saved-result']);
  assert.equal(reads,0,'Quota path and stale cup canonicalization must make zero Firestore calls');
  console.log('PASS HTTP cold start: stale Redis retains next match, 2–1 result, newer cup draw, locks, season/deletion filtering and user isolation without Firestore reads');
  // Per-competition snapshots work even when the full admin snapshot never existed.
  await getUpstashClient()!.del(ReadModelKeys.adminFixtures(season),getFreshKey(ReadModelKeys.adminFixtures(season)),ReadModelKeys.adminFixtures(season)+':lkg');
  const {getLkgKey}=await import('../readModel/readModelStore');
  await getUpstashClient()!.del(getLkgKey(ReadModelKeys.adminFixtures(season)));
  await redisSetRaw(ReadModelKeys.competitionFixtures(league,season),{data:rows.filter(f=>f.competitionId===league)});
  clearProcessMemoryForTest();
  const parts=await fetch(base+'/api/me/matches',{headers:{'x-test-owner':owner}});
  assert.equal(parts.status,200);assert.ok((await parts.json() as any).fixtures.some((f:any)=>f.id==='saved-result'));
  assert.equal(reads,0);
  console.log('PASS per-competition fallback and confirmed status filter');
  await getUpstashClient()!.del(getFreshKey(ReadModelKeys.clubsWithOwners(season)),getLkgKey(ReadModelKeys.clubsWithOwners(season)));
  clearProcessMemoryForTest();
  const unavailable=await fetch(base+'/api/me/matches',{headers:{'x-test-owner':owner}});
  assert.equal(unavailable.status,503,'Unavailable ownership cannot masquerade as an empty match list');
  assert.equal(reads,0);
  console.log('PASS missing ownership gives an explicit unavailable response instead of blank successful data');
}finally{server.close();db.collection=original;firestoreCircuitBreaker.forceState('CLOSED');await bridge.close();}
