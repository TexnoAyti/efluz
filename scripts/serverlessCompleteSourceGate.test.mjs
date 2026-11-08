import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const conversion=new URL('./convertEflCoreSnapshot.mjs',import.meta.url).pathname;
const archiveScript=new URL('./prepareEflRawDocumentBatches.mjs',import.meta.url).pathname;
const doc=(collection_path,document_id,data)=>({space:'production',collection_path,document_id,encoded:{},data});
async function setup(fn){
 const dir=await mkdtemp(join(tmpdir(),'efl-cutover-source-'));
 try{
  const source=join(dir,'input.jsonl'),archive=join(dir,'archive');
  await writeFile(source,[
   doc('users','user1',{telegramId:'111',createdAt:'2026-01-01T00:00:00Z',firstName:'User'}),
   // No relational projection exists yet for this historical collection.
   // It must nevertheless be preserved by the independently verified archive.
   doc('ticket_transactions_idempotency','history1',{createdAt:'2026-01-01T00:00:00Z'})
  ].map(JSON.stringify).join('\n')+'\n');
  return await fn({source,archive,dir});
 }finally{await rm(dir,{recursive:true,force:true});}
}
const run=(input,out,args=[])=>spawnSync(process.execPath,[conversion,input,out,...args],{encoding:'utf8'});
test('complete source mode requires independently verified private archive',async()=>{
 await setup(async({source,archive,dir})=>{
  let r=run(source,join(dir,'missing.json'),['--require-complete-source']);
  assert.notEqual(r.status,0);assert.match(r.stderr,/VERIFIED_ARCHIVE_REQUIRED/);
  const make=spawnSync(process.execPath,[archiveScript,source,archive],{encoding:'utf8'});
  assert.equal(make.status,0,make.stderr);
  r=run(source,join(dir,'complete.json'),['--require-complete-source','--verified-archive',archive]);
  assert.equal(r.status,0,r.stderr);
  const data=JSON.parse(await readFile(join(dir,'complete.json'),'utf8'));
  assert.equal(data.users.length,1);
  const modified=join(dir,'modified.jsonl');
  await writeFile(modified,[
   doc('users','user1',{telegramId:'111',createdAt:'2026-01-01T00:00:00Z',firstName:'Changed'}),
   doc('ticket_transactions_idempotency','history1',{createdAt:'2026-01-01T00:00:00Z'})
  ].map(JSON.stringify).join('\n')+'\n');
  r=run(modified,join(dir,'changed.json'),['--require-complete-source','--verified-archive',archive]);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/ARCHIVE_SOURCE_MISMATCH/);
 });
});
test('unknown production root must never be silently dropped in complete source mode',async()=>{
 await setup(async({source,archive,dir})=>{
  await writeFile(source,JSON.stringify(doc('unknown_new_runtime','1',{}))+'\n');
  const make=spawnSync(process.execPath,[archiveScript,source,archive],{encoding:'utf8'});
  assert.notEqual(make.status,0);
  assert.match(make.stderr,/SOURCE_COLLECTION_NOT_APPROVED/);
  const result=run(source,join(dir,'invalid.json'),['--require-complete-source','--verified-archive',archive]);
  assert.notEqual(result.status,0);
 });
});
