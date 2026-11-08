// Historical-only chat rooms, notification jobs and standings snapshots.
// Importing archived state cannot reopen chats, deliver old jobs, or replace
// the current table computed from confirmed fixtures.
import {createHash} from 'node:crypto';
import {stableRow} from '../../tgcloud/lib/importBatch.js';
const valid=s=>typeof s==='string'&&s.length>0&&s.length<=240;
const hash=x=>createHash('sha256').update(stableRow(x,Object.keys(x).sort())).digest('hex');
function records(source,root){
 const list=source[root]??[],seen=new Set();
 if(!Array.isArray(list))throw Error('INVALID_OPERATIONAL_HISTORY_COLLECTION');
 return list.map(doc=>{
  if(!doc||!valid(doc.document_id)||seen.has(doc.document_id)||
    !doc.data||typeof doc.data!=='object'||Array.isArray(doc.data))
   throw Error('INVALID_OPERATIONAL_HISTORY_DOCUMENT');
  seen.add(doc.document_id);
  return {id:doc.document_id,d:doc.data};
 });
}
export function convertEflOperationalHistory(source){
 const seasons=new Set((source.seasons??[]).map(x=>x.document_id));
 const competitions=new Set((source.competitions??[]).map(x=>x.document_id));
 let orphanStandings=0;
 const matchChatRoomHistory=records(source,'match_chat_rooms').map(({id,d})=>{
  if(d.id!==id||!valid(d.matchId)||!valid(d.seasonId)||
    !seasons.has(d.seasonId)||!Array.isArray(d.messages)||
    !Array.isArray(d.participants)||!Array.isArray(d.reports)||
    !Array.isArray(d.blockedBy)||typeof d.closed!=='boolean')
   throw Error('MATCH_CHAT_HISTORY_INVALID');
  return {id,match_id:d.matchId,season_id:d.seasonId,
   source_closed:d.closed,participant_count:d.participants.length,
   message_count:d.messages.length,source_sha256:hash(d),
   replay_policy:'HISTORICAL_ONLY'};
 });
 const matchdayJobHistory=records(source,'matchday_notification_jobs').map(({id,d})=>{
  if(!valid(d.competitionId)||!competitions.has(d.competitionId)||
     !valid(d.seasonId)||!seasons.has(d.seasonId)||
     !Number.isSafeInteger(d.matchday)||d.matchday<0||
     !valid(d.status))
   throw Error('MATCHDAY_JOB_HISTORY_INVALID');
  return {id,competition_id:d.competitionId,season_id:d.seasonId,
   matchday:d.matchday,source_status:d.status,
   source_sha256:hash(d),replay_policy:'HISTORICAL_ONLY'};
 });
 const standingsHistory=records(source,'standings').map(({id,d})=>{
  if(!valid(d.competitionId)||!valid(d.seasonId)||
     !seasons.has(d.seasonId)||!Array.isArray(d.rows)||
     !Array.isArray(d.confirmedFixtureIds)||!Number.isSafeInteger(d.totalPlayed)||
     d.totalPlayed<0)
   throw Error('STANDINGS_HISTORY_INVALID');
  const resolved=competitions.has(d.competitionId);
  if(!resolved)orphanStandings++;
  return {id,competition_id:d.competitionId,season_id:d.seasonId,
   source_row_count:d.rows.length,source_played:d.totalPlayed,
   reference_status:resolved?'RESOLVED':'UNRESOLVED',
   source_sha256:hash(d),replay_policy:'HISTORICAL_ONLY'};
 });
 return {rows:{matchChatRoomHistory,matchdayJobHistory,standingsHistory},
  report:{matchChatRooms:matchChatRoomHistory.length,
   matchdayJobs:matchdayJobHistory.length,standings:standingsHistory.length,
   orphanStandings,oldMessagesPublished:false,oldNotificationsSent:false,
   activeStandingsOverwritten:false,cutoverReady:false}};
}
