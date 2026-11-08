import {db,EndpointError} from 'sdk';
import {currentUser} from '../lib/auth.js';

// Private read-only inbox, derived from the Telegram-signed identity.
// No arbitrary userId accepted from the caller.
export default async function(input={},ctx) {
  const {user}=await currentUser(ctx);
  if(!user) throw new EndpointError('Profil topilmadi.',{code:'PROFILE_REQUIRED'});
  const cursor=input.cursor===undefined?0:input.cursor;
  if(!Number.isSafeInteger(cursor)||cursor<0)
    throw new EndpointError('Kursor noto‘g‘ri.',{code:'INVALID_CURSOR'});
  const limit=input.limit===undefined?30:input.limit;
  if(!Number.isSafeInteger(limit)||limit<1||limit>50)
    throw new EndpointError('Limit noto‘g‘ri.',{code:'INVALID_LIMIT'});
  const notifications=await db.all(`SELECT id,type,title,message,data,
    is_read AS isRead,created_at AS createdAt
    FROM efl_notifications WHERE user_id=:user
    ORDER BY created_at DESC,id DESC LIMIT :limit OFFSET :offset`,
    {':user':user.id,':limit':limit+1,':offset':cursor});
  return {ok:true,notifications:notifications.slice(0,limit),
    nextCursor:notifications.length>limit?cursor+limit:null,
    source:'telegram-serverless'};
}
