// Telegram calls this handler for each message. Notification delivery is
// limited to already-queued notices for the signed private sender.
import {api,db} from 'sdk';
import {handleReadOnlyBotCommand} from '../lib/readOnlyBotCommands.js';
import {deliverQueuedNotificationsOnUpdate} from '../lib/notificationDeliveryOnUpdate.js';

export default async function(message){
  await deliverQueuedNotificationsOnUpdate(db,api,message);
  const response=await handleReadOnlyBotCommand(db,message);
  if(response)await api.sendMessage(response);
}
