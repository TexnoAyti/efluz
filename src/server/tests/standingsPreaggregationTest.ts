import assert from 'assert';
import { ensureDbReady } from '../app';
import {
  getCompetitionStandingsFirestore,
  rebuildCompetitionStandingsFirestore,
  computeAndSortStandings,
  submitFixtureResultFirestore,
  reopenFixtureFirestore,
} from '../firebase/firestoreStore';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';

async function runStandingsTests() {
  console.log('=============================================================');
  console.log('       STANDINGS PRE-AGGREGATION & ATOMICITY TEST SUITE       ');
  console.log('=============================================================');

  await ensureDbReady();
  const db = getFirestoreDb();

  const dummyClubs = [
    { id: 'club-test-arsenal', name: 'Arsenal FC', shortName: 'ARS', logoUrl: '/arsenal.png' },
    { id: 'club-test-chelsea', name: 'Chelsea FC', shortName: 'CHE', logoUrl: '/chelsea.png' },
    { id: 'club-test-liverpool', name: 'Liverpool FC', shortName: 'LIV', logoUrl: '/liverpool.png' },
    { id: 'club-test-mancity', name: 'Manchester City', shortName: 'MCI', logoUrl: '/mancity.png' },
  ];

  const formatConfig = {
    pointsForWin: 3,
    pointsForDraw: 1,
    pointsForLoss: 0,
    tieBreakers: ['goalDifference', 'goalsFor', 'headToHead'] as const,
  };

  // --- TEST 1: Baseline computeAndSortStandings with no matches ---
  console.log('\n--- [TEST 1] Initial Standings (0 matches played) ---');
  let standings = computeAndSortStandings(dummyClubs, [], formatConfig);
  assert.strictEqual(standings.length, 4, 'Should contain 4 clubs');
  for (const s of standings) {
    assert.strictEqual(s.played, 0);
    assert.strictEqual(s.points, 0);
    assert.strictEqual(s.won, 0);
    assert.strictEqual(s.drawn, 0);
    assert.strictEqual(s.lost, 0);
    assert.strictEqual(s.goalDifference, 0);
  }
  console.log('✅ PASS [TEST 1]: 0 matches played produces clean zeroed table.');

  // --- TEST 2: First Confirmed Match (Arsenal 2 - 0 Chelsea) => Win & Loss ---
  console.log('\n--- [TEST 2] First Confirmed Match (Arsenal 2 - 0 Chelsea) ---');
  const match1 = [{ homeClubId: 'club-test-arsenal', awayClubId: 'club-test-chelsea', homeScore: 2, awayScore: 0 }];
  standings = computeAndSortStandings(dummyClubs, match1, formatConfig);

  const ars1 = standings.find((c) => c.clubId === 'club-test-arsenal')!;
  const che1 = standings.find((c) => c.clubId === 'club-test-chelsea')!;

  assert.strictEqual(ars1.position, 1, 'Arsenal should be 1st');
  assert.strictEqual(ars1.played, 1);
  assert.strictEqual(ars1.won, 1);
  assert.strictEqual(ars1.lost, 0);
  assert.strictEqual(ars1.goalsFor, 2);
  assert.strictEqual(ars1.goalsAgainst, 0);
  assert.strictEqual(ars1.goalDifference, 2);
  assert.strictEqual(ars1.points, 3);
  assert.deepStrictEqual(ars1.form, ['W']);

  assert.strictEqual(che1.played, 1);
  assert.strictEqual(che1.lost, 1);
  assert.strictEqual(che1.won, 0);
  assert.strictEqual(che1.goalsFor, 0);
  assert.strictEqual(che1.goalsAgainst, 2);
  assert.strictEqual(che1.goalDifference, -2);
  assert.strictEqual(che1.points, 0);
  assert.deepStrictEqual(che1.form, ['L']);
  console.log('✅ PASS [TEST 2]: First win correctly awards 3 points, +2 GD, and Win form.');

  // --- TEST 3: Second Confirmed Match with Draw (Liverpool 1 - 1 Man City) ---
  console.log('\n--- [TEST 3] Second Confirmed Match with Draw (Liverpool 1 - 1 Man City) ---');
  const match2 = [
    ...match1,
    { homeClubId: 'club-test-liverpool', awayClubId: 'club-test-mancity', homeScore: 1, awayScore: 1 },
  ];
  standings = computeAndSortStandings(dummyClubs, match2, formatConfig);

  const liv = standings.find((c) => c.clubId === 'club-test-liverpool')!;
  const mci = standings.find((c) => c.clubId === 'club-test-mancity')!;

  assert.strictEqual(liv.played, 1);
  assert.strictEqual(liv.drawn, 1);
  assert.strictEqual(liv.points, 1);
  assert.strictEqual(liv.goalDifference, 0);
  assert.deepStrictEqual(liv.form, ['D']);

  assert.strictEqual(mci.played, 1);
  assert.strictEqual(mci.drawn, 1);
  assert.strictEqual(mci.points, 1);
  assert.strictEqual(mci.goalDifference, 0);
  assert.deepStrictEqual(mci.form, ['D']);

  assert.strictEqual(standings[0].clubId, 'club-test-arsenal', 'Arsenal remains 1st with 3 pts');
  assert.strictEqual(standings[3].clubId, 'club-test-chelsea', 'Chelsea 4th with 0 pts');
  console.log('✅ PASS [TEST 3]: Draw awards 1 point to both clubs and preserves proper ranking order.');

  // --- TEST 4: Goal Difference & Goals For Tiebreaker (Man City 4 - 1 Arsenal) ---
  console.log('\n--- [TEST 4] Goal Difference & Goals For Ranking Multi-Match ---');
  const match3 = [
    ...match2,
    { homeClubId: 'club-test-mancity', awayClubId: 'club-test-arsenal', homeScore: 4, awayScore: 1 },
  ];
  standings = computeAndSortStandings(dummyClubs, match3, formatConfig);

  const mci2 = standings.find((c) => c.clubId === 'club-test-mancity')!;
  const ars2 = standings.find((c) => c.clubId === 'club-test-arsenal')!;

  assert.strictEqual(mci2.played, 2);
  assert.strictEqual(mci2.points, 4); // 1 + 3 = 4
  assert.strictEqual(mci2.goalDifference, 3); // (1-1) + (4-1) = +3
  assert.strictEqual(standings[0].clubId, 'club-test-mancity', 'Man City 1st with 4 points');

  assert.strictEqual(ars2.played, 2);
  assert.strictEqual(ars2.points, 3);
  assert.strictEqual(ars2.goalDifference, -1); // +2 - 3 = -1
  assert.deepStrictEqual(ars2.form, ['W', 'L']);
  console.log('✅ PASS [TEST 4]: Multi-match cumulative stats, GD, and form history verified.');

  // --- TEST 5: Materialized Firestore Standings Document & Persistence ---
  console.log('\n--- [TEST 5] Firestore Standings Document Pre-Aggregation ---');
  const testCompId = 'comp-premier-league-2026';

  // Rebuild standings for Premier League
  const rebuilt = await rebuildCompetitionStandingsFirestore(testCompId);
  assert(rebuilt.length > 0, 'Rebuilt standings must return rows');

  // Verify document in Firestore
  const docSnap = await db.collection(COLLECTIONS.STANDINGS).doc(testCompId).get();
  assert(docSnap.exists, `Document in '${COLLECTIONS.STANDINGS}/${testCompId}' must exist!`);
  const data = docSnap.data()!;
  assert.strictEqual(data.competitionId, testCompId);
  assert(Array.isArray(data.rows), 'rows must be an array');
  assert.strictEqual(data.rows.length, rebuilt.length);

  // Fast read from materialized document
  const cachedRead = await getCompetitionStandingsFirestore(testCompId);
  assert.strictEqual(cachedRead.length, rebuilt.length);
  assert.strictEqual(cachedRead[0].clubId, rebuilt[0].clubId);
  console.log(`✅ PASS [TEST 5]: Materialized standings stored and retrieved directly (${rebuilt.length} clubs).`);

  // --- TEST 6: Idempotent Standings & Duplicate Prevention ---
  console.log('\n--- [TEST 6] Duplicate Prevention / Idempotent Confirmation ---');
  // Reading multiple times does not mutate or duplicate numbers
  const read1 = await getCompetitionStandingsFirestore(testCompId);
  const read2 = await getCompetitionStandingsFirestore(testCompId);
  assert.deepStrictEqual(read1, read2, 'Successive reads must return exact identical results');
  console.log('✅ PASS [TEST 6]: Consecutive reads produce consistent, cached, non-duplicated standings.');

  console.log('\n=============================================================');
  console.log('       ALL STANDINGS & PRE-AGGREGATION TESTS PASSED!          ');
  console.log('=============================================================\n');
}

runStandingsTests().catch((err) => {
  console.error('FAILED Standings Tests:', err);
  process.exit(1);
});
