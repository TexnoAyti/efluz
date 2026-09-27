import { Fixture, Competition, StandingsRow } from '../../types';
import { queryAll } from '../db';
import { SEED_CLUBS, SEED_COMPETITIONS } from '../db/seed';
import {
  ReadModelKeys,
  redisGetFresh,
  redisGetLkg,
  getCompetitionsFromReadModel,
  getCompetitionStandingsFromReadModel,
  getAdminClubsFromReadModel,
} from '../readModel/readModelStore';
import { getSeasonAwards, getSeasonTrophies } from './seasonInsightsService';

const DOMESTIC_LEAGUES = new Set([
  'comp-premier-league-2026',
  'comp-la-liga-2026',
  'comp-serie-a-2026',
  'comp-bundesliga-2026',
  'comp-ligue-1-2026',
]);

const DOMESTIC_CUPS = new Set([
  'comp-fa-cup-2026',
  'comp-copa-del-rey-2026',
  'comp-coppa-italia-2026',
  'comp-dfb-pokal-2026',
  'comp-coupe-de-france-2026',
]);

const EUROPEAN_LEAGUE_PHASE = new Set([
  'comp-champions-league-2026',
  'comp-europa-league-2026',
]);

const UCL_ALLOCATION: Record<string, number> = {
  'comp-premier-league-2026': 5,
  'comp-la-liga-2026': 5,
  'comp-serie-a-2026': 5,
  'comp-bundesliga-2026': 5,
  'comp-ligue-1-2026': 4,
};

export type SeasonPhaseId =
  | 'LEAGUE_MD_1_9'
  | 'DOMESTIC_CUPS'
  | 'LEAGUE_MD_10_19'
  | 'EUROPE_LEAGUE_PHASE'
  | 'LEAGUE_MD_20_PLUS'
  | 'KNOCKOUT_RUN_IN';

export interface SeasonPhaseSummary {
  id: SeasonPhaseId;
  label: string;
  order: number;
  total: number;
  confirmed: number;
  remaining: number;
  percent: number;
  status: 'DONE' | 'ACTIVE' | 'UPCOMING';
}

function fixtureSortTime(fixture: Fixture): number {
  const raw = fixture.scheduledAt || fixture.createdAt || '';
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : 0;
}

function normalizeSqliteFixture(row: any, seasonId: string): Fixture {
  const home = SEED_CLUBS.find((club) => club.id === row.home_club_id);
  const away = SEED_CLUBS.find((club) => club.id === row.away_club_id);
  const competition = SEED_COMPETITIONS.find((item) => item.id === row.competition_id);
  return {
    id: row.id,
    seasonId: row.season_id || seasonId,
    competitionId: row.competition_id,
    competitionName: competition?.name || row.competition_id,
    matchday: Number(row.matchday || 0),
    roundName: row.round_name || undefined,
    homeClubId: row.home_club_id || null,
    awayClubId: row.away_club_id || null,
    homeClub: home ? ({ ...home, active: true, createdAt: '' } as any) : null,
    awayClub: away ? ({ ...away, active: true, createdAt: '' } as any) : null,
    scheduledAt: row.scheduled_at || '',
    status: row.status || 'SCHEDULED',
    homeScore: row.home_score ?? null,
    awayScore: row.away_score ?? null,
    winnerClubId: row.winner_club_id || null,
    resultConfirmedAt: row.result_confirmed_at || null,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  } as Fixture;
}

export async function loadSeasonOperationsFixtures(seasonId = 'season-2026-27') {
  const key = ReadModelKeys.adminFixtures(seasonId);
  const snapshot = (await redisGetFresh<Fixture[]>(key)) || (await redisGetLkg<Fixture[]>(key));
  if (Array.isArray(snapshot?.data) && snapshot!.data.length > 0) {
    return { fixtures: snapshot!.data, source: snapshot!.source || 'redis', stale: Boolean(snapshot!.stale) };
  }
  const rows = queryAll<any>(
    `SELECT * FROM fixtures WHERE season_id = ? OR season_id IS NULL ORDER BY matchday ASC, scheduled_at ASC, id ASC`,
    [seasonId]
  );
  return { fixtures: rows.map((row) => normalizeSqliteFixture(row, seasonId)), source: 'sqlite', stale: true };
}

