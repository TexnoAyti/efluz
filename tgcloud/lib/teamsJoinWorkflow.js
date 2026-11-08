// TEAMS join queue (shadow-only). Verified user identity is supplied by the
// Telegram endpoint, never by the client payload. Captain, mandatory channel,
// paid tickets and legacy team membership parity are NOT implemented yet.
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_:-]{1,160}$/.test(x);
function fields(input,names){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('INVALID_TEAMS_JOIN');
 if(Object.keys(input).some(key=>!names.includes(key)))throw Error('UNKNOWN_TEAMS_JOIN_FIELD');
}
export function validateJoinRequest(input){
 fields(input,['teamId','requestId']);
 if(!validId(input.teamId)||!validId(input.requestId))throw Error('INVALID_TEAMS_JOIN');
 return {teamId:input.teamId,requestId:input.requestId};
}
export async function submitTeamJoin(db,actor,input){
 const request=validateJoinRequest(input);
 if(!actor||!validId(actor.id)||!/^[1-9][0-9]{0,19}$/.test(String(actor.telegramId)))
  throw Error('TEAMS_AUTH_REQUIRED');
 const params={':id':request.requestId,':team':request.teamId,
  ':user':actor.id,':telegram':String(actor.telegramId),':now':Date.now()};
 const user=await db.get('SELECT id,is_banned AS banned FROM efl_users WHERE id=:user AND telegram_id=:telegram',
  {':user':actor.id,':telegram':String(actor.telegramId)});
 if(!user||user.banned)throw Error('TEAMS_JOIN_FORBIDDEN');
 const team=await db.get('SELECT id,membership_required AS membershipRequired,unresolved_member_count AS unresolvedMembers FROM efl_teams_catalog WHERE id=:team',{':team':request.teamId});
 if(!team)throw Error('TEAMS_TEAM_NOT_FOUND');
 // Mandatory-group joins cannot be verified by the current shadow endpoint.
 if(team.membershipRequired)throw Error('TEAMS_MEMBERSHIP_GATE_PENDING');
 if(team.unresolvedMembers)throw Error('TEAMS_LEGACY_MEMBERS_UNRESOLVED');
 const legacy=await db.get("SELECT id FROM efl_team_members WHERE user_id=:user AND status='LINKED'",{':user':actor.id});
 if(legacy)throw Error('TEAMS_ALREADY_MEMBER');
 const joined=await db.get("SELECT team_id FROM efl_team_join_requests WHERE user_id=:user AND status='APPROVED'",{':user':actor.id});
 if(joined)throw Error('TEAMS_ALREADY_JOINED');
 await db.run(`INSERT INTO efl_team_join_requests
 (id,team_id,user_id,telegram_id,status,created_at,updated_at)
 SELECT :id,:team,:user,:telegram,'PENDING',:now,:now
 WHERE EXISTS (SELECT 1 FROM efl_users u WHERE u.id=:user
     AND u.telegram_id=:telegram AND u.is_banned=0)
   AND EXISTS (SELECT 1 FROM efl_teams_catalog t WHERE t.id=:team AND t.membership_required=0 AND t.unresolved_member_count=0)
   AND NOT EXISTS (SELECT 1 FROM efl_team_join_requests r
     WHERE r.user_id=:user AND r.status='APPROVED')
   AND NOT EXISTS (SELECT 1 FROM efl_team_members m
     WHERE m.user_id=:user AND m.status='LINKED')
 ON CONFLICT DO NOTHING`,params);
 const saved=await db.get(`SELECT id,team_id AS teamId,user_id AS userId,
   telegram_id AS telegramId,status FROM efl_team_join_requests
   WHERE team_id=:team AND user_id=:user`,{':team':request.teamId,':user':actor.id});
 if(!saved||saved.id!==request.requestId||saved.userId!==actor.id||
   saved.telegramId!==String(actor.telegramId)||saved.status!=='PENDING')
  throw Error('TEAMS_JOIN_CONFLICT');
 return {ok:true,requestId:saved.id,teamId:saved.teamId,status:'PENDING'};
}
export async function approveTeamJoin(db,actor,input){
 fields(input,['requestId']);
 if(!validId(input.requestId))throw Error('INVALID_TEAMS_JOIN');
 if(!actor||!/^[1-9][0-9]{0,19}$/.test(String(actor.telegramId)))
  throw Error('TEAMS_AUTH_REQUIRED');
 const admin=await db.get('SELECT id,is_admin AS admin,is_banned AS banned FROM efl_users WHERE telegram_id=:telegram',
  {':telegram':String(actor.telegramId)});
 if(!admin||admin.banned)throw Error('TEAMS_ADMIN_FORBIDDEN');
 const params={':id':input.requestId,':telegram':String(actor.telegramId),':now':Date.now()};
 const pending=await db.get('SELECT id,team_id AS teamId,user_id AS userId,status FROM efl_team_join_requests WHERE id=:id',{':id':input.requestId});
 if(!pending)throw Error('TEAMS_JOIN_NOT_FOUND');
 const team=await db.get('SELECT owner_user_id AS ownerId,admin_user_id AS managerId FROM efl_teams_catalog WHERE id=:team',
   {':team':pending.teamId});
 if(!team||(!admin.admin&&team.ownerId!==admin.id&&team.managerId!==admin.id))
   throw Error('TEAMS_ADMIN_FORBIDDEN');
 if(pending.status==='APPROVED')return {ok:true,requestId:pending.id,status:'APPROVED',replayed:true};
 if(pending.status!=='PENDING')throw Error('TEAMS_JOIN_NOT_PENDING');
 // SQL rechecks the admin identity and the user's status at write time.
 // A filtered unique index on APPROVED user IDs prevents multiple TEAMS.
 await db.run(`UPDATE efl_team_join_requests SET status='APPROVED',updated_at=:now
 WHERE id=:id AND status='PENDING'
 AND EXISTS(SELECT 1 FROM efl_users admin JOIN efl_teams_catalog team
    ON team.id=efl_team_join_requests.team_id
    WHERE admin.telegram_id=:telegram AND admin.is_banned=0
    AND (admin.is_admin=1 OR team.owner_user_id=admin.id OR team.admin_user_id=admin.id))
 AND EXISTS(SELECT 1 FROM efl_users owner
    WHERE owner.id=efl_team_join_requests.user_id
      AND owner.telegram_id=efl_team_join_requests.telegram_id
      AND owner.is_banned=0)
 AND EXISTS(SELECT 1 FROM efl_teams_catalog team
    WHERE team.id=efl_team_join_requests.team_id AND team.membership_required=0 AND team.unresolved_member_count=0)
 AND NOT EXISTS(SELECT 1 FROM efl_team_join_requests other
    WHERE other.user_id=efl_team_join_requests.user_id AND other.status='APPROVED')
 AND NOT EXISTS(SELECT 1 FROM efl_team_members legacy
    WHERE legacy.user_id=efl_team_join_requests.user_id AND legacy.status='LINKED')`,params);
 const saved=await db.get('SELECT status FROM efl_team_join_requests WHERE id=:id',{':id':input.requestId});
 if(saved?.status!=='APPROVED')throw Error('TEAMS_JOIN_APPROVAL_CONFLICT');
 return {ok:true,requestId:pending.id,status:'APPROVED',replayed:false};
}

