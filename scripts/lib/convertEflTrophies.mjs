// Private, read-only projection of existing trophy winners.
// This does not award trophies, rerun competitions or infer winners.
const str=x=>typeof x==='string'&&x.length>0&&x.length<=160;
const stamp=x=>{
 if(typeof x!=='string')throw Error('INVALID_TROPHY_TIMESTAMP');
 const t=Date.parse(x);
 if(!Number.isSafeInteger(t)||t<0)throw Error('INVALID_TROPHY_TIMESTAMP');
 return t;
};
const source=(collections,name)=>{
 const out=new Map();
 for(const row of collections[name]??[]){
  if(!row||!str(row.document_id)||!row.data||typeof row.data!=='object'||
   Array.isArray(row.data)||out.has(row.document_id))
   throw Error('INVALID_TROPHY_SOURCE');
  out.set(row.document_id,row.data);
 }
 return out;
};
export function convertEflTrophies(collections){
 const users=source(collections,'users');
 const seasons=source(collections,'seasons');
 const clubs=source(collections,'clubs');
 const comps=source(collections,'competitions');
 const trophies=source(collections,'player_trophies');
 const rows=[];
 for(const [id,d] of trophies){
  if(d.id!==id)throw Error('TROPHY_ID_MISMATCH');
  if(!str(d.winnerUserId)||!users.has(d.winnerUserId))
   throw Error('TROPHY_WINNER_MISSING');
  if(!str(d.seasonId)||!seasons.has(d.seasonId))
   throw Error('TROPHY_SEASON_MISSING');
  if(!str(d.competitionId)||!comps.has(d.competitionId)||
     comps.get(d.competitionId).seasonId!==d.seasonId)
   throw Error('TROPHY_COMPETITION_MISMATCH');
  if(!str(d.clubId)||!clubs.has(d.clubId))
   throw Error('TROPHY_CLUB_MISSING');
  if(typeof d.active!=='boolean')throw Error('TROPHY_ACTIVE_INVALID');
  if(typeof d.winnerUsername!=='string'||typeof d.clubName!=='string'||
     typeof d.competitionName!=='string'||typeof d.decidedBy!=='string')
   throw Error('TROPHY_METADATA_INVALID');
  rows.push({
   id,season_id:d.seasonId,competition_id:d.competitionId,
   club_id:'s'+d.seasonId.length+':'+d.seasonId+':'+d.clubId,
   winner_user_id:d.winnerUserId,winner_username:d.winnerUsername,
   club_name:d.clubName,competition_name:d.competitionName,
   active:d.active,decided_by:d.decidedBy,
   evaluated_at:stamp(d.evaluatedAt),confirmed_at:stamp(d.confirmedAt)
  });
 }
 return {rows:{playerTrophies:rows},report:{
  trophies:rows.length,historicalWinnersPreserved:true,
  awardsRecomputed:false,writeEnabled:false,cutoverReady:false
 }};
}
