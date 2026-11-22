// Telegram calls this handler for each message. Notification delivery is
// limited to already-queued notices for the signed private sender.
import {api,db} from 'sdk';
import {handleReadOnlyBotCommand} from '../lib/readOnlyBotCommands.js';
import {deliverQueuedNotificationsOnUpdate} from '../lib/notificationDeliveryOnUpdate.js';
import {fetch} from 'sdk';
import {relayOwnerPhoto} from '../lib/aiPhotoRelay.js';

export default async function(message, ctx){
  await deliverQueuedNotificationsOnUpdate(db,api,message);
  if (await relayOwnerPhoto(message, ctx?.update?.update_id, fetch, async () =>
    (await db.get("SELECT credential FROM efl_ai_photo_relay WHERE target='efluz1'"))?.credential)) return;
  const response=await handleReadOnlyBotCommand(db,message);
  if(response)await api.sendMessage(response);
}
