import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {initDatabase} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {ReadModelKeys,getFreshKey,getLkgKey,getDirtyKey,patchCommittedFixtureVisibility} from '../readModel/readModelStore';
import {readPostgresSnapshotBundle} from '../readModel/postgresSnapshots';
import type {Fixture} from '../../types';

await initDatabase();
process.env.DATABASE_PROVIDER='supabase';
process.env.SUPABASE_DATA_NAMESPACE='production';
const db=getFirestoreDb();
const seasonId='season-2027-28',competitionId='comp-premier-league-2027';
const fixture={id:'visible-commit-one',seasonId,competitionId,matchday:3,
 homeClubId:'club-arsenal',awayClubId:'club-chelsea',status:'SCHEDULED',
 homeScore:null,awayScore:null,updatedAt:'2026-11-15T17:00:00.000Z'} as Fixture;
const other={...fixture,id:'visible-commit-two',homeClubId:'club-liverpool',awayClubId:'club-everton'};
const keys=[ReadModelKeys.adminFixtures(seasonId),ReadModelKeys.competitionFixtures(competitionId,seasonId)];
const hash=(key:string)=>createHash('sha256').update(key).digest('hex');
for(const key of keys){
 const original={schemaVersion:'v1',generatedAt:fixture.updatedAt,sourceVersion:'before-admin-result',
   actualCount:2,expectedCount:2,data:[fixture,other]};
 for(const snapshotKey of [getFreshKey(key),getLkgKey(key)]){
  await db.collection('durable_read_snapshots').doc(hash(snapshotKey)).set({
   snapshotJson:JSON.stringify(original),expiresAt:snapshotKey===getLkgKey(key)?null:Date.now()+86400000,
  });
 }
}
const committed={...fixture,status:'CONFIRMED',homeScore:3,awayScore:1,updatedAt:'2026-11-15T17:05:00.000Z'} as Fixture;
const result=await patchCommittedFixtureVisibility(committed);
assert.equal(result.visibleSynced,true,'A committed score must be visible on both fixture read models');
assert.deepEqual(result.pendingKeys,[]);
for(const key of keys){
 const view=await readPostgresSnapshotBundle(getFreshKey(key),getLkgKey(key),getDirtyKey(key));
 assert.equal(view.fresh?.data?.find((f:any)=>f.id===fixture.id)?.homeScore,3);
 assert.equal(view.fresh?.data?.find((f:any)=>f.id===fixture.id)?.awayScore,1);
 assert.equal(view.lkg?.data?.find((f:any)=>f.id===fixture.id)?.homeScore,3);
 assert.equal(view.fresh?.data?.find((f:any)=>f.id===other.id)?.status,'SCHEDULED','No other fixture may change');
}
console.log('PASS committed AI/admin result patches both durable Web App fixture snapshots without changing other games');
