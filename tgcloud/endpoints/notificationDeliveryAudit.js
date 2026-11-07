import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {readNotificationDeliveryAudit} from '../lib/notificationDeliveryQueue.js';

// Admin-only aggregate diagnostics; no destination identities or message text.
export default async function(input={},ctx){
 const actor=verifiedTelegramId(ctx);
 try{return await readNotificationDeliveryAudit(db,actor,input);}
 catch(error){
  const code=String(error?.message||'NOTIFICATION_DELIVERY_AUDIT_UNAVAILABLE');
  if(code==='DELIVERY_QUEUE_FORBIDDEN'||code.startsWith('INVALID_NOTIFICATION_')||
     code==='NOTIFICATION_DELIVERY_STATE_INCONSISTENT')
   throw new EndpointError('Bildirishnomalar auditi mavjud emas.',{code});
  throw error;
 }
}
