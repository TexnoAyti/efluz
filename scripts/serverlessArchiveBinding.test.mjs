import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyArchiveBinding} from './lib/verifyArchiveBinding.mjs';
const make=new URL('./prepareEflRawDocumentBatches.mjs',import.meta.url).pathname;
const convert=new URL('./convertEflCoreSnapshot.mjs',import.meta.url).pathname;
const original={space:'production',collection_path:'users',document_id:'user1',
 data:{telegramId:'1234567',createdAt:'2026-01-01T00:00:00Z',firstName:'Test'},
 encoded:{source:'test'}};
test('quarantine CLI refuses to proceed without independently verified matching archive',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-bound-'));
 try{
  const input=join(dir,'source.jsonl'),target=join(dir,'normalized.json');
  const archive=join(dir,'archive');
  await writeFile(input,JSON.stringify(original)+'\n');
  let x=spawnSync(process.execPath,[convert,input,target,'--quarantine-historical'],{encoding:'utf8'});
  assert.notEqual(x.status,0);
  assert.match(x.stderr,/VERIFIED_ARCHIVE_REQUIRED/);
  x=spawnSync(process.execPath,[make,input,archive],{encoding:'utf8'});
  assert.equal(x.status,0,x.stderr);
  const verified=await verifyArchiveBinding(input,archive);
  assert.equal(verified.verified,true);
  assert.equal(verified.sourceDocuments,1);
  x=spawnSync(process.execPath,[convert,input,target,'--quarantine-historical','--verified-archive',archive],{encoding:'utf8'});
  assert.equal(x.status,0,x.stderr);
  const rows=JSON.parse(await readFile(target,'utf8'));
  assert.equal(rows.users.length,1);
  const changed=join(dir,'changed.jsonl');
  await writeFile(changed,JSON.stringify({...original,data:{...original.data,firstName:'Different'}})+'\n');
  await assert.rejects(verifyArchiveBinding(changed,archive),/ARCHIVE_SOURCE_MISMATCH/);
  const second=spawnSync(process.execPath,[convert,changed,join(dir,'new.json'),'--quarantine-historical','--verified-archive',archive],{encoding:'utf8'});
  assert.notEqual(second.status,0);
  assert.match(second.stderr,/ARCHIVE_SOURCE_MISMATCH/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
