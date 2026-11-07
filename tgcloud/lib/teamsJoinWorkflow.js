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
  params);
 if(!user||user.banned)throw Error('TEAMS_JOIN_FORBIDDEN');
 const team=await db.get('SELECT id,membership_required AS membershipRequired FROM efl_teams_catalog WHERE id=:team',params);
 if(!team)throw Error('TEAMS_TEAM_NOT_FOUND');
 // Mandatory-group joins cannot be verified by the current shadow endpoint.
 if(team.membershipRequired)throw Error('TEAMS_MEMBERSHIP_GATE_PENDING');
 const joined=await db.get("SELECT team_id FROM efl_team_join_requests WHERE user_id=:user AND status='APPROVED'",params);
 if(joined)throw Error('TEAMS_ALREADY_JOINED');
 await db.run(`INSERT INTO efl_team_join_requests
 (id,team_id,user_id,telegram_id,status,created_at,updated_at)
 SELECT :id,:team,:user,:telegram,'PENDING',:now,:now
 WHERE EXISTS (SELECT 1 FROM efl_users u WHERE u.id=:user
     AND u.telegram_id=:telegram AND u.is_banned=0)
   AND EXISTS (SELECT 1 FROM efl_teams_catalog t WHERE t.id=:team AND t.membership_required=0)
   AND NOT EXISTS (SELECT 1 FROM efl_team_join_requests r
     WHERE r.user_id=:user AND r.status='APPROVED')
 ON CONFLICT DO NOTHING`,params);
 const saved=await db.get(`SELECT id,team_id AS teamId,user_id AS userId,
   telegram_id AS telegramId,status FROM efl_team_join_requests
   WHERE team_id=:team AND user_id=:user`,params);
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
 if(!admin?.admin||admin.banned)throw Error('TEAMS_ADMIN_FORBIDDEN');
 const params={':id':input.requestId,':telegram':String(actor.telegramId),':now':Date.now()};
 const pending=await db.get('SELECT id,team_id AS teamId,user_id AS userId,status FROM efl_team_join_requests WHERE id=:id',params);
 if(!pending)throw Error('TEAMS_JOIN_NOT_FOUND');
 if(pending.status==='APPROVED')return {ok:true,requestId:pending.id,status:'APPROVED',replayed:true};
 if(pending.status!=='PENDING')throw Error('TEAMS_JOIN_NOT_PENDING');
 // SQL rechecks the admin identity and the user's status at write time.
 // A filtered unique index on APPROVED user IDs prevents multiple TEAMS.
 await db.run(`UPDATE efl_team_join_requests SET status='APPROVED',updated_at=:now
 WHERE id=:id AND status='PENDING'
 AND EXISTS(SELECT 1 FROM efl_users admin WHERE admin.telegram_id=:telegram
    AND admin.is_admin=1 AND admin.is_banned=0)
 AND EXISTS(SELECT 1 FROM efl_users owner
    WHERE owner.id=efl_team_join_requests.user_id
      AND owner.telegram_id=efl_team_join_requests.telegram_id
      AND owner.is_banned=0)
 AND EXISTS(SELECT 1 FROM efl_teams_catalog team
    WHERE team.id=efl_team_join_requests.team_id AND team.membership_required=0)
 AND NOT EXISTS(SELECT 1 FROM efl_team_join_requests other
    WHERE other.user_id=efl_team_join_requests.user_id AND other.status='APPROVED')`,params);
 const saved=await db.get('SELECT status FROM efl_team_join_requests WHERE id=:id',params);
 if(saved?.status!=='APPROVED')throw Error('TEAMS_JOIN_APPROVAL_CONFLICT');
 return {ok:true,requestId:pending.id,status:'APPROVED',replayed:false};
}
