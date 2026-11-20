import {db,api,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';
import {enqueueCurrentFixtureNotices,drainNotificationQueue} from '../lib/notificationSweep.js';

// Operator-only bounded sweep. It never deletes or overwrites source data.
export default async function(input={},ctx){
  const actor=verifiedTelegramId(ctx);
  const admin=await db.get('SELECT is_admin AS isAdmin,is_banned AS isBanned FROM efl_users WHERE telegram_id=:telegram',{':telegram':actor});
  if(!admin?.isAdmin||admin.isBanned)throw new EndpointError('Faqat administrator ishlata oladi.',{code:'ADMIN_FORBIDDEN'});
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new EndpointError('Parametrlar noto‘g‘ri.',{code:'INVALID_INPUT'});
  const enqueued=await enqueueCurrentFixtureNotices(db);
  const delivered=await drainNotificationQueue(db,api,25);
  return {ok:true,source:'telegram-serverless',enqueued,delivered};
}