export async function rejectTeamJoin(db,actor,input){
 fields(input,['requestId']);
 if(!validId(input.requestId))throw Error('INVALID_TEAMS_JOIN');
 if(!actor||!/^[1-9][0-9]{0,19}$/.test(String(actor.telegramId)))
  throw Error('TEAMS_AUTH_REQUIRED');
 const admin=await db.get(`SELECT id,is_admin AS admin,is_banned AS banned
 FROM efl_users WHERE telegram_id=:telegram`,{':telegram':String(actor.telegramId)});
 if(!admin||admin.banned)throw Error('TEAMS_ADMIN_FORBIDDEN');
 const request=await db.get(`SELECT id,team_id AS teamId,status
 FROM efl_team_join_requests WHERE id=:id`,{':id':input.requestId});
 if(!request)throw Error('TEAMS_JOIN_NOT_FOUND');
 const team=await db.get(`SELECT owner_user_id AS ownerId,admin_user_id AS managerId
 FROM efl_teams_catalog WHERE id=:team`,{':team':request.teamId});
 if(!team||(!admin.admin&&team.ownerId!==admin.id&&team.managerId!==admin.id))
  throw Error('TEAMS_ADMIN_FORBIDDEN');
 if(request.status==='REJECTED')
  return {ok:true,requestId:request.id,status:'REJECTED',replayed:true};
 if(request.status!=='PENDING')throw Error('TEAMS_JOIN_NOT_PENDING');
 const params={':id':request.id,':telegram':String(actor.telegramId),
  ':now':Date.now()};
 // No player, roster or ticket is deleted. A rejected request cannot be
 // replayed to join a different team or override an approved membership.
 await db.run(`UPDATE efl_team_join_requests
 SET status='REJECTED',updated_at=:now WHERE id=:id AND status='PENDING'
 AND EXISTS(SELECT 1 FROM efl_users admin JOIN efl_teams_catalog team
  ON team.id=efl_team_join_requests.team_id
  WHERE admin.telegram_id=:telegram AND admin.is_banned=0
   AND (admin.is_admin=1 OR team.owner_user_id=admin.id
    OR team.admin_user_id=admin.id))`,params);
 const saved=await db.get('SELECT status FROM efl_team_join_requests WHERE id=:id',
  {':id':request.id});
 if(saved?.status!=='REJECTED')throw Error('TEAMS_JOIN_REJECTION_CONFLICT');
 return {ok:true,requestId:request.id,status:'REJECTED',replayed:false};
}
