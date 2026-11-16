import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
const script=new URL('./prepareServerlessImport.mjs',import.meta.url).pathname;
const row={id:'one',telegram_id:'123',username:null,first_name:'Test',
  last_name:'',is_admin:false,is_banned:false,created_at:1,updated_at:1};
test('offline packet generator emits deterministic counts and digest',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'efl-migrate-test-'));
  try {
    const source=join(dir,'source.json'), output=join(dir,'packets');
    await writeFile(source,JSON.stringify({users:[row]}));
    const result=spawnSync(process.execPath,[script,source,output],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const manifest=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
    assert.equal(manifest.tables.users.count,1);
    assert.equal(manifest.tables.seasons.count,0);
    assert.match(manifest.tables.users.sha256,/^[a-f0-9]{64}$/);
    const packet=JSON.parse(await readFile(join(output,'users-00000000.json'),'utf8'));
    assert.equal(packet.batchId,'users:00000000');
    assert.deepEqual(packet.rows,[row]);
    assert.equal((await readdir(output)).length,2);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('invalid source rows fail before a valid manifest is produced',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'efl-migrate-invalid-'));
  try {
    const source=join(dir,'source.json'), output=join(dir,'packets');
    await writeFile(source,JSON.stringify({users:[row,{...row}]}));
    const result=spawnSync(process.execPath,[script,source,output],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    await assert.rejects(readFile(join(output,'manifest.json')));
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('Unicode packet limit uses actual UTF-8 bytes, not JavaScript string length',()=>{
  const packet={table:'users',batchId:'users:00000000',rows:[
    {...row,first_name:'o‘'.repeat(34000)}
  ]};
  assert.ok(JSON.stringify(packet).length<98304);
  assert.ok(Buffer.byteLength(JSON.stringify(packet),'utf8')>98304);
  assert.throws(()=>validateImportBatch(packet),/INVALID_BATCH_BYTES/);
  const small={...packet,rows:[{...row,first_name:'O‘zbek tili'}]};
  assert.equal(validateImportBatch(small).rows.length,1);
});
