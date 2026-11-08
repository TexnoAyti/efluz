// Offline, read-only historical decisions and premium entitlements.
// No selection, revocation, billing, premium activation, or mutation is enabled.
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=160;
const required=(v,code)=>{if(!validId(v))throw Error(code);return v;};
function source(collections,name){
 const out=new Map();
 const docs=collections[name]??[];
 if(!Array.isArray(docs))throw Error('INVALID_SOURCE_COLLECTION');
 for(const doc of docs){
  if(!doc||!validId(doc.document_id)||!doc.data||
    typeof doc.data!=='object'||Array.isArray(doc.data)||
    out.has(doc.document_id))throw Error('INVALID_SOURCE_DOCUMENT');
  out.set(doc.document_id,doc.data);
 }
 return out;
}
function stamp(value,allowNull=false){
 if((value===null||value===undefined)&&allowNull)return null;
 if(typeof value!=='string')throw Error('INVALID_HISTORICAL_TIMESTAMP');
 const parsed=Date.parse(value);
 if(!Number.isSafeInteger(parsed)||parsed<0)throw Error('INVALID_HISTORICAL_TIMESTAMP');
 return parsed;
}
const optional=(value,code)=>{
 if(value===null||value===undefined)return null;
 if(typeof value!=='string')throw Error(code);
 return value;
};
export function convertEflSeasonEntitlements(collections){
 const users=source(collections,'users'),seasons=source(collections,'seasons');
 const clubs=source(collections,'clubs');
 const decisions=source(collections,'season2_retention_decisions');
 const premiums=source(collections,'premium_entitlements');
 const retentionDecisions=[],premiumEntitlements=[];
 for(const [id,d] of decisions){
  const userId=required(d.userId,'RETENTION_USER_MISSING');
  const seasonId=required(d.seasonId,'RETENTION_SEASON_MISSING');
  const sourceSeasonId=required(d.sourceSeasonId,'RETENTION_SOURCE_SEASON_MISSING');
  const clubId=required(d.clubId,'RETENTION_CLUB_MISSING');
  if(!users.has(userId)||!seasons.has(seasonId)||
   !seasons.has(sourceSeasonId)||!clubs.has(clubId))
   throw Error('RETENTION_REFERENCE_MISMATCH');
  if(!['KEEP','RELEASE'].includes(d.choice))
   throw Error('RETENTION_CHOICE_INVALID');
  retentionDecisions.push({
   id,user_id:userId,season_id:seasonId,source_season_id:sourceSeasonId,
   club_id:'s'+sourceSeasonId.length+':'+sourceSeasonId+':'+clubId,
   choice:d.choice,decided_at:stamp(d.at)
  });
 }
 for(const [id,d] of premiums){
  const userId=required(d.userId,'PREMIUM_USER_MISSING');
  const seasonId=required(d.seasonId,'PREMIUM_SEASON_MISSING');
  if(!users.has(userId)||!seasons.has(seasonId))
   throw Error('PREMIUM_REFERENCE_MISMATCH');
  if(!['ACTIVE','REVOKED'].includes(d.status))
   throw Error('PREMIUM_STATUS_INVALID');
  if(typeof d.source!=='string'||!d.source||
   typeof d.note!=='string'||typeof d.updatedBy!=='string')
   throw Error('PREMIUM_METADATA_INVALID');
  const activated=stamp(d.activatedAt);
  const revoked=stamp(d.revokedAt,true);
  const updated=stamp(d.updatedAt);
  if((d.status==='ACTIVE'&&revoked!==null)||
     (d.status==='REVOKED'&&revoked===null)||
     (revoked!==null&&revoked<activated)||
     updated<activated)throw Error('PREMIUM_LIFECYCLE_INVALID');
  premiumEntitlements.push({
   id,user_id:userId,season_id:seasonId,
   status:d.status,source:d.source,note:d.note,
   payment_charge_id:optional(d.paymentChargeId,'PREMIUM_PAYMENT_ID_INVALID'),
   activated_at:activated,revoked_at:revoked,
   revoked_by:optional(d.revokedBy,'PREMIUM_REVOKER_INVALID'),
   updated_at:updated,updated_by:d.updatedBy
  });
 }
 return {rows:{retentionDecisions,premiumEntitlements},report:{
  retentionDecisions:retentionDecisions.length,
  premiumEntitlements:premiumEntitlements.length,
  clubSelectionsReplayed:false,premiumAccessGranted:false,
  cutoverReady:false
 }};
}
