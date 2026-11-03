import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const pg=new PGlite();
try{
  await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;');
  await pg.exec(await readFile('supabase/migrations/20261009044907_postgres_document_runtime.sql','utf8'));
  await pg.exec("update efl_runtime.spaces set mode='active' where name='production'");
  const enc=(x:any):any=>x===null?{type:'null'}:Array.isArray(x)?{type:'array',value:x.map(enc)}:typeof x==='object'?{type:'map',value:Object.fromEntries(Object.entries(x).map(([k,v])=>[k,enc(v)]))}:{type:typeof x,value:x};
  const put=async(path:string,data:any)=>pg.query('select public.efl_runtime_commit($1,$2)',['production',JSON.stringify([{kind:'set',path,encoded:enc(data)}])]);
  for(const [id,r]of [['comp-premier-league-2026',13],['comp-la-liga-2026',9],['comp-serie-a-2026',5],['comp-bundesliga-2026',1]])await put('competitions/'+id,{seasonId:'season-2026-27',type:'LEAGUE',status:'active',currentMatchday:r,nextMatchdayOpenAt:'2026-01-01T00:00:00Z'});
  await put('fixtures/synthetic-score',{homeScore:3,awayScore:1,status:'CONFIRMED'});
  await put('competitions/comp-champions-league-2026',{seasonId:'season-2026-27',type:'EUROPEAN_LEAGUE_PHASE',status:'active',currentMatchday:1});
  await put('fixtures/unpublished-euro',{seasonId:'season-2026-27',competitionId:'comp-champions-league-2026',status:'SCHEDULED',matchday:8,homeClubId:'home',awayClubId:'away'});
  const sql=await readFile('scripts/reconcile-round-progress-20261103.sql','utf8');
  await put('competitions/comp-la-liga-2026',{seasonId:'season-2026-27',type:'LEAGUE',status:'active',currentMatchday:10});
  assert.equal((await pg.query<{result:any}>(sql)).rows[0].result.error,'ROUND_PROGRESS_PRECONDITION_CHANGED');
  assert.equal((await pg.query<{data:any}>("select data from efl_runtime.documents where collection_path='competitions' and document_id='comp-premier-league-2026'")).rows[0].data.currentMatchday,13,'No partial correction on changed preconditions');
  await put('competitions/comp-la-liga-2026',{seasonId:'season-2026-27',type:'LEAGUE',status:'active',currentMatchday:9,nextMatchdayOpenAt:'2026-01-01T00:00:00Z'});
  assert.ok((await pg.query<{result:any}>(sql)).rows[0].result.generation);
  const rows=(await pg.query<{data:any}>("select data from efl_runtime.documents where collection_path='competitions' and data->>'type'='LEAGUE' order by document_id")).rows;
  assert.deepEqual(rows.map(r=>r.data.currentMatchday),[17,19,19,17]);
  for(const r of rows){assert.equal(r.data.currentMatchday,r.data.resultEntryThroughMatchday);assert.equal(r.data.nextMatchdayOpenAt,'2026-01-01T00:00:00Z');}
  assert.equal((await pg.query<{data:any}>("select data from efl_runtime.documents where document_id='comp-champions-league-2026'")).rows[0].data.resultEntryThroughMatchday,1,'Unpublished future European fixtures do not authorize later rounds');
  assert.equal((await pg.query<{result:any}>(sql)).rows[0].result.status,'ALREADY_APPLIED');
  assert.deepEqual((await pg.query<{data:any}>("select data from efl_runtime.documents where document_id='synthetic-score'")).rows[0].data,{homeScore:3,awayScore:1,status:'CONFIRMED'});
  console.log('PASS progress rollout SQL: exact four rounds, no partial stale correction, bounded unpublished Europe, unchanged scores/deadlines, catalog invalidation, audit and idempotence');
}finally{await pg.close();}
