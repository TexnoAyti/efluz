import { createHash } from 'node:crypto';
import { EFL_SECOND_SEASON } from '../../lib/seasonPreparation';
import { S2_OPENS_AT, S2_PUBLIC_AT } from '../../lib/seasonTwoAdmissionWindow';
import { seasonLeagues } from './seasonCatalog';
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
  await syncRecipientDirectory(SEASON_ID);
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

/** Cron trigger at 20:30 and 20:45 Asia/Tashkent; safely retryable. */
export async function announceDueSeasonTwoMilestones(now = Date.now()): Promise<string> {
  if (now < openTime) return 'NOT_DUE';
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
