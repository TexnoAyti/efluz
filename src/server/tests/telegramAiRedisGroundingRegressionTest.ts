import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { redisSetRaw, ReadModelKeys, getFreshKey, getLkgKey, getDirtyKey, getUpstashClient, clearProcessMemoryForTest } from '../readModel/readModelStore';
import { buildAiGroundingContext, setTestGroundingOverride } from '../services/telegramAiGroundingService';
import { createAiSnapshotReader } from '../services/telegramAiSnapshotReader';

await initDatabase();
const bridge=await startMockUpstashBridge();
const client=getUpstashClient()!;
const season='season-2026-27',league='comp-premier-league-2026',cup='comp-fa-cup-2026';
const old='2026-10-04T10:00:00Z',fresh='2026-10-04T12:00:00Z';
const f=(id:string,comp:string,homeScore:number,awayScore:number,away='club-chelsea')=>({id,seasonId:season,competitionId:comp,homeClubId:'club-arsenal',awayClubId:away,homeScore,awayScore,status:'CONFIRMED',matchday:1,updatedAt:fresh});
setTestGroundingOverride(null);
await redisSetRaw(ReadModelKeys.competitions(season),{data:[{id:league,seasonId:season,name:'Premier League',type:'LEAGUE',leagueId:'league-premier-league',formatConfig:{}},
  {id:cup,seasonId:season,name:'FA Cup',type:'KNOCKOUT',leagueId:'league-premier-league',formatConfig:{}}],generatedAt:fresh});
await redisSetRaw(ReadModelKeys.clubsWithOwners(season),{data:[{id:'club-arsenal',name:'Arsenal',shortName:'ARS',leagueId:'league-premier-league',ownerUserId:'private-internal-id',ownerUsername:'actual_owner'},
  {id:'club-chelsea',name:'Chelsea',shortName:'CHE',leagueId:'league-premier-league',ownerUserId:null}],generatedAt:fresh});
await redisSetRaw(ReadModelKeys.adminFixtures(season),{data:[f('old-league-result',league,8,7),f('old-cup-draw',cup,9,8)],generatedAt:old});
await redisSetRaw(ReadModelKeys.competitionFixtures(league,season),{data:[f('latest-league',league,2,1),f('deleted',league,64,63),{...f('foreign-season',league,77,76),seasonId:'season-2025-26'}],generatedAt:fresh});
await redisSetRaw(ReadModelKeys.competitionFixtures(cup,season),{data:[f('new-cup-draw',cup,4,0)],generatedAt:fresh});
await redisSetRaw(`efluz:v1:season:${season}:fixture-tombstones`,{data:[{fixtureId:'deleted',deletedAt:fresh}],generatedAt:fresh});
await redisSetRaw(ReadModelKeys.standings(league,season),{data:[{clubId:'club-arsenal',clubName:'Arsenal',position:2,points:6,played:3,won:2,drawn:0,lost:1,goalsFor:5,goalsAgainst:3,goalDifference:2}],generatedAt:fresh});
// Real SDK reads, not the grounding override used by older tests.
const originalFetch=global.fetch;let batches=0;
global.fetch=async(input:any,init?:any)=>{const body=JSON.parse(init?.body||'null');if(Array.isArray(body)&&String(body[0]).toLowerCase()==='mget')batches++;return originalFetch(input,init);};
const db=getFirestoreDb(),originalCollection=db.collection.bind(db);let firestoreReads=0;
db.collection=(()=>{firestoreReads++;throw new Error('RESOURCE_EXHAUSTED');}) as any;
firestoreCircuitBreaker.forceState('OPEN');
try{
  clearProcessMemoryForTest();
  const result=await buildAiGroundingContext('Arsenal oxirgi natijalari qanday?');
  assert.ok(result.factsSummary.includes('Arsenal 2 - 1 Chelsea') && result.factsSummary.includes('Arsenal 4 - 0 Chelsea'));
  for(const score of ['8 - 7','9 - 8','64 - 63','77 - 76'])assert.ok(!result.factsSummary.includes(score),score+' must not leak from old/deleted/foreign snapshots');
  assert.equal(result.dataDiagnostics?.fixturesCount,2);
  assert.equal(result.hasStaleData,false,'A cup has no league standings; that expected absence must not mark verified facts stale');
  assert.ok(batches<=4,'Grounding must batch snapshot reads instead of per-key round trips');
  assert.equal(firestoreReads,0);
  const exact=await buildAiGroundingContext('Arsenal egasi kim va nechanchi?');
  assert.ok(exact.factualAnswer?.includes('@actual_owner') && exact.factualAnswer?.includes('2-o‘rin, 6 ochko'));
  assert.ok(!exact.factsSummary.includes('private-internal-id'));
  console.log('PASS actual Redis SDK integration: newest league and cup slices, deleted/foreign/old data excluded, exact owner/rank, <=4 batched requests and zero Firestore reads');

  // Empty newer cup draw is authoritative and must remove old games too.
  await redisSetRaw(ReadModelKeys.competitionFixtures(cup,season),{data:[],generatedAt:'2026-10-04T13:00:00Z'});
  assert.ok(!(await buildAiGroundingContext('Arsenal natijalari')).factsSummary.includes('Arsenal 4 - 0 Chelsea'));
  // Admin can be newer than an individual competition snapshot.
  await redisSetRaw(ReadModelKeys.adminFixtures(season),{data:[f('newer-admin-result',league,3,1)],generatedAt:'2026-10-04T14:00:00Z'});
  const newerAdmin=await buildAiGroundingContext('Arsenal natijalari');
  assert.ok(newerAdmin.factsSummary.includes('Arsenal 3 - 1 Chelsea') && !newerAdmin.factsSummary.includes('Arsenal 2 - 1 Chelsea'));
  console.log('PASS timestamp precedence in both directions and authoritative empty cup draw');

  const key=ReadModelKeys.standings(league,season);
  await client.del(getFreshKey(key));
  const lkg=await createAiSnapshotReader().read<any>(key);
  assert.equal(lkg.data[0].points,6);assert.equal(lkg.stale,true);
  await client.set(getFreshKey(key),'{broken-json');
  assert.equal((await createAiSnapshotReader().read<any>(key)).data[0].points,6,'Malformed fresh data falls back to valid LKG');
  await client.set(getFreshKey(key),JSON.stringify({data:[{points:999}],generatedAt:fresh}));
  await client.set(getDirtyKey(key),'1');
  assert.equal((await createAiSnapshotReader().read<any>(key)).data[0].points,6,'Dirty snapshot cannot override LKG');
  await client.del(getFreshKey(ReadModelKeys.clubsWithOwners(season)),getLkgKey(ReadModelKeys.clubsWithOwners(season)));
  const absent=await buildAiGroundingContext('Arsenal egasi kim?');
  assert.ok(absent.dataDiagnostics?.missingDatasets.includes(ReadModelKeys.clubsWithOwners(season)));
  assert.ok(!absent.factualAnswer?.includes('@actual_owner'));
  const controller=new AbortController();controller.abort();
  const aborted=await createAiSnapshotReader(controller.signal).read(key);
  assert.equal(aborted.available,false);
  console.log('PASS stale, malformed, dirty, missing and aborted snapshots produce truthful data/diagnostics');
}finally{global.fetch=originalFetch;db.collection=originalCollection;firestoreCircuitBreaker.forceState('CLOSED');await bridge.close();}
