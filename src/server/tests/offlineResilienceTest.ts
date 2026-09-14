import { strict as assert } from 'assert';
import { initDatabase, queryGet, queryRun } from '../db';
import { seedDatabase } from '../db/seed';
import { refreshMaterializedStandingsForCompetition } from '../db/sqliteStandings';
import {
  enqueueMutation,
  getPendingMutations,
  processPendingMutations,
  updateMutationStatus,
} from '../sync/mutationQueue';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { markSingleNotificationReadFirestore } from '../firebase/firestoreStore';
import { assertTestEnvironmentSafe } from '../utils/testGuard';

async function main() {
  const isLocalFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true';
  const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if (!isLocalFallback && !isEmulator) {
    throw new Error(
      'SAFETY_VIOLATION: offlineResilienceTest requires FIREBASE_FORCE_LOCAL_FALLBACK="true" or a verified FIRESTORE_EMULATOR_HOST before process startup. Aborting to prevent production Firestore contamination.'
    );
  }
  assertTestEnvironmentSafe('offlineResilienceTest');

  await initDatabase();
  seedDatabase();

  const seasonId = 'season-2026-27';
  const competitionId = 'comp-premier-league-2026';
  const fixtureId = `offline-test-${Date.now()}`;
  const now = new Date().toISOString();

  console.log('--- TEST 1: Materialized Standings & Offline Fixture ---');
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
  console.log('✓ Materialized standings and offline fixture test passed.');

  console.log('--- TEST 2: False SYNCED Prevention & Retry without Duplication ---');
  // Seed a fixture in Firestore to be approved via replay
  const db = getFirestoreDb();
  const testFixId = `fix-retry-test-${Date.now()}`;
  await db.collection(COLLECTIONS.FIXTURES).doc(testFixId).set({
    id: testFixId,
    seasonId,
    competitionId,
    homeClubId: 'club-liverpool',
    awayClubId: 'club-man-city',
    status: 'SCHEDULED',
    homeScore: null,
    awayScore: null,
    createdAt: now,
    updatedAt: now,
  });

  const testMutationId = `admin-approve-test-${Date.now()}`;
  enqueueMutation({
    mutationId: testMutationId,
    entityType: 'ADMIN_DECISION',
    entityId: testFixId,
    operation: 'ADMIN_APPROVE_RESULT',
    payload: {
      adminUserId: 'admin_test_user',
      fixtureId: testFixId,
      homeScore: 3,
      awayScore: 1,
      notes: 'Testing resilient replay',
    },
    createdAt: now,
  });

  // Verify mutation is initially PENDING
  const initialPending = getPendingMutations('PENDING');
  assert.ok(initialPending.some((m) => m.mutationId === testMutationId), 'Mutation must initially be PENDING');

  // STEP A: Simulate a remote failure during replay by proxying db.collection
  const originalCollection = db.collection.bind(db);
  let simulateRemoteFailure = true;

  (db as any).collection = (name: string) => {
    const col = originalCollection(name);
    if (name === COLLECTIONS.FIXTURES && simulateRemoteFailure) {
      return new Proxy(col, {
        get(target, prop, receiver) {
          if (prop === 'doc') {
            return (id: string) => {
              const doc = target.doc(id);
              return new Proxy(doc, {
                get(dTarget, dProp, dReceiver) {
                  if (dProp === 'update') {
                    return async () => {
                      throw new Error('SIMULATED_REMOTE_OUTAGE: Firestore write failed during replay');
                    };
                  }
                  return Reflect.get(dTarget, dProp, dReceiver);
                },
              });
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
    }
    return col;
  };

  const syncResultFailure = await processPendingMutations();
  assert.ok(syncResultFailure.failed >= 1, 'Sync attempt should record failure');

  // Authoritative check: mutation must NOT be marked SYNCED! It must remain PENDING!
  const allMutationsAfterFail = getPendingMutations();
  const mutationAfterFail = allMutationsAfterFail.find((m) => m.mutationId === testMutationId);
  assert.ok(mutationAfterFail, 'Mutation must still exist in the queue');
  assert.equal(mutationAfterFail.status, 'PENDING', 'Failed or fallback-only replay must remain PENDING');
  assert.ok(
    mutationAfterFail.lastError?.includes('SIMULATED_REMOTE_OUTAGE') ||
    mutationAfterFail.lastError?.includes('Firestore write failed'),
    'Mutation should record last error'
  );

  // STEP B: Restore Firestore and retry replay
  simulateRemoteFailure = false;
  (db as any).collection = originalCollection;

  const syncResultSuccess = await processPendingMutations();
  assert.ok(syncResultSuccess.synced >= 1, 'Retry sync should succeed');

  const allMutationsAfterRetry = getPendingMutations();
  const mutationAfterRetry = allMutationsAfterRetry.find((m) => m.mutationId === testMutationId);
  assert.ok(mutationAfterRetry, 'Mutation must exist in the queue');
  assert.equal(mutationAfterRetry.status, 'SYNCED', 'Mutation must be marked SYNCED after authoritative write succeeds');

  // Verify no duplication occurred
  const matchingMutations = allMutationsAfterRetry.filter((m) => m.mutationId === testMutationId);
  assert.equal(matchingMutations.length, 1, 'There must be exactly one mutation record (no duplication)');

  // Verify Firestore document was authoritatively updated
  const updatedFixSnap = await db.collection(COLLECTIONS.FIXTURES).doc(testFixId).get();
  assert.equal(updatedFixSnap.data()?.status, 'CONFIRMED');
  assert.equal(updatedFixSnap.data()?.homeScore, 3);
  assert.equal(updatedFixSnap.data()?.awayScore, 1);
  console.log('✓ Forced remote failure remained PENDING and successfully retried without duplication.');

  console.log('--- TEST 3: Notification Ownership Enforcement ---');
  const userA = `user_a_${Date.now()}`;
  const userB = `user_b_${Date.now()}`;
  const notifB = `notif_b_${Date.now()}`;

  // Seed notification for User B in Firestore and SQLite
  await db.collection(COLLECTIONS.NOTIFICATIONS).doc(notifB).set({
    id: notifB,
    userId: userB,
    type: 'SYSTEM',
    title: 'Private Notification for User B',
    message: 'Secret message for User B',
    isRead: false,
    createdAt: now,
  });

  queryRun(
    `INSERT OR REPLACE INTO notifications (id, user_id, type, title, message, is_read, created_at)
     VALUES (?, ?, 'SYSTEM', 'Private Notification for User B', 'Secret message', 0, ?)`,
    [notifB, userB, now]
  );

  // Attempt 1: User A directly attempts to mark User B's notification as read
  let directOwnershipBlocked = false;
  try {
    await markSingleNotificationReadFirestore(userA, notifB);
  } catch (err: any) {
    if (err.message?.includes('OWNERSHIP_MISMATCH')) {
      directOwnershipBlocked = true;
    }
  }
  assert.equal(directOwnershipBlocked, true, 'User A directly marking User B notification must throw OWNERSHIP_MISMATCH');

  // Verify notification remains unread
  const notifBDocAfterDirect = await db.collection(COLLECTIONS.NOTIFICATIONS).doc(notifB).get();
  assert.equal(notifBDocAfterDirect.data()?.isRead, false, 'User B notification in Firestore must remain unread');

  const notifBSqliteAfterDirect = queryGet<any>('SELECT is_read FROM notifications WHERE id = ?', [notifB]);
  assert.equal(notifBSqliteAfterDirect?.is_read, 0, 'User B notification in SQLite must remain unread');

  // Verify initial call did NOT enqueue mutation for User A
  const allMutationsAfterBlocked = getPendingMutations();
  assert.ok(
    !allMutationsAfterBlocked.some((m) => m.mutationId === `notif_read_${notifB}_${userA}`),
    'Initial call must never enqueue another user notification after ownership mismatch'
  );

  // Attempt 2: An unauthorized mutation is inserted into the queue attempting to spoof read as userA
  const spoofMutationId = `spoofed_notif_${Date.now()}`;
  enqueueMutation({
    mutationId: spoofMutationId,
    entityType: 'NOTIFICATION_READ',
    entityId: notifB,
    operation: 'MARK_READ',
    payload: {
      userId: userA,
      notificationId: notifB,
      readAt: now,
    },
    createdAt: now,
  });

  // Replay should catch ownership mismatch during execution and mark FAILED
  await processPendingMutations();

  const spoofedItem = getPendingMutations().find((m) => m.mutationId === spoofMutationId);
  assert.ok(spoofedItem, 'Spoofed mutation should exist in tracking queue');
  assert.equal(spoofedItem.status, 'FAILED', 'Spoofed mutation with ownership mismatch must be marked FAILED');
  assert.ok(spoofedItem.lastError?.includes('OWNERSHIP_MISMATCH'), 'Last error should specify OWNERSHIP_MISMATCH');

  // Verify User B's notification in Firestore remains unread
  const notifBDocFinal = await db.collection(COLLECTIONS.NOTIFICATIONS).doc(notifB).get();
  assert.equal(notifBDocFinal.data()?.isRead, false, 'User B notification in Firestore must still be unread after replay attempt');

  // Attempt 3: User B marks their OWN notification as read
  await markSingleNotificationReadFirestore(userB, notifB);
  const notifBDocOwner = await db.collection(COLLECTIONS.NOTIFICATIONS).doc(notifB).get();
  assert.equal(notifBDocOwner.data()?.isRead, true, 'User B marking their own notification must succeed');
  console.log('✓ Notification ownership verified: User A cannot mark User B notification read directly or via replay.');

  console.log('offline resilience regression: PASS');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
