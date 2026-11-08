import test from 'node:test';
import assert from 'node:assert/strict';
import {convertEflCustomTournamentHistory} from './lib/convertEflCustomTournamentHistory.mjs';
import {validateImportBatch} from '../tgcloud/lib/importBatch.js';
const doc=(document_id,data)=>({document_id,data});
const fixture=()=>({
 users:[doc('u1',{telegramId:'123'})],
 custom_tournaments:[doc('t1',{id:'t1',organizerUserId:'u1',name:'EFL Cup',
  status:'ACTIVE',format:'KNOCKOUT',maxParticipants:16,
  inviteToken:'secret-invite-marker',spectatorToken:'secret-spectator-marker',
  rules:{maxMatches:8}})],
 custom_tournament_participants:[doc('p1',{id:'p1',tournamentId:'t1',userId:'u1',
  clubId:'c1',status:'ACTIVE',telegramId:'123'})],
 custom_tournament_fixtures:[doc('f1',{id:'f1',tournamentId:'t1',status:'SCHEDULED',
  stage:'ROUND_1',leg:1,roundOrMatchday:1,matchIndex:0})],
 custom_tournament_audit_logs:[doc('a1',{id:'a1',tournamentId:'t1',
  action:'CREATED',performedByUserId:'u1',details:{creator:'u1'}})]
});
test('custom tournament history persists four domains but never imports private tokens or activates claims',()=>{
 const source=fixture(),original=JSON.stringify(source);
 const {rows,report}=convertEflCustomTournamentHistory(source);
 assert.equal(JSON.stringify(source),original);
 for(const [table,list] of Object.entries(rows)){
  assert.equal(list.length,1);
  assert.ok(validateImportBatch({table,batchId:table+':00000000',rows:list}));
  assert.doesNotMatch(JSON.stringify(list),/secret-invite-marker|secret-spectator-marker/);
  assert.equal(list[0].replay_policy,'HISTORICAL_ONLY');
  assert.match(list[0].source_sha256,/^[a-f0-9]{64}$/);
 }
 assert.equal(report.privateInviteTokensImported,false);
 assert.equal(report.historicalParticipantClaimsActivated,false);
 const bad={...rows.customTournamentHistory[0],replay_policy:'ACTIVATE'};
 assert.throws(()=>validateImportBatch({
  table:'customTournamentHistory',batchId:'customTournamentHistory:00000000',rows:[bad]
 }),/INVALID_CUSTOM_TOURNAMENT_HISTORY_IMPORT/);
});
test('source checksum changes when private source changes but private values stay out of normalized tables',()=>{
 const source=fixture();
 const before=convertEflCustomTournamentHistory(source).rows.customTournamentHistory[0];
 source.custom_tournaments[0].data.inviteToken='different-secret';
 const after=convertEflCustomTournamentHistory(source).rows.customTournamentHistory[0];
 assert.notEqual(before.source_sha256,after.source_sha256);
 assert.equal(before.id,after.id);
 assert.equal(before.name,after.name);
 assert.doesNotMatch(JSON.stringify(after),/different-secret/);
});
test('unknown tournament, user or duplicated source document fails closed',()=>{
 for(const mutate of [
  s=>s.custom_tournament_participants[0].data.userId='missing',
  s=>s.custom_tournament_fixtures[0].data.tournamentId='missing',
  s=>s.custom_tournament_audit_logs[0].data.details=[],
  s=>s.custom_tournaments[0].data.organizerUserId='missing',
  s=>s.custom_tournament_fixtures.push(s.custom_tournament_fixtures[0])
 ]){
  const source=fixture();mutate(source);
  assert.throws(()=>convertEflCustomTournamentHistory(source));
 }
});
