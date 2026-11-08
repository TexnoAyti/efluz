import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {IMPORT_TABLES} from '../tgcloud/lib/importBatch.js';
const preflight=new URL('./preflightEflCompleteMigration.mjs',import.meta.url).pathname;
const builder=new URL('./prepareEflRawDocumentBatches.mjs',import.meta.url).pathname;
const data=(collection_path,document_id)=>({
 space:'production',collection_path,document_id,
 encoded:{},data:{firstName:'Synthetic',telegramId:'123',createdAt:'2026-01-01T00:00:00Z'}
});
async function withFiles(fn){
 const dir=await mkdtemp(join(tmpdir(),'efl-preflight-'));
 try{
  const source=join(dir,'source.jsonl'),archive=join(dir,'archive');
  const normalizedSource=join(dir,'normalized-source.json');
  const normalizedTarget=join(dir,'normalized-target.json');
  const empty=Object.fromEntries(Object.keys(IMPORT_TABLES).map(key=>[key,[]]));
  await writeFile(normalizedSource,JSON.stringify(empty));
  await writeFile(normalizedTarget,JSON.stringify(empty));
  const run=()=>spawnSync(process.execPath,[preflight,source,archive,normalizedSource,normalizedTarget],{encoding:'utf8'});
  return await fn({source,archive,normalizedSource,normalizedTarget,run,empty});
 }finally{await rm(dir,{recursive:true,force:true});}
}
test('offline preflight verifies preserved unnormalized source with exact archive and target parity',async()=>{
 await withFiles(async({source,archive,run})=>{
  await writeFile(source,JSON.stringify(data('ticket_transactions_idempotency','history-1'))+'\n');
  let x=spawnSync(process.execPath,[builder,source,archive],{encoding:'utf8'});
  assert.equal(x.status,0,x.stderr);
  x=run();assert.equal(x.status,0,x.stderr);
  const report=JSON.parse(x.stdout);
  assert.equal(report.offlineDataVerified,true);
  assert.equal(report.archiveVerified,true);
  assert.equal(report.sourceTargetParity,true);
  assert.equal(report.cutoverReady,false);
  assert.equal(report.telegramSdkVerified,false);
  assert.doesNotMatch(x.stdout,/history-1|Synthetic/);
 });
});
test('preflight blocks unknown and review collections before any target verification',async()=>{
 for(const collection of ['never_reviewed_source','result_refresh_jobs']){
  await withFiles(async({source,run})=>{
   await writeFile(source,JSON.stringify(data(collection,'private'))+'\n');
   const res=run();
   assert.notEqual(res.status,0,res.stderr);
   const report=JSON.parse(res.stdout);
   assert.equal(report.offlineDataVerified,false);
   assert.equal(report.archiveVerified,false);
   assert.ok(report.blockers.includes(collection==='result_refresh_jobs'
    ?'REVIEW_SOURCE_COLLECTIONS':'UNKNOWN_SOURCE_COLLECTIONS'));
   assert.doesNotMatch(res.stdout,/Synthetic|private/);
  });
 }
});
test('preflight refuses absent archive or mismatching target rows',async()=>{
 await withFiles(async({source,archive,run,normalizedSource,normalizedTarget,empty})=>{
  await writeFile(source,JSON.stringify(data('users','user-1'))+'\n');
  let x=run();assert.notEqual(x.status,0);
  assert.ok(JSON.parse(x.stdout).blockers.includes('SOURCE_ARCHIVE_MISMATCH_OR_MISSING'));
  x=spawnSync(process.execPath,[builder,source,archive],{encoding:'utf8'});
  assert.equal(x.status,0,x.stderr);
  const verifiedUser={id:'x',telegram_id:'1',username:null,first_name:'',
   last_name:'',is_admin:false,is_banned:false,created_at:1,updated_at:1};
  await writeFile(normalizedSource,JSON.stringify({...empty,users:[verifiedUser]}));
  await writeFile(normalizedTarget,JSON.stringify({...empty,users:[{
   id:'x',telegram_id:'2',username:null,first_name:'',
   last_name:'',is_admin:false,is_banned:false,created_at:1,updated_at:1
  }]}));
  x=run();assert.notEqual(x.status,0);
  assert.ok(JSON.parse(x.stdout).blockers.includes('SOURCE_NORMALIZED_BINDING_FAILED'));
 });
});

