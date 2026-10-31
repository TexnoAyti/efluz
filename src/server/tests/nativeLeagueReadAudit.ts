import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { getFirestoreDb } from '../firebase/admin';
import { readNativeLeagueTable } from '../services/nativeLeagueTable';
import { getDashboardLeagueStats } from '../services/dashboardLeagueStatsService';
import { addFixtureTombstone } from '../services/fixtureTombstoneService';
import { competitionsRouter } from '../routes/competitions.routes';
import { SEED_CLUBS } from '../db/seed';

export async function verifyNativeLeagueRead() {
 const db = getFirestoreDb(), seasonId = 'season-2026-27', competitionId = 'comp-premier-league-2026';
 const fixture:any = {id:'native-league-confirmed',seasonId,competitionId,homeClubId:'club-arsenal',awayClubId:'club-chelsea',matchday:1,status:'CONFIRMED',homeScore:2,awayScore:1};
 for (const row of [fixture,{...fixture,id:'native-league-pending',status:'PENDING_CONFIRMATION',homeScore:90},
  {...fixture,id:'native-league-deleted',homeScore:99}, {...fixture,id:'native-league-other-season',seasonId:'season-other'},
  {...fixture,id:'native-league-other-competition',competitionId:'comp-la-liga-2026'}]) await db.collection('fixtures').doc(row.id).set(row);
 await addFixtureTombstone({fixtureId:'native-league-deleted',seasonId,competitionId,deletedAt:new Date().toISOString()});
 const original = db.collection.bind(db), transaction = db.runTransaction.bind(db), batch = db.batch.bind(db);
 let fixtureQueries=0, metadataQueries=0, writes=0;
 const wrap = (query:any, filters:any[]=[]):any => new Proxy(query,{get(target,key){
  if(key==='get') return async()=>{fixtureQueries++;assert.ok(filters.some(a=>a[0]==='seasonId'&&a[2]===seasonId));assert.ok(filters.some(a=>a[0]==='competitionId'&&a[2]===competitionId));assert.ok(filters.some(a=>a[0]==='limit'&&a[1]===1001));return target.get();};
  const value=Reflect.get(target,key);
  if(typeof value!=='function')return value;
  return (...args:any[])=>{const result=value.apply(target,args);return ['where','limit'].includes(String(key))?wrap(result,[...filters,key==='limit'?['limit',...args]:args]):result;};
 }});
 (db as any).collection=(name:string)=>{
  if(name==='fixtures')return wrap(original(name));
  if(name==='durable_read_snapshots'){metadataQueries++;return original(name);}
  throw Error('Unrelated read blocked: '+name);
 };
 (db as any).runTransaction=()=>{writes++;throw Error('Table reads must not write');};
 (db as any).batch=()=>{writes++;throw Error('Table reads must not publish snapshots');};
 const nativeRead=(db as any).readSnapshotDocuments;
 if(nativeRead)(db as any).readSnapshotDocuments=(...args:any[])=>{metadataQueries++;return nativeRead.apply(db,args);};
 try {
  const arsenal={...SEED_CLUBS.find(c=>c.id==='club-arsenal')!,active:true,createdAt:''};
  const readers=await Promise.all([...Array.from({length:8},()=>readNativeLeagueTable(competitionId,seasonId)),getDashboardLeagueStats(arsenal,seasonId)]);
  assert.equal(fixtureQueries,1,'Concurrent Home/Table readers share one bounded fixture query');
  assert.equal(metadataQueries,1,'Fresh and LKG tombstones are read together');assert.equal(writes,0);
  const table:any=readers[0], row=table.standings.find((r:any)=>r.clubId==='club-arsenal');
  assert.equal(table.standings.length,20);assert.equal(row.points,3);assert.equal(row.goalsFor,2);assert.equal(row.played,1);
  assert.equal(table.fixtureTruthCount,2,'Deleted and wrong-season/competition fixtures are excluded');
  assert.equal((readers.at(-1) as any).points,3);assert.ok(row.logoUrl&&row.shortName);
  assert.ok(table.standings.every((r:any)=>!r.managerUserId&&!r.managerUsername));
  await original('fixtures').doc(fixture.id).update({homeScore:0,awayScore:1});
  const app=express();app.use('/api/competitions',competitionsRouter);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try {
   const response=await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/competitions/${competitionId}/standings?seasonId=${seasonId}&view=league-summary`);
   assert.equal(response.status,200);const data:any=await response.json();assert.equal(data.source,'native-league-fixture-truth');
   assert.equal(data.standings.find((r:any)=>r.clubId==='club-chelsea').points,3,'Next HTTP read sees edited result');
   assert.equal(data.standings.find((r:any)=>r.clubId==='club-arsenal').points,0);
   assert.match(response.headers.get('server-timing')||'',/table;dur=/);assert.equal(writes,0);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
 }finally{(db as any).collection=original;(db as any).runTransaction=transaction;(db as any).batch=batch;if(nativeRead)(db as any).readSnapshotDocuments=nativeRead;}
 for (const id of ['native-league-confirmed','native-league-pending','native-league-deleted','native-league-other-season','native-league-other-competition']) await original('fixtures').doc(id).delete();
 assert.equal(await readNativeLeagueTable(competitionId,'season-2025-26'),null,'Historical tables keep their own stored roster');
 await assert.rejects(readNativeLeagueTable('comp-ligue-1-2026','season-2026-27'),/olib tashlangan/);
 console.log('PASS native league table and Home: one bounded read, batched tombstones, no writes/unrelated queries, live scores, pending/deleted exclusions, HTTP summary, roster logos and season gates');
}
