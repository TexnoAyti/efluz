import {db,EndpointError} from 'sdk';
import {currentUser} from '../lib/auth.js';
import {NOTIFICATION_READ_CONTROL} from '../lib/notificationReadControl.js';

// Idempotent write scoped to the signed user. Never accept userId from client.
export default async function(input={},ctx){
  if(!NOTIFICATION_READ_CONTROL.enabled)
    throw new EndpointError('Sinov bazasida bildirishnomani o‘qilgan deb belgilash hali yoqilmagan.',{code:'SHADOW_WRITE_DISABLED'});
  const {user}=await currentUser(ctx);
  if(!user)throw new EndpointError('Profil topilmadi.',{code:'PROFILE_REQUIRED'});
  const hasId=typeof input.notificationId==='string'&&input.notificationId.trim()!=='';
  if(Object.keys(input).some(key=>key!=='notificationId')||
     (hasId&&!/^[a-zA-Z0-9_:\-]{1,160}$/.test(input.notificationId.trim())))
    throw new EndpointError('Bildirishnoma noto‘g‘ri.',{code:'INVALID_NOTIFICATION'});
  if(hasId){
    const id=input.notificationId.trim();
    const params={':id':id,':user':user.id};
    const before=await db.get('SELECT is_read AS isRead FROM efl_notifications WHERE id=:id AND user_id=:user',params);
    await db.run(`UPDATE efl_notifications SET is_read=1
      WHERE id=:id AND user_id=:user AND is_read=0`,params);
    const after=await db.get('SELECT is_read AS isRead FROM efl_notifications WHERE id=:id AND user_id=:user',params);
    return {ok:true,notificationId:id,read:Boolean(after?.isRead),
      wasUnread:Boolean(before&&!before.isRead),source:'telegram-serverless'};
  }
  const before=await db.get('SELECT COUNT(*) AS unread FROM efl_notifications WHERE user_id=:user AND is_read=0', {':user':user.id});
  await db.run('UPDATE efl_notifications SET is_read=1 WHERE user_id=:user AND is_read=0', {':user':user.id});
  return {ok:true,markedCount:Number(before?.unread||0),source:'telegram-serverless'};
}
