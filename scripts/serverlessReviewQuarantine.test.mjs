import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyArchiveBinding} from './lib/verifyArchiveBinding.mjs';
const prepare=new URL('./prepareEflRawDocumentBatches.mjs',import.meta.url).pathname;
const verify=new URL('./verifyEflRawBatches.mjs',import.meta.url).pathname;
const doc=(collection_path,document_id,data)=>({
 space:'production',collection_path,document_id,encoded:{},data
});
test('review-only private history never becomes a target import batch',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-review-quarantine-'));
 try{
  const source=join(dir,'source.jsonl'),target=join(dir,'archive');
  const secret='secret-test-marker-not-for-import';
  const rows=[
   doc('users','u1',{telegramId:'123',firstName:'Example'}),
   doc('telegram_ai_state','ai1',{message:secret}),
   doc('telegram_webhook_leases','ephemeral1',{lease:secret})
  ];
  await writeFile(source,rows.map(JSON.stringify).join('\n')+'\n');
  let run=spawnSync(process.execPath,[prepare,source,target],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const manifest=JSON.parse(await readFile(join(target,'manifest.json'),'utf8'));
  assert.equal(manifest.sourceDocuments,3);
  assert.equal(manifest.count,1);
  assert.equal(manifest.reviewExcluded,1);
  assert.equal(manifest.rebuildExcluded,1);
  const packet=await readFile(join(target,'rawDocuments-00000000.json'),'utf8');
  assert.doesNotMatch(packet,/secret-test-marker/);
  const quarantine=await readFile(join(target,manifest.reviewFile),'utf8');
  assert.match(quarantine,/secret-test-marker/);
  const mode=(await stat(join(target,manifest.reviewFile))).mode&0o777;
  assert.equal(mode,0o600);
  assert.doesNotMatch(run.stdout+run.stderr,/secret-test-marker/);
  run=spawnSync(process.execPath,[verify,target],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const binding=await verifyArchiveBinding(source,target);
  assert.equal(binding.verified,true);
  assert.equal(binding.reviewQuarantined,1);
  await writeFile(join(target,manifest.reviewFile),quarantine.replace(secret,'modified-secret'));
  run=spawnSync(process.execPath,[verify,target],{encoding:'utf8'});
  assert.notEqual(run.status,0);
  assert.match(run.stderr,/REVIEW_QUARANTINE_CORRUPTED/);
  await assert.rejects(verifyArchiveBinding(source,target),
   /ARCHIVE_PACKET_VERIFICATION_FAILED/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('duplicate identity in a quarantined worker is still rejected',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-review-duplicates-'));
 try{
  const source=join(dir,'source.jsonl');
  const bad=doc('result_refresh_jobs','id1',{status:'QUEUED'});
  await writeFile(source,[bad,bad].map(JSON.stringify).join('\n')+'\n');
  const run=spawnSync(process.execPath,[prepare,source,join(dir,'archive')],{encoding:'utf8'});
  assert.notEqual(run.status,0);
  assert.match(run.stderr,/DUPLICATE_DOCUMENT/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
