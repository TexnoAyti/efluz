import { createHash } from 'node:crypto';
import { EFL_SECOND_SEASON } from '../../lib/seasonPreparation';
import { S2_OPENS_AT, S2_PUBLIC_AT } from '../../lib/seasonTwoAdmissionWindow';
import { seasonLeagues } from './seasonCatalog';
import { getFirestoreDb } from '../firebase/admin';
import { sendTelegramMessage } from './telegramBotService';
import { enqueueTelegramBroadcast, getBroadcastDetails, syncRecipientDirectory } from './telegramNotificationQueue';

const SEASON_ID = EFL_SECOND_SEASON.id;
const SYSTEM_ID = 'system:season2-announcements';
const OWNER = 'EFLUZ';
const openTime = Date.parse(S2_OPENS_AT);
const publicTime = Date.parse(S2_PUBLIC_AT);

type Announcement = { eventId: string; title: string; body: string };

/**
 * The existing durable Telegram queue publishes BOTH bot-chat messages and
 * in-app notifications to every registered account. Telegram itself can only
 * deliver DMs to users who have started the bot and have not blocked it.
 * A stable request ID makes cron retries / concurrent visitors idempotent.
 */
async function queueAnnouncement(item: Announcement): Promise<boolean> {
  if (process.env.VERCEL_ENV !== 'production' || process.env.DATABASE_PROVIDER !== 'supabase') return false;
  const broadcastId = 'bcast-' + createHash('sha256').update(SYSTEM_ID + ':' + item.eventId).digest('hex');
  if (await getBroadcastDetails(broadcastId)) return false;
  // All registered users, NOT just existing club owners and NOT just the
  // active league. Recipient IDs remain private inside the delivery worker.
  // The approved round-guide uses the already persisted recipient directory.
  // Refreshing 400+ users in a serverless request can hit the Postgres RPC
  // statement timeout before any broadcast job is enqueued.
  if (item.eventId !== ROUND_GUIDE_EVENT) await syncRecipientDirectory(SEASON_ID);
  await enqueueTelegramBroadcast({
    adminUserId: SYSTEM_ID,
    adminUsername: OWNER,
    seasonId: SEASON_ID,
    title: item.title,
    body: item.body,
    type: 'COMPETITION_UPDATE',
    targetAudience: 'ALL_USERS',
    requestId: item.eventId,
  });
  return true;
}

/**
 * One approved, immutable Season 2 help announcement. The existing public
 * status poll wakes this background job; no user-supplied text can be sent.
 * Both delivery paths use a durable, deterministic one-time identifier.
 */
const ROUND_GUIDE_EVENT = 'season2-any-round-guide-telegram-link-fix-20261120';
const ROUND_GUIDE_TITLE = 'EFLUZ 2-mavsum: to‘g‘ri o‘yin tartibi (yangilangan)';
const ROUND_GUIDE_BODY = [
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
  'Raqibingiz tayyormi? Navbat kutmang — uchrashuvni o‘tkazing!',
  'Mini App’ni ochish: Telegramdagi EFLUZ botiga kiring va «Ilovani ochish» tugmasini bosing.',
  'O‘yinga kirish 👉 @efluzbot',
].join('\n');

export async function announceSeasonTwoRoundGuide(): Promise<{broadcast:string;channel:string}> {
  if (process.env.VERCEL_ENV !== 'production' || process.env.DATABASE_PROVIDER !== 'supabase')
    return {broadcast:'NOT_PRODUCTION',channel:'NOT_PRODUCTION'};

  // A single broadcast ID prevents duplicated personal and in-app messages.
  let broadcast = 'ALREADY_QUEUED';
  try {
    const queued = await queueAnnouncement({
      eventId: ROUND_GUIDE_EVENT, title: ROUND_GUIDE_TITLE, body: ROUND_GUIDE_BODY,
    });
    broadcast = queued ? 'QUEUED' : 'ALREADY_QUEUED';
  } catch (error:any) {
    broadcast = 'QUEUE_ERROR';
    console.warn('[SEASON2_ROUND_GUIDE_BROADCAST]', String(error?.message||error));
  }

  // Channel delivery is separate and deliberately fail-closed on uncertain
  // Telegram outcomes, to avoid accidentally posting the guide twice.
  let channel = 'ALREADY_ATTEMPTED';
  const ref = getFirestoreDb().collection('runtime_settings').doc('channel-post-' + ROUND_GUIDE_EVENT);
  try {
    await ref.create({eventId:ROUND_GUIDE_EVENT, state:'SENDING',createdAt:new Date().toISOString()});
    const message = '<b>'+ROUND_GUIDE_TITLE+'</b>\n\n'+ROUND_GUIDE_BODY.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const result = await sendTelegramMessage('@efl_uz',message,{parse_mode:'HTML'});
    channel = result.ok ? 'SENT' : 'FAILED';
    await ref.set({state:channel,telegramMessageId:result.ok?result.result?.message_id:null,
      updatedAt:new Date().toISOString(),error:result.ok?null:String(result.error||'UNKNOWN').slice(0,240)},{merge:true});
  } catch (error:any) {
    if (!/already exists|already_exists|ALREADY_EXISTS|6:/.test(String(error?.message||error))) {
      channel = 'ERROR';
      console.warn('[SEASON2_ROUND_GUIDE_CHANNEL]',String(error?.message||error));
    }
  }
  console.info('[SEASON2_ROUND_GUIDE_RESULT]',{broadcast,channel});
  return {broadcast,channel};
}

