import {claimNotificationForWorker,finishNotificationForWorker} from './notificationDeliveryWorker.js';

const safeTelegramId=value=>/^[1-9][0-9]{0,19}$/.test(String(value??''));

// Serverless has no long-lived process here. A private Telegram update is the
// durable wake-up point: drain only that sender's already-queued notices.
// The lease protocol quarantines ambiguous sends instead of duplicating them.
export async function deliverQueuedNotificationsOnUpdate(db,api,message){
  const chat=message?.chat,from=message?.from;
  if(chat?.type!=='private'||!Number.isSafeInteger(chat.id)||
     !from||!Number.isSafeInteger(from.id)||from.id<=0||String(chat.id)!==String(from.id)||
     !safeTelegramId(from.id)) return {sent:0,reviewed:0};
  const rows=await db.all(`SELECT d.notification_id AS notificationId
    FROM efl_notification_deliveries d
    JOIN efl_notifications n ON n.id=d.notification_id AND n.user_id=d.user_id
    JOIN efl_users u ON u.id=d.user_id AND u.is_banned=0
    WHERE u.telegram_id=:telegram AND d.status='PENDING' AND d.retry_after<=:now
    ORDER BY d.created_at ASC,d.notification_id ASC LIMIT 5`,
    {':telegram':String(from.id),':now':Date.now()});
  let sent=0,reviewed=0;
  for(const row of rows){
    const now=Date.now();
    const leaseToken=`update_${String(message.message_id??message.update_id??now)}_${now}`;
    try{
      const notice=await claimNotificationForWorker(db,{notificationId:String(row.notificationId),leaseToken,now,leaseMs:120000});
      await api.sendMessage({chat_id:chat.id,text:`${notice.title}\n\n${notice.message}`.slice(0,4096)});
      await finishNotificationForWorker(db,{notificationId:notice.notificationId,leaseToken,now:Date.now(),success:true});
      sent++;
    }catch(error){
      // A failed or ambiguous send is fenced by the worker state machine.
      // Never retry from this update after a lease has been acquired.
      if(String(error?.message||'').includes('DELIVERY_ACK_CONFLICT')) reviewed++;
    }
  }
  return {sent,reviewed};
}
