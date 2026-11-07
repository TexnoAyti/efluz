import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=new URL('./auditEflDomainGraph.mjs',import.meta.url).pathname;
const doc=(collection_path,document_id,data)=>({space:'production',collection_path,document_id,encoded:{},data});
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
