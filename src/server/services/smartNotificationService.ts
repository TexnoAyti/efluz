import crypto from 'crypto';
import { Fixture } from '../../types';
import {
  getUpstashClient,
  KEY_PREFIX,
  ReadModelKeys,
  redisGetFresh,
  redisGetLkg,
} from '../readModel/readModelStore';
import { scheduleNotificationQueueDrain } from './telegramNotificationQueue';
import { isSmartNotificationEventEnabled, SmartNotificationEvent } from './smartNotificationSettingsService';

interface RecipientDirectoryEntry {
  userId: string;
  username: string;
  displayName: string;
  telegramId: string | number | null;
  clubId?: string;
  messageable: boolean;
}

interface SmartRecipientStatus {
  userId: string;
  username: string;
  displayName: string;
  status: 'PENDING';
  retryCount: number;
}

interface SmartBroadcastRecord {
  id: string;
  seasonId: string;
  title: string;
  body: string;
  type: 'CUSTOM_ALERT';
  targetAudience: 'SELECTED_RECIPIENTS';
  createdById: string;
  createdByUsername: string;
  createdAt: string;
  status: 'QUEUED';
  metrics: { totalRecipients: number; sentCount: number; failedCount: number; skippedCount: number };
  recipients: SmartRecipientStatus[];
  bodyIsHtml?: boolean;
  replyMarkup?: any;
}

interface SmartQueueJob {
  jobId: string;
  broadcastId: string;
  userId: string;
  username: string;
  displayName: string;
  telegramId: string | number;
  title: string;
  body: string;
  type: 'CUSTOM_ALERT';
  status: 'QUEUED';
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  availableAt: number;
  bodyIsHtml?: boolean;
  replyMarkup?: any;
}

const BROADCASTS_KEY = `${KEY_PREFIX}:telegram:broadcasts`;
const QUEUE_KEY = `${KEY_PREFIX}:telegram:queue`;
const RECIPIENT_DIR_KEY = `${KEY_PREFIX}:private:recipient-directory`;
const SMART_DEDUPE_PREFIX = `${KEY_PREFIX}:telegram:smart:dedupe`;
const SMART_DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;
const APP_URL = process.env.APP_URL || process.env.TELEGRAM_WEBAPP_URL || 'https://efluz.vercel.app/';

