import test from 'node:test';
import assert from 'node:assert/strict';
import {convertEflMatchdayHistory} from './lib/convertEflMatchdayHistory.mjs';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
const at='2026-01-01T00:00:00Z';
const doc=(document_id,data)=>({document_id,data});
const fixture=()=>({
 seasons:[doc('s1',{name:'Season'})],
 competitions:[doc('c1',{name:'Competition'})],
 fixtures:[doc('f1',{competitionId:'c1'})],
 matchday_locks:[
  doc('lock1',{id:'lock1',competitionId:'c1',seasonId:'s1',matchday:4,
   isOpen:false,isLocked:true,overrideStatus:'FORCE_LOCKED',
   durationHours:24,updatedAt:at}),
  doc('lock-old',{id:'lock-old',competitionId:'deleted-comp',seasonId:'s1',
   matchday:3,isOpen:true,isLocked:false,overrideStatus:'AUTO',
   durationHours:12,updatedAt:at})
 ],
 match_deadlines:[
  doc('deadline1',{fixtureId:'f1',competitionId:'c1',seasonId:'s1',
   matchday:4,deadlineAt:at,createdAt:at})
 ]
});
test('historic matchday locks preserve FORCE_LOCKED and orphan records without activating new locks',()=>{
 const source=fixture(),before=JSON.stringify(source);
 const result=convertEflMatchdayHistory(source);
 assert.equal(JSON.stringify(source),before);
 assert.equal(result.rows.matchdayLockHistory.length,2);
 assert.equal(result.rows.matchDeadlineHistory.length,1);
 assert.equal(result.rows.matchdayLockHistory[0].source_is_locked,true);
 assert.equal(result.rows.matchdayLockHistory[1].reference_status,'UNRESOLVED');
 assert.equal(result.rows.matchDeadlineHistory[0].reference_status,'RESOLVED');
 assert.equal(result.report.orphanLocks,1);
 assert.equal(result.report.activeLocksRestored,false);
 assert.equal(result.report.reminderJobsTriggered,false);
 for(const [table,rows] of Object.entries(result.rows))
  assert.ok(validateImportBatch({table,batchId:table+':00000000',rows}));
 const lock=result.rows.matchdayLockHistory[0];
 assert.throws(()=>validateImportBatch({table:'matchdayLockHistory',
  batchId:'matchdayLockHistory:00000000',
  rows:[{...lock,source_is_locked:false}]}),/INVALID_MATCHDAY_HISTORY_ROW/);
 const deadline=result.rows.matchDeadlineHistory[0];
 assert.throws(()=>validateImportBatch({table:'matchDeadlineHistory',
  batchId:'matchDeadlineHistory:00000000',
  rows:[{...deadline,fixture_id:'forged'}]}),/INVALID_MATCH_DEADLINE_HISTORY_ROW/);
});
test('malformed historic control states and duplicate identities fail closed',()=>{
 for(const change of [
  s=>s.matchday_locks[0].data.id='wrong',
  s=>s.matchday_locks[0].data.isLocked='true',
  s=>s.matchday_locks.push(s.matchday_locks[0]),
  s=>s.match_deadlines[0].data.matchday='four',
  s=>s.match_deadlines[0].data.deadlineAt='invalid'
 ]){
  const source=fixture();change(source);
  assert.throws(()=>convertEflMatchdayHistory(source));
 }
});
