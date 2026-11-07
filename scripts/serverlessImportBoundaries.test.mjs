import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImportBatch } from '../tgcloud/lib/importBatch.js';

const user = {id:'u1',telegram_id:'123',username:null,first_name:'Test',
 last_name:'',is_admin:false,is_banned:false,created_at:1,updated_at:1};
const wrap=(table,rows,batchId='protected:00000001')=>({table,batchId,rows});

test('import accepts a small normalized user',()=>{
 const result=validateImportBatch(wrap('users',[user]));
 assert.equal(result.pk,'id');
});
test('rejects oversized import payload even with one row',()=>{
 const row={...user,first_name:'x'.repeat(100000)};
 assert.throws(()=>validateImportBatch(wrap('users',[row])),/INVALID_BATCH_BYTES/);
});
test('rejects object-valued scalar columns and unsafe scores',()=>{
 assert.throws(()=>validateImportBatch(wrap('users',[{...user,username:{admin:true}}])),/INVALID_VALUE/);
 assert.throws(()=>validateImportBatch(wrap('users',[{...user,is_admin:Infinity}])),/INVALID_VALUE/);
});
test('rejects malformed archive checksums and encoded JSON',()=>{
 const archive={id:'a',source_space:'production',collection_path:'users',
   document_id:'1',encoded:{version:1},data:{id:'1'},source_checksum:'x'};
 assert.throws(()=>validateImportBatch(wrap('rawDocuments',[archive])),/INVALID_ARCHIVE_ROW/);
 assert.throws(()=>validateImportBatch(wrap('rawDocuments',[{...archive,source_checksum:'a'.repeat(64),encoded:[]}])),/INVALID_ARCHIVE_ROW/);
});
