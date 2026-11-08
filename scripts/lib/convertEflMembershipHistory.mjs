// Historical memberships are an audit record, NOT active occupancy grants.
// Source contains released membership rows and orphaned historic user/club IDs.
// All source keys are retained; unresolvable rows are explicitly marked.
const valid=x=>typeof x==='string'&&x.length>0&&x.length<=160;
const time=x=>{
 if(x==null)return null;
 if(typeof x!=='string')throw Error('INVALID_MEMBERSHIP_TIME');
 const ms=Date.parse(x);
 if(!Number.isSafeInteger(ms)||ms<0)throw Error('INVALID_MEMBERSHIP_TIME');
 return ms;
};
function docs(collections,name){
 const rows=collections[name]??[],out=new Map();
 if(!Array.isArray(rows))throw Error('INVALID_MEMBERSHIP_COLLECTION');
 for(const doc of rows){
  if(!doc||!valid(doc.document_id)||!doc.data||
   typeof doc.data!=='object'||Array.isArray(doc.data)||
   out.has(doc.document_id))throw Error('INVALID_MEMBERSHIP_DOCUMENT');
  out.set(doc.document_id,doc.data);
 }
 return out;
}
export function convertEflMembershipHistory(collections){
 const users=docs(collections,'users'),clubs=docs(collections,'clubs');
 const seasons=docs(collections,'seasons');
 const output={clubMembershipHistory:[],userMembershipHistory:[]};
 const report={clubMembershipHistory:0,userMembershipHistory:0,
  unlinkedUsers:0,unlinkedClubs:0,ownershipGranted:false,cutoverReady:false};
 for(const [root,table] of [['club_memberships','clubMembershipHistory'],
                             ['user_memberships','userMembershipHistory']]){
  const rows=docs(collections,root);
  for(const [key,d] of rows){
   if(!valid(d.userId)||!valid(d.clubId)||!valid(d.seasonId)||
    !seasons.has(d.seasonId)||!['active','released'].includes(d.status))
    throw Error('INVALID_MEMBERSHIP_SOURCE');
   const userFound=users.has(d.userId),clubFound=clubs.has(d.clubId);
   if(!userFound)report.unlinkedUsers++;
   if(!clubFound)report.unlinkedClubs++;
   const status=userFound&&clubFound?'RESOLVED':'UNRESOLVED';
   output[table].push({
    id:key,source_id:typeof d.id==='string'?d.id:null,
    user_id:d.userId,club_id:'s'+d.seasonId.length+':'+d.seasonId+':'+d.clubId,
    season_id:d.seasonId,source_status:d.status,reference_status:status,
    claimed_at:time(d.claimedAt),updated_at:time(d.updatedAt),
    released_at:time(d.releasedAt),source_record:d
   });
  }
  report[table]=output[table].length;
 }
 return {rows:output,report};
}