test('full archive and matching empty targets cannot hide missing normalized user projections',async()=>{
 await withFiles(async({source,archive,run})=>{
  await writeFile(source,JSON.stringify(data('users','must-not-disappear'))+'\n');
  const x=spawnSync(process.execPath,[builder,source,archive],{encoding:'utf8'});
  assert.equal(x.status,0,x.stderr);
  const result=run();
  assert.notEqual(result.status,0);
  const report=JSON.parse(result.stdout);
  assert.equal(report.archiveVerified,true);
  assert.equal(report.sourceTargetParity,false);
  assert.ok(report.blockers.includes('SOURCE_PROJECTION_COVERAGE_MISMATCH'));
  assert.doesNotMatch(result.stdout,/must-not-disappear/);
 });
});

test('preflight binds genuine normalized source to the original export then rejects changed target',async()=>{
 await withFiles(async({source,archive,normalizedSource,normalizedTarget,run})=>{
  await writeFile(source,JSON.stringify(data('users','user-1'))+'\n');
  let x=spawnSync(process.execPath,[builder,source,archive],{encoding:'utf8'});
  assert.equal(x.status,0,x.stderr);
  const converter=new URL('./convertEflCoreSnapshot.mjs',import.meta.url).pathname;
  const generator=join(archive,'independent-normalization.json');
  x=spawnSync(process.execPath,[converter,source,generator,
   '--require-complete-source','--verified-archive',archive],{encoding:'utf8'});
  assert.equal(x.status,0,x.stderr);
  const {readFile}=await import('node:fs/promises');
  const snapshot=await readFile(generator,'utf8');
  await writeFile(normalizedSource,snapshot);
  await writeFile(normalizedTarget,snapshot);
  x=run();assert.equal(x.status,0,x.stderr);
  const positive=JSON.parse(x.stdout);
  assert.equal(positive.sourceNormalizedBound,true);
  assert.equal(positive.sourceTargetParity,true);
  const tampered=JSON.parse(snapshot);
  tampered.users[0].telegram_id='forged';
  await writeFile(normalizedTarget,JSON.stringify(tampered));
  x=run();assert.notEqual(x.status,0);
  const report=JSON.parse(x.stdout);
  assert.equal(report.sourceNormalizedBound,true);
  assert.ok(report.blockers.includes('NORMALIZED_TARGET_PARITY_FAILED'));
  assert.doesNotMatch(x.stdout,/forged|user-1/);
 });
});
test('identical forged source and target normalized files cannot pass original source binding',async()=>{
 await withFiles(async({source,archive,normalizedSource,normalizedTarget,run})=>{
  await writeFile(source,JSON.stringify(data('users','user-1'))+'\n');
  const generated=spawnSync(process.execPath,[builder,source,archive],{encoding:'utf8'});
  assert.equal(generated.status,0,generated.stderr);
  const fabricated=await import('node:fs/promises');
  const altered=JSON.parse(await fabricated.readFile(normalizedSource,'utf8'));
  altered.users=[{id:'invented',telegram_id:'999',username:null,first_name:'',
   last_name:'',is_admin:false,is_banned:false,created_at:1,updated_at:1}];
  await writeFile(normalizedSource,JSON.stringify(altered));
  await writeFile(normalizedTarget,JSON.stringify(altered));
  const x=run();assert.notEqual(x.status,0);
  const report=JSON.parse(x.stdout);
  assert.equal(report.archiveVerified,true);
  assert.equal(report.sourceNormalizedBound,false);
  assert.equal(report.sourceTargetParity,false);
  assert.ok(report.blockers.includes('SOURCE_NORMALIZED_BINDING_FAILED'));
 });
});
