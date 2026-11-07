import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const produce=new URL('./prepareEflRawDocumentBatches.mjs',import.meta.url).pathname;
const verify=new URL('./verifyEflRawBatches.mjs',import.meta.url).pathname;
test('verifies raw document packets and fails on payload tampering',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'efl-raw-verify-'));
  try {
    const input=join(dir,'input.jsonl'),output=join(dir,'raw');
    const record={space:'production',collection_path:'users',document_id:'1',
      encoded:{id:'1'},data:{firstName:'Test'}};
    await writeFile(input,JSON.stringify(record)+'\n');
    const generation=spawnSync(process.execPath,[produce,input,output],{encoding:'utf8'});
    assert.equal(generation.status,0,generation.stderr);
    const success=spawnSync(process.execPath,[verify,output],{encoding:'utf8'});
    assert.equal(success.status,0,success.stderr);
    assert.match(success.stdout,/"verified":true/);
    const file=join(output,'rawDocuments-00000000.json');
    const data=await readFile(file,'utf8');
    await writeFile(file,data.replace('Test','Tampered'));
    const rejected=spawnSync(process.execPath,[verify,output],{encoding:'utf8'});
    assert.notEqual(rejected.status,0);
    assert.match(rejected.stderr,/PACKET_HASH_OR_SIZE_MISMATCH/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
