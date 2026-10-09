import { Fixture } from '../../types';
import {
  ReadModelKeys,
  redisGetFresh,
  redisGetLkg,
} from '../readModel/readModelStore';
import { enqueueSmartTelegramNotification } from './smartNotificationService';

const RESULT_TOPIC_BY_LEAGUE: Record<string, string> = {
  'league-premier-league': 'https://t.me/efleagueuz/2',
  'league-la-liga': 'https://t.me/efleagueuz/3',
  'league-serie-a': 'https://t.me/efleagueuz/4',
  'league-bundesliga': 'https://t.me/efleagueuz/5',
  'league-ligue-1': 'https://t.me/efleagueuz/6',
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ownerId(fixture: Fixture, side: 'home' | 'away'): string | undefined {
  const f = fixture as any;
  return side === 'home'
    ? (f.homeOwnerId || f.homeOwner?.userId || f.homeClub?.claimedByUserId)
    : (f.awayOwnerId || f.awayOwner?.userId || f.awayClub?.claimedByUserId);
}

function opponentUsername(fixture: Fixture, side: 'home' | 'away'): string | undefined {
  const f = fixture as any;
  const user = side === 'home' ? f.homeUser : f.awayUser;
  return String(user?.username || '').replace(/^@+/, '').trim() || undefined;
}

function clubName(fixture: Fixture, side: 'home' | 'away'): string {
  const f = fixture as any;
  return side === 'home'
    ? (f.homeClub?.name || f.homeClubId || 'Home')
    : (f.awayClub?.name || f.awayClubId || 'Away');
}

function resultTopicUrl(fixture: Fixture): string {
  const f = fixture as any;
  const competition = `${f.competitionId || ''} ${f.competitionName || ''}`.toLowerCase();
  if (competition.includes('super')) return 'https://t.me/efleagueuz/2335';
  if (competition.includes('champions') || competition.includes('ucl')) return 'https://t.me/efleagueuz/7';
  if (
    competition.includes('cup') ||
    competition.includes('pokal') ||
    competition.includes('copa') ||
    competition.includes('coppa') ||
    competition.includes('coupe')
  ) {
    return 'https://t.me/efleagueuz/8';
  }
  const leagueId = f.homeClub?.leagueId || f.awayClub?.leagueId || '';
  return RESULT_TOPIC_BY_LEAGUE[leagueId] || 'https://t.me/efleagueuz';
}

function formatTashkentDeadline(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat('uz-UZ', {
      timeZone: 'Asia/Tashkent',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function selectOutstandingOwnerIds(
  fixture: Fixture,
  submittedByUserIds: Iterable<string>
): string[] {
  const submitted = new Set(Array.from(submittedByUserIds).filter(Boolean));
  const owners = [ownerId(fixture, 'home'), ownerId(fixture, 'away')].filter(Boolean) as string[];
  return Array.from(new Set(owners)).filter((userId) => !submitted.has(userId));
}

async function getCompetitionFixtureSnapshot(competitionId: string, seasonId: string): Promise<Fixture[]> {
  const key = ReadModelKeys.competitionFixtures(competitionId, seasonId);
  const snapshot = (await redisGetFresh<Fixture[]>(key)) || (await redisGetLkg<Fixture[]>(key));
  return Array.isArray(snapshot?.data) ? snapshot!.data : [];
}

async function replyMarkupFor(fixture: Fixture, userId: string): Promise<any> {
  const homeId = ownerId(fixture, 'home');
  const isHome = homeId === userId;
  const opponentSide = isHome ? 'away' : 'home';
  const username = opponentUsername(fixture, opponentSide);
  const rows: any[][] = [];
  if (username) {
    rows.push([{ text: `👤 Raqib: @${username}`, url: `https://t.me/${username}` }]);
  }
  rows.push([{ text: '📸 O‘yin natijasini bu yerga tashlang', url: resultTopicUrl(fixture) }]);
  return { inline_keyboard: rows };
}

export interface MatchdayReminderResult {
  competitionId: string;
  seasonId: string;
  matchday: number;
  deadlineAt: string | null;
  overdue: boolean;
  fixturesChecked: number;
  unfinishedFixtures: number;
  outstandingPlayers: number;
  queued: number;
  skipped: number;
}

export async function notifyOutstandingMatchdayOwners(params: {
  competitionId: string;
  seasonId: string;
  matchday: number;
  deadlineAt?: string | null;
}): Promise<MatchdayReminderResult> {
  const fixtures = await getCompetitionFixtureSnapshot(params.competitionId, params.seasonId);
  const current = fixtures.filter((fixture: any) =>
    Number(fixture.matchday) === Number(params.matchday) &&
    !['CONFIRMED', 'CANCELLED'].includes(String(fixture.status || '').toUpperCase())
  );

  if (current.length === 0) {
    return {
      competitionId: params.competitionId,
      seasonId: params.seasonId,
      matchday: params.matchday,
      deadlineAt: params.deadlineAt || null,
      overdue: Boolean(params.deadlineAt && Date.now() > new Date(params.deadlineAt).getTime()),
      fixturesChecked: 0,
      unfinishedFixtures: 0,
      outstandingPlayers: 0,
      queued: 0,
      skipped: 0,
    };
  }

  // Manual/admin-triggered operation only. Queries are bounded to the current matchday
  // (9-10 fixtures for domestic leagues) and never run on normal user reads.
  const { getResultSubmissions } = await import('./adminService');
  const submissions = await Promise.all(
    current.map(async (fixture) => {
      try {
        const rows = await getResultSubmissions({ fixtureId: fixture.id, limit: 4 });
        return [fixture.id, rows] as const;
      } catch {
        return [fixture.id, [] as any[]] as const;
      }
    })
  );
  const submissionsByFixture = new Map(submissions);

  const deadlineText = formatTashkentDeadline(params.deadlineAt);
  const deadlineMs = params.deadlineAt ? new Date(params.deadlineAt).getTime() : NaN;
  const overdue = Number.isFinite(deadlineMs) && Date.now() > deadlineMs;
  const tasks: Array<Promise<boolean>> = [];
  let outstandingPlayers = 0;

  for (const fixture of current) {
    const rows = submissionsByFixture.get(fixture.id) || [];
    const submittedBy = rows.map((row: any) => String(row.submittedByUserId || row.userId || '')).filter(Boolean);
    const outstanding = selectOutstandingOwnerIds(fixture, submittedBy);

    for (const userId of outstanding) {
      outstandingPlayers++;
      const homeId = ownerId(fixture, 'home');
      const isHome = homeId === userId;
      const opponentSide = isHome ? 'away' : 'home';
      const opponent = escapeHtml(clubName(fixture, opponentSide));
      const opponentUser = opponentUsername(fixture, opponentSide);
      const competition = escapeHtml((fixture as any).competitionName || fixture.competitionId || 'EFL UZ');
      const deadlineLine = deadlineText
        ? `\n⏳ Deadline: <b>${escapeHtml(deadlineText)} (Toshkent)</b>`
        : '';
      const statusLine = overdue
        ? 'Deadline o‘tgan. Natijani imkon qadar tez yuboring.'
        : 'Sizdan hali natija kelmagan.';

      tasks.push(enqueueSmartTelegramNotification({
        userId,
        seasonId: params.seasonId,
        // Prefix intentionally maps this to the existing matchdayOpened smart setting.
        eventId: `matchday-open:reminder:${params.competitionId}:${params.matchday}:${fixture.id}:${params.deadlineAt || 'manual'}:${userId}`,
        title: overdue ? '⛔ Match deadline o‘tdi' : '⏳ Match deadline eslatmasi',
        body: `${competition} • Matchday ${params.matchday}\n\nRaqib klub: <b>${opponent}</b>${opponentUser ? `\nRaqib user: <b>@${escapeHtml(opponentUser)}</b>` : ''}${deadlineLine}\n\n${statusLine}`,
        replyMarkup: await replyMarkupFor(fixture, userId),
      }));
    }
  }

  const results = await Promise.allSettled(tasks);
  const queued = results.filter((result) => result.status === 'fulfilled' && result.value).length;

  return {
    competitionId: params.competitionId,
    seasonId: params.seasonId,
    matchday: params.matchday,
    deadlineAt: params.deadlineAt || null,
    overdue,
    fixturesChecked: current.length,
    unfinishedFixtures: current.length,
    outstandingPlayers,
    queued,
    skipped: Math.max(0, outstandingPlayers - queued),
  };
}
