// Internal Telegram delivery worker lease protocol (NOT a public endpoint).
// This does not call Telegram; an authenticated isolated worker must own the
// API token and handle at-least-once delivery after SDK integration tests.
// Telegram sendMessage has no general idempotency key: ambiguous responses
// may require reconciliation and must not be called exactly-once here.
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_:-]{1,160}$/.test(x);
const validToken=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(x);
function validArgs(input,finish=false){
 if(!input||typeof input!=='object'||Array.isArray(input)||
  Object.keys(input).some(k=>!['notificationId','leaseToken','now','leaseMs','success','errorCode'].includes(k))||
  !validId(input.notificationId)||!validToken(input.leaseToken)||
  !Number.isSafeInteger(input.now)||input.now<1)throw Error('INVALID_DELIVERY_LEASE');
 if(finish){
  if(Object.hasOwn(input,'leaseMs')||typeof input.success!=='boolean'||
   (!input.success&&(!validId(input.errorCode)||input.errorCode.length>80))||
   (input.success&&input.errorCode!==undefined))
   throw Error('INVALID_DELIVERY_ACK');
 }else{
  if(input.success!==undefined||input.errorCode!==undefined||
   !Number.isSafeInteger(input.leaseMs)||input.leaseMs<10000||
   input.leaseMs>300000)throw Error('INVALID_DELIVERY_LEASE');
 }
 return input;
}
export async function claimNotificationForWorker(db,input){
 const {notificationId,leaseToken,now,leaseMs}=validArgs(input);
 const params={':id':notificationId,':token':leaseToken,':now':now,
  ':until':now+leaseMs};
 if(!Number.isSafeInteger(params[':until']))throw Error('INVALID_DELIVERY_LEASE');
 await db.run(`UPDATE efl_notification_deliveries
 SET status='LEASED',lease_token=:token,lease_until=:until,
     attempts=attempts+1
 WHERE notification_id=:id AND attempts<5 AND
 ((status='PENDING' AND retry_after<=:now) OR
  (status='LEASED' AND lease_until<:now))
 AND EXISTS(SELECT 1 FROM efl_notifications n
   JOIN efl_users u ON u.id=n.user_id
   WHERE n.id=efl_notification_deliveries.notification_id
    AND n.user_id=efl_notification_deliveries.user_id
    AND u.is_banned=0 AND u.telegram_id IS NOT NULL
    AND u.telegram_id<>'')`,params);
 // The content and Telegram destination never leave this internal boundary.
 const row=await db.get(`SELECT d.notification_id AS notificationId,
 d.attempts,d.lease_until AS leaseUntil,
 u.telegram_id AS telegramId,n.title,n.message
 FROM efl_notification_deliveries d
 JOIN efl_notifications n ON n.id=d.notification_id AND n.user_id=d.user_id
 JOIN efl_users u ON u.id=d.user_id AND u.is_banned=0
 WHERE d.notification_id=:id AND d.status='LEASED'
  AND d.lease_token=:token AND d.lease_until=:until`,
  {':id':notificationId,':token':leaseToken,':until':params[':until']});
 if(!row)throw Error('DELIVERY_NOT_CLAIMED');
 return {notificationId:row.notificationId,leaseToken,attempt:row.attempts,
  leaseUntil:row.leaseUntil,telegramId:String(row.telegramId),
  title:String(row.title??'').slice(0,256),
  message:String(row.message??'').slice(0,3500)};
}
export async function finishNotificationForWorker(db,input){
 const {notificationId,leaseToken,now,success,errorCode}=validArgs(input,true);
 const params={':id':notificationId,':token':leaseToken,':now':now,
  ':success':success?1:0,':error':success?null:errorCode};
 await db.run(`UPDATE efl_notification_deliveries
 SET status=CASE WHEN :success=1 THEN 'SENT'
   WHEN :error IN ('TELEGRAM_TIMEOUT','NETWORK_UNCERTAIN') THEN 'REVIEW'
   WHEN attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,
  sent_at=CASE WHEN :success=1 THEN :now ELSE sent_at END,
  retry_after=CASE WHEN :success=1 THEN 0 ELSE :now+attempts*60000 END,
  last_error=:error,lease_token=NULL,lease_until=NULL
 WHERE notification_id=:id AND lease_token=:token AND status='LEASED'
  AND lease_until>=:now`,params);
 const row=await db.get(`SELECT status,lease_token AS leaseToken,
  attempts,sent_at AS sentAt,last_error AS lastError
 FROM efl_notification_deliveries WHERE notification_id=:id`,{':id':notificationId});
 if(!row||row.leaseToken!==null||
    row.status!==(success?'SENT':
      ['TELEGRAM_TIMEOUT','NETWORK_UNCERTAIN'].includes(errorCode)?'REVIEW':
       row.attempts>=5?'FAILED':'PENDING')||
    (success?row.sentAt!==now:row.lastError!==errorCode))
  throw Error('DELIVERY_ACK_CONFLICT');
 return {ok:true,notificationId,status:row.status,attempts:row.attempts};
}
