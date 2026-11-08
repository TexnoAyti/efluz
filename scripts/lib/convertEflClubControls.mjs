// Historical admission switches and club-selection bans only.
// No admission opening, club releasing or ban enforcement side effects occur.
const id=x=>typeof x==='string'&&x.length>0&&x.length<=160;
const time=x=>{
 if(typeof x!=='string')throw Error('INVALID_CLUB_CONTROL_TIME');
 const t=Date.parse(x);
 if(!Number.isSafeInteger(t)||t<0)throw Error('INVALID_CLUB_CONTROL_TIME');
 return t;
};
function source(collections,root){
 const rows=collections[root]??[];
 if(!Array.isArray(rows))throw Error('INVALID_CLUB_CONTROL_SOURCE');
 const out=new Map();
 for(const row of rows){
  if(!row||!id(row.document_id)||!row.data||
   typeof row.data!=='object'||Array.isArray(row.data)||
   out.has(row.document_id))throw Error('INVALID_CLUB_CONTROL_DOCUMENT');
  out.set(row.document_id,row.data);
 }
 return out;
}
export function convertEflClubControls(collections){
 const users=source(collections,'users');
 const seasons=source(collections,'seasons');
 const admissions=source(collections,'club_admissions');
 const bans=source(collections,'club_selection_bans');
 const clubAdmissions=[],clubSelectionBans=[];
 for(const [key,d] of admissions){
  if(!id(d.seasonId)||!seasons.has(d.seasonId))
   throw Error('ADMISSION_SEASON_MISSING');
  if(typeof d.enabled!=='boolean'||!Number.isSafeInteger(d.stage)||d.stage<0||
   !id(d.revision)||typeof d.updatedBy!=='string'||
   !d.leagueOverrides||typeof d.leagueOverrides!=='object'||
   Array.isArray(d.leagueOverrides)||d.leagueOverrides===null)
   throw Error('ADMISSION_STATE_INVALID');
  if(d.automatic!==undefined&&typeof d.automatic!=='boolean')
   throw Error('ADMISSION_AUTOMATIC_INVALID');
  clubAdmissions.push({
   id:key,season_id:d.seasonId,enabled:d.enabled,
   automatic:d.automatic??null,stage:d.stage,revision:d.revision,
   league_overrides:d.leagueOverrides,updated_by:d.updatedBy,
   updated_at:time(d.updatedAt)
  });
 }
 for(const [key,d] of bans){
  if(!id(d.userId)||d.userId!==key||!users.has(key))
   throw Error('CLUB_BAN_USER_CONFLICT');
  if(!id(d.telegramId)||String(users.get(key).telegramId)!==d.telegramId)
   throw Error('CLUB_BAN_TELEGRAM_CONFLICT');
  if(typeof d.isBanned!=='boolean'||typeof d.reason!=='string'||
   typeof d.actorId!=='string'||!Number.isSafeInteger(d.revision)||
   d.revision<0)throw Error('CLUB_BAN_STATE_INVALID');
  clubSelectionBans.push({
   id:key,user_id:d.userId,telegram_id:d.telegramId,
   is_banned:d.isBanned,reason:d.reason,actor_id:d.actorId,
   revision:d.revision,updated_at:time(d.updatedAt)
  });
 }
 return {rows:{clubAdmissions,clubSelectionBans},
  report:{admissions:clubAdmissions.length,bans:clubSelectionBans.length,
   historicSourcePreserved:true,banActionsExecuted:false,
   admissionOpened:false,cutoverReady:false}};
}