function inferSmartEvent(eventId: string): SmartNotificationEvent | null {
  const value = String(eventId || '').toLowerCase();
  if (value.includes(':verify:')) return 'resultVerification';
  if (value.includes(':confirmed')) return 'resultConfirmed';
  if (value.includes(':disputed')) return 'resultDisputed';
  if (value.startsWith('next-fixture:')) return 'nextOpponent';
  if (value.startsWith('matchday-open:')) return 'matchdayOpened';
  if (value.startsWith('cup-advance:') || value.startsWith('cup-champion:')) return 'cupProgress';
  if (value.includes('qualification') || value.includes('qualified')) return 'qualification';
  if (value.includes('european') || value.includes('league-phase') || value.includes('playoff')) return 'europeanOutcome';
  return null;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ownerId(fixture: Fixture, side: 'home' | 'away'): string | undefined {
  return side === 'home'
    ? (fixture.homeOwnerId || fixture.homeOwner?.userId || (fixture as any).homeUser?.id)
    : (fixture.awayOwnerId || fixture.awayOwner?.userId || (fixture as any).awayUser?.id);
}

function clubName(fixture: Fixture, side: 'home' | 'away'): string {
  return side === 'home'
    ? (fixture.homeClub?.name || fixture.homeClubId || 'Home')
    : (fixture.awayClub?.name || fixture.awayClubId || 'Away');
}

function contextLine(fixture: Fixture): string {
  const competition = escapeHtml(fixture.competitionName || fixture.competitionId || 'EFL UZ');
  const round = fixture.roundName ? escapeHtml(fixture.roundName) : `Matchday ${Number(fixture.matchday || 0)}`;
  return `<b>${competition}</b> • ${round}`;
}

function scoreLine(fixture: Fixture): string {
  const home = escapeHtml(clubName(fixture, 'home'));
  const away = escapeHtml(clubName(fixture, 'away'));
  const homeScore = fixture.homeScore ?? '–';
  const awayScore = fixture.awayScore ?? '–';
  return `⚽ <b>${home}</b>  ${homeScore}–${awayScore}  <b>${away}</b>`;
}

function formatTashkentTime(value?: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return escapeHtml(value);
  try {
    return new Intl.DateTimeFormat('uz-UZ', {
      timeZone: 'Asia/Tashkent',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(parsed) + ' (Toshkent)';
  } catch {
    return `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  }
}

async function opponentText(userId: string | undefined, seasonId: string): Promise<string> {
  if (!userId) return 'TBD';
  const recipient = await getCachedRecipient(userId, seasonId);
  const username = String(recipient?.username || '').replace(/^@+/, '').trim();
  if (username) return `@${escapeHtml(username)}`;
  return escapeHtml(recipient?.displayName || 'TBD');
}

async function buildMatchCardBody(params: {
  fixture: Fixture;
  viewerSide?: 'home' | 'away';
  deadlineAt?: string | null;
  footer?: string;
  showScore?: boolean;
}): Promise<string> {
  const fixture = params.fixture;
  const seasonId = fixture.seasonId || 'season-2026-27';
  const homeUser = await opponentText(ownerId(fixture, 'home'), seasonId);
  const awayUser = await opponentText(ownerId(fixture, 'away'), seasonId);
  const deadline = formatTashkentTime(params.deadlineAt || fixture.scheduledAt);
  const home = escapeHtml(clubName(fixture, 'home'));
  const away = escapeHtml(clubName(fixture, 'away'));
  const matchup = params.showScore
    ? scoreLine(fixture)
    : `⚽ <b>${home}</b>  vs  <b>${away}</b>`;
  const viewer = params.viewerSide === 'home' ? `🎮 Siz: <b>${home}</b>` : params.viewerSide === 'away' ? `🎮 Siz: <b>${away}</b>` : '';
  return [
    `🏟 ${contextLine(fixture)}`,
    '',
    matchup,
    `👤 ${homeUser}  •  ${awayUser}`,
    viewer,
    deadline ? `⏳ <b>${deadline}</b>` : '',
    params.footer ? `\n${params.footer}` : '',
  ].filter(Boolean).join('\n');
}

const RESULT_TOPIC_BY_LEAGUE: Record<string, string> = {
  'league-premier-league': 'https://t.me/efleagueuz/2',
  'league-la-liga': 'https://t.me/efleagueuz/3',
  'league-serie-a': 'https://t.me/efleagueuz/4',
  'league-bundesliga': 'https://t.me/efleagueuz/5',
  'league-ligue-1': 'https://t.me/efleagueuz/6',
};

function resultTopicUrl(fixture: Fixture): string {
  const competition = `${fixture.competitionId || ''} ${fixture.competitionName || ''}`.toLowerCase();
  if (competition.includes('super')) return 'https://t.me/efleagueuz/2335';
  if (competition.includes('champions') || competition.includes('ucl')) return 'https://t.me/efleagueuz/7';
  if (competition.includes('cup') || competition.includes('pokal') || competition.includes('copa') || competition.includes('coppa') || competition.includes('coupe')) return 'https://t.me/efleagueuz/8';
  const leagueId = fixture.homeClub?.leagueId || fixture.awayClub?.leagueId || '';
  return RESULT_TOPIC_BY_LEAGUE[leagueId] || 'https://t.me/efleagueuz';
}

async function fixtureReplyMarkup(fixture: Fixture, opponentUserId?: string, includeResultAction = true) {
  const rows: any[][] = [];
  if (opponentUserId) {
    const opponent = await getCachedRecipient(opponentUserId, fixture.seasonId || 'season-2026-27');
    const username = String(opponent?.username || '').replace(/^@+/, '').trim();
    if (username) rows.push([{ text: `👤 @${username}`, url: `https://t.me/${username}` }]);
  }
  if (includeResultAction) rows.push([{ text: '📸 Natijani yuborish', url: resultTopicUrl(fixture) }]);
  rows.push([{ text: '🏟 EFL UZ ilovasini ochish', url: APP_URL }]);
  return { inline_keyboard: rows };
}

async function getCompetitionFixtureSnapshot(competitionId: string, seasonId: string): Promise<Fixture[]> {
  const key = ReadModelKeys.competitionFixtures(competitionId, seasonId);
  const snapshot = (await redisGetFresh<Fixture[]>(key)) || (await redisGetLkg<Fixture[]>(key));
  return Array.isArray(snapshot?.data) ? snapshot!.data : [];
}

async function getCachedRecipient(userId: string, seasonId: string): Promise<RecipientDirectoryEntry | null> {
  const client = getUpstashClient();
  if (!client) return null;
  try {
    const entries = await client.get<RecipientDirectoryEntry[]>(`${RECIPIENT_DIR_KEY}:${seasonId}`);
    if (!Array.isArray(entries) || entries.length === 0) return null;
    return entries.find((entry) => entry.userId === userId) || null;
  } catch (error: any) {
    console.warn('[SMART_NOTIFY] Recipient directory read failed:', error?.message || error);
    return null;
  }
}

async function getCachedRecipientByClubId(clubId: string, seasonId: string): Promise<RecipientDirectoryEntry | null> {
  const client = getUpstashClient();
  if (!client) return null;
  try {
    const entries = await client.get<RecipientDirectoryEntry[]>(`${RECIPIENT_DIR_KEY}:${seasonId}`);
    if (!Array.isArray(entries) || entries.length === 0) return null;
    return entries.find((entry) => entry.clubId === clubId) || null;
  } catch (error: any) {
    console.warn('[SMART_NOTIFY] Club recipient lookup failed:', error?.message || error);
    return null;
  }
}

export async function enqueueSmartTelegramNotification(params: {
  userId: string;
  seasonId: string;
  eventId: string;
  title: string;
  body: string;
  replyMarkup?: any;
}): Promise<boolean> {
  const event = inferSmartEvent(params.eventId);
  if (!(await isSmartNotificationEventEnabled(params.seasonId, event))) {
    console.info('[SMART_NOTIFY_DISABLED]', JSON.stringify({ event, eventId: params.eventId, seasonId: params.seasonId }));
    return false;
  }

  const client = getUpstashClient();
  if (!client) {
    console.warn('[SMART_NOTIFY] Redis unavailable; notification skipped without affecting mutation');
    return false;
  }
  const recipient = await getCachedRecipient(params.userId, params.seasonId);
  if (!recipient?.messageable || !recipient.telegramId) {
    console.info('[SMART_NOTIFY] Recipient not messageable or directory not warmed', { userId: params.userId, seasonId: params.seasonId });
    return false;
  }

  const digest = crypto.createHash('sha256').update(`${params.eventId}:${params.userId}`).digest('hex');
  const broadcastId = `smart-${digest}`;
  const jobId = `job-${broadcastId}-${params.userId}`;
  const dedupeKey = `${SMART_DEDUPE_PREFIX}:${digest}`;
  const now = new Date().toISOString();
  const record: SmartBroadcastRecord = {
    id: broadcastId,
    seasonId: params.seasonId,
    title: params.title,
    body: params.body,
    type: 'CUSTOM_ALERT',
    targetAudience: 'SELECTED_RECIPIENTS',
    createdById: 'system:smart-notifications',
    createdByUsername: 'EFL UZ',
    createdAt: now,
    status: 'QUEUED',
    metrics: { totalRecipients: 1, sentCount: 0, failedCount: 0, skippedCount: 0 },
    recipients: [{ userId: recipient.userId, username: recipient.username || 'player', displayName: recipient.displayName || recipient.username || 'EFL Player', status: 'PENDING', retryCount: 0 }],
    bodyIsHtml: true,
    replyMarkup: params.replyMarkup,
  };
  const job: SmartQueueJob = {
    jobId,
    broadcastId,
    userId: recipient.userId,
    username: recipient.username || 'player',
    displayName: recipient.displayName || recipient.username || 'EFL Player',
    telegramId: recipient.telegramId,
    title: params.title,
    body: params.body,
    type: 'CUSTOM_ALERT',
    status: 'QUEUED',
    retryCount: 0,
    maxRetries: 3,
    createdAt: now,
    availableAt: Date.now(),
    bodyIsHtml: true,
    replyMarkup: params.replyMarkup,
  };

  try {
    const queued = await client.eval<unknown[], number>(`
      local accepted = redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[1])
      if not accepted then return 0 end
      redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])
      redis.call('RPUSH', KEYS[3], ARGV[4])
      return 1
    `, [dedupeKey, BROADCASTS_KEY, QUEUE_KEY], [SMART_DEDUPE_TTL_SECONDS, broadcastId, JSON.stringify(record), JSON.stringify(job)]);
    if (Number(queued) !== 1) return false;
    scheduleNotificationQueueDrain();
    console.info('[SMART_NOTIFY_QUEUED]', JSON.stringify({ eventId: params.eventId, userId: params.userId, broadcastId }));
    return true;
  } catch (error: any) {
    console.warn('[SMART_NOTIFY] Queue write failed; mutation remains successful:', error?.message || error);
    return false;
  }
}

export async function notifySmartMatchdayOpened(params: {
  competitionId: string;
  seasonId: string;
  matchday: number;
  deadlineAt?: string | null;
}): Promise<number> {
  const fixtures = await getCompetitionFixtureSnapshot(params.competitionId, params.seasonId);
  const matchdayFixtures = fixtures.filter((fixture) => Number(fixture.matchday) === Number(params.matchday));
  if (matchdayFixtures.length === 0) return 0;
  const tasks: Array<Promise<boolean>> = [];

  for (const fixture of matchdayFixtures) {
    const homeUserId = ownerId(fixture, 'home');
    const awayUserId = ownerId(fixture, 'away');
    if (homeUserId) tasks.push(enqueueSmartTelegramNotification({
      userId: homeUserId,
      seasonId: params.seasonId,
      eventId: `matchday-open:${params.competitionId}:${params.matchday}:${fixture.id}:${params.deadlineAt || ''}`,
      title: '🚀 Matchday ochildi',
      body: await buildMatchCardBody({ fixture, viewerSide: 'home', deadlineAt: params.deadlineAt, footer: 'O‘yinni o‘tkazing va natijani yuboring.' }),
      replyMarkup: await fixtureReplyMarkup(fixture, awayUserId),
    }));
    if (awayUserId) tasks.push(enqueueSmartTelegramNotification({
      userId: awayUserId,
      seasonId: params.seasonId,
      eventId: `matchday-open:${params.competitionId}:${params.matchday}:${fixture.id}:${params.deadlineAt || ''}`,
      title: '🚀 Matchday ochildi',
      body: await buildMatchCardBody({ fixture, viewerSide: 'away', deadlineAt: params.deadlineAt, footer: 'O‘yinni o‘tkazing va natijani yuboring.' }),
      replyMarkup: await fixtureReplyMarkup(fixture, homeUserId),
    }));
  }
  const results = await Promise.allSettled(tasks);
  return results.filter((result) => result.status === 'fulfilled' && result.value).length;
}

async function notifyNextFixtureIfKnown(fixture: Fixture): Promise<void> {
  const seasonId = fixture.seasonId || 'season-2026-27';
  const fixtures = await getCompetitionFixtureSnapshot(fixture.competitionId, seasonId);
  if (fixtures.length === 0) return;
  const sides: Array<{ userId?: string; clubId: string | null }> = [
    { userId: ownerId(fixture, 'home'), clubId: fixture.homeClubId },
    { userId: ownerId(fixture, 'away'), clubId: fixture.awayClubId },
  ];

  for (const side of sides) {
    if (!side.userId || !side.clubId) continue;
    const next = fixtures
      .filter((candidate) => candidate.id !== fixture.id && (candidate.homeClubId === side.clubId || candidate.awayClubId === side.clubId) && !['CONFIRMED', 'CANCELLED'].includes(candidate.status) && Number(candidate.matchday || 0) >= Number(fixture.matchday || 0))
      .sort((a, b) => Number(a.matchday || 0) - Number(b.matchday || 0) || String(a.scheduledAt || '').localeCompare(String(b.scheduledAt || '')))[0];
    if (!next) continue;
    const viewerSide = next.homeClubId === side.clubId ? 'home' : 'away';
    const opponentId = ownerId(next, viewerSide === 'home' ? 'away' : 'home');
    await enqueueSmartTelegramNotification({
      userId: side.userId,
      seasonId,
      eventId: `next-fixture:${fixture.id}:${next.id}`,
      title: '🎯 Keyingi raqib tayyor',
      body: await buildMatchCardBody({ fixture: next, viewerSide, footer: 'Keyingi o‘yin tafsilotlari tayyor.' }),
      replyMarkup: await fixtureReplyMarkup(next, opponentId),
    });
  }
}

export async function notifySmartCupAdvancement(params: {
  competitionId: string;
  seasonId: string;
  sourceFixtureId: string;
  targetFixtureId: string;
  winnerClubId: string;
}): Promise<boolean> {
  const recipient = await getCachedRecipientByClubId(params.winnerClubId, params.seasonId);
  if (!recipient) return false;
  const fixtures = await getCompetitionFixtureSnapshot(params.competitionId, params.seasonId);
  const target = fixtures.find((fixture) => fixture.id === params.targetFixtureId);
  const viewerSide = target?.homeClubId === params.winnerClubId ? 'home' : target?.awayClubId === params.winnerClubId ? 'away' : undefined;
  return enqueueSmartTelegramNotification({
    userId: recipient.userId,
    seasonId: params.seasonId,
    eventId: `cup-advance:${params.sourceFixtureId}:${params.targetFixtureId}:${params.winnerClubId}`,
    title: '🏆 Keyingi bosqichga o‘tdingiz',
    body: target
      ? await buildMatchCardBody({ fixture: target, viewerSide, footer: 'Bracket yangilandi. Keyingi bosqichga tayyorlaning.' })
      : `<b>Keyingi bosqich</b>\n\nBracket yangilandi. Tafsilotlar EFL UZ ilovasida.`,
    replyMarkup: target ? await fixtureReplyMarkup(target, viewerSide === 'home' ? ownerId(target, 'away') : ownerId(target, 'home')) : { inline_keyboard: [[{ text: '🏟 EFL UZ ilovasini ochish', url: APP_URL }]] },
  });
}

export async function notifySmartCupChampion(params: {
  competitionId: string;
  seasonId: string;
  sourceFixtureId: string;
  winnerClubId: string;
}): Promise<boolean> {
  const recipient = await getCachedRecipientByClubId(params.winnerClubId, params.seasonId);
  if (!recipient) return false;
  const fixtures = await getCompetitionFixtureSnapshot(params.competitionId, params.seasonId);
  const finalFixture = fixtures.find((fixture) => fixture.id === params.sourceFixtureId);
  const competitionName = finalFixture?.competitionName || params.competitionId;
  return enqueueSmartTelegramNotification({
    userId: recipient.userId,
    seasonId: params.seasonId,
    eventId: `cup-champion:${params.competitionId}:${params.sourceFixtureId}:${params.winnerClubId}`,
    title: '👑 Chempion!',
    body: finalFixture
      ? `${await buildMatchCardBody({ fixture: finalFixture, showScore: true })}\n\n🏆 <b>${escapeHtml(competitionName)} chempioni!</b>\nTrophy Cabinet yangilanadi.`
      : `🏆 <b>${escapeHtml(competitionName)}</b>\n\nTabriklaymiz — siz chempion bo‘ldingiz!`,
    replyMarkup: { inline_keyboard: [[{ text: '🏟 EFL UZ ilovasini ochish', url: APP_URL }]] },
  });
}

export async function notifySmartEuropeanZones(params: {
  competitionId: string;
  seasonId: string;
  rows: Array<{ clubId: string; clubName: string; position: number; zone: 'DIRECT_R16' | 'KNOCKOUT_PLAYOFF' | 'ELIMINATED'; zoneLabel: string }>;
}): Promise<number> {
  const tasks: Array<Promise<boolean>> = [];
  for (const row of params.rows) {
    const recipient = await getCachedRecipientByClubId(row.clubId, params.seasonId);
    if (!recipient) continue;
    const title = row.zone === 'DIRECT_R16' ? '🌟 To‘g‘ridan-to‘g‘ri yo‘llanma' : row.zone === 'KNOCKOUT_PLAYOFF' ? '⚔️ Play-off yo‘llanmasi' : '📋 Liga bosqichi yakunlandi';
    tasks.push(enqueueSmartTelegramNotification({
      userId: recipient.userId,
      seasonId: params.seasonId,
      eventId: `european-zone:${params.competitionId}:${row.clubId}:${row.zone}:${row.position}`,
      title,
      body: `🏟 <b>${escapeHtml(row.clubName)}</b> • #${row.position}\n\n${escapeHtml(row.zoneLabel)}\n\nYevrokubok holatingiz EFL UZ ilovasida yangilandi.`,
      replyMarkup: { inline_keyboard: [[{ text: '🏟 EFL UZ ilovasini ochish', url: APP_URL }]] },
    }));
  }
  const results = await Promise.allSettled(tasks);
  return results.filter((result) => result.status === 'fulfilled' && result.value).length;
}

export async function notifySmartResultLifecycle(fixture: Fixture, actorUserId: string): Promise<void> {
  const seasonId = fixture.seasonId || 'season-2026-27';
  const homeOwnerId = ownerId(fixture, 'home');
  const awayOwnerId = ownerId(fixture, 'away');
  const owners = [...new Set([homeOwnerId, awayOwnerId].filter(Boolean) as string[])];
  if (owners.length === 0) return;
  const status = fixture.status;
  const revision = fixture.resultConfirmedAt || fixture.updatedAt || `${fixture.homeScore}-${fixture.awayScore}`;
  const eventBase = `${fixture.id}:${status}:${revision}`;

  if (status === 'PENDING_CONFIRMATION') {
    const opponentId = owners.find((id) => id !== actorUserId);
    if (!opponentId) return;
    await enqueueSmartTelegramNotification({
      userId: opponentId,
      seasonId,
      eventId: `${eventBase}:verify:${actorUserId}`,
      title: '⚡ Natijani tasdiqlang',
      body: await buildMatchCardBody({ fixture, showScore: true, footer: 'Raqib natijani yubordi. Hisobni tekshirib, o‘z natijangizni yuboring.' }),
      replyMarkup: await fixtureReplyMarkup(fixture, actorUserId),
    });
    return;
  }

  if (status === 'CONFIRMED') {
    await Promise.all(owners.map(async (userId) => enqueueSmartTelegramNotification({
      userId,
      seasonId,
      eventId: `${eventBase}:confirmed`,
      title: '✅ Natija tasdiqlandi',
      body: await buildMatchCardBody({ fixture, showScore: true, footer: 'Natija rasmiy tasdiqlandi. Jadval va statistikalar yangilandi.' }),
      replyMarkup: await fixtureReplyMarkup(fixture, owners.find((id) => id !== userId), false),
    })));
    await notifyNextFixtureIfKnown(fixture).catch((error: any) => console.warn('[SMART_NOTIFY] Next fixture lookup failed:', error?.message || error));
    return;
  }

  if (status === 'DISPUTED') {
    await Promise.all(owners.map(async (userId) => enqueueSmartTelegramNotification({
      userId,
      seasonId,
      eventId: `${eventBase}:disputed`,
      title: '⚠️ Natijalar mos kelmadi',
      body: await buildMatchCardBody({ fixture, showScore: true, footer: 'Ikki tomon yuborgan natijalar mos kelmadi. Admin ko‘rib chiqishi talab qilinadi.' }),
      replyMarkup: await fixtureReplyMarkup(fixture, owners.find((id) => id !== userId)),
    })));
  }
}
