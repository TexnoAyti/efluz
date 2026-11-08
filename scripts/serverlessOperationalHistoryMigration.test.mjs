import test from 'node:test';
import assert from 'node:assert/strict';
import {convertEflOperationalHistory} from './lib/convertEflOperationalHistory.mjs';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
const doc=(document_id,data)=>({document_id,data});
const fixture=()=>({
 seasons:[doc('s1',{name:'Season'})],
 competitions:[doc('c1',{name:'League'})],
 match_chat_rooms:[doc('room1',{
  id:'room1',matchId:'f1',seasonId:'s1',closed:true,
  messages:[{text:'secret-match-message'}],participants:['u1','u2'],
  reports:[],blockedBy:[],unread:{},kind:'fixture'
 })],
 matchday_notification_jobs:[doc('job1',{
  competitionId:'c1',seasonId:'s1',status:'PENDING',matchday:1,
  deadlineAt:'2026-11-01T00:00:00Z'
 })],
 standings:[doc('standing1',{
  competitionId:'c1',seasonId:'s1',totalPlayed:2,
  rows:[{club:'c1',points:3}],confirmedFixtureIds:['f1']
 }),doc('orphan',{
  competitionId:'deleted-comp',seasonId:'s1',totalPlayed:0,
  rows:[],confirmedFixtureIds:[]
 })]
});
test('private chat messages and historical jobs are never replayed or copied to imported rows',()=>{
 const source=fixture(),unchanged=JSON.stringify(source);
 const {rows,report}=convertEflOperationalHistory(source);
 assert.equal(JSON.stringify(source),unchanged);
 assert.equal(report.matchChatRooms,1);
 assert.equal(report.matchdayJobs,1);
 assert.equal(report.standings,2);
 assert.equal(report.orphanStandings,1);
 assert.equal(report.oldMessagesPublished,false);
 assert.equal(report.oldNotificationsSent,false);
 assert.equal(report.activeStandingsOverwritten,false);
 assert.equal(rows.standingsHistory[1].reference_status,'UNRESOLVED');
 for(const [table,list] of Object.entries(rows)){
  assert.ok(validateImportBatch({table,batchId:table+':00000000',rows:list}));
  assert.doesNotMatch(JSON.stringify(list),/secret-match-message/);
  for(const row of list)assert.equal(row.replay_policy,'HISTORICAL_ONLY');
 }
});
test('changing historical source updates its checksum but never reveals private messages',()=>{
 const source=fixture();
 const before=convertEflOperationalHistory(source).rows.matchChatRoomHistory[0];
 source.match_chat_rooms[0].data.messages.push({text:'secret-other'});
 const after=convertEflOperationalHistory(source).rows.matchChatRoomHistory[0];
 assert.notEqual(before.source_sha256,after.source_sha256);
 assert.doesNotMatch(JSON.stringify(after),/secret-other/);
});
test('forged chat/job/standings import packets fail closed',()=>{
 const rows=convertEflOperationalHistory(fixture()).rows;
 for(const [table,delta] of [
  ['matchChatRoomHistory',{replay_policy:'OPEN'}],
  ['matchdayJobHistory',{matchday:-1}],
  ['standingsHistory',{source_played:-1}]
 ]){
  const row={...rows[table][0],...delta};
  assert.throws(()=>validateImportBatch({
   table,batchId:table+':00000000',rows:[row]
  }),/INVALID_OPERATIONAL_HISTORY_IMPORT/);
 }
});
test('unknown source references, duplicate rooms and invalid state fail closed',()=>{
 for(const mutate of [
  s=>s.match_chat_rooms[0].data.seasonId='missing',
  s=>s.match_chat_rooms[0].data.messages={},
  s=>s.matchday_notification_jobs[0].data.competitionId='missing',
  s=>s.standings[0].data.rows='bad',
  s=>s.match_chat_rooms.push(s.match_chat_rooms[0])
 ]){
  const x=fixture();mutate(x);
  assert.throws(()=>convertEflOperationalHistory(x));
 }
});
