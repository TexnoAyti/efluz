import { getNotificationStore } from './postgresNotificationStore';
import { createHash } from 'node:crypto';
import type { Club, Competition, Fixture } from '../../types';
import { matchdayImageModel } from '../../lib/tournamentImage';
import { tournamentImageBranding } from '../../lib/tournamentImageBranding';
import { KEY_PREFIX, ReadModelKeys, redisGetFresh, redisGetLkg } from '../readModel/readModelStore';
import { SMART_ENQUEUE_SCRIPT, persistBackupNotification } from './notificationBackupQueue';
import { scheduleNotificationQueueDrain, type NotificationQueueJob, type TelegramBroadcastRecord } from './telegramNotificationQueue';
import { PRIMARY_OWNER_TELEGRAM_ID } from './telegramAiConfigService';

// Matchday drafts are sent only to the primary owner's private chat.
export const MATCHDAY_POST_RECIPIENT = PRIMARY_OWNER_TELEGRAM_ID;
export const MATCHDAY_RULES_URL = 'https://t.me/efluz_cards/16';
export const MATCHDAY_CHANNEL_LEAGUES: Record<string, { title: string; topic: number }> = {
  'league-premier-league': { title: 'PREMIER LEAGUE', topic: 2 },
  'league-la-liga': { title: 'LA LIGA', topic: 3 },
  'league-serie-a': { title: 'SERIE A', topic: 4 },
  'league-bundesliga': { title: 'BUNDESLIGA', topic: 5 },
  'league-ligue-1': { title: 'LIGUE 1', topic: 6 },
};

export function channelMatchdayCaption(leagueId: string, matchday: number, deadlineAt: string): string {
  const league = MATCHDAY_CHANNEL_LEAGUES[leagueId];
  if (!league || !Number.isInteger(matchday) || matchday < 1 || !Number.isFinite(Date.parse(deadlineAt))) throw Error('INVALID_CHANNEL_MATCHDAY');
  const deadline = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(deadlineAt));
  return `<b>🏆 EFLUZ ${league.title} - ${matchday} tur o'yinlari ma'lum ✅</b>\n\n⚠️<b>Deadline:</b>\n<blockquote>${deadline} gacha (Toshkent)</blockquote>\n\n📋<b>Reglament:</b>\n${MATCHDAY_RULES_URL}\n\n📊<b>Natijalar bu yerga tashlanadi:</b>\nhttps://t.me/efleagueuz/${league.topic}\n\n› @efl_uz`;
}

/** Stable across reopen/restart/deadline changes; separate for each season. */
export function channelMatchdayId(competitionId: string, seasonId: string, matchday: number): string {
  return `owner-matchday-${createHash('sha256').update(JSON.stringify([competitionId, seasonId, matchday])).digest('hex').slice(0, 32)}`;
}

/** Called only after a successful matchday change, with its already loaded fixtures.
 * No Firestore reads, historical backfill or Gemini dependency. */
export async function enqueueMatchdayChannelPost(params: {
  competition: Pick<Competition, 'id' | 'seasonId' | 'leagueId' | 'name' | 'type' | 'status' | 'formatConfig'>;
  fixtures: Fixture[]; matchday: number; deadlineAt: string | null;
}): Promise<'QUEUED' | 'EXISTS' | 'SKIPPED' | 'FAILED'> {
  const { competition, matchday, deadlineAt } = params;
  if (competition.type !== 'LEAGUE' || competition.status === 'completed' || !MATCHDAY_CHANNEL_LEAGUES[competition.leagueId || '']) return 'SKIPPED';
  if (!deadlineAt || !Number.isFinite(Date.parse(deadlineAt)) || Date.parse(deadlineAt) <= Date.now()) return 'SKIPPED';
  const client = getNotificationStore();
  if (!client) return 'FAILED';
  const id = channelMatchdayId(competition.id, competition.seasonId, matchday);
  const broadcastsKey = `${KEY_PREFIX}:telegram:broadcasts`;
  // Skip expensive reads/image work when this round already has a durable event.
  if (await client.hexists(broadcastsKey, id)) return 'EXISTS';
  const clubsKey = ReadModelKeys.clubsWithOwners(competition.seasonId);
  const snapshot = await redisGetFresh<Club[]>(clubsKey) || await redisGetLkg<Club[]>(clubsKey);
  if (!Array.isArray(snapshot?.data) || !snapshot.data.length) throw Error('CHANNEL_CLUB_SNAPSHOT_UNAVAILABLE');
  const clubs = snapshot.data;
  const byId = new Map(clubs.map(club => [club.id, club]));
  const fixtures = params.fixtures.filter(f => f.competitionId === competition.id && f.seasonId === competition.seasonId && Number(f.matchday) === matchday && f.status !== 'CANCELLED').map(f => ({
    ...f, matchday: Number(f.matchday), homeClub: byId.get(f.homeClubId || '') || f.homeClub, awayClub: byId.get(f.awayClubId || '') || f.awayClub,
  }));
  if (!fixtures.length) return 'SKIPPED';
  // Do not publish an incomplete schedule with unknown club names.
  if (fixtures.some(f => !f.homeClub?.name || !f.awayClub?.name)) throw Error('CHANNEL_FIXTURE_CLUB_MISSING');
  const model = matchdayImageModel(competition.name, competition.seasonId, fixtures, matchday, 'uz', clubs);
  model.round = `${matchday}-tur`;
  model.branding = tournamentImageBranding(competition as Competition, [], clubs.filter(c => c.leagueId === competition.leagueId).length);
  const body = channelMatchdayCaption(competition.leagueId!, matchday, deadlineAt);
  const userId = `owner:${MATCHDAY_POST_RECIPIENT}`, createdAt = new Date().toISOString();
  const record: TelegramBroadcastRecord = {
    id, seasonId: competition.seasonId, title: `${competition.name} ${matchday}-tur`, body, type: 'NEW_MATCHDAY',
    targetAudience: 'SELECTED_RECIPIENTS', createdById: 'system', createdByUsername: 'system', createdAt, status: 'QUEUED', bodyIsHtml: true,
    metrics: { totalRecipients: 1, sentCount: 0, failedCount: 0, skippedCount: 0 },
    recipients: [{ userId, username: '', displayName: 'Asosiy admin', status: 'PENDING', retryCount: 0 }],
  };
  const job: NotificationQueueJob = {
    jobId: id, broadcastId: id, userId, username: '', displayName: 'Asosiy admin', telegramId: MATCHDAY_POST_RECIPIENT,
    seasonId: competition.seasonId, title: record.title, body, type: 'NEW_MATCHDAY', status: 'QUEUED', retryCount: 0, maxRetries: 3,
    createdAt, availableAt: 0, bodyIsHtml: true, photoModel: model,
  };
  const envelope = { dedupeKey: `${KEY_PREFIX}:telegram:channel:dedupe:${id}`, broadcastId: id, record: JSON.stringify(record), job: JSON.stringify(job) };
  try {
    const accepted = Number(await client.eval(SMART_ENQUEUE_SCRIPT, [envelope.dedupeKey, broadcastsKey, `${KEY_PREFIX}:telegram:queue`], [365 * 86400, id, envelope.record, envelope.job]));
    if (accepted === 0 || accepted === -1) return 'EXISTS';
    if (accepted !== 1) throw Error('CHANNEL_ENQUEUE_UNCONFIRMED');
  } catch (error) {
    if (!await persistBackupNotification(envelope)) throw error;
  }
  scheduleNotificationQueueDrain();
  return 'QUEUED';
}
