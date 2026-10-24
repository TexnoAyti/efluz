import { Fixture } from '../../types';
import {
  ReadModelKeys,
  redisGetFresh,
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
  const snapshot = await redisGetFresh<Fixture[]>(key);
  if (!Array.isArray(snapshot?.data)) throw new Error('O‘yinlarning yangi holati mavjud emas. Eslatma yuborilmadi; ro‘yxatni yangilab qayta urinib ko‘ring.');
  return snapshot.data;
}


/** Read current occupancy directly: a transferred club must never notify its former owner. */
async function resolveReminderOwners(fixtures: Fixture[], seasonId: string): Promise<Fixture[]> {
  const { getFirestoreDb } = await import('../firebase/admin');
  const { COLLECTIONS } = await import('../firebase/collections');
  const db = getFirestoreDb();
  fixtures = await Promise.all(fixtures.map(async fixture => {
    const doc = await db.collection(COLLECTIONS.FIXTURES).doc(fixture.id).get();
    if (!doc.exists) throw new Error('O‘yin holati topilmadi. Eslatma yuborilmadi.');
    const fresh = doc.data()!;
    if (fresh.competitionId !== fixture.competitionId || fresh.seasonId !== seasonId || Number(fresh.matchday) !== Number(fixture.matchday)) throw new Error('O‘yin holati o‘zgardi. Ro‘yxatni yangilang.');
    return {...fixture, ...fresh, id: fixture.id} as Fixture;
  }));
  fixtures = fixtures.filter(f => !['CONFIRMED','CANCELLED','POSTPONED'].includes(String(f.status).toUpperCase()));
  const clubIds = [...new Set(fixtures.flatMap(f => [f.homeClubId, f.awayClubId]).filter(id => id && id !== 'TBD'))];
  const owners = new Map(await Promise.all(clubIds.map(async id => {
    const doc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${id}`).get();
    const occupancy = doc.data();
    const userId = doc.exists && occupancy?.status === 'active' ? occupancy.userId : null;
    const user = userId ? (await db.collection(COLLECTIONS.USERS).doc(userId).get()).data() : null;
    return [id, userId ? {userId, username: user?.username || ''} : null] as const;
  })));
  return fixtures.map(f => {
    const home = owners.get(f.homeClubId), away = owners.get(f.awayClubId);
    return {...f, homeOwnerId: home?.userId || null, awayOwnerId: away?.userId || null,
      homeOwner: home || null, awayOwner: away || null, homeUser: home || null, awayUser: away || null,
      homeClub: f.homeClub ? {...f.homeClub, claimedByUserId: home?.userId || null} : f.homeClub,
      awayClub: f.awayClub ? {...f.awayClub, claimedByUserId: away?.userId || null} : f.awayClub} as unknown as Fixture;
  });
}

export interface MatchdayReminderDependencies {
  fixtures: typeof getCompetitionFixtureSnapshot;
  owners: typeof resolveReminderOwners;
  submissions: (fixtureId: string) => Promise<any[]>;
  enqueue: typeof enqueueSmartTelegramNotification;
}
const reminderDependencies: MatchdayReminderDependencies = {
  fixtures: getCompetitionFixtureSnapshot,
  owners: resolveReminderOwners,
  submissions: async fixtureId => {
    const { getFirestoreDb } = await import('../firebase/admin');
    const { COLLECTIONS } = await import('../firebase/collections');
    const snapshot = await getFirestoreDb().collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId','==',fixtureId).limit(100).get();
    if (snapshot.docs.length === 100) throw new Error('Natijalar ro‘yxati to‘liq emas. Eslatma yuborilmadi.');
    return snapshot.docs.map(doc => doc.data());
  },
  enqueue: enqueueSmartTelegramNotification,
};

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
  fromMatchday?: number;
  deadlineAt: string | null;
  overdue: boolean;
  fixturesChecked: number;
  unfinishedFixtures: number;
  outstandingPlayers: number;
  queued: number;
  skipped: number;
  failed: number;
}

export async function notifyOutstandingMatchdayOwners(params: {
  competitionId: string;
  seasonId: string;
  matchday: number;
  fromMatchday?: number;
  fixtureIds?: string[];
  deadlineAt?: string | null;
}, deps: MatchdayReminderDependencies = reminderDependencies): Promise<MatchdayReminderResult> {
  const from = params.fromMatchday ?? params.matchday;
  if (!Number.isInteger(from) || !Number.isInteger(params.matchday) || from < 1 || params.matchday < from || params.matchday > 100 || params.fixtureIds && (!Array.isArray(params.fixtureIds) || !params.fixtureIds.length || params.fixtureIds.length > 1000 || params.fixtureIds.some(id=>typeof id !== 'string' || !id))) throw new Error('Eslatma uchun tur oralig‘i yoki o‘yinlar ro‘yxati noto‘g‘ri.');
  const selected = params.fixtureIds ? new Set(params.fixtureIds) : null;
  const fixtures = await deps.fixtures(params.competitionId, params.seasonId);
  if (!Array.isArray(fixtures)) throw new Error('O‘yinlar manbasi o‘qilmadi. Eslatma yuborilmadi.');
  if (selected && [...selected].some(id=>!fixtures.some(f=>f.id===id && f.competitionId===params.competitionId && f.seasonId===params.seasonId && Number(f.matchday)>=from && Number(f.matchday)<=params.matchday))) throw new Error('Tanlangan o‘yinlar manbada to‘liq topilmadi. Ro‘yxatni yangilang.');
  let current = fixtures.filter((fixture: any) =>
    fixture.competitionId === params.competitionId && fixture.seasonId === params.seasonId &&
    Number(fixture.matchday) >= from && Number(fixture.matchday) <= params.matchday &&
    (!selected || selected.has(fixture.id)) &&
    !['CONFIRMED', 'CANCELLED', 'POSTPONED'].includes(String(fixture.status || '').toUpperCase())
  );

  if (current.length === 0) {
    return {
      competitionId: params.competitionId,
      seasonId: params.seasonId,
      matchday: params.matchday,
      ...(params.fromMatchday !== undefined ? {fromMatchday:from} : {}),
      deadlineAt: params.deadlineAt || null,
      overdue: Boolean(params.deadlineAt && Date.now() > new Date(params.deadlineAt).getTime()),
      fixturesChecked: 0,
      unfinishedFixtures: 0,
      outstandingPlayers: 0,
      queued: 0,
      skipped: 0,
      failed: 0,
    };
  }

  // Manual/admin-triggered operation only, bounded to the selected competition,
  // inclusive round range and optional exact reply fixture IDs. Never runs on normal reads.
  // Finish every source read before enqueueing the first message. Fail closed on read errors.
  current = await deps.owners(current, params.seasonId);
  const submissions = await Promise.all(current.map(async fixture => {
    const rows = await deps.submissions(fixture.id);
    if (!Array.isArray(rows)) throw new Error('Natijalar manbasi o‘qilmadi. Eslatma yuborilmadi.');
    return [fixture.id, rows] as const;
  }));
  const submissionsByFixture = new Map(submissions);

  const deadlineText = formatTashkentDeadline(params.deadlineAt);
  const deadlineMs = params.deadlineAt ? new Date(params.deadlineAt).getTime() : NaN;
  const overdue = Number.isFinite(deadlineMs) && Date.now() > deadlineMs;
  const tasks: Array<() => Promise<boolean>> = [];
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

      tasks.push(async () => deps.enqueue({
        userId,
        seasonId: params.seasonId,
        // Prefix intentionally maps this to the existing matchdayOpened smart setting.
        eventId: `matchday-open:reminder:${params.competitionId}:${fixture.matchday}:${fixture.id}:${params.deadlineAt || 'manual'}:${userId}`,
        title: overdue ? '⛔ Match deadline o‘tdi' : '⏳ Match deadline eslatmasi',
        body: `${competition} • Matchday ${fixture.matchday}\n\nRaqib klub: <b>${opponent}</b>${opponentUser ? `\nRaqib user: <b>@${escapeHtml(opponentUser)}</b>` : ''}${deadlineLine}\n\n${statusLine}`,
        replyMarkup: await replyMarkupFor(fixture, userId),
      }));
    }
  }

  const results = await Promise.allSettled(tasks.map(task => task()));
  const queued = results.filter((result) => result.status === 'fulfilled' && result.value).length;

  return {
    competitionId: params.competitionId,
    seasonId: params.seasonId,
    matchday: params.matchday,
      ...(params.fromMatchday !== undefined ? {fromMatchday:from} : {}),
    deadlineAt: params.deadlineAt || null,
    overdue,
    fixturesChecked: current.length,
    unfinishedFixtures: current.length,
    outstandingPlayers,
    queued,
    skipped: results.filter(result => result.status === 'fulfilled' && !result.value).length,
    failed: results.filter(result => result.status === 'rejected').length,
  };
}
