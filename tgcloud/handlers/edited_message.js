import {db,fetch} from 'sdk';
import {relayForum} from '../lib/aiForumRelay.js';

export default async function(message,ctx) {
  await relayForum('edited_message',message,ctx?.update?.update_id,db,fetch);
}