/** Correct existing channel message 1048 in place; do not repost to everyone. */
async function updateSeasonTwoGuideBotLinkInChannel(): Promise<void> {
  if (process.env.VERCEL_ENV !== 'production' || process.env.DATABASE_PROVIDER !== 'supabase') return;
  const db=getFirestoreDb();
  const original=await db.collection('runtime_settings').doc('channel-post-'+ROUND_GUIDE_EVENT).get();
  if (original.data()?.state!=='SENT' || !Number.isInteger(Number(original.data()?.telegramMessageId))) return;
  const edit= db.collection('runtime_settings').doc('channel-post-round-guide-bot-handle-edit-20261120');
  try {
    await edit.create({state:'ATTEMPTED',updatedAt:new Date().toISOString()});
  } catch(error:any) {
    if (/already exists|already_exists|ALREADY_EXISTS|6:/.test(String(error?.message||error))) return;
    throw error;
  }
  const token=process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    await edit.set({state:'FAILED',error:'BOT_TOKEN_UNAVAILABLE'}, {merge:true});
    return;
  }
  const plain=ROUND_GUIDE_BODY.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const message='<b>'+ROUND_GUIDE_TITLE+'</b>\\n\\n'+plain;
  try {
    const response=await fetch('https://api.telegram.org/bot'+token+'/editMessageText',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:'@efl_uz',message_id:Number(original.data()!.telegramMessageId),
        text:message,parse_mode:'HTML'}),signal:AbortSignal.timeout(9000),
    });
    const data:any=await response.json();
    await edit.set({state:data.ok?'SENT':'FAILED',error:data.ok?null:String(data.description||'REJECTED').slice(0,180),
      updatedAt:new Date().toISOString()}, {merge:true});
    console.info('[SEASON2_GUIDE_BOT_HANDLE_EDIT]', {ok:Boolean(data.ok)});
  } catch(error:any) {
    await edit.set({state:'UNCERTAIN',error:String(error?.message||error).slice(0,180),
      updatedAt:new Date().toISOString()}, {merge:true});
  }
}

/** Cron trigger at 20:30 and 20:45 Asia/Tashkent; safely retryable. */
export async function announceDueSeasonTwoMilestones(now = Date.now()): Promise<string> {
  if (now < openTime) return 'NOT_DUE';
  // One-shot explanation requested for every bot user and @efl_uz.
  await announceSeasonTwoRoundGuide();
  await updateSeasonTwoGuideBotLinkInChannel();
  if (now < publicTime) {
    const queued = await queueAnnouncement({
      eventId: 'season2-priority-20261106',
      title: 'EFL 2-mavsum: ustuvor qabul boshlandi',
      body: '20:30–20:45: 1-mavsum klub egalari o‘z klubini saqlashi yoki bo‘shatishi mumkin.\n20:45 dan barcha o‘yinchilar uchun umumiy klub qabuli ochiladi.\n\nEFLUZ: https://efluz.vercel.app',
    });
    return queued ? 'PRIORITY_QUEUED' : 'PRIORITY_ALREADY_QUEUED';
  }
  const queued = await queueAnnouncement({
    eventId: 'season2-public-20261106',
    title: 'EFL 2-mavsum: klub qabuli ochildi!',
    body: '20:45 dan barcha o‘yinchilar uchun 2-mavsum klublarini tanlash ochildi.\nBarcha 9 liga navigatsiyada ko‘rinadi. Qabul APLdan boshlanadi, keyingi ligalar navbat bilan ochiladi.\n\nEFLUZ: https://efluz.vercel.app',
  });
  return queued ? 'PUBLIC_QUEUED' : 'PUBLIC_ALREADY_QUEUED';
}

/** Notify everyone when automatic admission has advanced to another league. */
export async function announceSeasonTwoLeagueAdvance(seasonId: string, stage: unknown): Promise<void> {
  if (seasonId !== SEASON_ID || Date.now() < publicTime) return;
  if (!Number.isInteger(stage) || Number(stage) < 1) return;
  const leagues = seasonLeagues(SEASON_ID);
  const index = Number(stage);
  const current = leagues[index];
  const item: Announcement = current
    ? {
        eventId: `season2-league-stage-${index}-20261106`,
        title: `EFL 2-mavsum: ${current.name} qabuli ochildi`,
        body: `${current.name} ligasidan bo‘sh klubni tanlashingiz mumkin. Boshqa ligalar navigatsiyada ko‘rinib turadi, qabul navbat bilan davom etadi.\n\nEFLUZ: https://efluz.vercel.app`,
      }
    : {
        eventId: 'season2-leagues-complete-20261106',
        title: 'EFL 2-mavsum: klub qabuli yakunlandi',
        body: '2-mavsum ligalaridagi klublar qabuli yakunlandi. Keyingi e’lonlarni EFLUZ saytida kuzating.\n\nEFLUZ: https://efluz.vercel.app',
      };
  await queueAnnouncement(item);
}
