import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=new URL('./auditEflDomainGraph.mjs',import.meta.url).pathname;
const doc=(collection_path,document_id,data)=>({space:'production',collection_path,document_id,encoded:{},data});
test('source audit quarantines only resolved historical dispute, never an open one',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-dispute-'));
 try{
  const input=join(dir,'private.jsonl');
  const fixture=doc('disputes','historical-dispute',{fixtureId:'deleted-fixture',
   status:'RESOLVED'});
  await writeFile(input,JSON.stringify(fixture)+'\n');
  const strict=spawnSync(process.execPath,[script,input],{encoding:'utf8'});
  assert.notEqual(strict.status,0);
  assert.equal(JSON.parse(strict.stdout).errorsByType.DISPUTE_WITHOUT_FIXTURE,1);
  const archived=spawnSync(process.execPath,[script,input,'--quarantine-historical'],
   {encoding:'utf8'});
  assert.equal(archived.status,0,archived.stderr);
  assert.equal(JSON.parse(archived.stdout).quarantinedHistorical.resolvedDisputes,1);
  fixture.data.status='OPEN';
  await writeFile(input,JSON.stringify(fixture)+'\n');
  const open=spawnSync(process.execPath,[script,input,'--quarantine-historical'],
   {encoding:'utf8'});
  assert.notEqual(open.status,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('legacy source graph verifies reference integrity without exposing IDs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-domain-'));
 try{
  const input=join(dir,'export.jsonl');
  const rows=[
   doc('users','u1',{id:'u1'}),
   doc('seasons','s1',{id:'s1'}),
   doc('leagues','l1',{id:'l1',name:'League'}),
   doc('clubs','c1',{id:'c1',leagueId:'l1'}),
   doc('competitions','comp1',{id:'comp1',seasonId:'s1',leagueId:'l1'}),
   doc('club_occupancies','occ1',{userId:'u1',seasonId:'s1',clubId:'c1',status:'ACTIVE'}),
   doc('fixtures','fixture1',{id:'fixture1',competitionId:'comp1',seasonId:'s1',
     homeClubId:'c1',awayClubId:null,status:'SCHEDULED'})
  ];
  await writeFile(input,rows.map(JSON.stringify).join('\n')+'\n');
  const processResult=spawnSync(process.execPath,[script,input],{encoding:'utf8'});
  assert.equal(processResult.status,0,processResult.stderr);
  const summary=JSON.parse(processResult.stdout);
  assert.equal(summary.ok,true);
  assert.equal(summary.pendingOpponentSlots,1);
  assert.equal(summary.globalLeagueRowsNeedingSeasonMapping,1);
  assert.equal(summary.cutoverReady,false);
  assert.doesNotMatch(processResult.stdout,/fixture1|u1|occ1/);
  const broken=rows.concat(doc('result_submissions','sub1',{
    fixtureId:'missing-fixture',submittedByUserId:'u1',clubId:'c1'}));
  await writeFile(input,broken.map(JSON.stringify).join('\n')+'\n');
  const failed=spawnSync(process.execPath,[script,input],{encoding:'utf8'});
  assert.notEqual(failed.status,0);
  assert.equal(JSON.parse(failed.stdout).errorsByType.SUBMISSION_WITHOUT_FIXTURE,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('fixture override discrepancies block cutover and matching overrides reconcile',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-overrides-'));
 try{
  const file=join(dir,'data.jsonl');
  const fixture={id:'f1',status:'CONFIRMED',homeScore:2,awayScore:1,
    homeClubId:'a',awayClubId:'b',seasonId:'s1',competitionId:'comp1'};
  const base=[
   doc('seasons','s1',{id:'s1'}),
   doc('competitions','comp1',{id:'comp1',seasonId:'s1'}),
   doc('clubs','a',{id:'a'}),doc('clubs','b',{id:'b'}),
   doc('fixtures','f1',fixture)];
  const run=rows=>{
    // This test creates a private local fixture only, no production data.
    return writeFile(file,rows.map(JSON.stringify).join('\n')+'\n');
  };
  await run([...base,doc('durable_fixture_overrides','f1',{
    status:'CONFIRMED',homeScore:2,awayScore:1,homeClubId:'a',awayClubId:'b'})]);
  let result=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).reconciledFixtureOverrides,1);
  await run([...base,doc('durable_fixture_overrides','f1',{
    status:'CONFIRMED',homeScore:9,awayScore:1,homeClubId:'a',awayClubId:'b'})]);
  result=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.equal(JSON.parse(result.stdout).errorsByType.FIXTURE_OVERRIDE_MISMATCH,1);
  assert.doesNotMatch(result.stdout,/homeScore|f1/);
  await run([...base,doc('durable_fixture_overrides','missing',{status:'SCHEDULED'})]);
  result=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
  assert.equal(JSON.parse(result.stdout).errorsByType.OVERRIDE_WITHOUT_FIXTURE,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('orphan notification history fails with a count but no user identifier leak',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-orphan-notify-'));
 try{
  const input=join(dir,'source.jsonl');
  const missingUser='historical-account-do-not-publish';
  await writeFile(input,JSON.stringify(doc('notifications','notice-1',{
    userId:missingUser,type:'SYSTEM',message:'Private historical notification'}))+'\n');
  const run=spawnSync(process.execPath,[script,input],{encoding:'utf8'});
  assert.notEqual(run.status,0);
  const parsed=JSON.parse(run.stdout);
  assert.equal(parsed.errorsByType.NOTIFICATION_WITHOUT_USER,1);
  assert.doesNotMatch(run.stdout,/(?:historical-account|Private historical)/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('historical audit opt-in quarantines only released owners and missing old references',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-quarantine-audit-'));
 try{
  const input=join(dir,'source.jsonl');
  const rows=[
   doc('seasons','s1',{id:'s1'}),
   doc('leagues','l1',{id:'l1'}),
   doc('clubs','c1',{id:'c1',leagueId:'l1'}),
   doc('club_occupancies','released',{seasonId:'s1',clubId:'c1',
     userId:'former-user',status:'RELEASED'}),
   doc('notifications','notice',{userId:'former-user',type:'SYSTEM'}),
   doc('competition_participants','orphan',{seasonId:'s1',clubId:'c1',
     competitionId:'deleted-competition'})
  ];
  await writeFile(input,rows.map(JSON.stringify).join('\n')+'\n');
  const strict=spawnSync(process.execPath,[script,input],{encoding:'utf8'});
  assert.notEqual(strict.status,0);
  const staging=spawnSync(process.execPath,[script,input,'--quarantine-historical'],{encoding:'utf8'});
  assert.equal(staging.status,0,staging.stderr);
  assert.deepEqual(JSON.parse(staging.stdout).quarantinedHistorical,{
   releasedOccupancies:1,notifications:1,participants:1,resolvedDisputes:0,resolvedDisputes:0
  });
  rows[3].data.status='ACTIVE';
  await writeFile(input,rows.map(JSON.stringify).join('\n')+'\n');
  const active=spawnSync(process.execPath,[script,input,'--quarantine-historical'],{encoding:'utf8'});
  assert.notEqual(active.status,0);
  assert.equal(JSON.parse(active.stdout).errorsByType.OCCUPANCY_WITHOUT_USER,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
