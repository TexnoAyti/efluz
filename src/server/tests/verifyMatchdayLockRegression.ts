import { initDatabase, queryAll, queryRun } from '../db';
import {
  getMatchdayLockKey,
  invalidateMatchdayLockCache,
  checkFixturePlayability,
  assertMatchdayPlayableFirestore,
} from '../firebase/firestoreStore';

export async function runMatchdayLockRegressionTests(): Promise<boolean> {
  console.log('\n================================================================');
  console.log('  STARTING MATCHDAY LOCK REGRESSION TEST SUITE (A-F)            ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(title: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`✅ PASS: ${title}${details ? ` (${details})` : ''}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${title}${details ? ` (${details})` : ''}`);
      failed++;
    }
  }

  const TEST_SEASON = 'test-season-lock-regression';
  const now = new Date().toISOString();

  try {
    // -------------------------------------------------------------
    // TEST A — SQLite table creation
    // -------------------------------------------------------------
    console.log('\n--- [TEST A] SQLite matchday_locks Table Creation ---');
    await initDatabase();

    const tableRows = queryAll<any>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='matchday_locks'`
    );
    assert('matchday_locks table exists after initDatabase()', tableRows.length === 1);

    const columns = queryAll<any>(`PRAGMA table_info(matchday_locks)`).map((c) => c.name);
    const expectedCols = [
      'id',
      'season_id',
      'competition_id',
      'matchday',
      'override_status',
      'is_open',
      'is_locked',
      'duration_hours',
      'opened_at',
      'locked_at',
      'expires_at',
      'updated_at',
    ];
    const hasAllCols = expectedCols.every((col) => columns.includes(col));
    assert('matchday_locks table contains all required schema columns', hasAllCols, `Cols: ${columns.join(', ')}`);

    const indexRows = queryAll<any>(
      `SELECT name FROM sqlite_master WHERE type='index' AND name='idx_matchday_locks_lookup'`
    );
    assert('idx_matchday_locks_lookup index exists', indexRows.length === 1);

    // -------------------------------------------------------------
    // TEST B — Competition isolation
    // Lock PL MD1 -> UCL MD1, UEL MD1, Cup MD1, PL MD2 unchanged
    // -------------------------------------------------------------
    console.log('\n--- [TEST B] Competition & Matchday Isolation ---');
    // Clean any residual test locks
    queryRun('DELETE FROM matchday_locks WHERE season_id = ?', [TEST_SEASON]);
    invalidateMatchdayLockCache(TEST_SEASON, 'premier-league');
    invalidateMatchdayLockCache(TEST_SEASON, 'ucl');
    invalidateMatchdayLockCache(TEST_SEASON, 'uel');
    invalidateMatchdayLockCache(TEST_SEASON, 'fa-cup');

    // Insert lock strictly for PL MD1
    const plLockId = getMatchdayLockKey(TEST_SEASON, 'premier-league', 1);
    queryRun(
      `INSERT INTO matchday_locks (id, season_id, competition_id, matchday, override_status, is_open, is_locked, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [plLockId, TEST_SEASON, 'premier-league', 1, 'FORCE_LOCKED', 0, 1, now]
    );

    // Verify PL MD1 is locked
    const plMd1Playable = checkFixturePlayability(
      'premier-league',
      TEST_SEASON,
      1,
      'SCHEDULED',
      'club-arsenal',
      'club-chelsea',
      { currentMatchday: 1, isMatchdayOpen: true }
    );
    assert('PL MD1 is recognized as locked', plMd1Playable.isPlayable === false);

    // Verify UCL MD1 is unaffected (no lock row -> uses competition defaults: open)
    const uclMd1Playable = checkFixturePlayability(
      'ucl',
      TEST_SEASON,
      1,
      'SCHEDULED',
      'club-realmadrid',
      'club-bayern',
      { currentMatchday: 1, isMatchdayOpen: true, type: 'KNOCKOUT' }
    );
    assert('UCL MD1 is unchanged and playable', uclMd1Playable.isPlayable === true);

    // Verify UEL MD1 is unaffected
    const uelMd1Playable = checkFixturePlayability(
      'uel',
      TEST_SEASON,
      1,
      'SCHEDULED',
      'club-roma',
      'club-ajax',
      { currentMatchday: 1, isMatchdayOpen: true, type: 'KNOCKOUT' }
    );
    assert('UEL MD1 is unchanged and playable', uelMd1Playable.isPlayable === true);

    // Verify FA Cup MD1 is unaffected
    const cupMd1Playable = checkFixturePlayability(
      'fa-cup',
      TEST_SEASON,
      1,
      'SCHEDULED',
      'club-liverpool',
      'club-everton',
      { currentMatchday: 1, isMatchdayOpen: true, type: 'KNOCKOUT' }
    );
    assert('FA Cup MD1 is unchanged and playable', cupMd1Playable.isPlayable === true);

    // Verify PL MD2 is unaffected (MD1 is locked, MD2 default check where active is 2)
    const plMd2Playable = checkFixturePlayability(
      'premier-league',
      TEST_SEASON,
      2,
      'SCHEDULED',
      'club-mancity',
      'club-tottenham',
      { currentMatchday: 2, isMatchdayOpen: true }
    );
    assert('PL MD2 is unchanged and playable', plMd2Playable.isPlayable === true);

    // -------------------------------------------------------------
    // TEST C — Granular override precedence (FORCE_OPEN over comp-level locked)
    // -------------------------------------------------------------
    console.log('\n--- [TEST C] Granular Override Precedence (FORCE_OPEN) ---');
    // Set PL MD1 to FORCE_OPEN
    queryRun(
      `UPDATE matchday_locks SET override_status = 'FORCE_OPEN', is_open = 1, is_locked = 0, updated_at = ? WHERE id = ?`,
      [now, plLockId]
    );
    invalidateMatchdayLockCache(TEST_SEASON, 'premier-league', 1);

    // Comp level is explicitly locked: isMatchdayOpen = false, adminOverrideStatus = 'FORCE_LOCKED'
    const compLockedState = {
      currentMatchday: 1,
      isMatchdayOpen: false,
      adminOverrideStatus: 'FORCE_LOCKED' as any,
    };

    const plMd1ForcedOpen = checkFixturePlayability(
      'premier-league',
      TEST_SEASON,
      1,
      'SCHEDULED',
      'club-arsenal',
      'club-chelsea',
      compLockedState
    );
    assert(
      'checkFixturePlayability(PL MD1) is playable when granular lock is FORCE_OPEN despite competition-level lock',
      plMd1ForcedOpen.isPlayable === true
    );

    // -------------------------------------------------------------
    // TEST D — Granular lock precedence (FORCE_LOCKED over comp-level open)
    // -------------------------------------------------------------
    console.log('\n--- [TEST D] Granular Lock Precedence (FORCE_LOCKED) ---');
    // Set PL MD1 to FORCE_LOCKED
    queryRun(
      `UPDATE matchday_locks SET override_status = 'FORCE_LOCKED', is_open = 0, is_locked = 1, updated_at = ? WHERE id = ?`,
      [now, plLockId]
    );
    invalidateMatchdayLockCache(TEST_SEASON, 'premier-league', 1);

    // Comp level is explicitly open: isMatchdayOpen = true, adminOverrideStatus = 'FORCE_OPEN'
    const compOpenState = {
      currentMatchday: 1,
      isMatchdayOpen: true,
      adminOverrideStatus: 'FORCE_OPEN' as any,
    };

    const plMd1ForcedLocked = checkFixturePlayability(
      'premier-league',
      TEST_SEASON,
      1,
      'SCHEDULED',
      'club-arsenal',
      'club-chelsea',
      compOpenState
    );
    assert(
      'checkFixturePlayability(PL MD1) is locked when granular lock is FORCE_LOCKED despite competition-level open',
      plMd1ForcedLocked.isPlayable === false
    );

    // -------------------------------------------------------------
    // TEST E — Result submission consistency
    // checkFixturePlayability and assertMatchdayPlayableFirestore must agree
    // -------------------------------------------------------------
    console.log('\n--- [TEST E] Result Submission Consistency ---');
    // Case 1: Granular lock is FORCE_LOCKED
    const md1LockedCheck = checkFixturePlayability(
      'premier-league',
      TEST_SEASON,
      1,
      'SCHEDULED',
      'club-arsenal',
      'club-chelsea',
      compOpenState
    );
    assert('checkFixturePlayability indicates NOT playable when locked', md1LockedCheck.isPlayable === false);

    let assertThrew = false;
    let errorCode = '';
    try {
      await assertMatchdayPlayableFirestore(TEST_SEASON, 'premier-league', 1);
    } catch (err: any) {
      assertThrew = true;
      errorCode = err.code || err.message;
    }
    assert('assertMatchdayPlayableFirestore threw MATCHDAY_LOCKED error', assertThrew && errorCode === 'MATCHDAY_LOCKED', `Code: ${errorCode}`);

    // Case 2: Granular lock is FORCE_OPEN
    queryRun(
      `UPDATE matchday_locks SET override_status = 'FORCE_OPEN', is_open = 1, is_locked = 0, updated_at = ? WHERE id = ?`,
      [now, plLockId]
    );
    invalidateMatchdayLockCache(TEST_SEASON, 'premier-league', 1);

    const md1OpenCheck = checkFixturePlayability(
      'premier-league',
      TEST_SEASON,
      1,
      'SCHEDULED',
      'club-arsenal',
      'club-chelsea',
      compLockedState
    );
    assert('checkFixturePlayability indicates playable when FORCE_OPEN', md1OpenCheck.isPlayable === true);

    let assertAllowed = true;
    try {
      await assertMatchdayPlayableFirestore(TEST_SEASON, 'premier-league', 1);
    } catch {
      assertAllowed = false;
    }
    assert('assertMatchdayPlayableFirestore allows execution when FORCE_OPEN', assertAllowed);

    // -------------------------------------------------------------
    // TEST F — SQLite fallback behavior
    // If in-memory cache is empty, checkFixturePlayability resolves from SQLite correctly
    // -------------------------------------------------------------
    console.log('\n--- [TEST F] SQLite Fallback When In-Memory Cache Is Empty ---');
    // Set SQLite to FORCE_LOCKED
    queryRun(
      `UPDATE matchday_locks SET override_status = 'FORCE_LOCKED', is_open = 0, is_locked = 1, updated_at = ? WHERE id = ?`,
      [now, plLockId]
    );
    // Invalidate in-memory cache completely
    invalidateMatchdayLockCache(TEST_SEASON, 'premier-league', 1);

    // Call checkFixturePlayability with no preloadedLock
    const sqliteResolvedLocked = checkFixturePlayability(
      'premier-league',
      TEST_SEASON,
      1,
      'SCHEDULED',
      'club-arsenal',
      'club-chelsea',
      { currentMatchday: 1, isMatchdayOpen: true }
    );
    assert(
      'Cold cache resolves FORCE_LOCKED correctly from SQLite without throwing',
      sqliteResolvedLocked.isPlayable === false
    );

    // Now set SQLite to FORCE_OPEN and clear cache again
    queryRun(
      `UPDATE matchday_locks SET override_status = 'FORCE_OPEN', is_open = 1, is_locked = 0, updated_at = ? WHERE id = ?`,
      [now, plLockId]
    );
    invalidateMatchdayLockCache(TEST_SEASON, 'premier-league', 1);

    const sqliteResolvedOpen = checkFixturePlayability(
      'premier-league',
      TEST_SEASON,
      1,
      'SCHEDULED',
      'club-arsenal',
      'club-chelsea',
      { currentMatchday: 1, isMatchdayOpen: false }
    );
    assert(
      'Cold cache resolves FORCE_OPEN correctly from SQLite without throwing',
      sqliteResolvedOpen.isPlayable === true
    );
  } finally {
    // -------------------------------------------------------------
    // CLEANUP — Never leave test rows or dirty caches
    // -------------------------------------------------------------
    console.log('\n--- Cleaning up test artifacts ---');
    try {
      queryRun('DELETE FROM matchday_locks WHERE season_id = ?', [TEST_SEASON]);
      invalidateMatchdayLockCache(TEST_SEASON, 'premier-league');
      invalidateMatchdayLockCache(TEST_SEASON, 'ucl');
      invalidateMatchdayLockCache(TEST_SEASON, 'uel');
      invalidateMatchdayLockCache(TEST_SEASON, 'fa-cup');
      console.log('🧹 Cleaned up SQLite test rows and cache entries.');
    } catch (cleanupErr: any) {
      console.warn('⚠️ Cleanup warning:', cleanupErr?.message);
    }
  }

  console.log('\n================================================================');
  console.log(`  MATCHDAY LOCK REGRESSION TEST RESULTS: ${passed} PASSED, ${failed} FAILED `);
  console.log('================================================================\n');

  return failed === 0;
}

if (process.argv[1] && process.argv[1].includes('verifyMatchdayLockRegression')) {
  runMatchdayLockRegressionTests()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Fatal error during regression tests:', err);
      process.exit(1);
    });
}
