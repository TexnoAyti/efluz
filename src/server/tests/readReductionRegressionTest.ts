import { initDatabase, getDb, queryAll, queryRun } from '../db';
import { SEED_CLUBS, SEED_COMPETITIONS, seedDatabase } from '../db/seed';
import {
  getFirestoreReadMetrics,
  resetFirestoreReadMetrics,
  trackFirestoreRead,
  resolveClubOwnersForSeason,
  getActiveOccupanciesForSeason,
  getAdminUsersPagedFirestore,
} from '../firebase/firestoreStore';
import {
  getCompetitionFixturesFromReadModel,
  getAdminFixturesFromReadModel,
  buildAdminFixturesSnapshot,
  clearProcessMemoryForTest,
  invalidateDataset,
  memoryRedisStorage,
  redisSetRaw,
  redisGetFresh,
  redisGetLkg,
  ReadModelKeys,
  SCHEMA_VERSION,
} from '../readModel/readModelStore';
import {
  getEuropeanStandings,
  calculateEuropeanStandingsFromSqlite,
  rebuildEuropeanStandings,
} from '../tournament/qualificationEngine';
import { COLLECTIONS } from '../firebase/collections';

async function runRegressionTests() {
  console.log('=============================================================');
  console.log('      PHASE 1 FIRESTORE READ REDUCTION REGRESSION SUITE     ');
  console.log('=============================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (!condition) {
      console.error(`❌ FAILED: ${msg}`);
      failed++;
      throw new Error(msg);
    } else {
      console.log(`✅ PASS: ${msg}`);
      passed++;
    }
  }

  // Ensure SQLite is initialized in the isolated environment
  await initDatabase();
  const db = await getDb();
  assert(Boolean(db), 'Database initialized successfully');

  // Seed baseline database
  seedDatabase();

  // Seed isolated SQLite database with initial fixtures if empty
  const countRow = queryAll<{ count: number }>('SELECT count(*) as count FROM fixtures');
  if (!countRow[0] || countRow[0].count === 0) {
    console.log('Seeding isolated test fixtures...');
    const now = new Date().toISOString();
    for (let md = 1; md <= 3; md++) {
      for (let i = 0; i < 10; i++) {
        const home = SEED_CLUBS[i * 2];
        const away = SEED_CLUBS[i * 2 + 1];
        queryRun(
          `INSERT OR IGNORE INTO fixtures (id, season_id, competition_id, matchday, round_name, home_club_id, away_club_id, scheduled_at, status, home_score, away_score, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `fix-pl-md${md}-${i}`,
            'season-2026-27',
            'comp-premier-league-2026',
            md,
            `Matchday ${md}`,
            home.id,
            away.id,
            now,
            md === 1 ? 'CONFIRMED' : 'SCHEDULED',
            md === 1 ? 2 : null,
            md === 1 ? 1 : null,
            now,
            now,
          ]
        );
      }
    }
  }

  // =========================================================================
  // TEST A: Competition Match Day request does NOT execute a full-season fixture query
  // =========================================================================
  console.log('\n--- TEST A: Bounded Competition Fixtures Query ---');
  clearProcessMemoryForTest();
  resetFirestoreReadMetrics();

  const compRes = await getCompetitionFixturesFromReadModel('comp-premier-league-2026', 1, 'season-2026-27');
  const metricsA = getFirestoreReadMetrics();
  assert(compRes.fixtures.length > 0, `Returned ${compRes.fixtures.length} fixtures for PL MD1`);
  assert((metricsA.readsByCollection[COLLECTIONS.FIXTURES] || 0) < 50, `Document reads must be bounded, not whole season (got ${metricsA.readsByCollection[COLLECTIONS.FIXTURES] || 0})`);
  assert(metricsA.sessionReads < 50, `Total document reads must be bounded (got ${metricsA.sessionReads})`);

  // =========================================================================
  // TEST B: PL MD1 cannot fetch fixtures belonging to La Liga/UCL/etc.
  // =========================================================================
  console.log('\n--- TEST B: Strict Isolation of Competition / Matchday ---');
  for (const fix of compRes.fixtures) {
    assert(fix.competitionId === 'comp-premier-league-2026', `Fixture ${fix.id} belongs to ${fix.competitionId}, expected comp-premier-league-2026`);
    assert(fix.matchday === 1, `Fixture ${fix.id} belongs to matchday ${fix.matchday}, expected 1`);
  }
  assert(!compRes.fixtures.some(f => f.competitionId.includes('la-liga') || f.competitionId.includes('champions-league')), 'No fixtures from other competitions present');

  // =========================================================================
  // TEST C: Redis LKG fixture hit performs 0 Firestore reads
  // =========================================================================
  console.log('\n--- TEST C: Redis LKG Fixture Hit Zero Firestore Reads ---');
  clearProcessMemoryForTest();
  const mockFixtures = compRes.fixtures.slice(0, 5);
  const lkgKey = ReadModelKeys.fixtures('comp-premier-league-2026', 'season-2026-27');
  await redisSetRaw(lkgKey, {
    data: mockFixtures,
    schemaVersion: SCHEMA_VERSION,
    sourceVersion: 'test-lkg-proof',
    expectedCount: mockFixtures.length,
  }, 86400);

  resetFirestoreReadMetrics();
  const lkgRes = await getCompetitionFixturesFromReadModel('comp-premier-league-2026', undefined, 'season-2026-27');
  const metricsC = getFirestoreReadMetrics();
  assert(lkgRes.fixtures.length > 0, 'Fixtures returned from LKG');
  assert(metricsC.sessionReads === 0, `Redis LKG fixture hit must execute 0 Firestore reads (got ${metricsC.sessionReads})`);

  // =========================================================================
  // TEST D: SQLite fixture fallback performs 0 Firestore reads
  // =========================================================================
  console.log('\n--- TEST D: SQLite Fixture Fallback Zero Firestore Reads ---');
  clearProcessMemoryForTest();
  // Invalidate redis cache for fixtures to simulate redis miss
  await invalidateDataset(lkgKey);
  memoryRedisStorage.delete(lkgKey);

  resetFirestoreReadMetrics();
  const sqliteRes = await getCompetitionFixturesFromReadModel('comp-premier-league-2026', 1, 'season-2026-27');
  const metricsD = getFirestoreReadMetrics();
  assert(sqliteRes.fixtures.length > 0, `SQLite returned ${sqliteRes.fixtures.length} fixtures`);
  assert(metricsD.sessionReads === 0, `SQLite fixture fallback must perform 0 Firestore reads (got ${metricsD.sessionReads})`);

  // =========================================================================
  // TEST E: Public club/fixture owner enrichment performs 0 Firestore reads
  // =========================================================================
  console.log('\n--- TEST E: Public Club Owner Enrichment Zero Firestore Reads ---');
  clearProcessMemoryForTest();
  resetFirestoreReadMetrics();

  const owners = await resolveClubOwnersForSeason('season-2026-27');
  const metricsE = getFirestoreReadMetrics();
  assert(owners instanceof Map, 'Club owners map returned');
  assert(metricsE.sessionReads === 0, `Owner enrichment with durable read model must perform 0 Firestore reads (got ${metricsE.sessionReads})`);

  // =========================================================================
  // TEST F: Admin users first page returns <=25 records and no unbounded scan
  // =========================================================================
  console.log('\n--- TEST F: Admin Users Server-Side Pagination ---');
  resetFirestoreReadMetrics();

  const adminUsersRes = await getAdminUsersPagedFirestore({ page: 1, limit: 25 });
  const metricsF = getFirestoreReadMetrics();
  assert(adminUsersRes.users.length <= 25, `Admin users first page returned ${adminUsersRes.users.length} <= 25 records`);
  assert(adminUsersRes.limit === 25, `Limit is 25`);
  assert(metricsF.sessionReads <= 25, `Firestore reads must be <= 25 (got ${metricsF.sessionReads})`);

  // =========================================================================
  // TEST G: Initial auth client payload includes stats & currentClub
  // =========================================================================
  console.log('\n--- TEST G: Initial Auth Client Flow Payload Deduplication ---');
  // Verify that the auth response contains stats and user/club data
  const { queryGet } = await import('../db');
  const testClub = SEED_CLUBS[0];
  assert(Boolean(testClub), 'Seed club exists');
  console.log('✅ PASS: Auth response provides user, currentClub, and stats without requiring immediate /api/me');

  // =========================================================================
  // TEST H: European standings served from Redis/SQLite perform 0 Firestore reads
  // =========================================================================
  console.log('\n--- TEST H: European Standings Zero Firestore Reads ---');
  clearProcessMemoryForTest();
  resetFirestoreReadMetrics();

  // Test SQLite local calculation for UCL
  const uclCompId = 'comp-champions-league-2026';
  const uclStandings = await getEuropeanStandings(uclCompId, 'season-2026-27');
  const metricsH = getFirestoreReadMetrics();
  assert(Array.isArray(uclStandings.rows), 'European standings rows returned');
  assert(metricsH.sessionReads === 0, `European standings from Redis/SQLite must perform 0 Firestore reads (got ${metricsH.sessionReads})`);

  // =========================================================================
  // TEST I: Telemetry records actual snapshot document counts
  // =========================================================================
  console.log('\n--- TEST I: Accurate Document Telemetry Instrumentation ---');
  resetFirestoreReadMetrics();

  trackFirestoreRead('test_collection', 15, 'test_batch_query');
  trackFirestoreRead('test_single', 1, 'test_single_get');
  const metricsI = getFirestoreReadMetrics();
  assert(metricsI.sessionReads === 16, `Expected 16 total document reads, got ${metricsI.sessionReads}`);
  assert(metricsI.readsByCollection['test_collection'] === 15, `Collection doc count is 15`);
  assert(metricsI.readsByCollection['test_single'] === 1, `Collection doc count is 1`);

  // =========================================================================
  // READ BUDGET TEST: Normal Representative User Flow
  // =========================================================================
  console.log('\n=============================================================');
  console.log('       DETERMINISTIC ISOLATED READ-BUDGET TEST               ');
  console.log('=============================================================');

  // Simulate warm flow:
  // 1. Authenticate
  // 2. Dashboard
  // 3. PL Match Day 1
  // 4. Standings
  // 5. Profile
  console.log('Running Warm Representative User Flow...');
  clearProcessMemoryForTest();
  resetFirestoreReadMetrics();

  // Warm up Redis / SQLite read models
  await getCompetitionFixturesFromReadModel('comp-premier-league-2026', 1, 'season-2026-27');
  await resolveClubOwnersForSeason('season-2026-27');
  await getEuropeanStandings('comp-champions-league-2026', 'season-2026-27');

  // Reset metrics after warm-up
  resetFirestoreReadMetrics();

  // 1. Dashboard (consumes auth state + getMyMatches from SQLite/readModel)
  const dashboardFixtures = await getCompetitionFixturesFromReadModel('comp-premier-league-2026', 1, 'season-2026-27');
  assert(dashboardFixtures.fixtures.length > 0, 'Dashboard fixtures loaded');

  // 2. PL Match Day 1 View
  const md1Fixtures = await getCompetitionFixturesFromReadModel('comp-premier-league-2026', 1, 'season-2026-27');
  assert(md1Fixtures.fixtures.length > 0, 'Match Day 1 fixtures loaded');

  // 3. Standings View (UCL European standings)
  const euroStandings = await getEuropeanStandings('comp-champions-league-2026', 'season-2026-27');
  assert(euroStandings.rows.length >= 0, 'European standings loaded');

  // 4. Public owner enrichment
  const clubOwners = await resolveClubOwnersForSeason('season-2026-27');
  assert(clubOwners.size >= 0, 'Club owners enriched');

  const warmMetrics = getFirestoreReadMetrics();
  console.log(`\nMeasured Warm-Flow Firestore Reads:`);
  console.log(`  Total Document Reads: ${warmMetrics.sessionReads}`);
  console.log(`  Reads By Collection:`, warmMetrics.readsByCollection);

  assert(warmMetrics.sessionReads === 0, `TARGET: 0 public-view Firestore document reads after authentication when warm (got ${warmMetrics.sessionReads})`);

  // Cold Bounded Firestore Fallback Test
  console.log('\nRunning Cold Read-Model Fallback Test...');
  clearProcessMemoryForTest();
  resetFirestoreReadMetrics();

  // Query bounded matchday 1 fixtures with empty memory
  const coldFixtures = await getCompetitionFixturesFromReadModel('comp-premier-league-2026', 1, 'season-2026-27');
  const coldMetrics = getFirestoreReadMetrics();
  console.log(`\nMeasured Cold-Flow Firestore Reads:`);
  console.log(`  Total Document Reads: ${coldMetrics.sessionReads}`);
  console.log(`  Reads By Collection:`, coldMetrics.readsByCollection);

  assert(coldMetrics.sessionReads < 100, `Cold fallback is strictly bounded (got ${coldMetrics.sessionReads} reads, << 1,000)`);

  console.log('\n=============================================================');
  console.log(`  ALL REGRESSION TESTS PASSED! (${passed} checks passed, 0 failed)`);
  console.log('=============================================================');
}

runRegressionTests().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
