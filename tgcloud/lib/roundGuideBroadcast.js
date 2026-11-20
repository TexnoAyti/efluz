import {claimNotificationForWorker,finishNotificationForWorker} from './notificationDeliveryWorker.js';

// Telegram Serverless queue uses its own database. Never transplant the old
// Supabase queue: that could send one message through two independent bots.
export const ROUND_GUIDE_ID='roundguide-s2-20261120';
export const ROUND_GUIDE_TITLE='EFLUZ 2-mavsum: o‘yin tartibi';
export const ROUND_GUIDE_BODY=[
 'MUHIM: EFLUZ 2-MAVSUM O‘YIN TARTIBI',
 '',
 '19 ta turdagi uchrashuvlar oldindan belgilangan. 1-turni hamma tugatishini kutish shart emas!',
 'Masalan, 1-tur davom etayotgan bo‘lsa ham, 5-, 10- yoki 19-turdagi raqibingiz bilan kelishib o‘ynashingiz mumkin.',
 '',
 'RAQIBGA QANDAY YOZILADI?',
 'Mini App → Ligalar → O‘z ligangiz → O‘yinlar → kerakli tur va uchrashuv → Raqibga yozish.',
 'Telegram username o‘zgargan bo‘lsa ham, EFLUZ ichidagi uchrashuv chatidan foydalaning.',
 '',
 'HISOBNI QANDAY KIRITISH KERAK?',
 '1) Mini App → O‘yinlar → o‘ynalgan uchrashuv → hisobni kiritish.',
 '2) Yoki guruhga raqiblar va natijani aniq ko‘rsatib yuboring; EFLUZ AI hisobni aniqlashga yordam beradi.',
 'Bir tomon hisobni kiritgach, ikkinchi tomon tasdiqlaydi.',
 '',
 'Faqat haqiqatda o‘ynalgan uchrashuv natijasini yuboring. Noto‘g‘ri hisobda adminga murojaat qiling.',
 '',
 'Raqibingiz tayyormi? Navbat kutmang — uchrashuvni o‘tkazing!'
].join('\n');
export const ROUND_GUIDE_BUTTON={inline_keyboard:[[
 {text:'🎮 O‘yinga kirish',url:'https://t.me/efluzbot?start=app'}
]]};

const validTelegram=x=>/^[1-9][0-9]{0,19}$/.test(String(x??''));
const safeCursor=x=>typeof x==='string'&&x.length<=160&&/^[a-zA-Z0-9:_-]*$/.test(x);
async function requireAdmin(db,actor){
 if(!validTelegram(actor))throw Error('AUTH_REQUIRED');
 const row=await db.get('SELECT is_admin AS admin,is_banned AS banned FROM efl_users WHERE telegram_id=:tg',
  {':tg':String(actor)});
 if(!row?.admin||row.banned)throw Error('ROUND_GUIDE_FORBIDDEN');
}
function args(input,maximum){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!['cursor','limit'].includes(k)))throw Error('INVALID_ROUND_GUIDE_REQUEST');
 const cursor=input.cursor??'',limit=input.limit??maximum;
 if(!safeCursor(cursor)||!Number.isSafeInteger(limit)||limit<1||limit>maximum)
   throw Error('INVALID_ROUND_GUIDE_REQUEST');
 return {cursor,limit};
}
// Paginated, admin-only, and idempotent on notification ID and delivery ID.
// Only the immutable guide is inserted. No user-supplied message/recipient.
export async function prepareRoundGuideBatch(db,actor,input={}){
 await requireAdmin(db,actor);
 const {cursor,limit}=args(input,20);
 const users=await db.all(`SELECT id FROM efl_users
   WHERE id>:cursor AND is_banned=0 AND telegram_id IS NOT NULL AND telegram_id<>''
   ORDER BY id ASC LIMIT :limit`,{':cursor':cursor,':limit':limit});
 const now=Date.now();
 for(const user of users){
  const id=ROUND_GUIDE_ID+'-'+String(user.id);
  await db.run(`INSERT INTO efl_notifications
   (id,user_id,type,title,message,data,is_read,created_at)
   VALUES (:id,:user,'COMPETITION_UPDATE',:title,:message,NULL,0,:now)
   ON CONFLICT DO NOTHING`,
   {':id':id,':user':user.id,':title':ROUND_GUIDE_TITLE,':message':ROUND_GUIDE_BODY,':now':now});
  await db.run(`INSERT INTO efl_notification_deliveries
   (id,notification_id,user_id,status,attempts,created_at)
   SELECT n.id,n.id,n.user_id,'PENDING',0,:now FROM efl_notifications n
   JOIN efl_users u ON u.id=n.user_id
   WHERE n.id=:id AND u.is_banned=0 AND u.telegram_id IS NOT NULL AND u.telegram_id<>''
   ON CONFLICT DO NOTHING`,{':id':id,':now':now});
 }
 return {ok:true,campaign:ROUND_GUIDE_ID,prepared:users.length,
  nextCursor:users.length===limit?String(users[users.length-1].id):null};
}
// Small, bounded Telegram SDK batches. Each destination has an exclusive
// lease; failed/ambiguous acknowledgements cannot trigger blind duplicates.
export async function dispatchRoundGuideBatch(db,api,actor,input={}){
 await requireAdmin(db,actor);
 const {limit}=args(input,3);
 if(limit>3)throw Error('ROUND_GUIDE_BATCH_TOO_LARGE');
 const jobs=await db.all(`SELECT d.notification_id AS notificationId
  FROM efl_notification_deliveries d
  JOIN efl_notifications n ON n.id=d.notification_id AND n.user_id=d.user_id
  JOIN efl_users u ON u.id=d.user_id AND u.is_banned=0
  WHERE d.notification_id LIKE :prefix AND d.status='PENDING'
   AND d.retry_after<=:now AND u.telegram_id IS NOT NULL AND u.telegram_id<>''
  ORDER BY d.created_at,d.notification_id LIMIT :limit`,
  {':prefix':ROUND_GUIDE_ID+'-%',':now':Date.now(),':limit':limit});
 let sent=0,review=0,failed=0;
 for(let i=0;i<jobs.length;i++){
  const id=String(jobs[i].notificationId);
  // Only prepared guide records, never other queued notifications.
  if(!id.startsWith(ROUND_GUIDE_ID+'-'))continue;
  const now=Date.now(),leaseToken='roundguide_'+now+'_'+i+'_'+id.slice(-30).replace(/[^A-Za-z0-9_-]/g,'_');
  let notice;
  try{notice=await claimNotificationForWorker(db,{notificationId:id,leaseToken,now,leaseMs:120000});}
  catch{continue;}
  try{
   const response=await api.sendMessage({chat_id:notice.telegramId,text:ROUND_GUIDE_BODY,
    reply_markup:ROUND_GUIDE_BUTTON});
   if(response?.ok===false)throw Object.assign(new Error('TELEGRAM_REJECTED'),
     {error_code:response.error_code});
   await finishNotificationForWorker(db,{notificationId:id,leaseToken,now:Date.now(),success:true});
   sent++;
  }catch(error){
   // A timeout or an unknown response might already have been accepted.
   const permanent=Number(error?.error_code)===403||Number(error?.error_code)===400;
   try{
    await finishNotificationForWorker(db,{notificationId:id,leaseToken,now:Date.now(),
     success:false,errorCode:permanent?'TELEGRAM_REJECTED':'NETWORK_UNCERTAIN'});
    if(permanent)failed++;else review++;
   }catch{review++;}
  }
 }
 return {ok:true,campaign:ROUND_GUIDE_ID,attempted:jobs.length,sent,review,failed};
}
