import test from 'node:test';
import assert from 'node:assert/strict';
import {convertEflBanHistory} from './lib/convertEflBanHistory.mjs';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
const at='2026-11-01T10:00:00Z';
const doc=(document_id,data)=>({document_id,data});
const fixture=()=>({
 users:[doc('u1',{telegramId:'111'})],
 club_selection_ban_audit:[doc('audit1',{
  userId:'u1',telegramId:'111',actorId:'admin',isBanned:true,
  previousIsBanned:false,revision:4,reason:'Season rule',
  releasedClubs:[],updatedAt:at
 })],
 club_selection_ban_controls:[doc('callback1',{
  targetId:'u1',targetTelegramId:'111',expectedRevision:4,
  consumed:false,expiresAt:1700000000000,isBanned:true,
  reason:'Moderator',actorId:'admin',chatId:123,threadId:1,
  deliveredMessageId:2,releasedClubs:[]
 })]
});
test('history is immutable, preserves unconsumed controls but never reapplies them',()=>{
 const src=fixture(),original=JSON.stringify(src);
 const result=convertEflBanHistory(src);
 assert.equal(JSON.stringify(src),original);
 assert.equal(result.rows.banAuditHistory.length,1);
 assert.equal(result.rows.banControlHistory.length,1);
 assert.equal(result.rows.banControlHistory[0].originally_consumed,false);
 assert.equal(result.rows.banControlHistory[0].replay_policy,'HISTORICAL_ONLY');
 assert.equal(result.report.callbackReplayEnabled,false);
 assert.equal(result.report.bansApplied,false);
 assert.equal(result.report.clubsReleased,false);
 for(const [table,rows] of Object.entries(result.rows))
  assert.ok(validateImportBatch({table,batchId:table+':00000000',rows}));
});
test('tampered audit and callback import packets are rejected',()=>{
 const out=convertEflBanHistory(fixture()).rows;
 assert.throws(()=>validateImportBatch({
  table:'banAuditHistory',batchId:'banAuditHistory:00000000',
  rows:[{...out.banAuditHistory[0],is_banned:false}]
 }),/INVALID_BAN_AUDIT_HISTORY_IMPORT/);
 assert.throws(()=>validateImportBatch({
  table:'banControlHistory',batchId:'banControlHistory:00000000',
  rows:[{...out.banControlHistory[0],replay_policy:'EXECUTE'}]
 }),/INVALID_BAN_CONTROL_HISTORY_IMPORT/);
 assert.throws(()=>validateImportBatch({
  table:'banControlHistory',batchId:'banControlHistory:00000000',
  rows:[{...out.banControlHistory[0],expires_at:1700000000001}]
 }),/INVALID_BAN_CONTROL_HISTORY_IMPORT/);
});
test('ban history rejects missing users, bad timestamps, invalid control type and duplicate IDs',()=>{
 for(const mutate of [
  x=>x.club_selection_ban_audit[0].data.userId='missing',
  x=>x.club_selection_ban_audit[0].data.updatedAt='n/a',
  x=>x.club_selection_ban_controls[0].data.targetId='missing',
  x=>x.club_selection_ban_controls[0].data.consumed='false',
  x=>x.club_selection_ban_controls.push(x.club_selection_ban_controls[0])
 ]){
  const source=fixture();mutate(source);
  assert.throws(()=>convertEflBanHistory(source));
 }
});
