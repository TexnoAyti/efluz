// Signed TEAMS roster view. Public catalog never exposes private member names
// or legacy IDs. Only a linked member, approved joiner, owner or manager can
// view a team roster; unresolved identities are visible to staff only.
const idOk=x=>typeof x==='string'&&/^[A-Za-z0-9_:-]{1,160}$/.test(x);
export async function readPrivateTeamRoster(db,telegramId,input={}){
 if(!/^[1-9][0-9]{0,19}$/.test(String(telegramId??'')))
  throw Error('TEAMS_AUTH_REQUIRED');
 if(!input||typeof input!=='object'||Array.isArray(input)||!idOk(input.teamId))
  throw Error('INVALID_TEAMS_ROSTER');
 if(Object.keys(input).some(k=>!['teamId','limit','cursor'].includes(k)))
  throw Error('UNKNOWN_TEAMS_ROSTER_FIELD');
 const limit=input.limit??50,cursor=input.cursor??0;
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('INVALID_TEAMS_LIMIT');
 if(!Number.isSafeInteger(cursor)||cursor<0||cursor>1000000)throw Error('INVALID_TEAMS_CURSOR');
 const user=await db.get('SELECT id,is_admin AS admin,is_banned AS banned FROM efl_users WHERE telegram_id=:telegram',
  {':telegram':String(telegramId)});
 if(!user||user.banned)throw Error('TEAMS_ROSTER_FORBIDDEN');
 const team=await db.get('SELECT id,name,owner_user_id AS ownerId,admin_user_id AS managerId,unresolved_member_count AS unresolvedCount FROM efl_teams_catalog WHERE id=:team',
  {':team':input.teamId});
 if(!team)throw Error('TEAMS_TEAM_NOT_FOUND');
 const privileged=Boolean(user.admin)||team.ownerId===user.id||team.managerId===user.id;
 if(!privileged){
  const member=await db.get("SELECT id FROM efl_team_members WHERE team_id=:team AND user_id=:user AND status='LINKED'",
   {':team':input.teamId,':user':user.id});
  const approved=await db.get("SELECT id FROM efl_team_join_requests WHERE team_id=:team AND user_id=:user AND status='APPROVED'",
   {':team':input.teamId,':user':user.id});
  if(!member&&!approved)throw Error('TEAMS_ROSTER_FORBIDDEN');
 }
 const params={':team':input.teamId,':limit':limit+1,':offset':cursor};
 if(!privileged)params[':linked']='LINKED';
 const where=privileged?'':' AND status=:linked';
 const rows=await db.all(`SELECT member_name AS name,status FROM efl_team_members
   WHERE team_id=:team${where} ORDER BY status ASC,id ASC LIMIT :limit OFFSET :offset`,params);
 return {ok:true,teamId:team.id,teamName:team.name,
  members:rows.slice(0,limit),nextCursor:rows.length>limit?cursor+limit:null,
  ...(privileged?{unresolvedMembers:team.unresolvedCount}:{}),
  source:'telegram-serverless'};
}
