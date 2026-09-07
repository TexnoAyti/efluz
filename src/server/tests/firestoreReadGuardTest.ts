import assert from 'node:assert/strict';
import { firestoreCircuitBreaker, FIRESTORE_READ_SOFT_LIMIT } from '../firebase/circuitBreaker';
import { guardFirestoreDb } from '../firebase/firestoreReadGuard';

async function main() {
  firestoreCircuitBreaker.reset();

  let networkReads = 0;
  const docRef = {
    async get() {
      networkReads++;
      return { id: 'doc-1', exists: true, data: () => ({ ok: true }) };
    },
  };

  const query = {
    where() {
      return query;
    },
    limit() {
      return query;
    },
    async get() {
      networkReads++;
      return { docs: [{ id: 'doc-1' }], size: 1, empty: false };
    },
  };

  const collection = {
    doc() {
      return docRef;
    },
    where() {
      return query;
    },
    async get() {
      networkReads++;
      return { docs: [], size: 0, empty: true };
    },
  };

  const fakeDb = {
    collection() {
      return collection;
    },
    async getAll() {
      networkReads++;
      return [];
    },
  };

  const guarded = guardFirestoreDb(fakeDb);

  await guarded.collection('fixtures').where('seasonId', '==', 'season-2026-27').limit(1).get();
  assert.equal(networkReads, 1, 'Guarded query should reach Firestore while CLOSED');

  firestoreCircuitBreaker.setCooldown(10 * 60 * 1000);
  firestoreCircuitBreaker.forceState('OPEN');
  const beforeBlocked = networkReads;
  await assert.rejects(
    guarded.collection('fixtures').doc('fixture-1').get(),
    (err: any) => err?.code === 'FIRESTORE_READ_BLOCKED_BY_CIRCUIT_BREAKER'
  );
  assert.equal(networkReads, beforeBlocked, 'OPEN breaker must prevent the network read');

  // Force the cooldown to expire, then verify that a caller may perform a
  // non-consuming eligibility check before the guarded read reserves the
  // single HALF_OPEN probe.
  firestoreCircuitBreaker.setCooldown(1);
  firestoreCircuitBreaker.forceState('OPEN');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(firestoreCircuitBreaker.canExecute(), true, 'Expired OPEN breaker should become probe-eligible');
  const beforeProbe = networkReads;
  await guarded.collection('fixtures').doc('fixture-probe').get();
  assert.equal(networkReads, beforeProbe + 1, 'Exactly one HALF_OPEN probe read should reach the network');
  assert.equal(firestoreCircuitBreaker.getStatus().state, 'CLOSED', 'Successful HALF_OPEN probe should close the breaker');

  firestoreCircuitBreaker.reset();
  firestoreCircuitBreaker.recordReadDocuments(FIRESTORE_READ_SOFT_LIMIT);
  assert.equal(firestoreCircuitBreaker.getStatus().softLimitExceeded, true);
  const beforeSoftLimit = networkReads;
  await assert.rejects(
    guarded.collection('fixtures').get(),
    (err: any) => err?.code === 'FIRESTORE_READ_BLOCKED_BY_CIRCUIT_BREAKER'
  );
  assert.equal(networkReads, beforeSoftLimit, 'Soft limit must prevent subsequent Firestore reads');

  firestoreCircuitBreaker.reset();
  console.log('✅ firestoreReadGuardTest passed');
}

main().catch((err) => {
  console.error('❌ firestoreReadGuardTest failed:', err);
  process.exit(1);
});