function phaseOf(fixture: Fixture): SeasonPhaseId {
  if (DOMESTIC_LEAGUES.has(fixture.competitionId)) {
    const md = Number(fixture.matchday || 0);
    if (md <= 9) return 'LEAGUE_MD_1_9';
    if (md <= 19) return 'LEAGUE_MD_10_19';
    return 'LEAGUE_MD_20_PLUS';
  }
  if (DOMESTIC_CUPS.has(fixture.competitionId)) return 'DOMESTIC_CUPS';
  if (EUROPEAN_LEAGUE_PHASE.has(fixture.competitionId) && Number(fixture.matchday || 0) <= 8) return 'EUROPE_LEAGUE_PHASE';
  return 'KNOCKOUT_RUN_IN';
}

const PHASE_DEFS: Array<{ id: SeasonPhaseId; label: string; order: number }> = [
  { id: 'LEAGUE_MD_1_9', label: 'League MD 1–9', order: 10 },
  { id: 'DOMESTIC_CUPS', label: 'Domestic Cups', order: 20 },
  { id: 'LEAGUE_MD_10_19', label: 'League MD 10–19', order: 30 },
  { id: 'EUROPE_LEAGUE_PHASE', label: 'UCL / UEL League Phase', order: 40 },
  { id: 'LEAGUE_MD_20_PLUS', label: 'League MD 20+', order: 50 },
  { id: 'KNOCKOUT_RUN_IN', label: 'Knockouts & Finals', order: 60 },
];

function buildPhases(fixtures: Fixture[]): SeasonPhaseSummary[] {
  const raw = PHASE_DEFS.map((definition) => {
    const phaseFixtures = fixtures.filter((fixture) => phaseOf(fixture) === definition.id);
    const confirmed = phaseFixtures.filter((fixture) => fixture.status === 'CONFIRMED' || fixture.status === 'CANCELLED').length;
    const total = phaseFixtures.length;
    return {
      ...definition,
      total,
      confirmed,
      remaining: Math.max(0, total - confirmed),
      percent: total ? Math.round((confirmed / total) * 100) : 0,
      status: 'UPCOMING' as SeasonPhaseSummary['status'],
    };
  });
  const currentIndex = raw.findIndex((phase) => phase.total > 0 && phase.remaining > 0);
  return raw.map((phase, index) => ({
    ...phase,
    status: phase.total > 0 && phase.remaining === 0
      ? 'DONE'
      : index === currentIndex
        ? 'ACTIVE'
        : 'UPCOMING',
  }));
}

function competitionDeadline(competition: Competition | undefined, fixture: Fixture): string | null {
  const direct = (fixture as any).deadlineAt || (fixture as any).deadline_at;
  if (direct) return String(direct);
  const openedAt = fixture.matchdayOpenedAt || competition?.matchdayOpenedAt;
  const hours = Number((competition as any)?.matchdayDurationHours || 0);
  if (!openedAt || !hours) return null;
  const start = Date.parse(openedAt);
  return Number.isFinite(start) ? new Date(start + hours * 3600000).toISOString() : null;
}

export async function getSeasonOperationsOverview(seasonId = 'season-2026-27') {
  const [{ fixtures, source, stale }, competitionResult, trophyResult, awardResult] = await Promise.all([
    loadSeasonOperationsFixtures(seasonId),
    getCompetitionsFromReadModel(seasonId).catch(() => ({ competitions: [] as Competition[] } as any)),
    getSeasonTrophies(seasonId),
    getSeasonAwards(seasonId),
  ]);
  const competitions = (competitionResult.competitions || []) as Competition[];
  const competitionById = new Map(competitions.map((competition) => [competition.id, competition]));
  const phases = buildPhases(fixtures);
  const currentPhase = phases.find((phase) => phase.status === 'ACTIVE') || phases.at(-1)!;
  const now = Date.now();
  const openFixtures = fixtures.filter((fixture) => !['CONFIRMED', 'CANCELLED'].includes(fixture.status));
  const deadlines = openFixtures
    .map((fixture) => {
      const deadlineAt = competitionDeadline(competitionById.get(fixture.competitionId), fixture);
      const deadlineMs = deadlineAt ? Date.parse(deadlineAt) : NaN;
      return {
        fixtureId: fixture.id,
        competitionId: fixture.competitionId,
        competitionName: fixture.competitionName || competitionById.get(fixture.competitionId)?.name || fixture.competitionId,
        matchday: fixture.matchday,
        homeClubId: fixture.homeClubId,
        awayClubId: fixture.awayClubId,
        homeClubName: fixture.homeClub?.name || fixture.homeClubId,
        awayClubName: fixture.awayClub?.name || fixture.awayClubId,
        status: fixture.status,
        deadlineAt,
        overdue: Number.isFinite(deadlineMs) && deadlineMs < now,
      };
    })
    .filter((item) => item.deadlineAt)
    .sort((a, b) => Date.parse(a.deadlineAt!) - Date.parse(b.deadlineAt!));

  return {
    seasonId,
    source,
    stale,
    phases,
    currentPhase,
    counters: {
      totalFixtures: fixtures.length,
      confirmedFixtures: fixtures.filter((fixture) => fixture.status === 'CONFIRMED').length,
      pendingConfirmations: fixtures.filter((fixture) => fixture.status === 'PENDING_CONFIRMATION').length,
      disputed: fixtures.filter((fixture) => fixture.status === 'DISPUTED').length,
      overdue: deadlines.filter((deadline) => deadline.overdue).length,
      trophiesDecided: trophyResult.trophies.length,
    },
    deadlines: deadlines.slice(0, 30),
    awards: awardResult.awards,
    trophies: trophyResult.trophies,
    generatedAt: new Date().toISOString(),
  };
}

