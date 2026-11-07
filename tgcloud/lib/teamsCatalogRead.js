// Public, signed-user only TEAMS listing. Read-only: member identity, captain,
// owner, tickets and full embedded logo never appear in the response.
export async function readTeamsCatalog(db,input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))
  throw Error('INVALID_TEAMS_REQUEST');
 const limit=input.limit??40,cursor=input.cursor??0;
 if(!Number.isSafeInteger(limit)||limit<1||limit>80)throw Error('INVALID_TEAMS_LIMIT');
 if(!Number.isSafeInteger(cursor)||cursor<0||cursor>1000000)throw Error('INVALID_TEAMS_CURSOR');
 if(Object.keys(input).some(k=>!['limit','cursor'].includes(k)))
  throw Error('UNKNOWN_TEAMS_FIELD');
 const teams=await db.all(`SELECT id,name,logo_url AS logoUrl,
   member_count AS memberCount,membership_required AS membershipRequired
   FROM efl_teams_catalog ORDER BY name ASC,id ASC LIMIT :limit OFFSET :offset`,
   {':limit':limit+1,':offset':cursor});
 const more=teams.length>limit;
 return {ok:true,teams:teams.slice(0,limit),
   nextCursor:more?cursor+limit:null,source:'telegram-serverless'};
}
