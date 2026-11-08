import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,access,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=new URL('./exportEflSupabaseRuntime.sh',import.meta.url).pathname;
const doc=(collection,document_id)=>JSON.stringify({
 space:'production',collection_path:collection,document_id,encoded:{},data:{}
});
async function withMock(rows,fn){
 const dir=await mkdtemp(join(tmpdir(),'efl-source-export-'));
 try{
  const psql=join(dir,'psql');
  await writeFile(psql,"#!/bin/sh\ncat <<'EOF'\n"+rows.join('\n')+"\nEOF\n");
  await chmod(psql,0o700);
  const run=(suffix,env={})=>spawnSync('bash',[script,join(dir,suffix)],{
   encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,
    EFL_SOURCE_DATABASE_URL:'postgresql://private.invalid/export',
    EFL_REQUIRE_OBSERVED_COUNTS:'0',...env}});
  await fn(dir,run);
 }finally{await rm(dir,{recursive:true,force:true});}
}
test('live export accepts moving counts but preserves private snapshot and identity checks',async()=>{
 await withMock([doc('users','synthetic')],async(dir,run)=>{
  const normal=run('snapshot.jsonl');
  assert.equal(normal.status,0,normal.stderr);
  assert.match(await readFile(join(dir,'snapshot.jsonl'),'utf8'),/"synthetic"/);
  const strict=run('strict.jsonl',{EFL_REQUIRE_OBSERVED_COUNTS:'1'});
  assert.notEqual(strict.status,0);
  await assert.rejects(access(join(dir,'strict.jsonl')));
  assert.doesNotMatch(normal.stdout+normal.stderr+strict.stderr,
   /private\.invalid/);
 });
});
test('export always fails on unclassified collection or duplicate document',async()=>{
 for(const rows of [[doc('unreviewed_unknown_root','x')],
   [doc('users','same'),doc('users','same')]]){
  await withMock(rows,async(dir,run)=>{
   const result=run('unsafe.jsonl');
   assert.notEqual(result.status,0);
   await assert.rejects(access(join(dir,'unsafe.jsonl')));
   assert.doesNotMatch(result.stdout+result.stderr,/private\.invalid/);
  });
 }
});
