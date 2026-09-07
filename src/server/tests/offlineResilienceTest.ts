import { initDatabase, queryAll, queryRun } from '../db';
import { seedDatabase, repairSeason202627Roster } from '../db/seed';
import {
  rebuildMaterializedCompetitionStandings,
  getMaterializedCompetitionStandings,
} from '../db/sqliteStandings';
import { enqueueMutation, getPendingMutations } from '../sync/mutationQueue';

async function main(): Promise<void> {
  await initDatabase();
  seedDatabase();
  repairSeason202627Roster();

  const competitionId = 'comp-premier-league-2026';
  const seasonId = 'season-2026-27';
  const clubRows = queryAll<any>(
    `SELECT id FROM clubs WHERE league_id = 'league-premier-league' ORDER BY id LIMIT 2`
  );
  if (clubRows.length < 2) {
    throw new Error('Expected at least two Premier League clubs in SQLite baseline.');
  }

  const homeClubId = clubRows[0].id;
  const awayClubId = clubRows[1].id;
  const fixtureId = `offline-test-${Date.now()}`;
  const now = new Date().toISOString();

  queryRun(
    `INSERT INTO fixtures
      (id, season_id, competition_id, matchday, round_name, home_club_id, away_club_id,
       scheduled_at, status, home_score, away_score, winner_club_id,
       result_confirmed_at, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'Offline resilience test', ?, ?, ?, 'CONFIRMED', 2, 1, ?, ?, ?, ?)`,
    [fixtureId, seasonId, competitionId, homeClubId, awayClubId, now, homeClubId, now, now, now]
  );

  try {
    const standings = rebuildMaterializedCompetitionStandings(competitionId);
    const homeRow = standings.find((row) => row.clubId === homeClubId);
    const awayRow = standings.find((row) => row.clubId === awayClubId);

    assert(Boolean(homeRow), 'Home club is missing from materialized standings.');
    assert(Boolean(awayRow), 'Away club is missing from materialized standings.');
    assert(homeRow!.played >= 1, 'Home club played count was not materialized.');
    assert(homeRow!.won >= 1, 'Home club win was not materialized.');
    assert(homeRow!.points >= 3, 'Home club points were not materialized.');
    assert(awayRow!.played >= 1, 'Away club played count was not materialized.');
    assert(awayRow!.lost >= 1, 'Away club loss was not materialized.');

    const persisted = getMaterializedCompetitionStandings(competitionId);
    assert(persisted.length >= 20, `Expected at least 20 materialized PL rows, got ${persisted.length}.`);

    const mutationId = `offline-resilience-test-${Date.now()}`;
    enqueueMutation({
      mutationId,
      entityType: 'RESULT_SUBMISSION',
      entityId: fixtureId,
      operation: 'SUBMIT_RESULT',
      payload: {
        fixtureId,
        userId: 'offline-test-user',
        userClubId: homeClubId,
        homeScore: 2,
        awayScore: 1,
        proofUrl: null,
        submissionId: `offline-sub-${Date.now()}`,
        createdAt: now,
        updatedAt: now,
      },
      createdAt: now,
    });

    const queued = getPendingMutations('PENDING').some((item) => item.mutationId === mutationId);
    assert(queued, 'Offline result mutation was not persisted in the pending queue.');

    console.log('OFFLINE_RESILIENCE_TEST: PASS');
  } finally {
    queryRun('DELETE FROM pending_mutations WHERE mutation_id LIKE ?', ['offline-resilience-test-%']);
    queryRun('DELETE FROM fixtures WHERE id = ?', [fixtureId]);
    rebuildMaterializedCompetitionStandings(competitionId);
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

void main().catch((error) => {
  console.error('OFFLINE_RESILIENCE_TEST: FAIL');
  console.error(error);
  process.exitCode = 1;
});
