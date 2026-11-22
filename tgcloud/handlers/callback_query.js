import {api,db,fetch} from 'sdk';
import {relayForum} from '../lib/aiForumRelay.js';
import {handleReadOnlyCallback} from '../lib/readOnlyCallbacks.js';

export default async function(callbackQuery,ctx){
  if (await relayForum('callback_query', callbackQuery, ctx?.update?.update_id, db, fetch)) return;
  const result=await handleReadOnlyCallback(db,callbackQuery);
  if(!result)return;
  // Answer callback promptly; read-only user data goes only to private chat.
  await api.answerCallbackQuery(result.answer);
  if(result.message)await api.sendMessage(result.message);
}
