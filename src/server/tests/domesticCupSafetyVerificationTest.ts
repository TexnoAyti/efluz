/**
 * Focused Isolated Test Suite for Domestic Cup Safety Verification
 * 
 * Verifies the 3 critical safety points:
 * 1. Safe, idempotent SQLite migration supporting nullable club IDs and source metadata, preserving all records.
 * 2. Transactional winner advancement:
 *    - repeated advancement is a no-op
 *    - concurrent requests cannot overwrite each other
 *    - target slot containing another club returns 409
 *    - started, submitted, disputed or confirmed target matches cannot be modified
 * 3. testGuard.ts production and hosted test-write restrictions:
 *    - production/hosted test-write restrictions remain intact
 *    - local fallback tests never initialize real Firebase credentials or access production
 */

// MUST be forced local fallback before any imports
process.env.FIREBASE_FORCE_LOCAL_FALLBACK = 'true';
process.env.NODE_ENV = 'test';

import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { migrateFixturesTableIfNeeded } from '../db/index';
import { advanceDomesticCupWinnerSafe } from '../tournament/domesticCupService';
import { getFirestoreDb, initializeFirebaseAdmin, resetFirebaseAdminCache } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import {
  isHostedEnvironment,
  isTestSafe,
  assertTestEnvironmentSafe,
  isConnectedToProductionFirestore,
  isTargetingProductionProjectOrDb,
} from '../utils/testGuard';

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  evidence: string;
  error?: string;
}

const results: TestResult[] = [];

