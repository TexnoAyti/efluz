// Private shadow projection for custom tournaments. No participants are
// enrolled and no invite/spectator tokens are copied to imported tables.
// The complete source (including private tokens) remains only in the verified
// local source archive; per-document SHA256 binds these summaries to it.
import {createHash} from 'node:crypto';
import {stableRow} from '../../tgcloud/lib/importBatch.js';
const valid=x=>typeof x==='string'&&x.length>0&&x.length<=240;
const sha=data=>createHash('sha256').update(stableRow(data,Object.keys(data).sort())).digest('hex');
function docs(source,root){
 const list=source[root]??[],seen=new Set();
 if(!Array.isArray(list))throw Error('CUSTOM_TOURNAMENT_HISTORY_INVALID');
 return list.map(doc=>{
  if(!doc||!valid(doc.document_id)||seen.has(doc.document_id)||
     !doc.data||typeof doc.data!=='object'||Array.isArray(doc.data)||
     doc.data.id!==doc.document_id)throw Error('CUSTOM_TOURNAMENT_DOCUMENT_INVALID');
  seen.add(doc.document_id);
  return {id:doc.document_id,data:doc.data};
 });
}
export function convertEflCustomTournamentHistory(source){
 const users=new Set((source.users??[]).map(doc=>doc.document_id));
 const tournaments=docs(source,'custom_tournaments');
 const tournamentIds=new Set(tournaments.map(x=>x.id));
 const tournamentHistory=tournaments.map(({id,data})=>{
  if(!valid(data.organizerUserId)||!users.has(data.organizerUserId)||
     !valid(data.name)||!valid(data.status)||!valid(data.format)||
     !Number.isSafeInteger(data.maxParticipants)||data.maxParticipants<1)
   throw Error('CUSTOM_TOURNAMENT_OWNER_INVALID');
  return {id,name:data.name,organizer_user_id:data.organizerUserId,
   status:data.status,format:data.format,max_participants:data.maxParticipants,
   source_sha256:sha(data),replay_policy:'HISTORICAL_ONLY'};
 });
 const participantHistory=docs(source,'custom_tournament_participants').map(({id,data})=>{
  if(!valid(data.tournamentId)||!tournamentIds.has(data.tournamentId)||
     !valid(data.userId)||!users.has(data.userId)||!valid(data.status)||
     !valid(data.clubId))throw Error('CUSTOM_TOURNAMENT_PARTICIPANT_INVALID');
  return {id,tournament_id:data.tournamentId,user_id:data.userId,
   club_id:data.clubId,status:data.status,source_sha256:sha(data),
   replay_policy:'HISTORICAL_ONLY'};
 });
 const fixtureHistory=docs(source,'custom_tournament_fixtures').map(({id,data})=>{
  if(!valid(data.tournamentId)||!tournamentIds.has(data.tournamentId)||
     !valid(data.status)||!valid(data.stage)||!Number.isSafeInteger(data.leg)||
     !Number.isSafeInteger(data.roundOrMatchday)||!Number.isSafeInteger(data.matchIndex))
   throw Error('CUSTOM_TOURNAMENT_FIXTURE_INVALID');
  return {id,tournament_id:data.tournamentId,status:data.status,stage:data.stage,
   leg:data.leg,round:data.roundOrMatchday,match_index:data.matchIndex,
   source_sha256:sha(data),replay_policy:'HISTORICAL_ONLY'};
 });
 const auditHistory=docs(source,'custom_tournament_audit_logs').map(({id,data})=>{
  if(!valid(data.tournamentId)||!tournamentIds.has(data.tournamentId)||
     !valid(data.action)||!valid(data.performedByUserId)||
     !data.details||typeof data.details!=='object'||Array.isArray(data.details))
   throw Error('CUSTOM_TOURNAMENT_AUDIT_INVALID');
  return {id,tournament_id:data.tournamentId,action:data.action,
   actor_user_id:data.performedByUserId,source_sha256:sha(data),
   replay_policy:'HISTORICAL_ONLY'};
 });
 return {rows:{customTournamentHistory:tournamentHistory,
  customTournamentParticipantHistory:participantHistory,
  customTournamentFixtureHistory:fixtureHistory,
  customTournamentAuditHistory:auditHistory},
  report:{tournaments:tournamentHistory.length,
   participants:participantHistory.length,fixtures:fixtureHistory.length,
   audits:auditHistory.length,privateInviteTokensImported:false,
   historicalParticipantClaimsActivated:false,cutoverReady:false}};
}
