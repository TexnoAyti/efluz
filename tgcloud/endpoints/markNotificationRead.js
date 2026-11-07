import {db,EndpointError} from 'sdk';
import {currentUser} from '../lib/auth.js';
import {MUTATION_CONTROL} from '../lib/mutationControl.js';

// Idempotent write scoped to the signed user. Never accept userId from client.
export default async function(input={},ctx){
  if(!MUTATION_CONTROL.enabled)
    throw new EndpointError('Sinov bazasida bildirishnomani o‘qilgan deb belgilash hali yoqilmagan.',{code:'SHADOW_WRITE_DISABLED'});
  const {user}=await currentUser(ctx);
  if(!user)throw new EndpointError('Profil topilmadi.',{code:'PROFILE_REQUIRED'});
  const id=typeof input.notificationId==='string'?input.notificationId.trim():'';
  if(!/^[a-zA-Z0-9_:\-]{1,160}$/.test(id))
    throw new EndpointError('Bildirishnoma noto‘g‘ri.',{code:'INVALID_NOTIFICATION'});
  const params={':id':id,':user':user.id};
  const before=await db.get('SELECT is_read AS isRead FROM efl_notifications WHERE id=:id AND user_id=:user',params);
  await db.run(`UPDATE efl_notifications SET is_read=1
    WHERE id=:id AND user_id=:user AND is_read=0`,params);
  const after=await db.get('SELECT is_read AS isRead FROM efl_notifications WHERE id=:id AND user_id=:user',params);
  return {ok:true,notificationId:id,read:Boolean(after?.isRead),
    wasUnread:Boolean(before&&!before.isRead),source:'telegram-serverless'};
}
