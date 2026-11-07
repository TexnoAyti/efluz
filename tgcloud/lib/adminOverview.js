// Read-only staff dashboard summary, deliberately excluding private user rows.
export async function getAdminOverview(db,telegramId){
  if(typeof telegramId!=='string'||!/^[0-9]{1,20}$/.test(telegramId))
    throw Error('AUTH_REQUIRED');
  const user=await db.get('SELECT id,is_admin,is_banned FROM efl_users WHERE telegram_id=:telegram',
    {':telegram':telegramId});
  if(!user||!user.is_admin||user.is_banned)throw Error('ADMIN_FORBIDDEN');
  const scopes={
    users:'efl_users',
    seasons:'efl_seasons',
    leagues:'efl_leagues',
    clubs:'efl_clubs',
    occupancies:'efl_club_occupancies',
    competitions:'efl_competitions',
    fixtures:'efl_fixtures',
    pendingResults:'efl_result_submissions',
    disputes:'efl_disputes',
    notifications:'efl_notifications'
  };
  // SQL identifiers originate exclusively from this static allowlist.
  const entries=await Promise.all(Object.entries(scopes).map(async ([key,table])=>{
    const where=key==='occupancies'?" WHERE status='ACTIVE'":
      key==='disputes'?" WHERE status IN ('OPEN','PENDING','UNDER_REVIEW')":
      key==='pendingResults'?'': '';
    const record=await db.get(`SELECT COUNT(*) AS count FROM ${table}${where}`);
    const count=Number(record?.count);
    if(!Number.isSafeInteger(count)||count<0)throw Error('ADMIN_OVERVIEW_UNAVAILABLE');
    return [key,count];
  }));
  return {ok:true,stats:Object.fromEntries(entries),source:'telegram-serverless',
    disclaimer:'Staging counts only; not proof of production data parity'};
}
