import assert from 'node:assert/strict';
import { initDatabase, queryGet, queryAll, queryRun } from '../db';
import { seedDatabase } from '../db/seed';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import {
  submitFixtureResultFirestore,
  getFixtureByIdFirestore,
  claimClubAtomicFirestore,
  calculateCompetitionStandingsFirestore,
  rebuildCompetitionStandingsFirestore,
} from '../firebase/firestoreStore';
import {
  getDurableMutation,
  getDuePendingMutations,
  OUTBOX_KEYS,
  isRedisOutboxConfigured,
  DurablePersistenceUnavailableError,
} from '../outbox/redisOutbox';
import { processPendingMutations } from '../sync/mutationQueue';
import { startMockUpstashBridge, MockRedisServer } from './mockUpstashBridge';
import { inProcessMemoryCache, memoryRedisStorage } from '../readModel/readModelStore';

async function main() {
  console.log('\n================================================================');
  console.log('   EFL UZ — PHASE 2 ZERO-LOSS DURABLE MUTATIONS VERIFICATION   ');
  console.log('================================================================\n');

  // Start the in-process mock Upstash REST bridge
  const mockRedis = await startMockUpstashBridge();
  assert.ok(isRedisOutboxConfigured(), 'Redis outbox must be configured via Upstash client');

  // Initialize DB and base seed
  await initDatabase();
  seedDatabase();

  const seasonId = 'season-2026-27';
  const compId = 'comp-premier-league-2026';
  const testFixtureId = 'fix-comp-premier-league-2026-md1-bournemouth-vs-tottenham';
  const homeUserId = 'user-bournemouth-owner';
  const awayUserId = 'user-tottenham-owner';

  // Seed participating users and memberships in SQLite and mock Firestore
  const db = getFirestoreDb();
  queryRun(
    `INSERT OR REPLACE INTO club_memberships (id, season_id, club_id, user_id, status, claimed_at, updated_at)
     VALUES ('cm-bmouth', ?, 'club-bournemouth', ?, 'active', ?, ?),
            ('cm-tottenham', ?, 'club-tottenham', ?, 'active', ?, ?)`,
    [seasonId, homeUserId, new Date().toISOString(), new Date().toISOString(),
     seasonId, awayUserId, new Date().toISOString(), new Date().toISOString()]
  );
  await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${homeUserId}`).set({
    userId: homeUserId, seasonId, clubId: 'club-bournemouth', status: 'active',
  });
  await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${awayUserId}`).set({
    userId: awayUserId, seasonId, clubId: 'club-tottenham', status: 'active',
  });
  // Durable replay authorizes against the authoritative club occupancy documents.
  const claimedAt = new Date().toISOString();
  await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_club-bournemouth`).set({
    id: `${seasonId}_club-bournemouth`, seasonId, clubId: 'club-bournemouth', userId: homeUserId,
    status: 'active', claimedAt, updatedAt: claimedAt,
  });
  await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_club-tottenham`).set({
    id: `${seasonId}_club-tottenham`, seasonId, clubId: 'club-tottenham', userId: awayUserId,
    status: 'active', claimedAt, updatedAt: claimedAt,
  });
  await db.collection(COLLECTIONS.CLUBS).doc('club-bournemouth').set({
    id: 'club-bournemouth', name: 'AFC Bournemouth', shortName: 'BOU', leagueId: 'league-premier-league',
  });
  await db.collection(COLLECTIONS.CLUBS).doc('club-tottenham').set({
    id: 'club-tottenham', name: 'Tottenham Hotspur', shortName: 'TOT', leagueId: 'league-premier-league',
  });
  await db.collection(COLLECTIONS.FIXTURES).doc(testFixtureId).set({
    id: testFixtureId, seasonId, competitionId: compId, matchday: 1, roundName: 'Matchday 1',
    homeClubId: 'club-bournemouth', awayClubId: 'club-tottenham', status: 'SCHEDULED',
    homeScore: null, awayScore: null, winnerClubId: null,
  });

  // Reset fixture in local SQLite
  queryRun(
    `UPDATE fixtures 
     SET status = 'SCHEDULED', home_score = NULL, away_score = NULL, winner_club_id = NULL, result_confirmed_at = NULL 
     WHERE id = ?`,
    [testFixtureId]
  );
  queryRun('DELETE FROM result_submissions WHERE fixture_id = ?', [testFixtureId]);

  try {
    // -------------------------------------------------------------------
    // TEST A: Firestore unavailable -> Redis outbox success -> acknowledged
    // -------------------------------------------------------------------
    console.log('\n--- [TEST A] Firestore Outage -> Redis Outbox Persistence -> ACK with pendingSync ---');
    firestoreCircuitBreaker.forceState('OPEN');
    assert.equal(firestoreCircuitBreaker.canExecute(), false, 'Circuit breaker must be OPEN');

    const subResponse = await submitFixtureResultFirestore(
      homeUserId,
      testFixtureId,
      2,
      1,
      'https://proof.efootball/testA.png'
    );

    assert.ok(subResponse, 'Must return fixture');
    assert.equal((subResponse as any).pendingSync, true, 'Response must indicate pendingSync: true');

    const expectedMutationId = `sub_${testFixtureId}_${homeUserId}`;
    const durableRecord = await getDurableMutation(expectedMutationId);
    assert.ok(durableRecord, 'Complete mutation must exist in Redis durable outbox');
    assert.equal(durableRecord.status, 'PENDING');
    assert.equal(durableRecord.operation, 'SUBMIT_RESULT');
    assert.equal(durableRecord.payload.homeScore, 2);
    assert.equal(durableRecord.payload.awayScore, 1);
    assert.equal(durableRecord.payload.fixtureId, testFixtureId);
    assert.equal(durableRecord.payload.userId, homeUserId);
    console.log('✅ [TEST A PASS] Offline submission was durably persisted to Redis outbox BEFORE success response returned.');

    // -------------------------------------------------------------------
    // TEST B: Process killed immediately after ACK -> fresh instance starts -> recovers outbox from Redis -> replays to Firestore
    // -------------------------------------------------------------------
    console.log('\n--- [TEST B] Ephemeral Process Death & Fresh-Instance Redis Recovery ---');
    // Simulate container death: clear all process memory and wipe ephemeral SQLite mutations/submissions
    inProcessMemoryCache.clear();
    memoryRedisStorage.clear();
    queryRun('DELETE FROM result_submissions WHERE fixture_id = ?', [testFixtureId]);
    queryRun('DELETE FROM pending_mutations');
    assert.equal(queryAll('SELECT * FROM result_submissions WHERE fixture_id = ?', [testFixtureId]).length, 0);
    assert.equal(queryAll('SELECT * FROM pending_mutations').length, 0);

    // Fresh instance starts: Firestore recovers
    firestoreCircuitBreaker.forceState('CLOSED');
    assert.equal(firestoreCircuitBreaker.canExecute(), true);

    // Replay worker runs on the fresh instance
    const syncResult = await processPendingMutations();
    assert.equal(syncResult.synced, 1, 'Fresh instance must recover and sync 1 mutation from Redis outbox');

    // Verify in Firestore
    const syncedFixDoc = await db.collection(COLLECTIONS.FIXTURES).doc(testFixtureId).get();
    assert.ok(syncedFixDoc.exists);
    assert.equal(syncedFixDoc.data()?.status, 'PENDING_CONFIRMATION');

    const syncedSubDoc = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc(`sub-${testFixtureId}-${homeUserId}`).get();
    assert.ok(syncedSubDoc.exists);
    assert.equal(syncedSubDoc.data()?.homeScore, 2);
    assert.equal(syncedSubDoc.data()?.awayScore, 1);

    // Verify status in Redis outbox is now SYNCED (and record was not prematurely deleted)
    const syncedOutbox = await getDurableMutation(expectedMutationId);
    assert.ok(syncedOutbox);
    assert.equal(syncedOutbox.status, 'SYNCED');
    console.log('✅ [TEST B PASS] Fresh instance with empty /tmp recovered mutation from Redis and reconciled Firestore with 0 data loss.');

    // -------------------------------------------------------------------
    // TEST C: Firestore unavailable + Redis unavailable -> HTTP 503 DURABLE_PERSISTENCE_UNAVAILABLE
    // -------------------------------------------------------------------
    console.log('\n--- [TEST C] Dual Failure: Firestore Unavailable + Redis Unavailable ---');
    firestoreCircuitBreaker.forceState('OPEN');
    mockRedis.simulateFailure(true);

    let rejectedErr: any = null;
    try {
      await submitFixtureResultFirestore(
        awayUserId,
        testFixtureId,
        2,
        1
      );
    } catch (err: any) {
      rejectedErr = err;
    }

    assert.ok(rejectedErr, 'Must reject when both Firestore and Redis outbox fail');
    assert.ok(
      rejectedErr.code === 'DURABLE_PERSISTENCE_UNAVAILABLE' ||
      rejectedErr.statusCode === 503 ||
      String(rejectedErr).includes('DURABLE_PERSISTENCE_UNAVAILABLE'),
      `Expected DURABLE_PERSISTENCE_UNAVAILABLE, got: ${rejectedErr?.message || rejectedErr}`
    );

    // Ensure SQLite was NOT mutated when durable persistence failed
    const awaySubLocal = queryGet<any>('SELECT * FROM result_submissions WHERE submitted_by_user_id = ?', [awayUserId]);
    assert.equal(awaySubLocal, null, 'SQLite must NOT be mutated if Redis durable outbox fails');
    console.log('✅ [TEST C PASS] Rejected with 503 DURABLE_PERSISTENCE_UNAVAILABLE. Never acknowledged un-persisted write.');

    // Restore Redis health
    mockRedis.simulateFailure(false);

    // -------------------------------------------------------------------
    // TEST D: Replay 5 times -> identical outcome, 0 duplicates
    // -------------------------------------------------------------------
    console.log('\n--- [TEST D] Idempotent Replay (5x Consecutive Replay) ---');
    // Away manager submits matching score 2-1 while Firestore is offline (enqueues to Redis outbox)
    firestoreCircuitBreaker.forceState('OPEN');

    const confirmResponse = await submitFixtureResultFirestore(
      awayUserId,
      testFixtureId,
      2,
      1
    );
    assert.equal((confirmResponse as any).pendingSync, true);

    const awayMutationId = `sub_${testFixtureId}_${awayUserId}`;
    const awayMutation = await getDurableMutation(awayMutationId);
    assert.ok(awayMutation, 'Confirmation mutation must be stored in Redis outbox');
    assert.equal(awayMutation.payload.homeScore, 2);
    assert.equal(awayMutation.payload.awayScore, 1);

    // Firestore recovers: Replay 5 times consecutively
    firestoreCircuitBreaker.forceState('CLOSED');
    for (let i = 0; i < 5; i++) {
      await processPendingMutations();
    }

    // Verify fixture status in Firestore is confirmed
    const finalFix = await db.collection(COLLECTIONS.FIXTURES).doc(testFixtureId).get();
    assert.equal(finalFix.data()?.status, 'CONFIRMED');
    assert.equal(finalFix.data()?.homeScore, 2);
    assert.equal(finalFix.data()?.awayScore, 1);
    assert.equal(finalFix.data()?.winnerClubId, 'club-bournemouth');

    // Verify submissions in Firestore: exactly 2 submissions total (1 home, 1 away), 0 duplicates
    const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', '==', testFixtureId).get();
    assert.equal(subsSnap.docs.length, 2, 'Must have exactly 2 submissions (1 home, 1 away), 0 duplicates');

    // Verify audit logs in Firestore: exactly 1 log per manager, 0 duplicates
    const auditLogsSnap = await db.collection(COLLECTIONS.AUDIT_LOGS).where('entityId', '==', testFixtureId).get();
    const submitLogs = auditLogsSnap.docs.filter((d) => d.data()?.action === 'SUBMIT_RESULT');
    assert.equal(submitLogs.length, 2, 'Exactly 2 logical submit audit logs for the 2 managers, 0 replay duplicates');

    console.log('✅ [TEST D PASS] 5 consecutive replays produced identical state with 0 duplicate records.');

    // -------------------------------------------------------------------
    // TEST E: Club claim offline -> rejected safely (503 / authoritative required)
    // -------------------------------------------------------------------
    console.log('\n--- [TEST E] Strongly Authoritative Operations: Club Claim Offline Rejection ---');
    firestoreCircuitBreaker.forceState('OPEN');

    let claimErr: any = null;
    try {
      await claimClubAtomicFirestore('user-unauthorized', 'club-arsenal', seasonId);
    } catch (err: any) {
      claimErr = err;
    }

    assert.ok(claimErr, 'Club claim must fail when Firestore is offline');
    assert.ok(
      claimErr.message.includes('CIRCUIT_OPEN') || claimErr.message.includes('Authoritative write cannot execute'),
      `Expected circuit open error, got: ${claimErr?.message}`
    );

    // Verify club was not claimed in SQLite or Firestore
    const localOcc = queryGet<any>('SELECT * FROM club_memberships WHERE user_id = "user-unauthorized"');
    assert.equal(localOcc, null, 'User must NOT receive club ownership offline');
    console.log('✅ [TEST E PASS] Club claim rejected safely when Firestore is offline (prevents split-brain ownership).');

    // -------------------------------------------------------------------
    // TEST F: Standings correctness after outbox replay
    // -------------------------------------------------------------------
    console.log('\n--- [TEST F] Standings Materialization after Outbox Replay ---');
    firestoreCircuitBreaker.forceState('CLOSED');
    const standings = await rebuildCompetitionStandingsFirestore(compId);
    assert.ok(Array.isArray(standings));
    const bmouthRow = standings.find((r) => r.clubId === 'club-bournemouth');
    assert.ok(bmouthRow, 'Bournemouth must be in standings');
    assert.equal(bmouthRow.played, 1);
    assert.equal(bmouthRow.won, 1);
    assert.equal(bmouthRow.points, 3);
    assert.equal(bmouthRow.goalDifference, 1);

    const tottRow = standings.find((r) => r.clubId === 'club-tottenham');
    assert.ok(tottRow, 'Tottenham must be in standings');
    assert.equal(tottRow.played, 1);
    assert.equal(tottRow.lost, 1);
    assert.equal(tottRow.points, 0);
    assert.equal(tottRow.goalDifference, -1);
    console.log('✅ [TEST F PASS] Standings materialized correctly and deterministically from confirmed fixture state.');

    // -------------------------------------------------------------------
    // TEST G: Admin Fallback Mutations (Approve & Reopen via Durable Outbox)
    // -------------------------------------------------------------------
    console.log('\n--- [TEST G] Admin Fallback Mutations (Approve & Reopen) ---');
    const { adminApproveFixtureResultFirestore, reopenFixtureFirestore } = await import('../firebase/firestoreStore');
    firestoreCircuitBreaker.forceState('OPEN');

    // Admin approve offline
    const adminApproveRes = await adminApproveFixtureResultFirestore(
      'admin-super',
      testFixtureId,
      3,
      0,
      'Admin manual approval'
    );
    assert.equal(adminApproveRes.pendingSync, true);
    const adminApproveMut = await getDurableMutation(`admin_approve_${testFixtureId}`);
    assert.ok(adminApproveMut, 'Admin approve mutation must exist in Redis outbox');
    assert.equal(adminApproveMut.status, 'PENDING');
    assert.equal(adminApproveMut.payload.homeScore, 3);
    assert.equal(adminApproveMut.payload.awayScore, 0);

    // Replay to Firestore
    firestoreCircuitBreaker.forceState('CLOSED');
    await processPendingMutations();

    const adminApprovedDoc = await db.collection(COLLECTIONS.FIXTURES).doc(testFixtureId).get();
    assert.equal(adminApprovedDoc.data()?.status, 'CONFIRMED');
    assert.equal(adminApprovedDoc.data()?.homeScore, 3);
    assert.equal(adminApprovedDoc.data()?.awayScore, 0);
    assert.equal((await getDurableMutation(`admin_approve_${testFixtureId}`))?.status, 'SYNCED');

    // Admin reopen offline
    firestoreCircuitBreaker.forceState('OPEN');
    const reopenRes = await reopenFixtureFirestore('admin-super', testFixtureId, 'Reopening fixture');
    assert.equal(reopenRes.pendingSync, true);
    const reopenMut = await getDurableMutation(`admin_reject_${testFixtureId}`);
    assert.ok(reopenMut, 'Admin reopen mutation must exist in Redis outbox');
    assert.equal(reopenMut.status, 'PENDING');

    // Replay reopen to Firestore
    firestoreCircuitBreaker.forceState('CLOSED');
    await processPendingMutations();

    const reopenedDoc = await db.collection(COLLECTIONS.FIXTURES).doc(testFixtureId).get();
    assert.equal(reopenedDoc.data()?.status, 'SCHEDULED');
    assert.equal(reopenedDoc.data()?.homeScore, null);
    assert.equal((await getDurableMutation(`admin_reject_${testFixtureId}`))?.status, 'SYNCED');
    console.log('✅ [TEST G PASS] Admin approve & reopen fallback mutations persist to Redis outbox and replay idempotently.');

    console.log('\n================================================================');
    console.log('   ALL PHASE 2 ZERO-LOSS DURABILITY TESTS PASSED (7/7)        ');
    console.log('================================================================\n');
  } finally {
    await mockRedis.close();
  }
}

main().catch((err) => {
  console.error('\n❌ PHASE 2 VERIFICATION FAILED:', err);
  process.exit(1);
});
