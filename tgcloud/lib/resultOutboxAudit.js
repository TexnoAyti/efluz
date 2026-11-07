// Read-only verification of the result-confirmation audit/inbox/outbox chain.
// Old imported confirmed fixtures may legitimately predate this mechanism;
// discrepancies are reported, never "fixed" with fabricated notifications.
const telegramValid=x=>/^[1-9][0-9]{0,19}$/.test(String(x??''));
const count=(value,field)=>{
 const n=Number(value??0);
 if(!Number.isSafeInteger(n)||n<0)throw Error('INVALID_RESULT_OUTBOX_COUNT_'+field);
 return n;
};
export async function readResultOutboxAudit(db,telegramId,input={}){
 if(!telegramValid(telegramId))throw Error('AUTH_REQUIRED');
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)
  throw Error('INVALID_RESULT_OUTBOX_AUDIT_REQUEST');
 const admin=await db.get(`SELECT is_admin AS admin,is_banned AS banned
  FROM efl_users WHERE telegram_id=:telegram`,{':telegram':String(telegramId)});
 if(!admin?.admin||admin.banned)throw Error('RESULT_OUTBOX_AUDIT_FORBIDDEN');
 const season=await db.get(`SELECT id,name FROM efl_seasons
 WHERE is_active=1 ORDER BY created_at DESC,id DESC LIMIT 1`);
 if(!season)return {ok:true,readOnly:true,season:null,
  stats:{confirmed:0,missingAudits:0,missingInbox:0,missingDeliveries:0},
  source:'telegram-serverless'};
 const stats=await db.get(`SELECT COUNT(*) AS confirmed,
  COALESCE(SUM(CASE WHEN a.id IS NULL THEN 1 ELSE 0 END),0) AS missingAudits,
  COALESCE(SUM(
   (CASE WHEN nh.id IS NULL THEN 1 ELSE 0 END)+
   (CASE WHEN na.id IS NULL THEN 1 ELSE 0 END)),0) AS missingInbox,
  COALESCE(SUM(
   (CASE WHEN dh.notification_id IS NULL THEN 1 ELSE 0 END)+
   (CASE WHEN da.notification_id IS NULL THEN 1 ELSE 0 END)),0) AS missingDeliveries
 FROM efl_fixtures f
 LEFT JOIN efl_audit_logs a ON
  a.id='result_confirmed:'||f.id AND a.action='RESULT_CONFIRMED'
 LEFT JOIN efl_notifications nh ON nh.id='fixture_confirmed:'||f.id||':home'
 LEFT JOIN efl_notifications na ON na.id='fixture_confirmed:'||f.id||':away'
 LEFT JOIN efl_notification_deliveries dh
  ON dh.notification_id=nh.id AND dh.user_id=nh.user_id
 LEFT JOIN efl_notification_deliveries da
  ON da.notification_id=na.id AND da.user_id=na.user_id
 WHERE f.season_id=:season AND f.status='CONFIRMED'`,
 {':season':season.id});
 const fields=['confirmed','missingAudits','missingInbox','missingDeliveries'];
 const safe=Object.fromEntries(fields.map(field=>[field,count(stats?.[field],field)]));
 if(safe.missingAudits>safe.confirmed||
   safe.missingInbox>safe.confirmed*2||
   safe.missingDeliveries>safe.confirmed*2)
  throw Error('RESULT_OUTBOX_AUDIT_INCONSISTENT');
 return {ok:true,readOnly:true,season:{name:String(season.name).slice(0,120)},
  stats:safe,source:'telegram-serverless',
  note:'Historical confirmed fixtures can predate notification outbox migration.'};
}
