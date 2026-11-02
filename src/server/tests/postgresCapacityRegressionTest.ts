import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {performance} from 'node:perf_hooks';
import {PGlite} from '@electric-sql/pglite';
import {initDatabase} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {createSessionToken} from '../auth/sessionToken';
import {SEED_CLUBS} from '../db/seed';
import {isSeasonLeagueEnabled} from '../../lib/seasonParticipationPolicy';
import {ReadModelKeys,redisSetRaw,clearProcessMemoryForTest} from '../readModel/readModelStore';
import {verifyReadCostBatch} from './readCostBatchAudit';

// Native PostgreSQL engine and actual Express HTTP. Only the PostgREST network
// envelope is simulated. This measures local capacity, never hosted latency.
const pg=new PGlite();
await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
for(const name of ['20261009044907_postgres_document_runtime.sql','20261009125000_nonblocking_runtime_reads.sql','20261009134500_patch_snapshot_rows.sql','20261010091409_application_runtime_commit_conflicts.sql','20261010161456_stop_postgrest_conflict_retries.sql','20261010172440_conditional_snapshot_reads.sql','20261101122224_indexed_document_id_filters.sql','20261101122430_linear_runtime_map_decode.sql'])await pg.exec(await readFile('supabase/migrations/'+name,'utf8'));
await pg.exec('set role service_role;');
await initDatabase();delete process.env.FIREBASE_FORCE_LOCAL_FALLBACK;
process.env.DATABASE_PROVIDER='supabase';process.env.SUPABASE_DATA_NAMESPACE='preview';
process.env.SUPABASE_URL='https://isolated-capacity.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='isolated-only';
process.env.SESSION_SECRET='isolated-capacity-session-secret-32-bytes';
const originalFetch=globalThis.fetch;
let measuring=false,writes=0,rpcs=0,fixtureReads=0;
globalThis.fetch=(async(input:any,init:any)=>{
 const url=new URL(String(input));
 if(url.origin.startsWith('http://127.0.0.1:'))return originalFetch(input,init);
 assert.equal(url.origin,'https://isolated-capacity.invalid','Capacity tests must never access external services');
 // Model asynchronous transport so native SQL's microtasks do not serialize
 // otherwise concurrent HTTP arrivals into zero-latency database requests.
 await new Promise(resolve=>setTimeout(resolve,2));
 const name=url.pathname.split('/').at(-1),body=JSON.parse(init.body);
 if(measuring){rpcs++;if(name==='efl_runtime_commit_safe')writes++;if(body.p_query?.collection==='fixtures')fixtureReads++;}
 try {
  let result;
  if(name==='efl_runtime_read')result=await pg.query('select public.efl_runtime_read($1,$2::jsonb) as value',[body.p_space,JSON.stringify(body.p_query)]);
  else if(name==='efl_runtime_snapshot_read')result=await pg.query('select public.efl_runtime_snapshot_read($1,$2::jsonb,$3::jsonb) as value',[body.p_space,JSON.stringify(body.p_ids),JSON.stringify(body.p_versions)]);
  else if(name==='efl_runtime_commit_safe')result=await pg.query('select public.efl_runtime_commit_safe($1,$2::jsonb,$3) as value',[body.p_space,JSON.stringify(body.p_operations),body.p_generation]);
  else throw Error('UNEXPECTED_CAPACITY_RPC_'+name);
  return Response.json(result.rows[0].value);
 }catch(error:any){return Response.json({code:error.code,message:error.message},{status:400});}
}) as typeof fetch;
let server:ReturnType<typeof import('node:http').createServer>|undefined;
try {
 await verifyReadCostBatch();
 const season='season-2026-27',competition='comp-premier-league-2026';
 const users=Array.from({length:1000},(_,i)=>({id:'capacity-user-'+i,telegramId:String(940000000+i),username:'capacity_'+i,firstName:'Capacity '+i,isAdmin:false,isSuspended:false,createdAt:'',updatedAt:''}));
 const active=SEED_CLUBS.filter(c=>isSeasonLeagueEnabled(c.leagueId,season));
 const owners=new Map(active.map((c,i)=>[c.id,users[i]]));
 const clubs=SEED_CLUBS.map(c=>({...c,ownerUserId:owners.get(c.id)?.id||null,ownerUsername:owners.get(c.id)?.username||null,isOccupied:owners.has(c.id),isTaken:owners.has(c.id)}));
 await redisSetRaw(ReadModelKeys.clubsWithOwners(season),{data:clubs});
 const competitions=[...new Set(active.map(c=>c.leagueId))].map(leagueId=>({id:`comp-${leagueId.replace('league-','')}-2026`,seasonId:season,leagueId,type:'LEAGUE',name:leagueId,currentMatchday:1}));
 await redisSetRaw(ReadModelKeys.competitions(season),{data:competitions});
 const db=getFirestoreDb();
 await db.collection('fixtures').doc('capacity-confirmed').set({id:'capacity-confirmed',seasonId:season,competitionId:competition,homeClubId:'club-arsenal',awayClubId:'club-chelsea',matchday:1,status:'CONFIRMED',homeScore:2,awayScore:1});
 await db.collection('fixtures').doc('capacity-private-pending').set({id:'capacity-private-pending',seasonId:season,competitionId:competition,homeClubId:'club-arsenal',awayClubId:'club-chelsea',matchday:2,status:'PENDING_CONFIRMATION',homeScore:99,awayScore:0,userSubmission:{submittedByUserId:'foreign',homeScore:99,awayScore:0}});
 clearProcessMemoryForTest();
 const {createApp}=await import('../app');
 server=createApp().listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const elapsed:number[]=[];let index=0,requests=0;const started=performance.now();measuring=true;
 await Promise.all(Array.from({length:32},async()=>{
  while(index<users.length){
   const i=index++,user=users[i],headers={Authorization:'Bearer '+createSessionToken(user)};
   for(const path of ['/api/me/bootstrap?seasonId='+season,'/api/competitions?seasonId='+season+'&view=league-summary',`/api/competitions/${competition}/standings?seasonId=${season}&view=league-summary`]){
    const begin=performance.now(),response=await fetch(base+path,{headers}),body:any=await response.json();
    elapsed.push(performance.now()-begin);requests++;
    assert.equal(response.status,200,`${path} user ${i}: ${JSON.stringify(body)}`);
    if(path.includes('/bootstrap')){
     assert.equal(body.user.id,user.id);assert.equal(body.currentClubStatus,'resolved','Healthy capacity load must resolve real ownership');
     assert.equal(body.currentClub?.id||null,active[i]?.id||null,'No account may receive another user ownership');
    }else if(body.competitions)assert.equal(body.competitions.length,4);
    else {
     assert.equal(body.standings.length,20);
     assert.equal(body.standings.find((r:any)=>r.clubId==='club-arsenal').goalsFor,2,'Unconfirmed private score cannot affect public table');
     assert.ok(body.standings.every((r:any)=>!r.userSubmission&&!r.opponentSubmission&&!r.managerUserId));
    }
   }
  }
 }));
 assert.equal(requests,3000);assert.equal(writes,0,'Opening cannot create database writes or recovery jobs');
 assert.ok(fixtureReads<1000,'Overlapping league reads must share database work');
 const blocked=await fetch(base+'/api/me/bootstrap');assert.equal(blocked.status,401);
 elapsed.sort((a,b)=>a-b);
 console.log('POSTGRES_OPENING_CAPACITY',JSON.stringify({users:1000,concurrentVisitors:32,simulatedDatabaseTransportMs:2,requests,successfulRequests:requests,databaseRpcs:rpcs,fixtureReads,databaseWrites:writes,localElapsedMs:Math.round(performance.now()-started),localP95Ms:Math.round(elapsed[Math.floor(elapsed.length*.95)]),note:'Local HTTP + native PGlite; not proof of hosted production capacity or 1000 simultaneous visitors'}));
 console.log('PASS 1000 signed PostgreSQL visitors/3000 HTTP opening requests: correct per-user ownership, four leagues, table privacy, shared fixture reads, zero opening writes and anonymous rejection');
}finally{measuring=false;if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));globalThis.fetch=originalFetch;await pg.close();}
