import test from 'node:test';
import assert from 'node:assert/strict';
import {parseImportReceipt,verifyImportReceipt} from './verifyEflStagingImportReceipt.mjs';

const packet={table:'users',batchId:'users:00000000',rows:[{id:'a'},{id:'b'}]};
const receipt={ok:true,table:'users',batchId:'users:00000000',verified:2,previouslyPresent:0,total:2,status:'COMPLETE'};

test('accepts only a matching, complete structured receipt',()=>{
  assert.deepEqual(verifyImportReceipt(packet,parseImportReceipt(JSON.stringify({result:receipt}))),{ok:true,table:'users',verified:2});
  assert.equal(parseImportReceipt('CLI info\n'+JSON.stringify(receipt)).batchId,packet.batchId);
});
test('matching words without a structured receipt are insufficient',()=>{
  assert.throws(()=>parseImportReceipt('ok: true status: COMPLETE'),/STAGING_IMPORT_RECEIPT_MISSING/);
  assert.throws(()=>parseImportReceipt('{"ok":true,"status":"COMPLETE"}'),/STAGING_IMPORT_RECEIPT_MISSING/);
});
test('wrong table, batch, row counts, or status never report success',()=>{
  const tampered=[
    {...receipt,table:'seasons'},
    {...receipt,batchId:'users:00000001'},
    {...receipt,total:1},
    {...receipt,verified:1},
    {...receipt,previouslyPresent:3},
    {...receipt,previouslyPresent:-1},
    {...receipt,previouslyPresent:1.5},
    {...receipt,status:'PENDING'}
  ];
  for(const value of tampered)
    assert.throws(()=>verifyImportReceipt(packet,value),/STAGING_IMPORT_RECEIPT_MISMATCH/);
});
