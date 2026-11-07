import {api,db} from 'sdk';
import {handleReadOnlyCallback} from '../lib/readOnlyCallbacks.js';

export default async function(callbackQuery){
  const result=await handleReadOnlyCallback(db,callbackQuery);
  if(!result)return;
  // Answer callback promptly; read-only user data goes only to private chat.
  await api.answerCallbackQuery(result.answer);
  if(result.message)await api.sendMessage(result.message);
}
