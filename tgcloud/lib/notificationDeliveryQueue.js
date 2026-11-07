// Idempotent staging enqueue from the existing EFL notification inbox.
// No Telegram send, user-controlled recipient, or message copying occurs here.
// A delivery service must later be reviewed for SDK contracts, retries and
// ambiguous Telegram responses before dispatch is enabled.
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_:-]{1,160}$/.test(value);
const validTelegram=value=>/^[1-9][0-9]{0,19}$/.test(String(value??''));
export function validateQueueNotification(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(key=>key!=='notificationId')||
    !validId(input.notificationId))throw Error('INVALID_NOTIFICATION_QUEUE_REQUEST');
 return {notificationId:input.notificationId};
}
export async function queueNotificationDelivery(db,telegramId,input={}){
 if(!validTelegram(telegramId))throw Error('AUTH_REQUIRED');
 const {notificationId}=validateQueueNotification(input);
 const admin=await db.get(`SELECT id,is_admin AS admin,is_banned AS banned
 FROM efl_users WHERE telegram_id=:telegram`,{':telegram':String(telegramId)});
 if(!admin?.admin||admin.banned)throw Error('DELIVERY_QUEUE_FORBIDDEN');
 const params={':id':notificationId,':now':Date.now(),':telegram':String(telegramId)};
 // The insert rechecks the administrator and recipient against the DB.
 // Exactly one outbox row per existing inbox notification, even under retries.
 await db.run(`INSERT INTO efl_notification_deliveries
  (id,notification_id,user_id,status,attempts,created_at)
 SELECT n.id,n.id,n.user_id,'PENDING',0,:now
 FROM efl_notifications n JOIN efl_users recipient ON recipient.id=n.user_id
 WHERE n.id=:id AND recipient.is_banned=0
 AND recipient.telegram_id IS NOT NULL AND recipient.telegram_id<>''
 AND EXISTS(SELECT 1 FROM efl_users a WHERE a.telegram_id=:telegram
    AND a.is_admin=1 AND a.is_banned=0)
 ON CONFLICT DO NOTHING`,params);
 const saved=await db.get(`SELECT d.id,d.notification_id AS notificationId,
  d.user_id AS userId,d.status
 FROM efl_notification_deliveries d
 JOIN efl_notifications n ON n.id=d.notification_id AND n.user_id=d.user_id
 WHERE d.notification_id=:id`,{':id':notificationId});
 if(!saved)throw Error('DELIVERY_QUEUE_NOT_ELIGIBLE');
 // Do not return userId, Telegram ID or notification body to the client.
 return {ok:true,notificationId:saved.notificationId,queued:true,
   status:saved.status,source:'telegram-serverless'};
}
export async function readNotificationDeliveryAudit(db,telegramId,input={}){
 if(!validTelegram(telegramId))throw Error('AUTH_REQUIRED');
 if(!input||typeof input!=='object'||Array.isArray(input)||
   Object.keys(input).length)throw Error('INVALID_NOTIFICATION_DELIVERY_AUDIT');
 const admin=await db.get(`SELECT is_admin AS admin,is_banned AS banned
 FROM efl_users WHERE telegram_id=:telegram`,{':telegram':String(telegramId)});
 if(!admin?.admin||admin.banned)throw Error('DELIVERY_QUEUE_FORBIDDEN');
 const result=await db.get(`SELECT COUNT(*) AS total,
  COALESCE(SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END),0) AS pending,
  COALESCE(SUM(CASE WHEN status='LEASED' THEN 1 ELSE 0 END),0) AS leased,
  COALESCE(SUM(CASE WHEN status='SENT' THEN 1 ELSE 0 END),0) AS sent,
  COALESCE(SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END),0) AS failed,
  COALESCE(SUM(CASE WHEN status='REVIEW' THEN 1 ELSE 0 END),0) AS review
 FROM efl_notification_deliveries`);
 const output={};
 for(const key of ['total','pending','leased','sent','failed','review']){
  const number=Number(result?.[key]??0);
  if(!Number.isSafeInteger(number)||number<0)
   throw Error('INVALID_NOTIFICATION_DELIVERY_COUNT');
  output[key]=number;
 }
 if(output.pending+output.leased+output.sent+output.failed+output.review!==output.total)
  throw Error('NOTIFICATION_DELIVERY_STATE_INCONSISTENT');
 return {ok:true,readOnly:true,stats:output,source:'telegram-serverless',
  note:'Queue audit only. Telegram delivery remains disabled.'};
}
