import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {convertEflCore} from './lib/convertEflCore.mjs';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
const doc=(document_id,data)=>({document_id,data});
function sample(){
 return {
 users:[doc('user-1',{telegramId:'111',firstName:'A',lastName:'',
  username:'a',isAdmin:false,isSuspended:false,createdAt:'2026-01-01T00:00:00Z'}),
  doc('user-2',{telegramId:'222',firstName:'B',lastName:'',
  username:'b',isAdmin:false,isSuspended:false,createdAt:'2026-01-01T00:00:00Z'})],
 seasons:[doc('s1',{name:'Season 1',status:'active',createdAt:'2026-01-01T00:00:00Z'}),
 doc('s2',{name:'Season 2',status:'registration',createdAt:'2026-02-01T00:00:00Z'})],
 leagues:[doc('l1',{name:'APL',country:'England',createdAt:'2025-01-01T00:00:00Z'})],
 clubs:[doc('c1',{name:'Arsenal',shortName:'ARS',country:'England',leagueId:'l1',
  createdAt:'2025-01-01T00:00:00Z'}),
  doc('c2',{name:'Chelsea',shortName:'CHE',leagueId:'l1',
  createdAt:'2025-01-01T00:00:00Z'})],
 competitions:[doc('comp1',{name:'APL League',seasonId:'s1',leagueId:'l1',
  type:'LEAGUE',status:'active',createdAt:'2026-01-01T00:00:00Z',
  currentMatchday:2,isMatchdayOpen:true})],
 club_occupancies:[doc('o1',{seasonId:'s1',clubId:'c1',userId:'user-1',
  status:'active',claimedAt:'2026-01-02T00:00:00Z',updatedAt:'2026-01-02T00:00:00Z'}),
  doc('o2',{seasonId:'s1',clubId:'c2',userId:'user-2',
  status:'active',claimedAt:'2026-01-02T00:00:00Z'})],
 fixtures:[doc('f1',{seasonId:'s1',competitionId:'comp1',matchday:2,
  homeClubId:'c1',awayClubId:'c2',status:'SCHEDULED',
  updatedAt:'2026-01-02T00:00:00Z'})],
 competition_participants:[doc('p1',{seasonId:'s1',competitionId:'comp1',
  clubId:'c1',seedNumber:1,createdAt:'2026-01-02T00:00:00Z'})],
 result_submissions:[],disputes:[],
 notifications:[doc('n1',{userId:'user-1',type:'MATCH',title:'New match',
    message:'Fixture scheduled',isRead:false,createdAt:'2026-01-02T00:00:00Z'})],
 audit_logs:[doc('a1',{action:'SYSTEM_RECONCILE',entityType:'fixture',
    entityId:'f1',newValueJson:'{"status":"SCHEDULED"}',
    createdAt:'2026-01-02T00:00:00Z'})]
 };
}
test('global leagues and clubs create unique copies for each season',()=>{
 const {rows,report}=convertEflCore(sample());
 assert.equal(rows.leagues.length,2);
 assert.equal(rows.clubs.length,4);
 assert.notEqual(rows.clubs[0].id,rows.clubs[2].id);
 assert.equal(rows.clubOccupancies[0].club_id,rows.clubs[0].id);
 assert.equal(rows.fixtures[0].home_club_id,rows.clubs[0].id);
 assert.equal(rows.matchAccess.length,1);
 assert.equal(rows.notifications.length,1);
 assert.equal(rows.auditLogs.length,1);
 assert.equal(rows.auditLogs[0].actor_user_id,'SYSTEM');
 assert.deepEqual(rows.auditLogs[0].new_value,{status:'SCHEDULED'});
 assert.equal(rows.matchAccess[0].writable,false);
 assert.equal(report.cutoverReady,false);
 for(const [table,records] of Object.entries(rows))
  if(records.length)assert.ok(validateImportBatch({table,batchId:table+':00000000',rows:records}));
});
test('cannot import duplicate owner, unknown user or cross-season fixtures',()=>{
 const d=sample();
 d.club_occupancies.push(doc('dup',{...d.club_occupancies[0].data,userId:'user-2'}));
 assert.throws(()=>convertEflCore(d),/DUPLICATE_ACTIVE_CLUB/);
 const missing=sample();missing.club_occupancies[0].data.userId='missing';
 assert.throws(()=>convertEflCore(missing),/OCCUPANCY_REFERENCE_MISSING/);
 const mismatch=sample();mismatch.fixtures[0].data.seasonId='s2';
 assert.throws(()=>convertEflCore(mismatch),/FIXTURE_COMPETITION_SEASON_MISMATCH/);
});
test('core converter checks durable fixture corrections without replacing authoritative scores',()=>{
 const fixture=sample();
 fixture.fixtures[0].data={...fixture.fixtures[0].data,
   status:'CONFIRMED',homeScore:2,awayScore:1};
 fixture.durable_fixture_overrides=[doc('f1',{
   status:'CONFIRMED',homeScore:2,awayScore:1
 })];
 const converted=convertEflCore(fixture);
 assert.equal(converted.report.reconciledFixtureOverrides,1);
 assert.equal(converted.rows.fixtures[0].home_score,2);
 fixture.durable_fixture_overrides[0].data.homeScore=9;
 assert.throws(()=>convertEflCore(fixture),/FIXTURE_OVERRIDE_MISMATCH/);
 fixture.durable_fixture_overrides=[doc('missing',{status:'SCHEDULED'})];
 assert.throws(()=>convertEflCore(fixture),/OVERRIDE_WITHOUT_FIXTURE/);
});
test('historical orphan quarantine is explicit and never grants an active owner',()=>{
 const d=sample();
 d.club_occupancies.push(doc('released-orphan',{
   seasonId:'s1',clubId:'c1',userId:'deleted-user',
   status:'released',claimedAt:'2026-01-01T00:00:00Z'
 }));
 d.notifications.push(doc('unowned-notification',{
   userId:'deleted-user',type:'SYSTEM',title:'Archived',message:'Historical',
   createdAt:'2026-01-01T00:00:00Z'
 }));
 d.competition_participants.push(doc('past-participant',{
   seasonId:'s1',competitionId:'deleted-competition',clubId:'c1',
   createdAt:'2026-01-01T00:00:00Z'
 }));
 assert.throws(()=>convertEflCore(d),/OCCUPANCY_REFERENCE_MISSING/);
 const {rows,report}=convertEflCore(d,{quarantineHistoricalOrphans:true});
 assert.deepEqual(report.quarantinedHistorical,{
   releasedOccupancies:1,notifications:1,participants:1,resolvedDisputes:0
 });
 assert.equal(rows.clubOccupancies.length,2);
 assert.equal(rows.notifications.length,1);
 assert.equal(rows.participants.length,1);
 d.club_occupancies[d.club_occupancies.length-1].data.status='active';
 assert.throws(()=>convertEflCore(d,{quarantineHistoricalOrphans:true}),
   /OCCUPANCY_REFERENCE_MISSING/);
});
test('resolved orphan disputes are explicitly archived, live disputes are never dropped',()=>{
 const original=sample();
 original.disputes=[
   doc('old-dispute',{fixtureId:'deleted-fixture',seasonId:'s1',
     status:'RESOLVED',createdAt:'2026-01-01T00:00:00Z'})
 ];
 assert.throws(()=>convertEflCore(original),/DISPUTE_FIXTURE_MISSING/);
 const result=convertEflCore(original,{quarantineHistoricalOrphans:true});
 assert.equal(result.report.quarantinedHistorical.resolvedDisputes,1);
 assert.equal(result.rows.disputes.length,0);
 original.disputes[0].data.status='OPEN';
 assert.throws(()=>convertEflCore(original,{quarantineHistoricalOrphans:true}),
   /DISPUTE_FIXTURE_MISSING/);
});
test('CLI creates normalized file and refuses overwrite',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-core-'));
 try{
  const file=join(dir,'source.jsonl'),destination=join(dir,'mapped.json');
  const docs=Object.entries(sample()).flatMap(([collection_path,items])=>
   items.map(({document_id,data})=>({collection_path,document_id,data,
      space:'production',encoded:{}})));
  await writeFile(file,docs.map(JSON.stringify).join('\n')+'\n');
  const program=new URL('./convertEflCoreSnapshot.mjs',import.meta.url).pathname;
  const result=spawnSync(process.execPath,[program,file,destination],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const normalized=JSON.parse(await readFile(destination,'utf8'));
  assert.equal(normalized.leagues.length,2);
  assert.equal(normalized.fixtures[0].round,2);
  const repeat=spawnSync(process.execPath,[program,file,destination],{encoding:'utf8'});
  assert.notEqual(repeat.status,0);
  assert.match(repeat.stderr,/DESTINATION_ALREADY_EXISTS/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
