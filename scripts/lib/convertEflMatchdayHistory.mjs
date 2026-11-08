// Shadow-only matchday lock and fixture deadline state.
// Old locks/reminder timestamps must never be automatically executed.
// Some historic source locks refer to deleted competitions and seasons.
const valid=s=>typeof s==='string'&&s.length>0&&s.length<=240;
const stamp=x=>{
 if(x==null)return null;
 if(typeof x!=='string')throw Error('INVALID_MATCHDAY_HISTORY_DATE');
 const ms=Date.parse(x);
 if(!Number.isSafeInteger(ms)||ms<0)throw Error('INVALID_MATCHDAY_HISTORY_DATE');
 return ms;
};
function docs(collections,root){
 const rows=collections[root]??[],out=new Map();
 if(!Array.isArray(rows))throw Error('INVALID_MATCHDAY_HISTORY_SOURCE');
 for(const row of rows){
  if(!row||!valid(row.document_id)||out.has(row.document_id)||
   !row.data||typeof row.data!=='object'||Array.isArray(row.data))
   throw Error('INVALID_MATCHDAY_HISTORY_DOCUMENT');
  out.set(row.document_id,row.data);
 }
 return out;
}
export function convertEflMatchdayHistory(collections){
 const comps=docs(collections,'competitions'),seasons=docs(collections,'seasons');
 const fixtures=docs(collections,'fixtures');
 const locks=docs(collections,'matchday_locks');
 const deadlines=docs(collections,'match_deadlines');
 let orphanLocks=0,orphanDeadlines=0;
 const matchdayLockHistory=[...locks].map(([id,data])=>{
  if(!valid(data.competitionId)||!valid(data.seasonId)||
   data.id!==id||!Number.isSafeInteger(data.matchday)||data.matchday<0||
   typeof data.isOpen!=='boolean'||typeof data.isLocked!=='boolean'||
   !valid(data.overrideStatus)||!Number.isFinite(data.durationHours)||
   data.durationHours<0)
   throw Error('INVALID_MATCHDAY_LOCK');
  const resolved=comps.has(data.competitionId)&&seasons.has(data.seasonId);
  if(!resolved)orphanLocks++;
  return {id,competition_id:data.competitionId,season_id:data.seasonId,
   matchday:data.matchday,source_is_open:data.isOpen,source_is_locked:data.isLocked,
   override_status:data.overrideStatus,updated_at:stamp(data.updatedAt),
   reference_status:resolved?'RESOLVED':'UNRESOLVED',source_record:data};
 });
 const matchDeadlineHistory=[...deadlines].map(([id,data])=>{
  if(!valid(data.fixtureId)||!valid(data.competitionId)||!valid(data.seasonId)||
   !Number.isSafeInteger(data.matchday)||data.matchday<0)
   throw Error('INVALID_MATCH_DEADLINE');
  const resolved=fixtures.has(data.fixtureId)&&comps.has(data.competitionId)&&
   seasons.has(data.seasonId);
  if(!resolved)orphanDeadlines++;
  return {id,fixture_id:data.fixtureId,competition_id:data.competitionId,
   season_id:data.seasonId,matchday:data.matchday,
   deadline_at:stamp(data.deadlineAt),created_at:stamp(data.createdAt),
   reference_status:resolved?'RESOLVED':'UNRESOLVED',source_record:data};
 });
 return {rows:{matchdayLockHistory,matchDeadlineHistory},
  report:{matchdayLockHistory:matchdayLockHistory.length,
   matchDeadlineHistory:matchDeadlineHistory.length,
   orphanLocks,orphanDeadlines,activeLocksRestored:false,
   reminderJobsTriggered:false,cutoverReady:false}};
}