export async function getClubOperations(clubId: string, seasonId = 'season-2026-27') {
  const [{ fixtures, source }, clubsResult] = await Promise.all([
    loadSeasonOperationsFixtures(seasonId),
    getAdminClubsFromReadModel(seasonId).catch(() => ({ clubs: [] as any[] } as any)),
  ]);
  const club = (clubsResult.clubs || []).find((item: any) => item.id === clubId) || SEED_CLUBS.find((item) => item.id === clubId);
  if (!club) throw new Error('CLUB_NOT_FOUND');
  const matches = fixtures
    .filter((fixture) => fixture.homeClubId === clubId || fixture.awayClubId === clubId)
    .sort((a, b) => fixtureSortTime(a) - fixtureSortTime(b) || a.id.localeCompare(b.id));
  const confirmed = matches.filter((fixture) => fixture.status === 'CONFIRMED' && fixture.homeScore != null && fixture.awayScore != null);
  let wins = 0; let draws = 0; let losses = 0; let gf = 0; let ga = 0;
  const form: string[] = [];
  for (const fixture of confirmed) {
    const home = fixture.homeClubId === clubId;
    const mine = Number(home ? fixture.homeScore : fixture.awayScore);
    const theirs = Number(home ? fixture.awayScore : fixture.homeScore);
    gf += mine; ga += theirs;
    if (mine > theirs) { wins += 1; form.push('W'); }
    else if (mine === theirs) { draws += 1; form.push('D'); }
    else { losses += 1; form.push('L'); }
  }
  return {
    club,
    source,
    summary: {
      played: confirmed.length,
      wins, draws, losses,
      goalsFor: gf,
      goalsAgainst: ga,
      goalDifference: gf - ga,
      points: wins * 3 + draws,
      form: form.slice(-5),
    },
    upcoming: matches.filter((fixture) => !['CONFIRMED', 'CANCELLED'].includes(fixture.status)).slice(0, 8),
    recent: confirmed.slice(-8).reverse(),
    competitions: Array.from(new Set(matches.map((fixture) => fixture.competitionId))).map((competitionId) => ({
      competitionId,
      competitionName: matches.find((fixture) => fixture.competitionId === competitionId)?.competitionName || competitionId,
      played: confirmed.filter((fixture) => fixture.competitionId === competitionId).length,
      remaining: matches.filter((fixture) => fixture.competitionId === competitionId && !['CONFIRMED', 'CANCELLED'].includes(fixture.status)).length,
    })),
  };
}