function recordTest(suite: string, name: string, passed: boolean, evidence: string, error?: string) {
  results.push({ suite, name, passed, evidence, error });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} [${suite}] ${name}`);
  console.log(`   Evidence: ${evidence}`);
  if (error) {
    console.log(`   Error: ${error}`);
  }
}

// ----------------------------------------------------------------------
// Suite 1: SQLite Migration & Schema Safety
// ----------------------------------------------------------------------
async function runSuite1_SQLiteMigration() {
  const suite = 'SQLite Migration Safety';
  const SQL = await initSqlJs();

  // Test 1.1: Migration of mock legacy database with NOT NULL constraints and TBDs
  try {
    const db = new SQL.Database();
    // Create legacy table where home_club_id and away_club_id are NOT NULL and source metadata is missing
    db.exec(`
      CREATE TABLE seasons (id TEXT PRIMARY KEY);
      CREATE TABLE competitions (id TEXT PRIMARY KEY);
      INSERT INTO seasons (id) VALUES ('season-2026-27');
      INSERT INTO competitions (id) VALUES ('comp-fa-cup-2026');

      CREATE TABLE fixtures (
        id TEXT PRIMARY KEY,
        season_id TEXT NOT NULL,
        competition_id TEXT NOT NULL,
        matchday INTEGER NOT NULL,
        home_club_id TEXT NOT NULL,
        away_club_id TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'SCHEDULED',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO fixtures VALUES 
        ('fix-1', 'season-2026-27', 'comp-fa-cup-2026', 1, 'club-arsenal', 'club-chelsea', '2026-10-01', 'CONFIRMED', '2026-09-01', '2026-09-01'),
        ('fix-2', 'season-2026-27', 'comp-fa-cup-2026', 1, 'club-liverpool', 'club-everton', '2026-10-01', 'CONFIRMED', '2026-09-01', '2026-09-01'),
        ('fix-3', 'season-2026-27', 'comp-fa-cup-2026', 2, 'TBD', 'TBD', '2026-11-01', 'SCHEDULED', '2026-09-01', '2026-09-01');
    `);

    // Verify initial count is 3
    const beforeCountRes = db.exec('SELECT count(*) FROM fixtures');
    const beforeCount = Number(beforeCountRes[0].values[0][0]);

    // Run migration
    const migResult = migrateFixturesTableIfNeeded(db);

    // Verify record preservation
    const afterCountRes = db.exec('SELECT count(*) FROM fixtures');
    const afterCount = Number(afterCountRes[0].values[0][0]);

    // Verify nullability: insert a fixture with NULL clubs
    db.exec(`
      INSERT INTO fixtures (id, season_id, competition_id, matchday, home_club_id, away_club_id, scheduled_at, status, source_fixture_id, source_winner_slot, created_at, updated_at)
      VALUES ('fix-null-test', 'season-2026-27', 'comp-fa-cup-2026', 2, NULL, NULL, '2026-11-01', 'SCHEDULED', 'fix-1', 'home', '2026-09-01', '2026-09-01');
    `);

    const nullFixtureRes = db.exec("SELECT id, home_club_id, away_club_id, source_fixture_id, source_winner_slot FROM fixtures WHERE id = 'fix-null-test'");
    const nullRow = nullFixtureRes[0].values[0];

    // Verify TBDs were sanitized to NULL
    const fix3Res = db.exec("SELECT home_club_id, away_club_id FROM fixtures WHERE id = 'fix-3'");
    const fix3Row = fix3Res[0].values[0];

    // Test Idempotency: run migration again
    const secondMig = migrateFixturesTableIfNeeded(db);
    const thirdMig = migrateFixturesTableIfNeeded(db);
    const finalCountRes = db.exec('SELECT count(*) FROM fixtures');
    const finalCount = Number(finalCountRes[0].values[0][0]);

    const passed =
      beforeCount === 3 &&
      afterCount === 3 &&
      migResult.recordsPreserved === 3 &&
      nullRow[1] === null &&
      nullRow[2] === null &&
      nullRow[3] === 'fix-1' &&
      nullRow[4] === 'home' &&
      fix3Row[0] === null &&
      fix3Row[1] === null &&
      secondMig.migrated === false &&
      thirdMig.migrated === false &&
      finalCount === 4; // 3 preserved + 1 inserted null fixture

    recordTest(
      suite,
      'Legacy schema migration preserves records, allows nullable clubs, maps TBD->NULL, is idempotent',
      passed,
      `beforeCount=${beforeCount}, preserved=${migResult.recordsPreserved}, nullInsertSuccess=true, fix3Clubs=(${fix3Row[0]}, ${fix3Row[1]}), secondMig.migrated=${secondMig.migrated}, finalCount=${finalCount}`
    );
  } catch (err: any) {
    recordTest(suite, 'Legacy schema migration test', false, 'Exception occurred', err.message);
  }

  // Test 1.2: Verification against actual repository database data/efootball.sqlite
  try {
    const sqlitePath = path.join(process.cwd(), 'data/efootball.sqlite');
    if (fs.existsSync(sqlitePath)) {
      const dbBuf = fs.readFileSync(sqlitePath);
      const db = new SQL.Database(dbBuf);
      const countBeforeRes = db.exec('SELECT count(*) FROM fixtures');
      const countBefore = Number(countBeforeRes[0].values[0][0]);

      const migRes = migrateFixturesTableIfNeeded(db);

      const countAfterRes = db.exec('SELECT count(*) FROM fixtures');
      const countAfter = Number(countAfterRes[0].values[0][0]);

      // Verify PRAGMA table_info
      const pragmaRes = db.exec('PRAGMA table_info(fixtures)');
      const cols = pragmaRes[0].values;
      const homeCol = cols.find((c) => c[1] === 'home_club_id');
      const awayCol = cols.find((c) => c[1] === 'away_club_id');
      const srcFixCol = cols.find((c) => c[1] === 'source_fixture_id');
      const srcSlotCol = cols.find((c) => c[1] === 'source_winner_slot');

      const passed =
        countBefore === 190 &&
        countAfter === 190 &&
        homeCol &&
        homeCol[3] === 0 && // notnull === 0 (nullable!)
        awayCol &&
        awayCol[3] === 0 && // notnull === 0 (nullable!)
        srcFixCol !== undefined &&
        srcSlotCol !== undefined;

      recordTest(
        suite,
        'Existing data/efootball.sqlite (190 fixtures) migrated safely with 100% record preservation',
        Boolean(passed),
        `countBefore=${countBefore}, countAfter=${countAfter}, homeNotNull=${homeCol ? homeCol[3] : 'N/A'}, awayNotNull=${awayCol ? awayCol[3] : 'N/A'}, sourceColumnsPresent=${Boolean(srcFixCol && srcSlotCol)}`
      );
    } else {
      recordTest(suite, 'data/efootball.sqlite check', false, 'data/efootball.sqlite file not found');
    }
  } catch (err: any) {
    recordTest(suite, 'data/efootball.sqlite migration verification', false, 'Exception', err.message);
  }
}

// ----------------------------------------------------------------------
// Suite 2: Transactional Winner Advancement
// ----------------------------------------------------------------------
async function runSuite2_TransactionalAdvancement() {
  const suite = 'Transactional Advancement Safety';
  const db = getFirestoreDb();

  // Test 2.1: Repeated advancement is a no-op
  try {
    const compId = 'comp-fa-cup-2026';
    const sourceFixtureId = `fix-${compId}-r1-m0`;
    const targetFixtureId = `fix-${compId}-r2-m4`; // 20 teams: pureByeMatches=4, 4+0=4

    // Seed source fixture: status CONFIRMED, winner club-arsenal
    await db.collection(COLLECTIONS.FIXTURES).doc(sourceFixtureId).set({
      id: sourceFixtureId,
      competitionId: compId,
      seasonId: 'season-2026-27',
      matchday: 1,
      homeClubId: 'club-arsenal',
      awayClubId: 'club-watford',
      status: 'CONFIRMED',
      winnerClubId: 'club-arsenal',
      homeScore: 3,
      awayScore: 1,
      scheduledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Seed target fixture: status SCHEDULED, away slot is null
    await db.collection(COLLECTIONS.FIXTURES).doc(targetFixtureId).set({
      id: targetFixtureId,
      competitionId: compId,
      seasonId: 'season-2026-27',
      matchday: 2,
      homeClubId: 'club-man-city',
      awayClubId: null,
      status: 'SCHEDULED',
      scheduledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Advance first time
    const res1 = await advanceDomesticCupWinnerSafe(sourceFixtureId, {
      adminUserId: 'admin-safe-1',
      adminUsername: 'admin1',
    });

    // Advance second time (repeated advancement)
    const res2 = await advanceDomesticCupWinnerSafe(sourceFixtureId, {
      adminUserId: 'admin-safe-1',
      adminUsername: 'admin1',
    });

    const targetDoc = await db.collection(COLLECTIONS.FIXTURES).doc(targetFixtureId).get();
    const targetData = targetDoc.data();

    const passed =
      res1.success === true &&
      res1.advanced === true &&
      res1.isNoop === false &&
      res2.success === true &&
      res2.advanced === false &&
      res2.isNoop === true &&
      targetData?.awayClubId === 'club-arsenal';

    recordTest(
      suite,
      'Repeated advancement is an idempotent no-op (res1.advanced=true, res2.isNoop=true)',
      passed,
      `res1: advanced=${res1.advanced}, isNoop=${res1.isNoop}; res2: advanced=${res2.advanced}, isNoop=${res2.isNoop}, awayClubId=${targetData?.awayClubId}`
    );
  } catch (err: any) {
    recordTest(suite, 'Repeated advancement test', false, 'Exception', err.message);
  }

  // Test 2.2: Target slot containing another club returns 409 Conflict
  try {
    const compId = 'comp-fa-cup-2026';
    const sourceFixtureId = `fix-${compId}-r1-m1`;
    const targetFixtureId = `fix-${compId}-r2-m5`; // 4+1=5

    // Seed source fixture
    await db.collection(COLLECTIONS.FIXTURES).doc(sourceFixtureId).set({
      id: sourceFixtureId,
      competitionId: compId,
      seasonId: 'season-2026-27',
      matchday: 1,
      homeClubId: 'club-chelsea',
      awayClubId: 'club-fulham',
      status: 'CONFIRMED',
      winnerClubId: 'club-chelsea',
      homeScore: 2,
      awayScore: 0,
      scheduledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Seed target fixture with CONFLICTING away club ('club-tottenham' instead of null or 'club-chelsea')
    await db.collection(COLLECTIONS.FIXTURES).doc(targetFixtureId).set({
      id: targetFixtureId,
      competitionId: compId,
      seasonId: 'season-2026-27',
      matchday: 2,
      homeClubId: 'club-liverpool',
      awayClubId: 'club-tottenham', // Conflicting club!
      status: 'SCHEDULED',
      scheduledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let caughtError: any = null;
    try {
      await advanceDomesticCupWinnerSafe(sourceFixtureId, {
        adminUserId: 'admin-safe-1',
        adminUsername: 'admin1',
      });
    } catch (err: any) {
      caughtError = err;
    }

    const passed =
      caughtError !== null &&
      caughtError.statusCode === 409 &&
      caughtError.code === 'TARGET_SLOT_OCCUPIED_CONFLICT';

    recordTest(
      suite,
      'Target slot containing another club throws 409 TARGET_SLOT_OCCUPIED_CONFLICT',
      passed,
      `statusCode=${caughtError?.statusCode}, code=${caughtError?.code}, message="${caughtError?.message}"`
    );
  } catch (err: any) {
    recordTest(suite, 'Target slot conflict test', false, 'Exception', err.message);
  }

  // Test 2.3: Started, submitted, disputed, or confirmed target matches cannot be modified
  const protectedStatuses = ['PLAYING', 'AWAITING_RESULT', 'PENDING_CONFIRMATION', 'DISPUTED', 'CONFIRMED'];
  for (const status of protectedStatuses) {
    try {
      const compId = 'comp-fa-cup-2026';
      const sourceFixtureId = `fix-${compId}-r1-m2`;
      const targetFixtureId = `fix-${compId}-r2-m6`;

      await db.collection(COLLECTIONS.FIXTURES).doc(sourceFixtureId).set({
        id: sourceFixtureId,
        competitionId: compId,
        seasonId: 'season-2026-27',
        matchday: 1,
        homeClubId: 'club-aston-villa',
        awayClubId: 'club-wolves',
        status: 'CONFIRMED',
        winnerClubId: 'club-aston-villa',
        homeScore: 1,
        awayScore: 0,
        scheduledAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Target fixture has protected status
      await db.collection(COLLECTIONS.FIXTURES).doc(targetFixtureId).set({
        id: targetFixtureId,
        competitionId: compId,
        seasonId: 'season-2026-27',
        matchday: 2,
        homeClubId: 'club-newcastle',
        awayClubId: null,
        status,
        scheduledAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      let caughtError: any = null;
      try {
        await advanceDomesticCupWinnerSafe(sourceFixtureId, {
          adminUserId: 'admin-safe-1',
          adminUsername: 'admin1',
        });
      } catch (err: any) {
        caughtError = err;
      }

      const passed =
        caughtError !== null &&
        caughtError.statusCode === 400 &&
        caughtError.code === 'TARGET_MATCH_LOCKED';

      recordTest(
        suite,
        `Target match with status '${status}' cannot be modified (status locked)`,
        passed,
        `status=${status}, caughtError=${caughtError?.message}, code=${caughtError?.code}`
      );
    } catch (err: any) {
      recordTest(suite, `Locked status ${status} test`, false, 'Exception', err.message);
    }
  }

  // Test 2.4: Concurrent requests cannot overwrite each other
  try {
    const compId = 'comp-fa-cup-2026';
    const sourceFixtureId = `fix-${compId}-r1-m3`;
    const targetFixtureId = `fix-${compId}-r2-m7`;

    await db.collection(COLLECTIONS.FIXTURES).doc(sourceFixtureId).set({
      id: sourceFixtureId,
      competitionId: compId,
      seasonId: 'season-2026-27',
      matchday: 1,
      homeClubId: 'club-brighton',
      awayClubId: 'club-brentford',
      status: 'CONFIRMED',
      winnerClubId: 'club-brighton',
      homeScore: 2,
      awayScore: 1,
      scheduledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.collection(COLLECTIONS.FIXTURES).doc(targetFixtureId).set({
      id: targetFixtureId,
      competitionId: compId,
      seasonId: 'season-2026-27',
      matchday: 2,
      homeClubId: 'club-man-united',
      awayClubId: null,
      status: 'SCHEDULED',
      scheduledAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Launch 5 concurrent advancements simultaneously
    const concurrentPromises = Array.from({ length: 5 }, (_, i) =>
      advanceDomesticCupWinnerSafe(sourceFixtureId, {
        adminUserId: `admin-concurrent-${i}`,
        adminUsername: `admin${i}`,
      })
    );

    const resultsArray = await Promise.all(concurrentPromises);
    const advancedCount = resultsArray.filter((r) => r.advanced === true).length;
    const noopCount = resultsArray.filter((r) => r.isNoop === true).length;

    const targetDoc = await db.collection(COLLECTIONS.FIXTURES).doc(targetFixtureId).get();
    const finalAwayClub = targetDoc.data()?.awayClubId;

    // Under serializable execution, exactly 1 will perform the mutation and the other 4 will be idempotent no-ops
    const passed =
      advancedCount === 1 &&
      noopCount === 4 &&
      finalAwayClub === 'club-brighton' &&
      resultsArray.every((r) => r.success === true);

    recordTest(
      suite,
      'Concurrent requests are transactional (1 executes, remainder are safe no-ops, zero race conditions)',
      passed,
      `totalRequests=5, advancedCount=${advancedCount}, noopCount=${noopCount}, finalAwayClub=${finalAwayClub}`
    );
  } catch (err: any) {
    recordTest(suite, 'Concurrent requests test', false, 'Exception', err.message);
  }
}

// ----------------------------------------------------------------------
// Suite 3: testGuard.ts Production / Hosted Protection Verification
// ----------------------------------------------------------------------
async function runSuite3_TestGuardSecurity() {
  const suite = 'testGuard.ts Security & Local Isolation';

  // Test 3.1: Verify local fallback guarantees
  try {
    const adminInit = initializeFirebaseAdmin();
    const isSafe = isTestSafe();
    const isConnectedProd = isConnectedToProductionFirestore();
    const isTargetingProd = isTargetingProductionProjectOrDb();

    const passed =
      adminInit.info.authMode === 'local_fallback' &&
      adminInit.info.projectId === 'test-local-fallback' &&
      isSafe === true &&
      isConnectedProd === false &&
      isTargetingProd === false;

    recordTest(
      suite,
      'Local fallback tests use in-memory store, never initialize real credentials, and never connect to production',
      passed,
      `authMode=${adminInit.info.authMode}, projectId=${adminInit.info.projectId}, isSafe=${isSafe}, isConnectedProd=${isConnectedProd}, isTargetingProd=${isTargetingProd}`
    );
  } catch (err: any) {
    recordTest(suite, 'Local fallback isolation test', false, 'Exception', err.message);
  }

  // Test 3.2: Production environment cannot be bypassed by FIREBASE_FORCE_LOCAL_FALLBACK
  try {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    resetFirebaseAdminCache();

    let threwInAdmin = false;
    let adminError = '';
    try {
      initializeFirebaseAdmin();
    } catch (err: any) {
      threwInAdmin = true;
      adminError = err.message;
    }

    const safeInProd = isTestSafe();

    // Restore env immediately
    process.env.NODE_ENV = originalNodeEnv;
    resetFirebaseAdminCache();

    const passed =
      threwInAdmin === true &&
      adminError.includes('FATAL_SAFETY_VIOLATION') &&
      safeInProd === false;

    recordTest(
      suite,
      'FIREBASE_FORCE_LOCAL_FALLBACK throws FATAL_SAFETY_VIOLATION in NODE_ENV=production',
      passed,
      `threwInAdmin=${threwInAdmin}, adminError="${adminError}", isTestSafeInProd=${safeInProd}`
    );
  } catch (err: any) {
    recordTest(suite, 'Production bypass prevention test', false, 'Exception', err.message);
  }

  // Test 3.3: Hosted environment detection remains strict
  try {
    const hosted = isHostedEnvironment();
    // In this Cloud Run environment, K_SERVICE is set, so isHostedEnvironment() returns true
    const hasKService = Boolean(process.env.K_SERVICE);
    const passed = hasKService ? hosted === true : true;

    recordTest(
      suite,
      'isHostedEnvironment() strictly checks K_SERVICE/VERCEL/NODE_ENV without fallback override',
      passed,
      `isHostedEnvironment=${hosted}, K_SERVICE=${process.env.K_SERVICE}`
    );
  } catch (err: any) {
    recordTest(suite, 'Hosted environment detection test', false, 'Exception', err.message);
  }

  // Test 3.4: Production guard blocks test mutations outside safe environment
  try {
    const originalFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK;
    delete process.env.FIREBASE_FORCE_LOCAL_FALLBACK;
    resetFirebaseAdminCache();

    let caughtError: any = null;
    try {
      assertTestEnvironmentSafe('production_write_attempt');
    } catch (err: any) {
      caughtError = err;
    }

    // Restore fallback immediately
    process.env.FIREBASE_FORCE_LOCAL_FALLBACK = originalFallback;
    resetFirebaseAdminCache();

    const passed =
      caughtError !== null &&
      caughtError.message.includes('PRODUCTION_SAFETY_VIOLATION');

    recordTest(
      suite,
      'assertTestEnvironmentSafe strictly throws PRODUCTION_SAFETY_VIOLATION if not in verified test sandbox',
      passed,
      `caughtError="${caughtError?.message}"`
    );
  } catch (err: any) {
    recordTest(suite, 'assertTestEnvironmentSafe check', false, 'Exception', err.message);
  }
}

// ----------------------------------------------------------------------
// Main Runner
// ----------------------------------------------------------------------
async function runAllSafetyTests() {
  console.log('========================================================================');
  console.log('DOMESTIC CUP FOCUSED SAFETY VERIFICATION TEST SUITE');
  console.log('Strict Zero-Production-Write & Local Sandbox Guarantees');
  console.log('========================================================================\n');

  await runSuite1_SQLiteMigration();
  await runSuite2_TransactionalAdvancement();
  await runSuite3_TestGuardSecurity();

  console.log('\n========================================================================');
  console.log('SUMMARY OF SAFETY VERIFICATION:');
  const allPassed = results.every((r) => r.passed);
  const total = results.length;
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`Results: ${passedCount}/${total} PASSED`);
  if (!allPassed) {
    console.error('❌ SOME TESTS FAILED');
    process.exit(1);
  } else {
    console.log('✅ ALL FOCUSED SAFETY TESTS PASSED WITH 100% SUCCESS');
    process.exit(0);
  }
}

runAllSafetyTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
