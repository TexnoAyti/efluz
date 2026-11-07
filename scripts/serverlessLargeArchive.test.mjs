import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {encodeRawParts,decodeRawParts} from './lib/oversizedArchiveParts.mjs';
const prepare=new URL('./prepareEflRawDocumentBatches.mjs',import.meta.url).pathname;
const verify=new URL('./verifyEflRawBatches.mjs',import.meta.url).pathname;
function large(){
 return {space:'production',collection_path:'uzeflife',document_id:'settings',
  encoded:{path:'uzeflife/settings'},data:{
   name:'UZEFLIFE',status:'active',
   participants:Array.from({length:1800},(_,i)=>({id:i,
    note:'O‘zbekiston 🇺🇿 UZEFLIFE '+i+' — '.repeat(80)}))
  }};
}
test('multipart archive round-trips large UTF-8 records without dropping a byte',()=>{
 const source=large();
 const {sourceDocumentId,rows}=encodeRawParts(source);
 assert.match(sourceDocumentId,/^[a-f0-9]{64}$/);
 assert.ok(rows.length>4);
 assert.ok(rows.every(row=>row.part_data.length<=70000));
 const rebuilt=decodeRawParts(rows);
 assert.deepEqual(rebuilt.data,source.data);
 assert.deepEqual(rebuilt.encoded,source.encoded);
 assert.throws(()=>decodeRawParts(rows.slice(1)),/PART_COUNT_MISMATCH/);
 const changed=rows.map(row=>({...row}));
 changed[1].part_data=changed[1].part_data.replace(/^./,'Q');
 assert.throws(()=>decodeRawParts(changed),/PART_CHECKSUM_MISMATCH|SOURCE_CHECKSUM_MISMATCH/);
});
test('archiver verifies small and oversized records together and rejects tampered chunks',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-large-'));
 try{
  const input=join(dir,'source.jsonl'),out=join(dir,'packets');
  const small={space:'production',collection_path:'fixtures',document_id:'f1',
   encoded:{},data:{id:'f1',status:'SCHEDULED'}};
  await writeFile(input,[small,large()].map(JSON.stringify).join('\n')+'\n');
  const made=spawnSync(process.execPath,[prepare,input,out],{encoding:'utf8'});
  assert.equal(made.status,0,made.stderr);
  const m=JSON.parse(await readFile(join(out,'manifest.json'),'utf8'));
  assert.equal(m.version,2);assert.equal(m.count,2);
  assert.equal(m.oversizedDocuments,1);
  assert.ok(m.partsBatches.length>4);
  const audited=spawnSync(process.execPath,[verify,out],{encoding:'utf8'});
  assert.equal(audited.status,0,audited.stderr);
  assert.equal(JSON.parse(audited.stdout).documents,2);
  const partPath=join(out,m.partsBatches[0].file);
  const part=await readFile(partPath,'utf8');
  await writeFile(partPath,part.replace('UZEFLIFE','CHANGED_'));
  const invalid=spawnSync(process.execPath,[verify,out],{encoding:'utf8'});
  assert.notEqual(invalid.status,0);
  assert.match(invalid.stderr,/PACKET_HASH_OR_SIZE_MISMATCH/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
