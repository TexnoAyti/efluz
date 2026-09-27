import { Fixture } from '../../types';
import { queryAll } from '../db';
import { SEED_CLUBS, SEED_COMPETITIONS } from '../db/seed';
import {
  DOMESTIC_LEAGUE_CONFIG,
  ReadModelKeys,
  redisGetFresh,
  redisGetLkg,
} from '../readModel/readModelStore';

export interface TrophyRecord {
  competitionId: string;
  competitionName: string;
  seasonId: string;
  clubId: string;
  clubName: string;
  winnerUserId?: string;
  winnerUsername?: string;
  decidedBy: 'FINAL' | 'LEAGUE_TABLE' | 'ONE_MATCH_FINAL';
  confirmedAt?: string | null;
}

export interface SeasonAwardLeader {
  clubId: string;
  clubName: string;
  userId?: string;
  username?: string;
  value: number;
}

export interface SeasonAward {
  id: 'MOST_WINS' | 'MOST_GOALS' | 'BEST_DEFENCE' | 'LONGEST_UNBEATEN' | 'LONGEST_WIN_STREAK';
  label: string;
  description: string;
  unit: string;
  leaders: SeasonAwardLeader[];
}

type OwnerEntry = {
  id: string;
  ownerUserId?: string | null;
  ownerUsername?: string | null;
  ownerDisplayName?: string | null;
};

type ClubAggregate = {
  clubId: string;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  longestUnbeaten: number;
  longestWinStreak: number;
};

const clubMap = new Map(SEED_CLUBS.map((club) => [club.id, club]));
const competitionMap = new Map(SEED_COMPETITIONS.map((competition) => [competition.id, competition]));
const domesticLeagueIds = new Set(Object.keys(DOMESTIC_LEAGUE_CONFIG));

