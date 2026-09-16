import { SEED_COMPETITIONS, SEED_CLUBS, SEED_LEAGUES } from '../db/seed';
import {
  compareAdminFixtures,
  encodeFixtureCursor,
  decodeFixtureCursor,
  ReadModelKeys,
  readThroughReadModel,
  getAdminFixturesFromReadModel,
  rebuildAllReadModels,
  getReadModelHealthStatus,
  invalidateClubReadModels,
  invalidateFixtureReadModels,
  invalidateStandingsReadModels,
  invalidateCompetitionReadModels,
  invalidateUserMembershipReadModel,
  ReadModelNotWarmedError,
  setInProcessMemory,
  getFromProcessMemory,
  clearProcessMemoryForTest,
  ReadModelSnapshot,
  SCHEMA_VERSION,
} from '../readModel/readModelStore';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { Fixture, Club } from '../../types/index';

async function runTestSuite() {
  console.log('=============================================================');
  console.log('    DURABLE READ MODEL & ADMIN FIXTURE SORTING TEST SUITE    ');
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

  // =========================================================================
  // TEST 1: EFL CUP ABSENT EVERYWHERE REQUIRED
  // =========================================================================
  console.log('\n--- [TEST 1] EFL Cup Removal & Domestic Cup Counts ---');

  const eflInSeed = SEED_COMPETITIONS.filter(
    (c) => c.id.includes('efl-cup') || c.name.toLowerCase().includes('efl cup')
  );
  assert(eflInSeed.length === 0, 'No EFL Cup found in SEED_COMPETITIONS');

  const domesticCups = SEED_COMPETITIONS.filter((c) => c.type === 'KNOCKOUT');
  assert(
    domesticCups.length === 5,
    `Domestic cups count must be exactly 5 (FA Cup, Copa del Rey, Coppa Italia, DFB-Pokal, Coupe de France), got ${domesticCups.length}`
  );

  const cupIds = domesticCups.map((c) => c.id).sort();
  assert(
    cupIds.includes('comp-fa-cup-2026') &&
      cupIds.includes('comp-copa-del-rey-2026') &&
      cupIds.includes('comp-coppa-italia-2026') &&
      cupIds.includes('comp-dfb-pokal-2026') &&
      cupIds.includes('comp-coupe-de-france-2026') &&
      !cupIds.includes('comp-efl-cup-2026'),
    'Domestic cups contain canonical cups and strictly exclude EFL Cup'
  );

  const totalComps = SEED_COMPETITIONS.length;
  assert(
    totalComps === 17,
    `Total active competitions must be 17 (dropped from 18 following EFL Cup removal), got ${totalComps}`
  );

  // =========================================================================
  // TEST 2: ADMIN FIXTURE STABLE SORT TUPLE & NUMERICAL MATCHDAY ORDER
  // =========================================================================
  console.log('\n--- [TEST 2] Admin Fixture Stable Sort Tuple & MD1..MD11 Ordering ---');

  const mockClub: Club = {
    id: 'club-arsenal',
    name: 'Arsenal',
    shortName: 'ARS',
    country: 'England',
    leagueId: 'league-premier-league',
    logoUrl: '',
    active: true,
    createdAt: '',
  };

  const createMockFixture = (
    id: string,
    competitionId: string,
    matchday: number,
    scheduledAt: string
  ): Fixture => ({
    id,
    competitionId,
    seasonId: 'season-2026-27',
    matchday,
    homeClubId: 'club-arsenal',
    awayClubId: 'club-chelsea',
    homeClub: mockClub,
    awayClub: mockClub,
    scheduledAt,
    status: 'SCHEDULED',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  });

  // Test numerical ordering of matchdays: MD1, MD2, MD3 ... MD9, MD10, MD11
  const fixturesUnsorted: Fixture[] = [
    createMockFixture('fix-11', 'comp-premier-league-2026', 11, '2026-11-01T15:00:00Z'),
    createMockFixture('fix-2', 'comp-premier-league-2026', 2, '2026-08-20T15:00:00Z'),
    createMockFixture('fix-10', 'comp-premier-league-2026', 10, '2026-10-25T15:00:00Z'),
    createMockFixture('fix-1', 'comp-premier-league-2026', 1, '2026-08-15T15:00:00Z'),
    createMockFixture('fix-9', 'comp-premier-league-2026', 9, '2026-10-18T15:00:00Z'),
    createMockFixture('fix-3', 'comp-premier-league-2026', 3, '2026-08-27T15:00:00Z'),
  ];

  const sortedFixtures = [...fixturesUnsorted].sort(compareAdminFixtures);
  const matchdays = sortedFixtures.map((f) => f.matchday);
  console.log('Sorted matchday sequence:', matchdays.join(', '));
  assert(
    JSON.stringify(matchdays) === JSON.stringify([1, 2, 3, 9, 10, 11]),
    'Matchdays sort numerically (1, 2, 3, 9, 10, 11) NOT lexicographically (1, 10, 11, 2, 3, 9)'
  );

  // Test competition order hierarchy (Premier League < La Liga < Serie A < Bundesliga < Ligue 1 < UCL < UEL < UECL < FA Cup ...)
  const mixedCompFixtures: Fixture[] = [
    createMockFixture('fix-ucl', 'comp-champions-league-2026', 1, '2026-09-15T20:00:00Z'),
    createMockFixture('fix-pl', 'comp-premier-league-2026', 1, '2026-08-15T15:00:00Z'),
    createMockFixture('fix-ll', 'comp-la-liga-2026', 1, '2026-08-15T19:00:00Z'),
    createMockFixture('fix-facup', 'comp-fa-cup-2026', 1, '2026-11-05T15:00:00Z'),
  ];

  const sortedComps = [...mixedCompFixtures].sort(compareAdminFixtures);
  assert(sortedComps[0].competitionId === 'comp-premier-league-2026', 'Premier League is 1st in competition hierarchy');
  assert(sortedComps[1].competitionId === 'comp-la-liga-2026', 'La Liga is 2nd in competition hierarchy');
  assert(sortedComps[2].competitionId === 'comp-fa-cup-2026', 'FA Cup follows domestic leagues in canonical order');
  assert(sortedComps[3].competitionId === 'comp-champions-league-2026', 'Champions League follows domestic cups in canonical order');

  // Test scheduledAt and id tie-breaker
  const tieFixtures: Fixture[] = [
    createMockFixture('fix-b', 'comp-premier-league-2026', 1, '2026-08-15T15:00:00Z'),
    createMockFixture('fix-a', 'comp-premier-league-2026', 1, '2026-08-15T15:00:00Z'),
    createMockFixture('fix-later', 'comp-premier-league-2026', 1, '2026-08-15T17:30:00Z'),
  ];
  const sortedTies = [...tieFixtures].sort(compareAdminFixtures);
  assert(sortedTies[0].id === 'fix-a' && sortedTies[1].id === 'fix-b', 'Tie-breaker resolves by ID ascending');
  assert(sortedTies[2].id === 'fix-later', 'Earlier scheduledAt appears before later scheduledAt');

  // =========================================================================
  // TEST 3: CURSOR PAGINATION - ENCODING, ZERO SKIPS, ZERO DUPLICATES
  // =========================================================================
  console.log('\n--- [TEST 3] Cursor Pagination with Complete Sort Tuple ---');

  const cursorTestFix = createMockFixture('fix-test-123', 'comp-premier-league-2026', 5, '2026-09-20T14:00:00.000Z');
  const encodedCursor = encodeFixtureCursor(cursorTestFix);
  const decodedTuple = decodeFixtureCursor(encodedCursor);
  assert(decodedTuple !== null, 'Cursor decodes successfully');
  assert(decodedTuple?.competitionOrder === 1, 'Cursor preserves competitionOrder');
  assert(decodedTuple?.matchday === 5, 'Cursor preserves matchday');
  assert(decodedTuple?.scheduledAt === '2026-09-20T14:00:00.000Z', 'Cursor preserves scheduledAt');
  assert(decodedTuple?.id === 'fix-test-123', 'Cursor preserves fixtureId');

  // Multi-page test with zero skips and zero duplicates
  const allTestFixtures: Fixture[] = [];
  for (let md = 1; md <= 15; md++) {
    for (let f = 1; f <= 4; f++) {
      allTestFixtures.push(
        createMockFixture(
          `fix-md${md}-${f}`,
          'comp-premier-league-2026',
          md,
          `2026-${String(md).padStart(2, '0')}-10T${String(12 + f).padStart(2, '0')}:00:00Z`
        )
      );
    }
  }
  allTestFixtures.sort(compareAdminFixtures);
  assert(allTestFixtures.length === 60, 'Generated 60 fixtures across 15 matchdays');

  // Store in process memory read model
  const testKey = ReadModelKeys.adminFixtures('season-2026-27');
  const snapshot60: ReadModelSnapshot<Fixture[]> = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceVersion: 'test-batch',
    data: allTestFixtures,
  };
  setInProcessMemory(testKey, snapshot60);

  // Paginate with pageSize = 15
  const page1 = await getAdminFixturesFromReadModel({
    seasonId: 'season-2026-27',
    competitionId: 'comp-premier-league-2026',
    limit: 15,
  });
  assert(page1.fixtures.length === 15, `Page 1 has 15 fixtures, got ${page1.fixtures.length}`);
  assert(page1.hasMore === true, 'Page 1 hasMore is true');
  assert(Boolean(page1.nextCursor), 'Page 1 returned a nextCursor');

  const page2 = await getAdminFixturesFromReadModel({
    seasonId: 'season-2026-27',
    competitionId: 'comp-premier-league-2026',
    cursor: page1.nextCursor,
    limit: 15,
  });
  assert(page2.fixtures.length === 15, `Page 2 has 15 fixtures, got ${page2.fixtures.length}`);
  assert(page2.hasMore === true, 'Page 2 hasMore is true');

  const page3 = await getAdminFixturesFromReadModel({
    seasonId: 'season-2026-27',
    competitionId: 'comp-premier-league-2026',
    cursor: page2.nextCursor,
    limit: 15,
  });
  assert(page3.fixtures.length === 15, `Page 3 has 15 fixtures, got ${page3.fixtures.length}`);
  assert(page3.hasMore === true, 'Page 3 hasMore is true');

  const page4 = await getAdminFixturesFromReadModel({
    seasonId: 'season-2026-27',
    competitionId: 'comp-premier-league-2026',
    cursor: page3.nextCursor,
    limit: 15,
  });
  assert(page4.fixtures.length === 15, `Page 4 has 15 fixtures, got ${page4.fixtures.length}`);
  assert(page4.hasMore === false, 'Page 4 hasMore is false');

  // Verify zero duplicates and zero skips
  const allPagedIds = [
    ...page1.fixtures.map((f) => f.id),
    ...page2.fixtures.map((f) => f.id),
    ...page3.fixtures.map((f) => f.id),
    ...page4.fixtures.map((f) => f.id),
  ];
  assert(allPagedIds.length === 60, `Total paginated fixtures is 60, got ${allPagedIds.length}`);
  const uniquePagedIds = new Set(allPagedIds);
  assert(uniquePagedIds.size === 60, `Zero duplicates across all pages (expected 60 unique, got ${uniquePagedIds.size})`);
  assert(
    JSON.stringify(allPagedIds) === JSON.stringify(allTestFixtures.map((f) => f.id)),
    'Zero skips: all items appear in exact deterministic sort order across pages'
  );

  // =========================================================================
  // TEST 4: TIERED READ HIERARCHY & CIRCUIT BREAKER STALE SERVING
  // =========================================================================
  console.log('\n--- [TEST 4] Read-Through Hierarchy, Fresh Snapshot & Circuit Breaker Stale Serving ---');

  const mockKey = 'efluz:v1:season-2026-27:test-data';
  const mockPayload = [{ id: 'item-1', name: 'Item One' }, { id: 'item-2', name: 'Item Two' }];

  // 1. Fresh read when database works
  const freshResult = await readThroughReadModel({
    key: mockKey,
    seasonId: 'season-2026-27',
    firestoreFetcher: async () => mockPayload,
    validateData: (d) => Array.isArray(d) && d.length > 0,
  });
  assert(freshResult.data.length === 2, 'Fresh read returned valid payload');
  assert(!freshResult.stale, 'Fresh read is not marked stale');

  // 2. Trip circuit breaker to OPEN
  firestoreCircuitBreaker.recordFailure(new Error('RESOURCE_EXHAUSTED: Firestore quota exceeded'));
  firestoreCircuitBreaker.recordFailure(new Error('RESOURCE_EXHAUSTED: Firestore quota exceeded'));
  firestoreCircuitBreaker.recordFailure(new Error('RESOURCE_EXHAUSTED: Firestore quota exceeded'));
  firestoreCircuitBreaker.recordFailure(new Error('RESOURCE_EXHAUSTED: Firestore quota exceeded'));
  firestoreCircuitBreaker.recordFailure(new Error('RESOURCE_EXHAUSTED: Firestore quota exceeded'));

  const circuitStatus = firestoreCircuitBreaker.getStatus();
  assert(circuitStatus.state === 'OPEN', 'Firestore circuit breaker is OPEN');

  // 3. Read through should serve stale snapshot without calling failing fetcher
  let fetcherCalled = false;
  const staleResult = await readThroughReadModel({
    key: mockKey,
    seasonId: 'season-2026-27',
    firestoreFetcher: async () => {
      fetcherCalled = true;
      throw new Error('Should not be called when circuit is open');
    },
    validateData: (d) => Array.isArray(d) && d.length > 0,
  });
  assert(!fetcherCalled, 'Firestore fetcher was NOT called when circuit was open');
  assert(staleResult.data.length === 2, 'Returned valid previous snapshot when circuit breaker tripped');
  assert(staleResult.stale === true, 'Result is marked stale');
  assert(staleResult.degraded === true, 'Result is marked degraded');
  assert(staleResult.source.includes('stale') || staleResult.source === 'memory', `Source reflects stale serving (${staleResult.source})`);

  // Reset circuit breaker for remaining tests
  firestoreCircuitBreaker.reset();
  assert(firestoreCircuitBreaker.getStatus().state === 'CLOSED', 'Circuit breaker reset to CLOSED');

  // =========================================================================
  // TEST 5: UN-WARMED READ MODEL RETURNS STRUCTURED 503 ERROR
  // =========================================================================
  console.log('\n--- [TEST 5] Un-Warmed Read Model Structured 503 Rejection ---');

  const unWarmedKey = 'efluz:v1:season-2026-27:non-existent-key';
  let errorThrown: any = null;
  try {
    await readThroughReadModel({
      key: unWarmedKey,
      seasonId: 'season-2026-27',
      firestoreFetcher: async () => {
        throw new Error('Database unreachable');
      },
    });
  } catch (err: any) {
    errorThrown = err;
  }

  assert(errorThrown !== null, 'Exception thrown when both database and read model have no data');
  assert(errorThrown instanceof ReadModelNotWarmedError, 'Thrown error is instance of ReadModelNotWarmedError');
  assert(errorThrown.status === 503, 'Error HTTP status is 503');
  assert(errorThrown.errorCode === 'READ_MODEL_NOT_WARMED', 'Error code is exactly READ_MODEL_NOT_WARMED');

  // =========================================================================
  // TEST 6: MUTATION INVALIDATION SCOPE
  // =========================================================================
  console.log('\n--- [TEST 6] Targeted Mutation Invalidation ---');

  // Set up keys in memory
  const compKey = ReadModelKeys.competitions('season-2026-27');
  const clubsKey = ReadModelKeys.clubsWithOwners('season-2026-27');
  const stdKey = ReadModelKeys.standings('comp-premier-league-2026', 'season-2026-27');
  const userMemKey = ReadModelKeys.userMembership('user-123', 'season-2026-27');

  setInProcessMemory(compKey, { schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), sourceVersion: '1', data: [{ id: 'comp-1' }] });
  setInProcessMemory(clubsKey, { schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), sourceVersion: '1', data: [{ id: 'club-1' }] });
  setInProcessMemory(stdKey, { schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), sourceVersion: '1', data: [{ id: 'std-1' }] });
  setInProcessMemory(userMemKey, { schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), sourceVersion: '1', data: { userId: 'user-123' } });

  // Invalidate club read models only
  await invalidateClubReadModels('season-2026-27');
  assert(getFromProcessMemory(clubsKey) === null, 'Clubs key invalidated');
  assert(getFromProcessMemory(compKey) !== null, 'Competitions key preserved (not over-invalidated)');
  assert(getFromProcessMemory(stdKey) !== null, 'Standings key preserved');

  // Invalidate standings only
  await invalidateStandingsReadModels('comp-premier-league-2026', 'season-2026-27');
  assert(getFromProcessMemory(stdKey) === null, 'Standings key invalidated');
  assert(getFromProcessMemory(compKey) !== null, 'Competitions key preserved');

  // Invalidate user membership only
  await invalidateUserMembershipReadModel('user-123', 'season-2026-27');
  assert(getFromProcessMemory(userMemKey) === null, 'User membership key invalidated');
  assert(getFromProcessMemory(compKey) !== null, 'Competitions key preserved');

  // Invalidate competitions
  await invalidateCompetitionReadModels('season-2026-27');
  assert(getFromProcessMemory(compKey) === null, 'Competitions key invalidated');

  // =========================================================================
  // TEST 7: HEALTH STATUS REPORT
  // =========================================================================
  console.log('\n--- [TEST 7] Read Model Health Status Report ---');

  const health = await getReadModelHealthStatus('season-2026-27');
  assert(Boolean(health.firestoreState), `firestoreState present: ${health.firestoreState}`);
  assert(Boolean(health.redisState), `redisState present: ${health.redisState}`);
  assert(Boolean(health.circuitBreakerState), `circuitBreakerState present: ${health.circuitBreakerState}`);
  assert(Array.isArray(health.warmedKeys), 'warmedKeys is an array');
  assert(Array.isArray(health.missingKeys), 'missingKeys is an array');
  // Check no secrets or credentials leaked
  const healthJson = JSON.stringify(health);
  assert(!healthJson.includes('token') && !healthJson.includes('secret') && !healthJson.includes('http'), 'No secrets or Redis credentials leaked in health check');

  console.log('\n=============================================================');
  console.log(`       TEST SUITE COMPLETED: ${passed} PASSED, ${failed} FAILED      `);
  console.log('=============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test suite uncaught failure:', err);
  process.exit(1);
});
