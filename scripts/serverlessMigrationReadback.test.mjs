import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {IMPORT_TABLES} from '../tgcloud/lib/importBatch.js';
import {validateMigrationReadback,readMigrationPage}
 from '../tgcloud/lib/migrationReadback.js';
import {READBACK_CONTROL,IMPORT_CONTROL}
 from '../tgcloud/lib/importControl.js';

const user=(id,telegramId)=>Object.fromEntries(IMPORT_TABLES.users.map(key=>
 [key,key==='id'?id:key==='telegram_id'?telegramId:null]));
function source(rows){
 const calls=[];
 return {calls,async all(sql,params){
   calls.push({sql,params});
   const items=rows.filter(row=>!params[':cursor']||row.id>params[':cursor']);
   return items.slice(0,params[':limit']);
 }};
}
test('readback and import controls stay independently disabled',async()=>{
 assert.equal(IMPORT_CONTROL.enabled,false);
 assert.equal(READBACK_CONTROL.enabled,false);
 assert.equal(READBACK_CONTROL.ownerTelegramId,'');
 const route=await readFile(new URL('../tgcloud/endpoints/migrationReadback.js',import.meta.url),'utf8');
 assert.match(route,/verifiedTelegramId\(ctx\)/);
 assert.match(route,/READBACK_CONTROL\.enabled/);
 assert.doesNotMatch(route,/assertMigrationOwner/);
});
test('allowlist and cursor bounds prevent arbitrary SQL and unbounded export',()=>{
 assert.throws(()=>validateMigrationReadback({table:'users; DROP TABLE efl_users'}),
   /INVALID_READBACK_TABLE/);
 assert.throws(()=>validateMigrationReadback({table:'users',limit:1000}),
   /INVALID_READBACK_LIMIT/);
 assert.throws(()=>validateMigrationReadback({table:'users',cursor:"a' OR 1=1"}),
   /INVALID_READBACK_CURSOR/);
 assert.throws(()=>validateMigrationReadback({table:'users',userId:'other'}),
   /INVALID_READBACK_REQUEST/);
 assert.deepEqual(validateMigrationReadback({table:'users'}),{
   table:'users',cursor:null,limit:20
 });
 assert.deepEqual(validateMigrationReadback({table:'matchMessages',cursor:1}),{
   table:'matchMessages',cursor:1,limit:20
 });
 assert.throws(()=>validateMigrationReadback({table:'matchMessages',cursor:'1'}),
   /INVALID_READBACK_CURSOR/);
});
test('two-keyset pages deliver each target row exactly once',async()=>{
 const db=source([user('a','1'),user('b','2'),user('c','3')]);
 const one=await readMigrationPage(db,{table:'users',limit:2});
 assert.deepEqual(one.rows.map(r=>r.id),['a','b']);
 assert.equal(one.nextCursor,'b');
 assert.equal(one.hasMore,true);
 assert.match(db.calls[0].sql,/FROM efl_users/);
 assert.ok(!db.calls[0].sql.includes('OFFSET'));
 const two=await readMigrationPage(db,{table:'users',limit:2,cursor:one.nextCursor});
 assert.deepEqual(two.rows.map(r=>r.id),['c']);
 assert.equal(two.nextCursor,null);
 assert.equal(two.hasMore,false);
 assert.deepEqual(db.calls[1].params,{':cursor':'b',':limit':3});
 assert.equal(db.calls.length,2);
});
test('rejects malformed or cross-schema target rows',async()=>{
 const invalid=source([{id:'a',telegram_id:'1'}]);
 await assert.rejects(readMigrationPage(invalid,{table:'users'}),/READBACK_ROW_CONTRACT_INVALID/);
 const disorder=source([user('b','2'),user('a','1')]);
 await assert.rejects(readMigrationPage(disorder,{table:'users'}),/READBACK_ORDER_INVALID/);
 const extra=source([{...user('a','1'),server_secret:'not allowed'}]);
 await assert.rejects(readMigrationPage(extra,{table:'users'}),/READBACK_ROW_CONTRACT_INVALID/);
 const tooMany={async all(){return Array.from({length:4},(_,i)=>user(String.fromCharCode(97+i),''+i));}};
 await assert.rejects(readMigrationPage(tooMany,{table:'users',limit:2}),/READBACK_UNBOUNDED_RESULT/);
});
test('oversized target payload fails instead of unbounded disclosure',async()=>{
 const big=source([{...user('a','1'),first_name:'X'.repeat(70000)}]);
 await assert.rejects(readMigrationPage(big,{table:'users'}),/READBACK_PAGE_TOO_LARGE/);
});
