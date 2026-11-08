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

test('transient login/webhook excluded, reviewed sources privately quarantined',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-policy-'));
 try{
  const input=join(dir,'source.jsonl'),output=join(dir,'packets');
  const transient={space:'production',collection_path:'telegram_webhook_leases',
    document_id:'lease-1',encoded:{token:'private'},data:{status:'leased'}};
  const durable={space:'production',collection_path:'fixtures',
    document_id:'fixture-1',encoded:{id:1},data:{id:'fixture-1'}};
  await writeFile(input,[transient,durable].map(JSON.stringify).join('\n')+'\n');
  let result=spawnSync(process.execPath,[program,input,output],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const manifest=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
  assert.equal(manifest.count,1);
  assert.equal(manifest.sourceDocuments,2);
  assert.equal(manifest.rebuildExcluded,1);
  const packageData=await readFile(join(output,manifest.batches[0].file),'utf8');
  assert.doesNotMatch(packageData,/private|lease-1/);
  const reviewInput=join(dir,'review.jsonl'),reviewOutput=join(dir,'review-packets');
  await writeFile(reviewInput,[durable,{...durable,collection_path:'telegram_ai_state'}]
   .map(JSON.stringify).join('\n')+'\n');
  result=spawnSync(process.execPath,[program,reviewInput,reviewOutput],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const quarantineManifest=JSON.parse(await readFile(join(reviewOutput,'manifest.json'),'utf8'));
  assert.equal(quarantineManifest.count,1);
  assert.equal(quarantineManifest.reviewExcluded,1);
  const privateHistory=await readFile(join(reviewOutput,quarantineManifest.reviewFile),'utf8');
  assert.match(privateHistory,/telegram_ai_state/);
  const reviewedPacket=await readFile(join(reviewOutput,quarantineManifest.batches[0].file),'utf8');
  assert.doesNotMatch(reviewedPacket,/telegram_ai_state/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
