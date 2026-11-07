import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const program=new URL('./prepareEflRawDocumentBatches.mjs',import.meta.url).pathname;
test('streamed source produces deterministic, bounded, independently verifiable packets',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'efl-jsonl-'));
  try{
    const src=join(dir,'source.jsonl'),dest=join(dir,'private-packets');
    const docs=Array.from({length:205},(_,i)=>({space:'production',
      collection_path:i%2?'users':'fixtures',document_id:'d'+i,
      encoded:{original:{id:i}},data:{id:i,fixture:{score:0,notes:'ok'}}}));
    await writeFile(src,docs.map(d=>JSON.stringify(d)).join('\n')+'\n');
    const result=spawnSync(process.execPath,[program,src,dest],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const manifest=JSON.parse(await readFile(join(dest,'manifest.json'),'utf8'));
    assert.equal(manifest.count,205);
    assert.ok(manifest.batches.length>=3);
    assert.ok(manifest.batches.every(x=>x.rows<=100&&x.bytes<=98304));
    assert.equal((await readdir(dest)).length,manifest.batches.length+1);
    const first=JSON.parse(await readFile(join(dest,manifest.batches[0].file),'utf8'));
    assert.equal(first.table,'rawDocuments');
    assert.deepEqual(first.rows[0].encoded,docs[0].encoded);
    assert.deepEqual(first.rows[0].data,docs[0].data);
    assert.ok(first.rows.every(row=>row.source_space==='production'));
    const duplicate=spawnSync(process.execPath,[program,src,dest],{encoding:'utf8'});
    assert.notEqual(duplicate.status,0);
    assert.match(duplicate.stderr,/TARGET_ALREADY_EXISTS/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('streaming import refuses duplicate document identities',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'efl-jsonl-'));
  try{
    const d={space:'production',collection_path:'fixtures',document_id:'1',encoded:{},data:{}};
    const src=join(dir,'input.jsonl'),dest=join(dir,'packets');
    await writeFile(src,JSON.stringify(d)+'\n'+JSON.stringify(d)+'\n');
    const result=spawnSync(process.execPath,[program,src,dest],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/DUPLICATE_DOCUMENT/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
