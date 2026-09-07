import { COLLECTIONS } from './collections';
import { getFirestoreDb } from './admin';
import { firestoreCircuitBreaker } from './circuitBreaker';

/**
 * Performs exactly one lightweight Firestore read when the breaker cooldown
 * has elapsed. The read itself is guarded by the central Firestore read guard,
 * so it is the single controlled HALF_OPEN probe.
 */
export async function attemptFirestoreRecoveryProbe(): Promise<boolean> {
  const status = firestoreCircuitBreaker.getStatus();

  if (status.state === 'CLOSED') return true;
  if (status.state !== 'OPEN' || status.cooldownRemainingMs > 0) return false;

  try {
    const db = getFirestoreDb();
    await db.collection(COLLECTIONS.CLUBS).limit(1).get();
    firestoreCircuitBreaker.recordSuccess();
    console.log('[RECOVERY] Firestore health probe succeeded; circuit CLOSED.');
    return true;
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    console.warn('[RECOVERY] Firestore health probe failed:', err?.message || String(err));
    return false;
  }
}