function normalizeSqliteFixture(row: any, seasonId: string): Fixture {
  const home = row.home_club_id ? clubMap.get(row.home_club_id) : undefined;
  const away = row.away_club_id ? clubMap.get(row.away_club_id) : undefined;
  return {
    id: row.id,
    seasonId: row.season_id || seasonId,
    competitionId: row.competition_id,
    competitionName: competitionMap.get(row.competition_id)?.name || row.competition_id,
    matchday: Number(row.matchday || 1),
    roundName: row.round_name || undefined,
    homeClubId: row.home_club_id || null,
    awayClubId: row.away_club_id || null,
    homeClub: home ? { ...home, active: true, createdAt: '' } as any : null,
    awayClub: away ? { ...away, active: true, createdAt: '' } as any : null,
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

async function loadSeasonFixtures(seasonId: string): Promise<{ fixtures: Fixture[]; source: string }> {
  const key = ReadModelKeys.adminFixtures(seasonId);
  const snapshot = (await redisGetFresh<Fixture[]>(key)) || (await redisGetLkg<Fixture[]>(key));
  if (Array.isArray(snapshot?.data) && snapshot!.data.length > 0) {
    return { fixtures: snapshot!.data, source: snapshot!.source || 'redis' };
  }

  const rows = queryAll<any>(
    `SELECT * FROM fixtures WHERE season_id = ? OR season_id IS NULL ORDER BY matchday ASC, scheduled_at ASC, id ASC`,
    [seasonId]
  );
  return { fixtures: rows.map((row) => normalizeSqliteFixture(row, seasonId)), source: 'sqlite' };
}

async function loadOwners(seasonId: string): Promise<OwnerEntry[]> {
  const key = ReadModelKeys.clubsWithOwners(seasonId);
  const snapshot = (await redisGetFresh<OwnerEntry[]>(key)) || (await redisGetLkg<OwnerEntry[]>(key));
  if (Array.isArray(snapshot?.data) && snapshot!.data.length > 0) return snapshot!.data;

  const rows = queryAll<any>(
    `SELECT cm.club_id, cm.user_id, u.username, u.first_name, u.last_name
       FROM club_memberships cm
       LEFT JOIN users u ON u.id = cm.user_id
      WHERE cm.season_id = ? AND cm.status = 'active'`,
    [seasonId]
  );
  return rows.map((row) => ({
    id: row.club_id,
    ownerUserId: row.user_id,
    ownerUsername: row.username || null,
    ownerDisplayName: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.username || row.user_id,
  }));
}

function fixtureTime(fixture: Fixture): number {
  const value = fixture.resultConfirmedAt || fixture.scheduledAt || fixture.updatedAt || fixture.createdAt || '';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function confirmedForClub(fixtures: Fixture[], clubId: string): Fixture[] {
  return fixtures
    .filter((fixture) =>
      fixture.status === 'CONFIRMED' &&
      (fixture.homeClubId === clubId || fixture.awayClubId === clubId) &&
      fixture.homeScore !== null && fixture.homeScore !== undefined &&
      fixture.awayScore !== null && fixture.awayScore !== undefined
    )
    .sort((a, b) => fixtureTime(a) - fixtureTime(b) || a.id.localeCompare(b.id));
}

function aggregateClub(fixtures: Fixture[], clubId: string): ClubAggregate {
  const matches = confirmedForClub(fixtures, clubId);
  const aggregate: ClubAggregate = {
    clubId,
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
    longestUnbeaten: 0,
    longestWinStreak: 0,
  };
  let unbeaten = 0;
  let winStreak = 0;

  for (const fixture of matches) {
    const isHome = fixture.homeClubId === clubId;
    const gf = Number(isHome ? fixture.homeScore : fixture.awayScore) || 0;
    const ga = Number(isHome ? fixture.awayScore : fixture.homeScore) || 0;
    aggregate.matches += 1;
    aggregate.goalsFor += gf;
    aggregate.goalsAgainst += ga;
    if (gf > ga) {
      aggregate.wins += 1;
      aggregate.points += 3;
      unbeaten += 1;
      winStreak += 1;
    } else if (gf === ga) {
      aggregate.draws += 1;
      aggregate.points += 1;
      unbeaten += 1;
      winStreak = 0;
    } else {
      aggregate.losses += 1;
      unbeaten = 0;
      winStreak = 0;
    }
    aggregate.longestUnbeaten = Math.max(aggregate.longestUnbeaten, unbeaten);
    aggregate.longestWinStreak = Math.max(aggregate.longestWinStreak, winStreak);
  }
  return aggregate;
}

function resolveWinnerClubId(fixture: Fixture): string | null {
  if (fixture.winnerClubId) return fixture.winnerClubId;
  if (fixture.homeScore === null || fixture.homeScore === undefined || fixture.awayScore === null || fixture.awayScore === undefined) return null;
  if (fixture.homeScore > fixture.awayScore) return fixture.homeClubId || null;
  if (fixture.awayScore > fixture.homeScore) return fixture.awayClubId || null;
  return null;
}

function deriveLeagueChampion(fixtures: Fixture[], competitionId: string): string | null {
  const competitionFixtures = fixtures.filter((fixture) => fixture.competitionId === competitionId);
  if (competitionFixtures.length === 0 || competitionFixtures.some((fixture) => fixture.status !== 'CONFIRMED')) return null;
  const clubIds = Array.from(new Set(competitionFixtures.flatMap((fixture) => [fixture.homeClubId, fixture.awayClubId]).filter(Boolean) as string[]));
  const rows = clubIds.map((clubId) => aggregateClub(competitionFixtures, clubId));
  rows.sort((a, b) =>
    b.points - a.points ||
    (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) ||
    b.goalsFor - a.goalsFor ||
    a.clubId.localeCompare(b.clubId)
  );
  return rows[0]?.clubId || null;
}

export async function getSeasonTrophies(seasonId = 'season-2026-27'): Promise<{ trophies: TrophyRecord[]; source: string }> {
  const [{ fixtures, source }, owners] = await Promise.all([loadSeasonFixtures(seasonId), loadOwners(seasonId)]);
  const ownerByClub = new Map(owners.map((owner) => [owner.id, owner]));
  const grouped = new Map<string, Fixture[]>();
  for (const fixture of fixtures) {
    if (!fixture.competitionId) continue;
    const list = grouped.get(fixture.competitionId) || [];
    list.push(fixture);
    grouped.set(fixture.competitionId, list);
  }

  const trophies: TrophyRecord[] = [];
  for (const [competitionId, competitionFixtures] of grouped) {
    let winnerClubId: string | null = null;
    let decidedBy: TrophyRecord['decidedBy'] = 'FINAL';
    let confirmedAt: string | null | undefined = null;

    if (domesticLeagueIds.has(competitionId)) {
      winnerClubId = deriveLeagueChampion(fixtures, competitionId);
      decidedBy = 'LEAGUE_TABLE';
      confirmedAt = winnerClubId ? competitionFixtures.map((fixture) => fixture.resultConfirmedAt || '').sort().at(-1) || null : null;
    } else {
      const finals = competitionFixtures
        .filter((fixture) => fixture.status === 'CONFIRMED' && String(fixture.roundName || '').toLowerCase().includes('final'))
        .sort((a, b) => Number(b.matchday || 0) - Number(a.matchday || 0));
      let finalFixture = finals[0];
      if (!finalFixture && competitionFixtures.length === 1 && competitionFixtures[0].status === 'CONFIRMED') {
        finalFixture = competitionFixtures[0];
        decidedBy = 'ONE_MATCH_FINAL';
      }
      if (finalFixture) {
        winnerClubId = resolveWinnerClubId(finalFixture);
        confirmedAt = finalFixture.resultConfirmedAt;
      }
    }

    if (!winnerClubId) continue;
    const owner = ownerByClub.get(winnerClubId);
    trophies.push({
      competitionId,
      competitionName: competitionMap.get(competitionId)?.name || competitionFixtures[0]?.competitionName || competitionId,
      seasonId,
      clubId: winnerClubId,
      clubName: clubMap.get(winnerClubId)?.name || winnerClubId,
      winnerUserId: owner?.ownerUserId || undefined,
      winnerUsername: owner?.ownerUsername || undefined,
      decidedBy,
      confirmedAt,
    });
  }

  trophies.sort((a, b) => a.competitionName.localeCompare(b.competitionName));
  return { trophies, source };
}

function leadersFor(
  rows: ClubAggregate[],
  owners: Map<string, OwnerEntry>,
  selector: (row: ClubAggregate) => number,
  direction: 'MAX' | 'MIN'
): SeasonAwardLeader[] {
  if (rows.length === 0) return [];
  const values = rows.map(selector);
  const target = direction === 'MAX' ? Math.max(...values) : Math.min(...values);
  return rows
    .filter((row) => selector(row) === target)
    .map((row) => {
      const owner = owners.get(row.clubId);
      return {
        clubId: row.clubId,
        clubName: clubMap.get(row.clubId)?.name || row.clubId,
        userId: owner?.ownerUserId || undefined,
        username: owner?.ownerUsername || undefined,
        value: selector(row),
      };
    });
}

export async function getSeasonAwards(seasonId = 'season-2026-27'): Promise<{ awards: SeasonAward[]; source: string }> {
  const [{ fixtures, source }, ownerEntries] = await Promise.all([loadSeasonFixtures(seasonId), loadOwners(seasonId)]);
  const owners = new Map(ownerEntries.map((entry) => [entry.id, entry]));
  const leagueFixtures = fixtures.filter((fixture) => domesticLeagueIds.has(fixture.competitionId) && fixture.status === 'CONFIRMED');
  const clubIds = Array.from(new Set(leagueFixtures.flatMap((fixture) => [fixture.homeClubId, fixture.awayClubId]).filter(Boolean) as string[]));
  const rows = clubIds.map((clubId) => aggregateClub(leagueFixtures, clubId)).filter((row) => row.matches > 0);

  return {
    source,
    awards: [
      { id: 'MOST_WINS', label: 'Most Wins', description: 'Most confirmed domestic-league victories.', unit: 'wins', leaders: leadersFor(rows, owners, (row) => row.wins, 'MAX') },
      { id: 'MOST_GOALS', label: 'Most Goals', description: 'Most goals scored in confirmed domestic-league matches.', unit: 'goals', leaders: leadersFor(rows, owners, (row) => row.goalsFor, 'MAX') },
      { id: 'BEST_DEFENCE', label: 'Best Defence', description: 'Fewest goals conceded among clubs that have played.', unit: 'conceded', leaders: leadersFor(rows, owners, (row) => row.goalsAgainst, 'MIN') },
      { id: 'LONGEST_UNBEATEN', label: 'Longest Unbeaten', description: 'Longest domestic-league run without defeat.', unit: 'matches', leaders: leadersFor(rows, owners, (row) => row.longestUnbeaten, 'MAX') },
      { id: 'LONGEST_WIN_STREAK', label: 'Longest Win Streak', description: 'Longest consecutive domestic-league winning run.', unit: 'matches', leaders: leadersFor(rows, owners, (row) => row.longestWinStreak, 'MAX') },
    ],
  };
}

export async function getPlayerSeasonInsights(
  userId: string,
  seasonId = 'season-2026-27',
  fallbackClubIds: string[] = []
) {
  const [{ fixtures, source }, ownerEntries, trophyResult, awardResult] = await Promise.all([
    loadSeasonFixtures(seasonId),
    loadOwners(seasonId),
    getSeasonTrophies(seasonId),
    getSeasonAwards(seasonId),
  ]);
  const ownedClubIds = ownerEntries.filter((owner) => owner.ownerUserId === userId).map((owner) => owner.id);
  const clubIds = Array.from(new Set([...ownedClubIds, ...fallbackClubIds].filter(Boolean)));
  const confirmed = fixtures
    .filter((fixture) => fixture.status === 'CONFIRMED' && clubIds.some((clubId) => fixture.homeClubId === clubId || fixture.awayClubId === clubId))
    .sort((a, b) => fixtureTime(a) - fixtureTime(b) || a.id.localeCompare(b.id));

  const summary = {
    matchesPlayed: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsScored: 0,
    goalsConceded: 0,
    goalDifference: 0,
    winRate: 0,
    points: 0,
    longestUnbeaten: 0,
    longestWinStreak: 0,
  };
  let unbeaten = 0;
  let wins = 0;
  const form: Array<'W' | 'D' | 'L'> = [];
  const competitionBreakdown = new Map<string, { competitionId: string; competitionName: string; matches: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number }>();

  const resultForFixture = (fixture: Fixture) => {
    const clubId = clubIds.find((id) => fixture.homeClubId === id || fixture.awayClubId === id)!;
    const isHome = fixture.homeClubId === clubId;
    const gf = Number(isHome ? fixture.homeScore : fixture.awayScore) || 0;
    const ga = Number(isHome ? fixture.awayScore : fixture.homeScore) || 0;
    const outcome: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
    return { clubId, isHome, gf, ga, outcome };
  };

  for (const fixture of confirmed) {
    const result = resultForFixture(fixture);
    summary.matchesPlayed += 1;
    summary.goalsScored += result.gf;
    summary.goalsConceded += result.ga;
    form.push(result.outcome);
    if (result.outcome === 'W') {
      summary.wins += 1;
      summary.points += 3;
      unbeaten += 1;
      wins += 1;
    } else if (result.outcome === 'D') {
      summary.draws += 1;
      summary.points += 1;
      unbeaten += 1;
      wins = 0;
    } else {
      summary.losses += 1;
      unbeaten = 0;
      wins = 0;
    }
    summary.longestUnbeaten = Math.max(summary.longestUnbeaten, unbeaten);
    summary.longestWinStreak = Math.max(summary.longestWinStreak, wins);

    const entry = competitionBreakdown.get(fixture.competitionId) || {
      competitionId: fixture.competitionId,
      competitionName: fixture.competitionName || competitionMap.get(fixture.competitionId)?.name || fixture.competitionId,
      matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0,
    };
    entry.matches += 1;
    entry.goalsFor += result.gf;
    entry.goalsAgainst += result.ga;
    if (result.outcome === 'W') entry.wins += 1;
    else if (result.outcome === 'D') entry.draws += 1;
    else entry.losses += 1;
    competitionBreakdown.set(fixture.competitionId, entry);
  }

  summary.goalDifference = summary.goalsScored - summary.goalsConceded;
  summary.winRate = summary.matchesPlayed ? Math.round((summary.wins / summary.matchesPlayed) * 1000) / 10 : 0;

  const recentMatches = confirmed.slice(-5).reverse().map((fixture) => {
    const result = resultForFixture(fixture);
    const opponentId = result.isHome ? fixture.awayClubId : fixture.homeClubId;
    return {
      id: fixture.id,
      competitionId: fixture.competitionId,
      competitionName: fixture.competitionName || competitionMap.get(fixture.competitionId)?.name || fixture.competitionId,
      roundName: fixture.roundName || `Matchday ${fixture.matchday}`,
      opponentClubId: opponentId,
      opponentName: opponentId ? clubMap.get(opponentId)?.name || opponentId : 'TBD',
      goalsFor: result.gf,
      goalsAgainst: result.ga,
      outcome: result.outcome,
      confirmedAt: fixture.resultConfirmedAt,
    };
  });

  const nextFixture = fixtures
    .filter((fixture) =>
      !['CONFIRMED', 'CANCELLED'].includes(fixture.status) &&
      clubIds.some((clubId) => fixture.homeClubId === clubId || fixture.awayClubId === clubId)
    )
    .sort((a, b) => Number(a.matchday || 0) - Number(b.matchday || 0) || fixtureTime(a) - fixtureTime(b))[0];

  let nextMatch: any = null;
  if (nextFixture) {
    const myClubId = clubIds.find((clubId) => nextFixture.homeClubId === clubId || nextFixture.awayClubId === clubId)!;
    const opponentId = nextFixture.homeClubId === myClubId ? nextFixture.awayClubId : nextFixture.homeClubId;
    nextMatch = {
      id: nextFixture.id,
      competitionId: nextFixture.competitionId,
      competitionName: nextFixture.competitionName || competitionMap.get(nextFixture.competitionId)?.name || nextFixture.competitionId,
      roundName: nextFixture.roundName || `Matchday ${nextFixture.matchday}`,
      myClubId,
      opponentClubId: opponentId,
      opponentName: opponentId ? clubMap.get(opponentId)?.name || opponentId : 'TBD',
      scheduledAt: nextFixture.scheduledAt,
      status: nextFixture.status,
    };
  }

  const trophies = trophyResult.trophies.filter((trophy) => trophy.winnerUserId === userId || clubIds.includes(trophy.clubId));
  const awardsHeld = awardResult.awards
    .map((award) => ({ ...award, leaders: award.leaders.filter((leader) => leader.userId === userId || clubIds.includes(leader.clubId)) }))
    .filter((award) => award.leaders.length > 0);

  return {
    seasonId,
    source,
    clubIds,
    summary,
    form: form.slice(-5).reverse(),
    recentMatches,
    nextMatch,
    trophies,
    awardsHeld,
    competitionBreakdown: Array.from(competitionBreakdown.values()).sort((a, b) => b.matches - a.matches || a.competitionName.localeCompare(b.competitionName)),
  };
}

export async function getSeasonInsights(seasonId = 'season-2026-27') {
  const [trophies, awards] = await Promise.all([getSeasonTrophies(seasonId), getSeasonAwards(seasonId)]);
  return {
    seasonId,
    trophies: trophies.trophies,
    awards: awards.awards,
    source: trophies.source,
    generatedAt: new Date().toISOString(),
  };
}
