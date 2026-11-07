import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {MUTATION_CONTROL} from '../lib/mutationControl.js';
import {queueNotificationDelivery} from '../lib/notificationDeliveryQueue.js';

// Staging-only queue insert. No outbound Telegram API call is made.
export default async function(input={},ctx){
 if(!MUTATION_CONTROL.enabled)
  throw new EndpointError('Bildirishnomalarni yuborish navbati hali o‘chirilgan.',
   {code:'SHADOW_WRITE_DISABLED'});
 const actor=verifiedTelegramId(ctx);
 try{return await queueNotificationDelivery(db,actor,input);}
 catch(error){
  const code=String(error?.message||'NOTIFICATION_QUEUE_FAILED');
  if(code==='DELIVERY_QUEUE_FORBIDDEN'||code==='DELIVERY_QUEUE_NOT_ELIGIBLE'||
      code==='INVALID_NOTIFICATION_QUEUE_REQUEST')
   throw new EndpointError('Bildirishnomani navbatga qo‘shib bo‘lmadi.',{code});
  throw error;
 }
}
