import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,cp,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {IMPORT_TABLES} from '../tgcloud/lib/importBatch.js';

const prepare=new URL('./prepareServerlessImport.mjs',import.meta.url).pathname;
const verify=new URL('./verifyEflNormalizedPackets.mjs',import.meta.url).pathname;
const user=(id,telegram_id)=>({
 id,telegram_id,username:null,first_name:'Test',last_name:'',
 is_admin:false,is_banned:false,created_at:1,updated_at:1
});
const invoke=(script,args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
async function fixture(fn){
 const dir=await mkdtemp(join(tmpdir(),'efl-normalized-verify-'));
 try {
   const source=join(dir,'source.json'),out=join(dir,'packets');
   const snapshot=Object.fromEntries(Object.keys(IMPORT_TABLES).map(k=>[k,[]]));
   snapshot.users=[user('a','123'),user('b','456')];
   await writeFile(source,JSON.stringify(snapshot));
   const prepared=invoke(prepare,[source,out]);
   assert.equal(prepared.status,0,prepared.stderr);
   await fn({dir,source,out,snapshot});
 } finally {await rm(dir,{recursive:true,force:true});}
}
test('offline normalized packets verify against independent source',async()=>{
 await fixture(async({source,out})=>{
   const ok=invoke(verify,[source,out]);
   assert.equal(ok.status,0,ok.stderr);
   assert.match(ok.stdout,/"verified":true/);
   assert.match(ok.stdout,/"rows":2/);
 });
});
test('missing packet, unexpected extra packet, or changed bytes fail closed',async()=>{
 await fixture(async({source,out})=>{
   await writeFile(join(out,'unexpected.json'),'{}');
   assert.match(invoke(verify,[source,out]).stderr,/UNEXPECTED_OR_MISSING_PACKET_FILE/);
   await unlink(join(out,'unexpected.json'));
   const target=join(out,'users-00000000.json');
   const original=await readFile(target,'utf8');
   await writeFile(target,original.replace('Test','Tampered'));
   assert.match(invoke(verify,[source,out]).stderr,/NORMALIZED_PACKET_HASH_MISMATCH/);
   await unlink(target);
   assert.notEqual(invoke(verify,[source,out]).status,0);
 });
});
test('snapshot drift fails even when packet and manifest remain internally valid',async()=>{
 await fixture(async({source,out,snapshot})=>{
   snapshot.users[1].first_name='Different';
   await writeFile(source,JSON.stringify(snapshot));
   const bad=invoke(verify,[source,out]);
   assert.notEqual(bad.status,0);
   assert.match(bad.stderr,/NORMALIZED_SOURCE_DIGEST_MISMATCH/);
 });
});
test('omitted packet rows fail even if manifest count and packet hash are rewritten',async()=>{
 await fixture(async({source,out})=>{
   const manifestPath=join(out,'manifest.json');
   const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
   manifest.tables.users.chunks=[];
   await writeFile(manifestPath,JSON.stringify(manifest));
   const result=invoke(verify,[source,out]);
   assert.notEqual(result.status,0);
   assert.match(result.stderr,/NORMALIZED_PACKET_MISSING_ROWS/);
 });
});
