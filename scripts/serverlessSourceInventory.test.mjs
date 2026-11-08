import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=new URL('./auditEflSourceInventory.mjs',import.meta.url).pathname;
const d=collection_path=>({space:'production',collection_path,document_id:'sample',
  encoded:{},data:{}});
test('inventory classifies durable, rebuild and review without printing user data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-inventory-'));
 try{
  const file=join(dir,'data.jsonl');
  await writeFile(file,[d('users'),d('telegram_webhook_leases'),d('telegram_ai_state')]
    .map(x=>JSON.stringify(x)).join('\n')+'\n');
  const result=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout);
  assert.equal(report.total,3);
  assert.equal(report.preserveRows,1);
  assert.equal(report.rebuildRows,1);
  assert.equal(report.reviewRows,1);
  const strict=spawnSync(process.execPath,[script,file,'--strict'],{encoding:'utf8'});
  assert.notEqual(strict.status,0);
  assert.equal(JSON.parse(strict.stdout).reviewCollections[0].collection,'telegram_ai_state');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('unclassified production collections fail closed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-inventory-'));
 try{
  const file=join(dir,'data.jsonl');
  await writeFile(file,JSON.stringify(d('completely_new_collection'))+'\n');
  const x=spawnSync(process.execPath,[script,file],{encoding:'utf8'});
  assert.notEqual(x.status,0);
  assert.deepEqual(JSON.parse(x.stdout).unknownCollections,['completely_new_collection']);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('full export inventory validates observed counts and flags stale/missing records',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-inventory-baseline-'));
 try{
  const source=join(dir,'source.jsonl'),manifest=join(dir,'baseline.json');
  const rows=[
   d('users'),
   d('telegram_webhook_leases'),
   d('telegram_ai_state')
  ];
  const policy={observedGeneration:258600,observedTotal:3,collections:[
   {collection:'users',observedDocuments:1,handling:'preserve'},
   {collection:'telegram_webhook_leases',observedDocuments:1,handling:'rebuild'},
   {collection:'telegram_ai_state',observedDocuments:1,handling:'review'}
  ]};
  await writeFile(manifest,JSON.stringify(policy));
  await writeFile(source,rows.map(JSON.stringify).join('\n')+'\n');
  const run=(extra=[])=>spawnSync(process.execPath,[script,source,
   '--manifest='+manifest,'--require-observed-counts',...extra],{encoding:'utf8'});
  const exact=run();
  assert.equal(exact.status,0,exact.stderr);
  assert.equal(JSON.parse(exact.stdout).observedTotalMismatch,false);
  assert.deepEqual(JSON.parse(exact.stdout).observedCollectionMismatches,[]);
  // A reviewed collection is still separately blocked by --strict.
  assert.notEqual(run(['--strict']).status,0);
  await writeFile(source,rows.slice(0,2).map(JSON.stringify).join('\n')+'\n');
  const missing=run();
  assert.notEqual(missing.status,0);
  assert.equal(JSON.parse(missing.stdout).observedTotalMismatch,true);
  assert.deepEqual(JSON.parse(missing.stdout).observedCollectionMismatches,['telegram_ai_state']);
  assert.doesNotMatch(missing.stdout,/sample|encoded/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('duplicate export document keys fail without exposing document contents',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-inventory-duplicate-'));
 try{
  const path=join(dir,'source.jsonl');
  const doc={...d('users'),data:{privateValue:'never-show-this'}};
  await writeFile(path,JSON.stringify(doc)+'\n'+JSON.stringify(doc)+'\n');
  const run=spawnSync(process.execPath,[script,path],{encoding:'utf8'});
  assert.notEqual(run.status,0);
  assert.match(run.stderr,/DUPLICATE_SOURCE_DOCUMENT/);
  assert.doesNotMatch(run.stderr,/never-show-this|sample/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