export async function getHeadToHead(clubA: string, clubB: string, seasonId = 'season-2026-27') {
  if (!clubA || !clubB || clubA === clubB) throw new Error('TWO_DISTINCT_CLUBS_REQUIRED');
  const { fixtures, source } = await loadSeasonOperationsFixtures(seasonId);
  const matches = fixtures
    .filter((fixture) => fixture.status === 'CONFIRMED' && (
      (fixture.homeClubId === clubA && fixture.awayClubId === clubB) ||
      (fixture.homeClubId === clubB && fixture.awayClubId === clubA)
    ))
    .sort((a, b) => fixtureSortTime(b) - fixtureSortTime(a));
  let aWins = 0; let bWins = 0; let draws = 0; let aGoals = 0; let bGoals = 0;
  for (const fixture of matches) {
    const aHome = fixture.homeClubId === clubA;
    const ag = Number(aHome ? fixture.homeScore : fixture.awayScore);
    const bg = Number(aHome ? fixture.awayScore : fixture.homeScore);
    aGoals += ag; bGoals += bg;
    if (ag > bg) aWins += 1;
    else if (bg > ag) bWins += 1;
    else draws += 1;
  }
  return { source, clubA, clubB, matches, summary: { played: matches.length, aWins, draws, bWins, aGoals, bGoals } };
}

function qualificationZone(row: StandingsRow, competition: Competition | undefined) {
  const config: any = competition?.formatConfig || {};
  const ucl = Number(config.qualificationSpots ?? UCL_ALLOCATION[row.clubId] ?? 0);
  const uel = Number(config.europaQualificationSpots ?? 0);
  const uecl = Number(config.conferenceQualificationSpots ?? 0);
  if (row.position <= ucl) return 'UCL';
  if (uel > 0 && row.position <= ucl + uel) return 'UEL';
  if (uecl > 0 && row.position <= ucl + uel + uecl) return 'UECL';
  return null;
}

export async function getQualificationTracker(seasonId = 'season-2026-27') {
  const competitionResult = await getCompetitionsFromReadModel(seasonId).catch(() => ({ competitions: [] as Competition[] } as any));
  const competitions = (competitionResult.competitions || []) as Competition[];
  const byId = new Map(competitions.map((competition) => [competition.id, competition]));
  const leagues = await Promise.all(Array.from(DOMESTIC_LEAGUES).map(async (competitionId) => {
    const standingsResult = await getCompetitionStandingsFromReadModel(competitionId, seasonId);
    const comp = byId.get(competitionId);
    const uclFallback = UCL_ALLOCATION[competitionId] || 0;
    const config: any = comp?.formatConfig || {};
    return {
      competitionId,
      competitionName: comp?.name || competitionId,
      allocation: {
        ucl: Number(config.qualificationSpots ?? uclFallback),
        uel: Number(config.europaQualificationSpots ?? 0),
        uecl: Number(config.conferenceQualificationSpots ?? 0),
      },
      rows: standingsResult.standings.map((row) => ({ ...row, qualificationZone: (() => {
        const ucl = Number(config.qualificationSpots ?? uclFallback);
        const uel = Number(config.europaQualificationSpots ?? 0);
        const uecl = Number(config.conferenceQualificationSpots ?? 0);
        if (row.position <= ucl) return 'UCL';
        if (uel > 0 && row.position <= ucl + uel) return 'UEL';
        if (uecl > 0 && row.position <= ucl + uel + uecl) return 'UECL';
        return null;
      })() })),
      source: standingsResult.source,
    };
  }));
  return { seasonId, leagues, generatedAt: new Date().toISOString() };
}

export async function getSeasonRolloverPreview(seasonId = 'season-2026-27') {
  const overview = await getSeasonOperationsOverview(seasonId);
  const unresolved = overview.counters.pendingConfirmations + overview.counters.disputed + overview.counters.overdue;
  const incompletePhases = overview.phases.filter((phase) => phase.total > 0 && phase.remaining > 0);
  const [yearStart, yearEnd] = seasonId.replace('season-', '').split('-').map(Number);
  const nextSeasonId = Number.isFinite(yearStart) && Number.isFinite(yearEnd)
    ? `season-${yearStart + 1}-${String(yearEnd + 1).padStart(2, '0')}`
    : 'season-next';
  return {
    seasonId,
    nextSeasonId,
    canRollover: unresolved === 0 && incompletePhases.length === 0,
    blockers: [
      ...(unresolved > 0 ? [`${unresolved} unresolved/pending/overdue match records remain`] : []),
      ...incompletePhases.map((phase) => `${phase.label}: ${phase.remaining} fixtures remaining`),
    ],
    archivePlan: ['freeze current season', 'persist trophies and career snapshot', 'persist qualification snapshot', 'create next season shell'],
    destructiveActions: false,
    generatedAt: new Date().toISOString(),
  };
}
