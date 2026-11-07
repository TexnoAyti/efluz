// Public TEAMS listing derived from private production documents.
// Never publish owner IDs, Telegram IDs, member rosters, embedded base64
// logos or membership/payment receipts through this projection.
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=160;
const timestamp=value=>{
 if(value==null)return 0;
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)
  return value>1e11?value:value*1000;
 if(typeof value==='string'){
  const n=Date.parse(value);
  if(Number.isSafeInteger(n)&&n>=0)return n;
 }
 throw Error('TEAMS_INVALID_TIMESTAMP');
};
export function convertTeamsCatalog(records){
 if(!Array.isArray(records))throw Error('TEAMS_INVALID_SOURCE');
 const ids=new Set(),rows=[];
 for(const source of records){
  if(!source||typeof source!=='object'||Array.isArray(source)||
     !validId(source.document_id)||!source.data||typeof source.data!=='object')
    throw Error('TEAMS_INVALID_RECORD');
  const d=source.data;
  if(ids.has(source.document_id))throw Error('TEAMS_DUPLICATE_ID');
  ids.add(source.document_id);
  if(typeof d.name!=='string'||!d.name.trim()||d.name.length>160)
    throw Error('TEAMS_INVALID_NAME');
  if(!Array.isArray(d.members)||d.members.length>200)
    throw Error('TEAMS_INVALID_MEMBERS');
  // Inline data URIs are intentionally excluded from this small public
  // catalog; raw-document multipart backup retains the exact image bytes.
  const logo=typeof d.logo==='string'&&d.logo.length<=2048&&
    /^https:\/\//i.test(d.logo)?d.logo:null;
  // Owner IDs match the authoritative users collection (not Telegram IDs).
  // These values are PRIVATE and never selected by the public teams endpoint.
  const owner=d.ownerId??null,manager=d.adminUserId??null;
  if(owner!==null&&!validId(owner))throw Error('TEAMS_INVALID_OWNER_ID');
  if(manager!==null&&!validId(manager))throw Error('TEAMS_INVALID_ADMIN_ID');
  rows.push({id:source.document_id,name:d.name.trim(),
    owner_user_id:owner,admin_user_id:manager,logo_url:logo,
    member_count:d.members.length,membership_required:d.membershipRequired===true,
    updated_at:timestamp(d.updatedAt)});
 }
 return {rows:{teamsCatalog:rows},report:{
  teams:rows.length,logoEmbedsRetainedInPrivateArchive:true,
  privateRostersExcluded:true,privateTeamAdministratorsStored:true,readOnly:true,cutoverReady:false}};
}
