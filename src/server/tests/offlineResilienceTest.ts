import { strict as assert } from 'assert';
import { initDatabase, queryGet, queryRun } from '../db';
import { seedDatabase } from '../db/seed';
import { refreshMaterializedStandingsForCompetition } from '../db/sqliteStandings';
import { enqueueMutation, getPendingMutations } from '../sync/mutationQueue';

async function main() {
  await initDatabase();
  seedDatabase();

  const seasonId = 'season-2026-27';
  const competitionId = 'comp-premier-league-2026';
  const fixtureId = `offline-test-${Date.now()}`;
  const now = new Date().toISOString();

  queryRun(
    `INSERT OR REPLACE INTO fixtures
      (id, season_id, competition_id, matchday, round_name, home_club_id, away_club_id, scheduled_at,
       status, home_score, away_score, winner_club_id, result_confirmed_at, fixture_source, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'Offline Regression Test', 'club-arsenal', 'club-chelsea', ?,
       'CONFIRMED', 2, 1, 'club-arsenal', ?, 'test', ?, ?)`,
    [fixtureId, seasonId, competitionId, now, now, now, now]
  );

  const standings = refreshMaterializedStandingsForCompetition(competitionId);
  const arsenal = standings.find((row: any) => row.clubId === 'club-arsenal');
  assert.ok(arsenal, 'Arsenal standings row should exist');
  assert.equal(arsenal.played >= 1, true, 'Confirmed offline fixture must update played count');

  const mutationId = `offline-test-mutation-${Date.now()}`;
  enqueueMutation({
    mutationId,
    entityType: 'MATCHDAY_OVERRIDE',
    entityId: competitionId,
    operation: 'ADVANCE_MATCHDAY',
    payload: {
      competitionId,
      currentMatchday: 2,
      durationHours: 30,
      nextOpenAt: now,
      overrideStatus: 'AUTO',
    },
    createdAt: now,
  });

  const pending = getPendingMutations('PENDING');
  assert.ok(pending.some((item) => item.mutationId === mutationId), 'Mutation must persist in pending queue');

  const persistedFixture = queryGet<any>('SELECT status, home_score, away_score FROM fixtures WHERE id = ?', [fixtureId]);
  assert.equal(persistedFixture?.status, 'CONFIRMED');
  assert.equal(Number(persistedFixture?.home_score), 2);
  assert.equal(Number(persistedFixture?.away_score), 1);

  console.log('offline resilience regression: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
