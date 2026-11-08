// TEAMS migration projection. Public catalog excludes private IDs and roster;
// the private members table keeps verified user links and unresolved legacy
// identities separately. Full original documents remain in the raw archive.
import {createHash} from 'node:crypto';
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
const hash=x=>createHash('sha256').update(x).digest('hex');
export function convertTeamsCatalog(records,{knownUserIds}={}){
 if(!Array.isArray(records))throw Error('TEAMS_INVALID_SOURCE');
 if(!(knownUserIds instanceof Set))throw Error('TEAMS_USER_REFERENCE_SET_REQUIRED');
 const ids=new Set(),linkedUsers=new Set(),catalog=[],members=[];
 let unresolved=0;
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
  const owner=d.ownerId??null,manager=d.adminUserId??null;
  if(owner!==null&&(!validId(owner)||!knownUserIds.has(owner)))
    throw Error('TEAMS_OWNER_REFERENCE_MISSING');
  if(manager!==null&&(!validId(manager)||!knownUserIds.has(manager)))
    throw Error('TEAMS_MANAGER_REFERENCE_MISSING');
  const seenSourceMembers=new Set(),updated=timestamp(d.updatedAt);
  let unresolvedForTeam=0;
  for(const [index,member] of d.members.entries()){
   if(!member||typeof member!=='object'||Array.isArray(member))
    throw Error('TEAMS_INVALID_MEMBER');
   const sourceMemberId=member.id??'index-'+index;
   if(!validId(sourceMemberId)||seenSourceMembers.has(sourceMemberId))
    throw Error('TEAMS_DUPLICATE_MEMBER_ID');
   seenSourceMembers.add(sourceMemberId);
   const linked=validId(member.userId)&&knownUserIds.has(member.userId);
   const userId=linked?member.userId:null;
   if(linked){
    if(linkedUsers.has(userId))throw Error('TEAMS_MULTI_TEAM_OWNER');
    linkedUsers.add(userId);
   }else{unresolvedForTeam++;unresolved++;}
   const name=typeof member.name==='string'?member.name:'';
   if(name.length>160)throw Error('TEAMS_MEMBER_NAME_TOO_LONG');
   members.push({id:hash(source.document_id+':'+sourceMemberId),
    team_id:source.document_id,source_member_id:sourceMemberId,
    user_id:userId,member_name:name,status:linked?'LINKED':'UNRESOLVED',
    created_at:updated,updated_at:updated});
  }
  // Embedded base64 logos are never exposed in public catalog listings.
  const logo=typeof d.logo==='string'&&d.logo.length<=2048&&
    /^https:\/\//i.test(d.logo)?d.logo:null;
  catalog.push({id:source.document_id,name:d.name.trim(),
   owner_user_id:owner,admin_user_id:manager,
   unresolved_member_count:unresolvedForTeam,
   logo_url:logo,member_count:d.members.length,
   membership_required:d.membershipRequired===true,updated_at:updated});
 }
 return {rows:{teamsCatalog:catalog,teamMembers:members},
  report:{teams:catalog.length,members:members.length,unresolvedMembers:unresolved,
   verifiedLinkedMembers:linkedUsers.size,logoEmbedsRetainedInPrivateArchive:true,
   privateRosterNeverExposed:true,readOnly:true,cutoverReady:false}};
}
