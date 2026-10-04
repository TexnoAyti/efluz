import assert from 'node:assert/strict';
import { initDatabase, queryGet, queryRun } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { markSingleNotificationReadFirestore } from '../firebase/firestoreStore';
import { enqueueMutation, processPendingMutations } from '../sync/mutationQueue';
import { reconcileDurableMutations, RECONCILIATION_COOLDOWN_KEY } from '../sync/scheduleReconciliation';
import { getDurableMutation, getDuePendingMutations, markMutationRetryable, OUTBOX_KEYS } from '../outbox/redisOutbox';
import { clearProcessMemoryForTest, getUpstashClient, redisSetRaw, getFreshKey, getLkgKey, readThroughReadModel } from '../readModel/readModelStore';
import { startMockUpstashBridge } from './mockUpstashBridge';

await initDatabase();
const redis = await startMockUpstashBridge();
const client = getUpstashClient()!;
const db = getFirestoreDb();
const now = new Date().toISOString();
const userId = 'quota-recovery-user';
const notificationId = 'quota-recovery-notification';
await db.collection(COLLECTIONS.NOTIFICATIONS).doc(notificationId).set({ id: notificationId, userId, isRead: false, createdAt: now });
queryRun('INSERT OR REPLACE INTO notifications (id,user_id,type,title,message,is_read,created_at) VALUES (?,?,?,?,?,0,?)', [notificationId,userId,'SYSTEM','Test','Test',now]);
try {
  firestoreCircuitBreaker.forceState('OPEN');
  redis.simulateFailure(true);
  await assert.rejects(markSingleNotificationReadFirestore(userId, notificationId), (error: any) => error.code === 'DURABLE_PERSISTENCE_UNAVAILABLE');
  assert.equal(queryGet<any>('SELECT is_read FROM notifications WHERE id=?', [notificationId])?.is_read, 0, 'Failed durable write must not update ephemeral local state');
  redis.simulateFailure(false);
  await markSingleNotificationReadFirestore(userId, notificationId);
  const id = `notif_read_${notificationId}_${userId}`;
  assert.equal((await getDurableMutation(id))?.status, 'PENDING');
  assert.ok(redis.zsets.get(OUTBOX_KEYS.pending())?.has(id));
  assert.ok(redis.sets.get(OUTBOX_KEYS.all())?.has(id));
  assert.equal(await reconcileDurableMutations(), null, 'Quota cooldown must defer replay');
  console.log('PASS durable receipt precedes notification acknowledgement; Redis failure rejects the change; quota cooldown preserves pending work.');

  // Backoff must not be bypassed by a warm worker's local mirror.
  firestoreCircuitBreaker.forceState('CLOSED');
  await markMutationRetryable(id, 'temporary failure');
  assert.equal((await getDuePendingMutations()).length, 0);
  assert.equal((await processPendingMutations()).processed, 0);
  assert.equal((await db.collection(COLLECTIONS.NOTIFICATIONS).doc(notificationId).get()).data()?.isRead, false);
  await client.zadd(OUTBOX_KEYS.pending(), { score: 0, member: id });
  clearProcessMemoryForTest();
  queryRun('DELETE FROM pending_mutations');
  const results = await Promise.all([reconcileDurableMutations(), reconcileDurableMutations()]);
  assert.equal(results.filter(Boolean).length, 1, 'Only one recovery batch across competing requests');
  assert.equal(results.find(Boolean)?.synced, 1);
  assert.equal((await getDurableMutation(id))?.status, 'SYNCED');
  assert.equal((await db.collection(COLLECTIONS.NOTIFICATIONS).doc(notificationId).get()).data()?.isRead, true);
  console.log('PASS recovery reads Redis after process memory/local queue are cleared, respects backoff, and avoids duplicate scheduled batches.');

  await client.del(RECONCILIATION_COOLDOWN_KEY);
  const collection = db.collection.bind(db);
  let calls = 0;
  db.collection = ((...args: any[]) => { calls++; return (collection as any)(...args); }) as any;
  try { assert.equal((await reconcileDurableMutations())?.processed, 0); assert.equal(calls, 0, 'Empty outbox must not read Firestore'); }
  finally { db.collection = collection; }

  // Expired cooldown owns exactly one real half-open probe, not a pre-check.
  const secondId = 'quota-half-open';
  await enqueueMutation({ mutationId: secondId, entityType: 'NOTIFICATION_READ', entityId: notificationId, operation: 'MARK_READ', payload: { userId, readAt: now }, createdAt: now });
  firestoreCircuitBreaker.setCooldown(0);
  firestoreCircuitBreaker.forceState('OPEN');
  await client.del(RECONCILIATION_COOLDOWN_KEY);
  assert.equal((await reconcileDurableMutations())?.synced, 1);
  assert.equal(firestoreCircuitBreaker.getStatus().state, 'CLOSED');
  firestoreCircuitBreaker.setCooldown(60000);
  console.log('PASS empty recovery causes zero Firestore collection accesses; cooldown recovery performs its real probe and exits HALF_OPEN.');

  // Prior published club/result/table data survives loss of process + fresh TTL.
  const snapshots = [
    ['quota-clubs', [{ id: 'club-kept', ownerUserId: userId, ownerUsername: 'kept-owner' }]],
    ['quota-fixtures', [{ id: 'match-kept', homeScore: 2, awayScore: 1, status: 'CONFIRMED' }]],
    ['quota-standings', [{ clubId: 'club-kept', position: 1, points: 3 }]],
  ] as const;
  for (const [key, data] of snapshots) { await redisSetRaw(key, { data }); await client.del(getFreshKey(key)); assert.equal(await client.ttl(getLkgKey(key)), -1); }
  clearProcessMemoryForTest();
  firestoreCircuitBreaker.forceState('OPEN');
  let firestoreReads = 0;
  for (const [key, data] of snapshots) {
    const result = await readThroughReadModel({ key, firestoreFetcher: async () => { firestoreReads++; throw new Error('RESOURCE_EXHAUSTED'); } });
    assert.deepEqual(result.data, data); assert.equal(result.stale, true);
  }
  assert.equal(firestoreReads, 0);
  console.log('PASS permanent Redis snapshots retain owner, confirmed score and table points after cold memory/fresh expiry, with zero exhausted Firestore reads.');
} finally {
  firestoreCircuitBreaker.forceState('CLOSED');
  firestoreCircuitBreaker.setCooldown(60000);
  await redis.close();
}
