import test from 'node:test';
import assert from 'node:assert/strict';
import {convertEflTelegramTagsHistory} from './lib/convertEflTelegramTagsHistory.mjs';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
const doc=(document_id,data)=>({document_id,data});
const fixture=()=>({
 users:[doc('u1',{telegramId:'123'})],
 seasons:[doc('s1',{name:'Season 1'})],
 telegram_member_tags:[doc('tag1',{
  userId:'u1',seasonId:'s1',telegramId:123,appliedTag:'Club A',
  checkedAt:'2026-11-01T10:00:00Z',managed:true,
  reason:'ok',scope:'group',ownershipKey:'u1:s1',
  diagnosticVersion:1,nextCheckAt:10000,clubId:'c1'
 })],
 telegram_member_tag_state:[
  doc('stat-flag',{value:true,expiresAt:11000}),
  doc('stat-metric',{value:12,expiresAt:null}),
  doc('stat-object',{value:{cursor:'a'}})
 ]
});
test('group-tag history and scalar state preserved without Telegram side effects',()=>{
 const source=fixture(),original=JSON.stringify(source);
 const result=convertEflTelegramTagsHistory(source);
 assert.equal(JSON.stringify(source),original);
 assert.equal(result.rows.telegramTagHistory.length,1);
 assert.equal(result.rows.telegramTagStateHistory.length,3);
 assert.equal(result.rows.telegramTagStateHistory[0].source_value,true);
 assert.equal(result.rows.telegramTagStateHistory[1].source_value,12);
 assert.deepEqual(result.rows.telegramTagStateHistory[2].source_value,{cursor:'a'});
 assert.equal(result.report.tagsReapplied,false);
 assert.equal(result.report.timersScheduled,false);
 for(const [table,rows] of Object.entries(result.rows))
  assert.ok(validateImportBatch({table,batchId:table+':00000000',rows}));
});
test('forged Telegram tag and executable state are rejected',()=>{
 const out=convertEflTelegramTagsHistory(fixture()).rows;
 assert.throws(()=>validateImportBatch({
  table:'telegramTagHistory',batchId:'telegramTagHistory:00000000',
  rows:[{...out.telegramTagHistory[0],applied_tag:'hijacked'}]
 }),/INVALID_TELEGRAM_TAG_HISTORY_IMPORT/);
 assert.throws(()=>validateImportBatch({
  table:'telegramTagStateHistory',batchId:'telegramTagStateHistory:00000000',
  rows:[{...out.telegramTagStateHistory[0],replay_policy:'SCHEDULE'}]
 }),/INVALID_TELEGRAM_TAG_STATE_HISTORY_IMPORT/);
});
test('unknown users, invalid timestamps and duplicate IDs fail closed',()=>{
 for(const change of [
  s=>s.telegram_member_tags[0].data.userId='missing',
  s=>s.telegram_member_tags[0].data.seasonId='missing',
  s=>s.telegram_member_tags[0].data.telegramId='123',
  s=>s.telegram_member_tags[0].data.nextCheckAt='tomorrow',
  s=>s.telegram_member_tag_state[0].data.expiresAt=-2,
  s=>s.telegram_member_tags.push(s.telegram_member_tags[0])
 ]){
  const s=fixture();change(s);
  assert.throws(()=>convertEflTelegramTagsHistory(s));
 }
});
