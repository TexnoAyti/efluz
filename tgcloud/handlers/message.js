// Telegram calls this handler for each message. Staging is explicitly
// read-only: unrecognized updates are ignored, never forwarded or mutated.
import {api,db} from 'sdk';
import {handleReadOnlyBotCommand} from '../lib/readOnlyBotCommands.js';

export default async function(message){
  const response=await handleReadOnlyBotCommand(db,message);
  if(response)await api.sendMessage(response);
}
