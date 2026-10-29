import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { SEED_COMPETITIONS, SEED_CLUBS } from '../db/seed';
import { ReadModelKeys, redisSetRaw, redisGetFresh } from '../readModel/readModelStore';
import { addFixtureTombstone } from '../services/fixtureTombstoneService';
import { competitionsRouter } from '../routes/competitions.routes';
import { loadActiveClubStanding } from '../../lib/useActiveClubStanding';
import { loadFixtureClubPositions } from '../../lib/useFixtureClubPositions';
import { getLoginClubState } from '../services/loginClubState';
import { readPostgresOwnedFixtures } from '../services/postgresOwnedFixtures';

await initDatabase();
const db=getFirestoreDb(),seasonId='season-2026-27',comp='comp-premier-league-2026';
const clubs=SEED_CLUBS.filter(c=>c.leagueId==='league-premier-league');
const oldRows=clubs.map((c,i)=>({clubId:c.id,clubName:c.name,position:i+1,played:0,won:0,drawn:0,lost:0,goalsFor:0,goalsAgainst:0,goalDifference:0,points:0,managerUserId:'old-private-owner',managerUsername:'stale-owner'}));
const game:any={id:'home-latency-result',seasonId,competitionId:comp,homeClubId:'club-arsenal',awayClubId:'club-chelsea',matchday:1,status:'CONFIRMED',homeScore:2,awayScore:1};
await redisSetRaw(ReadModelKeys.competitions(seasonId),{data:SEED_COMPETITIONS});
await redisSetRaw(ReadModelKeys.standings(comp,seasonId),{data:oldRows});
await redisSetRaw(ReadModelKeys.competitionFixtures(comp,seasonId),{data:[game,{...game,id:'pending',status:'PENDING_CONFIRMATION',homeScore:90},{...game,id:'deleted',homeScore:99}]});
await addFixtureTombstone({fixtureId:'deleted',seasonId,competitionId:comp,deletedAt:new Date().toISOString()});
const originalCollection=db.collection.bind(db),originalTransaction=db.runTransaction.bind(db);
let unrelatedReads=0,writes=0;
(db as any).collection=(name:string)=>{
 if(['users','club_memberships','club_occupancies','competitions','matchday_locks'].includes(name)){
  unrelatedReads++;throw Error('Unrelated ownership/European/round query blocked');
 }
 return originalCollection(name);
};
(db as any).runTransaction=()=>{writes++;throw Error('A table read must not write');};
const app=express();app.use('/api/competitions',competitionsRouter);
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as any).port}`;
try {
 const request=async(path:string)=>{
  const response=await fetch(base+path);assert.equal(response.status,200);return response.json() as Promise<any>;
 };
 const catalog=await request(`/api/competitions?seasonId=${seasonId}&view=league-summary`);
 assert.equal(catalog.competitions.length,4);
 assert.ok(catalog.competitions.every((c:any)=>c.type==='LEAGUE'));
 const table=await request(`/api/competitions/${comp}/standings?seasonId=${seasonId}&view=league-summary`);
 const arsenal=table.standings.find((r:any)=>r.clubId==='club-arsenal');
 assert.equal(arsenal.points,3);assert.equal(arsenal.played,1);assert.equal(arsenal.goalsFor,2);
 assert.equal(table.fixtureTruthCount,2,'Deleted fixtures are excluded; pending scores never count');
 assert.ok(table.standings.every((r:any)=>!r.managerUserId&&!r.managerUsername));
 assert.equal(unrelatedReads,0,'Warm home data cannot depend on unrelated manager, Europe or round queries');
 assert.equal(writes,0,'Reads cannot wait for durable snapshot writes');
 assert.equal((await redisGetFresh<any[]>(ReadModelKeys.standings(comp,seasonId)))?.data.find(r=>r.clubId==='club-arsenal').points,0,'Projection did not rewrite stored rows');
 const calls:string[]=[];
 const client:any={
  getCompetitions:async(s:string,skip:boolean,view:string)=>{assert.equal(s,seasonId);assert.equal(view,'league-summary');calls.push('catalog');return catalog;},
  getCompetitionStandings:async(id:string,skip:boolean,s:string,view:string)=>{assert.equal(id,comp);assert.equal(s,seasonId);assert.equal(view,'league-summary');calls.push('table');return table;},
 };
 assert.equal((await loadActiveClubStanding('club-arsenal','league-premier-league',seasonId,client))?.points,3);
 const ranks=await loadFixtureClubPositions({...game,homeClub:clubs.find(c=>c.id===game.homeClubId),awayClub:clubs.find(c=>c.id===game.awayClubId)},seasonId,client);
 assert.equal(ranks['club-arsenal'],arsenal.position);assert.ok(ranks['club-chelsea']>0);
 assert.deepEqual(calls,['catalog','table','catalog','table']);
} finally { (db as any).collection=originalCollection;(db as any).runTransaction=originalTransaction;await new Promise<void>(resolve=>server.close(()=>resolve())); }
// Query work is bounded by verified clubs and season, and parallel callers coalesce.
await originalCollection('fixtures').doc(game.id).set(game);
await originalCollection('fixtures').doc('other-club-game').set({...game,id:'other-club-game',homeClubId:'club-liverpool',awayClubId:'club-everton'});
await originalCollection('fixtures').doc('other-season-game').set({...game,id:'other-season-game',seasonId:'season-2027-28'});
let fixtureQueries=0;
const guard=(query:any,filters:any[]=[]):any=>new Proxy(query,{get(target,key){
 if(key==='get')return async()=>{fixtureQueries++;assert.ok(filters.some(([field,op,values])=>['homeClubId','awayClubId'].includes(field)&&op==='in'&&values.length<=30),'Fixture query must be club-scoped');return target.get();};
 const value=Reflect.get(target,key);
 if(typeof value!=='function')return value;
 return (...args:any[])=>{const next=value.apply(target,args);return ['where','limit'].includes(String(key))?guard(next,key==='where'?[...filters,args]:filters):next;};
}});
(db as any).collection=(name:string)=>name==='fixtures'?guard(originalCollection(name)):originalCollection(name);
try {
 const results=await Promise.all(Array.from({length:8},()=>readPostgresOwnedFixtures(seasonId,['club-arsenal','club-chelsea'])));
 assert.ok(results.every(rows=>rows.length===1&&rows[0].id===game.id),'Exclude other owners/seasons and deduplicate fixtures involving both owned clubs');
 assert.equal(fixtureQueries,2,'Eight simultaneous callers use only the home/away query pair');
 await originalCollection('fixtures').doc(game.id).update({homeScore:4});
 assert.equal((await readPostgresOwnedFixtures(seasonId,['club-arsenal','club-chelsea']))[0].homeScore,4,'Next request sees changed results');
} finally {(db as any).collection=originalCollection;}
// Independently hold ownership indefinitely: verified login must not wait for the old 1.2s budget.
(db as any).collection=(name:string)=>{
 if(name==='durable_read_snapshots') return {where(){return this;},get:()=>new Promise(()=>{})};
 return originalCollection(name);
};
process.env.DATABASE_PROVIDER='supabase';
try {
 const state=await Promise.race([getLoginClubState('latency-new-user'),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(Error('Optional ownership blocked login')),1000);timer.unref();})]);
 assert.equal(state.currentClubStatus,'unavailable','Unknown ownership is not represented as no club');
} finally {(db as any).collection=originalCollection;}
console.log('PASS home summary: current fixture-derived points/ranks, pending/deleted exclusions, no unrelated reads or writes, real frontend summary selection, bounded optional ownership without fabricated club state');
