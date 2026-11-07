// The only TEAMS application queries are the signed user's queue and
// a narrow pending queue for the verified team owner, manager or administrator.
export async function readTeamJoinQueue(db,telegramId,input={}){
 if(!/^[1-9][0-9]{0,19}$/.test(String(telegramId??'')))throw Error('TEAMS_AUTH_REQUIRED');
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('INVALID_TEAMS_QUEUE');
 if(Object.keys(input).some(k=>!['scope','limit','cursor'].includes(k)))
   throw Error('UNKNOWN_TEAMS_QUEUE_FIELD');
 const scope=input.scope??'mine';
 if(!['mine','admin'].includes(scope))throw Error('INVALID_TEAMS_SCOPE');
 const limit=input.limit??25,cursor=input.cursor??0;
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('INVALID_TEAMS_LIMIT');
 if(!Number.isSafeInteger(cursor)||cursor<0||cursor>1000000)throw Error('INVALID_TEAMS_CURSOR');
 const user=await db.get('SELECT id,is_admin AS admin,is_banned AS banned FROM efl_users WHERE telegram_id=:telegram',
  {':telegram':String(telegramId)});
 if(!user||user.banned)throw Error('TEAMS_QUEUE_FORBIDDEN');
 if(scope==='admin'&&!user.admin){
  const manages=await db.get('SELECT id FROM efl_teams_catalog WHERE owner_user_id=:user OR admin_user_id=:user LIMIT 1',
    {':user':user.id});
  if(!manages)throw Error('TEAMS_ADMIN_FORBIDDEN');
 }
 const extra=scope==='admin'
  ?"WHERE r.status='PENDING' AND (:globalAdmin=1 OR t.owner_user_id=:user OR t.admin_user_id=:user)"
  :"WHERE r.user_id=:user";
 const params={':limit':limit+1,':offset':cursor,':user':user.id};
 if(scope==='admin')params[':globalAdmin']=user.admin?1:0;
 const rows=await db.all(`SELECT r.id AS requestId,r.team_id AS teamId,
   t.name AS teamName,r.status,r.created_at AS createdAt
   ${scope==='admin'?',r.user_id AS userId':''}
   FROM efl_team_join_requests r JOIN efl_teams_catalog t ON t.id=r.team_id
   ${extra} ORDER BY r.created_at DESC,r.id ASC LIMIT :limit OFFSET :offset`,params);
 return {ok:true,scope,requests:rows.slice(0,limit),
  nextCursor:rows.length>limit?cursor+limit:null,source:'telegram-serverless'};
}
