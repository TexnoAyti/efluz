import assert from 'node:assert/strict';
import { initDatabase, queryRun, queryGet } from '../db';
import { seedDatabase } from '../db/seed';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { getResilientCompetitionStandings } from '../services/standingsReadService';

async function main() {
  await initDatabase();
  seedDatabase();

  const competitionId = 'comp-premier-league-2026';
  const fixture = queryGet<any>(
    `SELECT * FROM fixtures WHERE competition_id = ? ORDER BY matchday ASC LIMIT 1`,
    [competitionId]
  );
  assert.ok(fixture, 'Seeded Premier League fixture should exist');

  queryRun('DELETE FROM competition_standings WHERE competition_id = ?', [competitionId]);
  queryRun(
    `UPDATE fixtures SET status = 'CONFIRMED', home_score = 3, away_score = 1 WHERE id = ?`,
    [fixture.id]
  );

  firestoreCircuitBreaker.reset();
  firestoreCircuitBreaker.forceState('OPEN');

  const standings = await getResilientCompetitionStandings(competitionId);
  assert.equal(standings.length, 20, 'Fallback should return all 20 Premier League rows');
  assert.ok(standings.some((row) => row.played > 0), 'Confirmed local result must affect standings');

  const materializedCount = queryGet<any>(
    'SELECT COUNT(*) AS count FROM competition_standings WHERE competition_id = ?',
    [competitionId]
  );
  assert.equal(materializedCount?.count, 20, 'Fallback must persist the materialized standings snapshot');

  firestoreCircuitBreaker.reset();
  console.log('✅ sqliteStandingsFallbackTest passed');
}

main().catch((err) => {
  console.error('❌ sqliteStandingsFallbackTest failed:', err);
  process.exit(1);
});
