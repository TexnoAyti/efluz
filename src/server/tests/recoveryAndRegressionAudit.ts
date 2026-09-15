/**
 * REGRESSION AND SAFETY VERIFICATION AUDIT
 *
 * Verifies:
 * 1. getAdminFixturesPagedFirestore pagination and FieldPath.documentId() runtime execution.
 * 2. Undefined/invalid club claim rejection in both client API and backend route.
 * 3. Default-deny safety enforcement: assertTestEnvironmentSafe and assertNoSyntheticIdsInProduction.
 * 4. Post-recovery state integrity across restored clubs and fixtures.
 */

import { getAdminFixturesPagedFirestore } from '../firebase/firestoreStore';
import { assertTestEnvironmentSafe, assertNoSyntheticIdsInProduction, isSyntheticIdentifier } from '../utils/testGuard';
import { api } from '../../lib/api';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';

async function runRegressionAudit() {
  console.log('================================================================');
  console.log('       REGRESSION & PRODUCTION SAFETY VERIFICATION AUDIT');
  console.log('================================================================');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, description: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${description}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${description}`);
      failed++;
    }
  }

  // --- TEST 1: Admin Fixture Pagination and FieldPath.documentId() ---
  console.log('\n[TEST 1] Admin Fixture Pagination & FieldPath Stability...');
  try {
    const page1 = await getAdminFixturesPagedFirestore({
      limit: 5,
      seasonId: 'season-2026-27',
    });

    assert(Array.isArray(page1.fixtures), 'getAdminFixturesPagedFirestore returns fixtures array');
    assert(page1.fixtures.length <= 5, 'Page 1 respects limit boundary');
    assert(typeof page1.total === 'number' && page1.total >= 0, 'Total count aggregation returned valid number');
    assert(!page1.errorCode, `No error code returned on page 1 (errorCode: ${page1.errorCode || 'none'})`);

    if (page1.nextCursor && page1.fixtures.length > 0) {
      const page2 = await getAdminFixturesPagedFirestore({
        limit: 5,
        cursor: page1.nextCursor,
        seasonId: 'season-2026-27',
      });
      assert(Array.isArray(page2.fixtures), 'Page 2 returns fixtures array with cursor');
      assert(!page2.errorCode, 'Page 2 executed without errors using FieldPath cursor');
    }
  } catch (err: any) {
    assert(false, `getAdminFixturesPagedFirestore threw unexpected error: ${err.message}`);
  }

  // --- TEST 2: Undefined / Invalid Club Claim Protections ---
  console.log('\n[TEST 2] Undefined and Malformed Club Claim Guards...');
  try {
    let clientThrew = false;
    try {
      await api.claimClub('undefined');
    } catch (err: any) {
      clientThrew = true;
      assert(err.message.includes('INVALID_CLUB_ID'), 'api.claimClub rejects "undefined" with INVALID_CLUB_ID error');
    }
    assert(clientThrew, 'api.claimClub threw error for "undefined" ID');

    let clientThrewNull = false;
    try {
      await api.claimClub('null' as any);
    } catch (err: any) {
      clientThrewNull = true;
      assert(err.message.includes('INVALID_CLUB_ID'), 'api.claimClub rejects "null" with INVALID_CLUB_ID error');
    }
    assert(clientThrewNull, 'api.claimClub threw error for "null" ID');

    let clientThrewInvalidPrefix = false;
    try {
      await api.claimClub('random-id-123' as any);
    } catch (err: any) {
      clientThrewInvalidPrefix = true;
      assert(err.message.includes('INVALID_CLUB_ID'), 'api.claimClub rejects non "club-" prefixed ID');
    }
    assert(clientThrewInvalidPrefix, 'api.claimClub threw error for non "club-" prefix');
  } catch (err: any) {
    assert(false, `Club claim client guard test failed: ${err.message}`);
  }

  // --- TEST 3: Default-Deny Safety Guards ---
  console.log('\n[TEST 3] Production Safety Guard Validation...');
  try {
    let testMutationBlocked = false;
    try {
      assertTestEnvironmentSafe('audit_write_test');
    } catch (err: any) {
      testMutationBlocked = true;
      assert(err.message.includes('PRODUCTION_SAFETY_VIOLATION'), 'assertTestEnvironmentSafe blocks mutations against production');
    }
    assert(testMutationBlocked, 'assertTestEnvironmentSafe threw when connected to production');

    let syntheticIdBlocked = false;
    try {
      assertNoSyntheticIdsInProduction('create_membership', ['audit-claimant-123']);
    } catch (err: any) {
      syntheticIdBlocked = true;
      assert(err.message.includes('PRODUCTION_SAFETY_VIOLATION'), 'assertNoSyntheticIdsInProduction blocks synthetic identifiers');
    }
    assert(syntheticIdBlocked, 'assertNoSyntheticIdsInProduction threw for synthetic audit- ID');

    assert(isSyntheticIdentifier('audit-claimant-999'), 'isSyntheticIdentifier recognizes audit- prefix');
    assert(isSyntheticIdentifier('test_user_sunderland'), 'isSyntheticIdentifier recognizes test_ prefix');
    assert(isSyntheticIdentifier('user-regression-test-a'), 'isSyntheticIdentifier recognizes test pattern');
    assert(!isSyntheticIdentifier('user-7460059265'), 'isSyntheticIdentifier allows real user ID');
  } catch (err: any) {
    assert(false, `Safety guard test failed: ${err.message}`);
  }

  // --- TEST 4: Post-Recovery Production State Integrity ---
  console.log('\n[TEST 4] Post-Recovery Production State Integrity...');
  try {
    const db = getFirestoreDb();

    // Check Alaves
    const alavesClub = (await db.collection(COLLECTIONS.CLUBS).doc('club-alaves').get()).data();
    assert(alavesClub?.isTaken === true && alavesClub?.claimedByUserId === 'user-1238738998', 'Deportivo Alaves claimed by user-1238738998');

    // Check Barcelona
    const barcaClub = (await db.collection(COLLECTIONS.CLUBS).doc('club-barcelona').get()).data();
    assert(barcaClub?.isTaken === true && barcaClub?.claimedByUserId === 'user-8117945434', 'FC Barcelona claimed by user-8117945434');

    // Check Arsenal
    const arsenalClub = (await db.collection(COLLECTIONS.CLUBS).doc('club-arsenal').get()).data();
    assert(arsenalClub?.isTaken === true && arsenalClub?.claimedByUserId === 'user-7460059265', 'Arsenal claimed by legitimate user-7460059265');

    // Check Sunderland
    const sunderlandClub = (await db.collection(COLLECTIONS.CLUBS).doc('club-sunderland').get()).data();
    assert(sunderlandClub?.isTaken === true && sunderlandClub?.claimedByUserId === 'user-6128910148', 'Sunderland claimed by legitimate user-6128910148');

    // Check Released Clubs
    const racingClub = (await db.collection(COLLECTIONS.CLUBS).doc('club-racing-santander').get()).data();
    assert(racingClub?.isTaken === false && !racingClub?.claimedByUserId, 'Racing Santander cleanly released');

    const malagaClub = (await db.collection(COLLECTIONS.CLUBS).doc('club-malaga').get()).data();
    assert(malagaClub?.isTaken === false && !malagaClub?.claimedByUserId, 'Malaga CF cleanly released');

    const mallorcaClub = (await db.collection(COLLECTIONS.CLUBS).doc('club-mallorca').get()).data();
    assert(mallorcaClub?.isTaken === false && !mallorcaClub?.claimedByUserId, 'RCD Mallorca cleanly released');

    // Check Fixture fix-comp-premier-league-2026-md1-bournemouth-vs-tottenham
    const fixture = (await db.collection(COLLECTIONS.FIXTURES).doc('fix-comp-premier-league-2026-md1-bournemouth-vs-tottenham').get()).data();
    assert(fixture?.status === 'PENDING_CONFIRMATION' || fixture?.status === 'SCHEDULED', `Bournemouth vs Tottenham fixture status valid (${fixture?.status})`);
    assert(fixture?.homeScore === null && fixture?.awayScore === null, 'Bournemouth vs Tottenham fixture scores cleared');
    assert(fixture?.winnerClubId === null, 'Bournemouth vs Tottenham winner cleared');
    assert(Boolean(fixture?.recoveredAt), 'Bournemouth vs Tottenham contains recoveredAt timestamp');
  } catch (err: any) {
    assert(false, `Post-recovery state integrity check failed: ${err.message}`);
  }

  console.log('\n================================================================');
  console.log(`AUDIT RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runRegressionAudit().catch((err) => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
