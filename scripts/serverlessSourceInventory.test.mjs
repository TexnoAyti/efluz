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
