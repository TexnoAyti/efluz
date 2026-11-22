// Copied into an isolated CLI project only for tgcloud run.
import {relayForum} from '../lib/aiForumRelay.js';
import {relayOwnerPhoto} from '../lib/aiPhotoRelay.js';

export default async function () {
  const group = {chat:{type:'supergroup', username:'efleagueuz', id:-11},
    from:{id:10}, message_id:5, message_thread_id:11429, text:'A 1-0 B'};
  const db = {get:async () => ({credential:'test-only'})};
  let calls = 0;
  const receive = async (_url, options) => {
    const update = JSON.parse(options.body);
    if (update.update_id !== 20 || update.message.message_thread_id !== 11429) throw Error('UPDATE_MISMATCH');
    calls++;
    return {ok:true};
  };
  if (!await relayForum('message',group,20,db,receive)) throw Error('UEL_ROUTE_MISSING');
  if (await relayForum('message',{...group,text:'/start'},21,db,receive)) throw Error('START_ROUTED');
  if (await relayOwnerPhoto(group,20,receive,async () => '')) throw Error('GROUP_AS_OWNER');
  if (calls !== 1) throw Error('CALL_COUNT');
  return {probe:'EFL_AI_STAGING_ROUTE_OK'};
}
