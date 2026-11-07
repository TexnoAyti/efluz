import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const script=new URL('./prepareSupabaseDocumentArchive.mjs',import.meta.url).pathname;
test('raw archive converter preserves dynamic fields and detects duplicates',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'efl-raw-'));
 try{
  const input=join(dir,'in.json'),output=join(dir,'out.json');
  const source=[{space:'production',collection_path:'fixtures',document_id:'fixture-1',
    encoded:{field:{type:'number',value:1}},data:{id:'fixture-1',extra:{nested:true}}}];
  await writeFile(input,JSON.stringify(source));
  let r=spawnSync(process.execPath,[script,input,output],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  const mapped=JSON.parse(await readFile(output,'utf8')).rawDocuments;
  assert.equal(mapped.length,1);
  assert.deepEqual(mapped[0].data,source[0].data);
  assert.deepEqual(mapped[0].encoded,source[0].encoded);
  assert.match(mapped[0].source_checksum,/^[a-f0-9]{64}$/);
  assert.match(mapped[0].id,/^[a-f0-9]{64}$/);
  await writeFile(input,JSON.stringify([...source,...source]));
  r=spawnSync(process.execPath,[script,input,output],{encoding:'utf8'});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/DUPLICATE_SOURCE_DOCUMENT/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
