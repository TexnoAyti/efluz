import {db,EndpointError} from 'sdk';
import {currentUser} from '../lib/auth.js';

// Idempotent write scoped to the signed user. Never accept userId from client.
export default async function(input={},ctx){
  const {user}=await currentUser(ctx);
  if(!user)throw new EndpointError('Profil topilmadi.',{code:'PROFILE_REQUIRED'});
  const id=typeof input.notificationId==='string'?input.notificationId.trim():'';
  if(!/^[a-zA-Z0-9_:\-]{1,160}$/.test(id))
    throw new EndpointError('Bildirishnoma noto‘g‘ri.',{code:'INVALID_NOTIFICATION'});
  const result=await db.run(`UPDATE efl_notifications SET is_read=1
    WHERE id=:id AND user_id=:user AND is_read=0`,
    {':id':id,':user':user.id});
  return {ok:true,notificationId:id,changed:Boolean(result?.rowsAffected),source:'telegram-serverless'};
}
