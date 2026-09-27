import { Club } from '../../types';
import {
  getCompetitionFixturesFromReadModel,
  getCompetitionStandingsFromReadModel,
} from '../readModel/readModelStore';
import {
  filterTombstonedFixtures,
  rebuildStandingsSnapshotFromFixtures,
} from './fixtureTombstoneService';

const DOMESTIC_LEAGUE_COMPETITION_BY_LEAGUE: Record<string, string> = {
  'league-premier-league': 'comp-premier-league-2026',
  'league-la-liga': 'comp-la-liga-2026',
  'league-serie-a': 'comp-serie-a-2026',
  'league-bundesliga': 'comp-bundesliga-2026',
  'league-ligue-1': 'comp-ligue-1-2026',
};

export function emptyDashboardLeagueStats() {
  return {
    matchesPlayed: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsScored: 0,
    goalsConceded: 0,
    points: 0,
    trophies: 0,
    leaguePosition: 0,
  };
}

function applyStandingRow(stats: ReturnType<typeof emptyDashboardLeagueStats>, row: any) {
  stats.matchesPlayed = row.played || 0;
  stats.wins = row.won || 0;
  stats.draws = row.drawn || 0;
  stats.losses = row.lost || 0;
  stats.goalsScored = row.goalsFor || 0;
  stats.goalsConceded = row.goalsAgainst || 0;
  stats.points = row.points || 0;
  stats.leaguePosition = row.position || 0;
  return stats;
}

export async function getDashboardLeagueStats(
  currentClub?: Club | null,
  seasonId = 'season-2026-27'
) {
  const stats = emptyDashboardLeagueStats();
  if (!currentClub?.id || !currentClub.leagueId) return stats;

  const competitionId = DOMESTIC_LEAGUE_COMPETITION_BY_LEAGUE[currentClub.leagueId];
  if (!competitionId) return stats;

  // Primary: exactly the same visible-fixture truth as the public Table endpoint.
  // Durable tombstones are applied before standings are calculated, so deleted
  // phantom fixtures cannot keep Home POS/PTS/W-D-L stale after cold starts.
  try {
    const fixtureResult = await getCompetitionFixturesFromReadModel(competitionId, { seasonId });
    const visibleFixtures = await filterTombstonedFixtures(fixtureResult.fixtures, seasonId);
    const standings = await rebuildStandingsSnapshotFromFixtures(
      competitionId,
      seasonId,
      visibleFixtures
    );
    const row = standings.find((standing) => standing.clubId === currentClub.id);
    if (row) return applyStandingRow(stats, row);
  } catch (error: any) {
    console.warn('[DASHBOARD_STATS] visible fixture truth unavailable:', error?.message || error);
  }

  // Resilient fallback: use the durable standings snapshot. This keeps login and
  // /api/me available during a temporary fixture-read failure.
  try {
    const result = await getCompetitionStandingsFromReadModel(competitionId, seasonId);
    const row = result.standings.find((standing) => standing.clubId === currentClub.id);
    if (row) return applyStandingRow(stats, row);
  } catch (error: any) {
    console.warn('[DASHBOARD_STATS] standings fallback unavailable:', error?.message || error);
  }

  return stats;
}
