import test from 'node:test';
import assert from 'node:assert/strict';
import {convertUzeflifeHistory} from './lib/convertUzeflifeHistory.mjs';
import {validateImportBatch,stableRow} from '../tgcloud/lib/importBatch.js';
import {createHash} from 'node:crypto';
const at='2026-01-01T00:00:00Z';
const row=(id,data)=>({document_id:id,data});
const fixture=()=>({
 uzeflife_audit:[
  row('revision1',{action:'start',actor:'admin',at,revision:1}),
  row('revision2',{action:'result',actor:'admin',at,revision:2,details:{fixture:'f1'}})
 ],
 uzeflife_notifications:[
  row('batch1',{createdAt:at,cursor:1,deliveryVersion:2,lease:'lease01',
   leaseUntil:123456,notices:[{to:'a',message:'test'}],
   retryIndices:[0],status:'PENDING'})
 ]
});
test('historical UZEFLIFE migration preserves audit and queue checksums without enqueuing stale notifications',()=>{
 const source=fixture(),before=JSON.stringify(source);
 const result=convertUzeflifeHistory(source);
 assert.equal(JSON.stringify(source),before);
 assert.equal(result.rows.uzeflifeAuditHistory.length,2);
 assert.equal(result.rows.uzeflifeNoticeHistory.length,1);
 const notice=result.rows.uzeflifeNoticeHistory[0];
 assert.equal(notice.replay_policy,'HISTORICAL_ONLY');
 assert.equal(notice.notice_count,1);
 assert.equal(result.report.notificationReplayEnabled,false);
 assert.equal(result.report.liveLeaseRestored,false);
 assert.ok(!Object.hasOwn(notice,'source_record'));
 const orig=source.uzeflife_notifications[0].data;
 const checksum=createHash('sha256').update(stableRow(orig,Object.keys(orig).sort())).digest('hex');
 assert.equal(notice.source_sha256,checksum);
 for(const [table,rows] of Object.entries(result.rows)){
  assert.ok(validateImportBatch({table,batchId:table+':00000000',rows}));
 }
 assert.throws(()=>validateImportBatch({
  table:'uzeflifeNoticeHistory',batchId:'uzeflifeNoticeHistory:00000000',
  rows:[{...notice,replay_policy:'RETRY'}]
 }),/INVALID_UZEFLIFE_NOTICE_HISTORY_ROW/);
});
test('large queue messages never inflate normalized import rows past packet limit',()=>{
 const source=fixture();
 source.uzeflife_notifications[0].data.notices=[{message:'x'.repeat(85000)}];
 const {rows}=convertUzeflifeHistory(source);
 assert.ok(JSON.stringify(rows.uzeflifeNoticeHistory[0]).length<1024);
 assert.ok(validateImportBatch({table:'uzeflifeNoticeHistory',
  batchId:'uzeflifeNoticeHistory:00000000',rows:rows.uzeflifeNoticeHistory}));
});
test('unknown or malformed source notification state is blocked',()=>{
 for(const change of [
  s=>s.uzeflife_audit[0].data.revision='1',
  s=>s.uzeflife_audit[0].data.details=[],
  s=>s.uzeflife_notifications[0].data.notices={},
  s=>s.uzeflife_notifications[0].data.leaseUntil='never',
  s=>s.uzeflife_notifications[0].data.createdAt='invalid',
  s=>s.uzeflife_notifications.push(s.uzeflife_notifications[0])
 ]){
  const s=fixture();change(s);
  assert.throws(()=>convertUzeflifeHistory(s));
 }
});
