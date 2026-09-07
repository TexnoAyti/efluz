import { getPendingMutations, updateMutationStatus, PendingMutation } from './mutationQueue';
import { getFirestoreDb } from '../firebase/admin';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { COLLECTIONS } from '../firebase/collections';

/**
 * Syncs matchday mutations that carry a full local SQLite state snapshot.
 * These operations cannot be reduced to a simple override-status write because
 * ADVANCE_MATCHDAY and SET_MATCHDAY_TIMER also persist the current matchday
 * and timer fields.
 */
export async function processPendingMatchdayMutations(): Promise<{
  processed: number;
  synced: number;
  failed: number;
  deferred: number;
}> {
  if (!firestoreCircuitBreaker.canExecute()) {
    return { processed: 0, synced: 0, failed: 0, deferred: getMatchdayMutations().length };
  }

  const items = getMatchdayMutations().sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  if (items.length === 0) {
    return { processed: 0, synced: 0, failed: 0, deferred: 0 };
  }

  const db = getFirestoreDb();
  let processed = 0;
  let synced = 0;
  let failed = 0;

  for (const item of items) {
    if (!firestoreCircuitBreaker.canExecute()) break;

    processed += 1;
    updateMutationStatus(item.mutationId, 'SYNCING');

    try {
      const payload = item.payload as any;
      const state = payload?.state || payload || {};
      const ref = db.collection(COLLECTIONS.COMPETITIONS).doc(item.entityId);
      const now = state.updatedAt || new Date().toISOString();

      const updates: Record<string, unknown> = { updatedAt: now };

      if (item.operation === 'SET_MATCHDAY_OVERRIDE') {
        const overrideStatus = state.overrideStatus || 'AUTO';
        updates.adminOverrideStatus = overrideStatus;
        updates.isMatchdayOpen = overrideStatus === 'FORCE_OPEN' || overrideStatus === 'AUTO';
      } else if (item.operation === 'ADVANCE_MATCHDAY') {
        updates.currentMatchday = Number(state.currentMatchday || 1);
        updates.matchdayDurationHours = Number(state.durationHours || 30);
        updates.nextMatchdayOpenAt = state.nextOpenAt || null;
        const overrideStatus = state.overrideStatus || 'AUTO';
        updates.adminOverrideStatus = overrideStatus;
        updates.isMatchdayOpen = overrideStatus === 'FORCE_OPEN' || overrideStatus === 'AUTO';
        updates.matchdayOpenedAt = now;
      } else if (item.operation === 'OPEN_MATCHDAY_NOW') {
        updates.currentMatchday = Number(state.currentMatchday || 1);
        updates.matchdayDurationHours = Number(state.durationHours || 30);
        updates.nextMatchdayOpenAt = state.nextOpenAt || null;
        updates.adminOverrideStatus = state.overrideStatus || 'FORCE_OPEN';
        updates.isMatchdayOpen = true;
        updates.matchdayOpenedAt = now;
      } else if (item.operation === 'SET_MATCHDAY_TIMER') {
        if (state.currentMatchday !== undefined) {
          updates.currentMatchday = Number(state.currentMatchday);
        }
        if (state.durationHours !== undefined) {
          updates.matchdayDurationHours = Number(state.durationHours);
        }
        if (state.nextOpenAt !== undefined) {
          updates.nextMatchdayOpenAt = state.nextOpenAt;
        }
        if (state.overrideStatus !== undefined) {
          updates.adminOverrideStatus = state.overrideStatus;
          updates.isMatchdayOpen = state.overrideStatus === 'FORCE_OPEN' || state.overrideStatus === 'AUTO';
        }
      } else {
        updateMutationStatus(item.mutationId, 'FAILED', `Unsupported matchday operation: ${item.operation}`);
        failed += 1;
        continue;
      }

      await ref.get();
      await ref.update(updates);
      updateMutationStatus(item.mutationId, 'SYNCED');
      firestoreCircuitBreaker.recordSuccess();
      synced += 1;
    } catch (err: any) {
      firestoreCircuitBreaker.recordFailure(err);
      updateMutationStatus(item.mutationId, 'PENDING', err?.message || 'Matchday sync failed');
      failed += 1;
      if (firestoreCircuitBreaker.isQuotaExhaustedError(err)) break;
    }
  }

  return {
    processed,
    synced,
    failed,
    deferred: Math.max(0, getMatchdayMutations().filter((m) => m.status === 'PENDING').length),
  };
}

function getMatchdayMutations(): PendingMutation[] {
  return getPendingMutations('PENDING').filter(
    (mutation) =>
      mutation.entityType === 'MATCHDAY_OVERRIDE' &&
      ['SET_MATCHDAY_OVERRIDE', 'ADVANCE_MATCHDAY', 'OPEN_MATCHDAY_NOW', 'SET_MATCHDAY_TIMER'].includes(
        mutation.operation
      )
  );
}
