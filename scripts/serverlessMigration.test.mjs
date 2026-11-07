import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImportBatch, stableRow } from '../tgcloud/lib/importBatch.js';

const user={ id:'u1',telegram_id:'123',username:null,first_name:'Test',last_name:'',
  is_admin:false,is_banned:false,created_at:1,updated_at:1 };
const payload=(overrides={})=>({ table:'users',batchId:'users:000001',rows:[user],...overrides });
test('valid batch is deterministic under key reordering',()=>{
  const result=validateImportBatch(payload());
  assert.equal(result.sqlTable,'efl_users');
  assert.equal(result.rows.length,1);
  assert.equal(stableRow({a:{y:2,x:1}},['a']),stableRow({a:{x:1,y:2}},['a']));
});
test('unsafe table and unknown column rejected',()=>{
  assert.throws(()=>validateImportBatch(payload({table:'efl_users;DROP TABLE users'})),/INVALID_TABLE/);
  assert.throws(()=>validateImportBatch(payload({rows:[{...user,hack:1}]})),/UNKNOWN_COLUMN/);
});
test('batch bounded to 100 and must contain complete rows',()=>{
  assert.throws(()=>validateImportBatch(payload({rows:[]})),/INVALID_BATCH_SIZE/);
  assert.throws(()=>validateImportBatch(payload({rows:Array.from({length:101},(_,i)=>({...user,id:String(i)}))})),/INVALID_BATCH_SIZE/);
  assert.throws(()=>validateImportBatch(payload({rows:[{id:'u1'}]})),/MISSING_COLUMN/);
});
test('same primary key twice rejected before writes',()=>{
  assert.throws(()=>validateImportBatch(payload({rows:[user,{...user}]})),/DUPLICATE_IN_BATCH/);
});
test('client cannot inject table or column names',()=>{
  assert.throws(()=>validateImportBatch(payload({rows:[{...user,'id) VALUES(1);--':'bad'}]})),/UNKNOWN_COLUMN/);
});
