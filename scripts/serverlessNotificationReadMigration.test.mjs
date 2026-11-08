import test from 'node:test';
import assert from 'node:assert/strict';
import {convertEflNotificationReadState} from './lib/convertEflNotificationReadState.mjs';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
import {rowsEquivalent} from '../tgcloud/lib/importEngine.js';
const doc=(document_id,data)=>({document_id,data});
const fixture=()=>({
 users:[doc('u1',{telegramId:'123'}),doc('u2',{telegramId:'456'})],
 notification_read_state:[
  doc('u1',{state:{all:'2026-01-01T00:00:00Z','notification:n1':'2026-01-02T00:00:00Z'}}),
  doc('u2',{state:{'notification:n2':'2026-01-03T00:00:00Z'}})
 ]
});
test('per-user notification read-state snapshot migrates without marking new notices read',()=>{
 const source=fixture(),before=JSON.stringify(source);
 const {rows,report}=convertEflNotificationReadState(source);
 assert.equal(JSON.stringify(source),before);
 assert.equal(rows.notificationReadState.length,2);
 assert.equal(rows.notificationReadState[0].id,'u1');
 assert.equal(rows.notificationReadState[0].state['notification:n1'],'2026-01-02T00:00:00Z');
 assert.equal(report.newNotificationsSent,false);
 assert.ok(validateImportBatch({
  table:'notificationReadState',batchId:'notificationReadState:00000000',
  rows:rows.notificationReadState
 }));
 const row=rows.notificationReadState[0];
 assert.equal(rowsEquivalent({...row,state:JSON.stringify(row.state)},row,['id','user_id','state']),true);
 assert.throws(()=>validateImportBatch({
  table:'notificationReadState',batchId:'notificationReadState:00000000',
  rows:[{...row,user_id:'another'}]
 }),/INVALID_NOTIFICATION_READ_IMPORT_ROW/);
});
test('unknown owners, duplicate documents and malformed marker objects fail closed',()=>{
 for(const change of [
  s=>s.notification_read_state[0].document_id='unknown',
  s=>s.notification_read_state.push(s.notification_read_state[0]),
  s=>s.notification_read_state[0].data.state=[],
  s=>s.notification_read_state[0].data.state={all:123}
 ]){
  const source=fixture();change(source);
  assert.throws(()=>convertEflNotificationReadState(source));
 }
});
