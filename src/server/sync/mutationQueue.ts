import fs from 'fs';
import path from 'path';
import { queryAll, queryGet, queryRun } from '../db';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { assertNoSyntheticIdsInProduction } from '../utils/testGuard';

export type MutationStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

export interface PendingMutation<T = any> {
  mutationId: string;
  entityType:
    | 'RESULT_SUBMISSION'
    | 'CLUB_CLAIM'
    | 'ADMIN_APPROVE_RESULT'
    | 'ADMIN_REJECT_RESULT'
    | 'ADMIN_DECISION'
    | 'ADMIN_ASSIGN_CLUB'
    | 'ADMIN_RELEASE_CLUB'
    | 'MATCHDAY_OVERRIDE'
    | 'DISPUTE_CREATION'
    | 'DISPUTE_RESOLUTION'
    | 'USER_CREATE'
    | string;
  entityId: string;
  operation: string;
  payload: T;
  createdAt: string;
  status: MutationStatus;
  retryCount: number;
  lastError: string | null;
  updatedAt: string;
}

export interface SyncResult {
  totalPending: number;
  processed: number;
  synced: number;
  failed: number;
  circuitOpen: boolean;
  errors: Array<{ mutationId: string; error: string }>;
}

// In-memory queue mirror + optional file backup in data/
const memoryQueue = new Map<string, PendingMutation>();
let isSyncInProgress = false;

// File backup path
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
const BACKUP_DIR = process.env.DATA_DIR || (IS_SERVERLESS ? '/tmp/data' : path.resolve(process.cwd(), 'data'));
const BACKUP_FILE = path.join(BACKUP_DIR, 'pending_mutations.json');

function saveQueueBackupToFile(): void {
  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    const arr = Array.from(memoryQueue.values()).filter((m) => m.status === 'PENDING' || m.status === 'SYNCING');
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(arr, null, 2), 'utf-8');
  } catch {}
}

function loadQueueBackupFromFile(): void {
  try {
    if (fs.existsSync(BACKUP_FILE)) {
      const content = fs.readFileSync(BACKUP_FILE, 'utf-8');
      const arr = JSON.parse(content) as PendingMutation[];
      for (const item of arr) {
        if (!memoryQueue.has(item.mutationId)) {
          memoryQueue.set(item.mutationId, item);
        }
      }
    }
  } catch {}
}

export function enqueueMutation<T = any>(
  mutation: Omit<PendingMutation<T>, 'status' | 'retryCount' | 'lastError' | 'updatedAt'>
): PendingMutation<T> {
  const now = new Date().toISOString();
  const existing = memoryQueue.get(mutation.mutationId);

  // Idempotency: if already exists and is SYNCED, do not re-enqueue
  if (existing && existing.status === 'SYNCED') {
    return existing;
  }

  const fullMutation: PendingMutation<T> = {
    ...mutation,
    status: 'PENDING',
    retryCount: existing ? existing.retryCount : 0,
    lastError: null,
    updatedAt: now,
  };

  memoryQueue.set(mutation.mutationId, fullMutation);
  saveQueueBackupToFile();

  // Persist into SQLite
  try {
    queryRun(
      `INSERT OR REPLACE INTO pending_mutations 
       (mutation_id, entity_type, entity_id, operation, payload, status, retry_count, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fullMutation.mutationId,
        fullMutation.entityType,
        fullMutation.entityId,
        fullMutation.operation,
        JSON.stringify(fullMutation.payload),
        fullMutation.status,
        fullMutation.retryCount,
        fullMutation.lastError,
        fullMutation.createdAt,
        fullMutation.updatedAt,
      ]
    );
  } catch (err) {
    console.warn('[MUTATION_QUEUE] SQLite insert warning:', err);
  }

  console.log(`[MUTATION_QUEUE] Enqueued mutation: id=${fullMutation.mutationId} type=${fullMutation.entityType}`);
  return fullMutation;
}

export function getPendingMutations(status?: MutationStatus): PendingMutation[] {
  // First ensure loaded from SQLite or file if memory is cold
  if (memoryQueue.size === 0) {
    try {
      const rows = queryAll<any>(
        `SELECT mutation_id, entity_type, entity_id, operation, payload, status, retry_count, last_error, created_at, updated_at 
         FROM pending_mutations WHERE status IN ('PENDING', 'SYNCING')`
      );
      for (const r of rows) {
        let payload = {};
        try {
          payload = JSON.parse(r.payload);
        } catch {}
        memoryQueue.set(r.mutation_id, {
          mutationId: r.mutation_id,
          entityType: r.entity_type,
          entityId: r.entity_id,
          operation: r.operation,
          payload,
          status: r.status,
          retryCount: r.retry_count || 0,
          lastError: r.last_error || null,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        });
      }
    } catch {}

    loadQueueBackupFromFile();
  }

  const all = Array.from(memoryQueue.values());
  if (status) {
    return all.filter((m) => m.status === status);
  }
  return all;
}

export function updateMutationStatus(
  mutationId: string,
  status: MutationStatus,
  error?: string | null
): void {
  const item = memoryQueue.get(mutationId);
  const now = new Date().toISOString();
  if (item) {
    item.status = status;
    item.updatedAt = now;
    if (error) {
      item.lastError = error;
      item.retryCount = (item.retryCount || 0) + 1;
    } else if (status === 'SYNCED') {
      item.lastError = null;
    }
    memoryQueue.set(mutationId, item);
  }

  saveQueueBackupToFile();

  try {
    queryRun(
      `UPDATE pending_mutations 
       SET status = ?, last_error = ?, updated_at = ?, retry_count = retry_count + ?
       WHERE mutation_id = ?`,
      [status, error || null, now, error ? 1 : 0, mutationId]
    );
  } catch {}
}

export function getQueueStats() {
  const all = getPendingMutations();
  return {
    total: all.length,
    pending: all.filter((m) => m.status === 'PENDING').length,
    syncing: all.filter((m) => m.status === 'SYNCING').length,
    synced: all.filter((m) => m.status === 'SYNCED').length,
    failed: all.filter((m) => m.status === 'FAILED').length,
  };
}

/**
 * Reconciles pending mutations to Firestore when Firestore is available.
 * Idempotent, safe, drains in creation order.
 */
export async function processPendingMutations(): Promise<SyncResult> {
  if (isSyncInProgress) {
    console.log('[MUTATION_QUEUE] Sync already in progress, skipping duplicate call.');
    return {
      totalPending: getPendingMutations('PENDING').length,
      processed: 0,
      synced: 0,
      failed: 0,
      circuitOpen: !firestoreCircuitBreaker.canExecute(),
      errors: [],
    };
  }

  if (!firestoreCircuitBreaker.canExecute()) {
    console.log('[MUTATION_QUEUE] Circuit breaker is OPEN. Deferring sync.');
    return {
      totalPending: getPendingMutations('PENDING').length,
      processed: 0,
      synced: 0,
      failed: 0,
      circuitOpen: true,
      errors: [],
    };
  }

  isSyncInProgress = true;
  const pendingItems = getPendingMutations('PENDING').sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  let processed = 0;
  let synced = 0;
  let failed = 0;
  const errors: Array<{ mutationId: string; error: string }> = [];

  try {
    const db = getFirestoreDb();

    for (const item of pendingItems) {
      // Check circuit breaker before each mutation
      if (!firestoreCircuitBreaker.canExecute()) {
        console.warn('[MUTATION_QUEUE] Circuit breaker tripped during sync. Aborting remaining mutations.');
        break;
      }

      processed++;
      updateMutationStatus(item.mutationId, 'SYNCING');

      try {
        await executeSingleMutationSync(db, item);
        updateMutationStatus(item.mutationId, 'SYNCED');
        firestoreCircuitBreaker.recordSuccess();
        synced++;
        console.log(`[MUTATION_QUEUE] Successfully synced mutation ${item.mutationId} (${item.entityType})`);
      } catch (err: any) {
        const isQuota = firestoreCircuitBreaker.isQuotaExhaustedError(err);
        const isOwnershipMismatch = err.message?.includes('OWNERSHIP_MISMATCH');
        const isTerminalError = isOwnershipMismatch;
        firestoreCircuitBreaker.recordFailure(err);

        // Failed or fallback-only replay must remain PENDING for retry.
        // Terminal permission/ownership mismatches must be marked FAILED.
        const nextStatus: MutationStatus = isTerminalError ? 'FAILED' : 'PENDING';
        updateMutationStatus(item.mutationId, nextStatus, err.message);
        failed++;
        errors.push({ mutationId: item.mutationId, error: err.message });
        console.error(`[MUTATION_QUEUE] Failed syncing mutation ${item.mutationId}:`, err.message);

        if (isQuota) {
          // If quota exhausted, abort immediately to prevent hammering
          break;
        }
      }
    }
  } finally {
    isSyncInProgress = false;
  }

  return {
    totalPending: getPendingMutations('PENDING').length,
    processed,
    synced,
    failed,
    circuitOpen: !firestoreCircuitBreaker.canExecute(),
    errors,
  };
}

async function executeSingleMutationSync(db: FirebaseFirestore.Firestore, item: PendingMutation): Promise<void> {
  const { entityType, entityId, payload } = item;

  // Reject synthetic actor IDs or entity IDs before any mutation replay in production
  assertNoSyntheticIdsInProduction(`mutation_queue_replay:${entityType}`, [
    item.mutationId,
    entityId,
    payload?.adminUserId,
    payload?.userId,
    payload?.targetUserId,
    payload?.submittedByUserId,
    payload?.fixtureId,
    payload?.clubId,
    payload?.submissionId,
  ]);

  switch (entityType) {
    case 'RESULT_SUBMISSION': {
      // payload: { fixtureId, userId, userClubId, homeScore, awayScore, proofUrl, now, submissionId }
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(entityId);
      const fixDoc = await fixRef.get();
      if (!fixDoc.exists) {
        throw new Error(`Fixture ${entityId} not found in Firestore.`);
      }

      const fixData = fixDoc.data()!;
      const subRef = db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc(payload.submissionId);

      // Write submission doc
      await subRef.set(
        {
          id: payload.submissionId,
          fixtureId: entityId,
          submittedByUserId: payload.userId,
          clubId: payload.userClubId,
          homeScore: payload.homeScore,
          awayScore: payload.awayScore,
          proofUrl: payload.proofUrl || null,
          createdAt: payload.createdAt || new Date().toISOString(),
        },
        { merge: true }
      );

      // Check all submissions in Firestore for this fixture
      const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', '==', entityId).get();
      const subs = subsSnap.docs.map((d) => d.data());

      let newStatus = fixData.status;
      let confirmedHome: number | null = fixData.homeScore ?? null;
      let confirmedAway: number | null = fixData.awayScore ?? null;
      let winnerClubId: string | null = fixData.winnerClubId ?? null;
      let confirmedAt: string | null = fixData.resultConfirmedAt ?? null;

      if (subs.length >= 2) {
        const [s1, s2] = subs;
        if (s1.homeScore === s2.homeScore && s1.awayScore === s2.awayScore) {
          newStatus = 'CONFIRMED';
          confirmedHome = s1.homeScore;
          confirmedAway = s1.awayScore;
          confirmedAt = payload.updatedAt || new Date().toISOString();
          if (confirmedHome > confirmedAway) winnerClubId = fixData.homeClubId;
          else if (confirmedAway > confirmedHome) winnerClubId = fixData.awayClubId;
        } else {
          newStatus = 'DISPUTED';
        }
      } else if (subs.length === 1 && newStatus !== 'CONFIRMED') {
        newStatus = 'PENDING_CONFIRMATION';
      }

      await fixRef.update({
        status: newStatus,
        homeScore: confirmedHome,
        awayScore: confirmedAway,
        winnerClubId,
        resultConfirmedAt: confirmedAt,
        updatedAt: new Date().toISOString(),
      });

      if (newStatus === 'CONFIRMED' && fixData.competitionId) {
        try {
          const { rebuildCompetitionStandingsFirestore } = await import('../firebase/firestoreStore');
          await rebuildCompetitionStandingsFirestore(fixData.competitionId);
        } catch {}
      }
      break;
    }

    case 'ADMIN_APPROVE_RESULT': {
      // payload: { adminUserId, homeScore, awayScore, notes, fixtureId }
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(entityId);
      const fixDoc = await fixRef.get();
      if (!fixDoc.exists) {
        throw new Error(`Fixture ${entityId} not found in Firestore.`);
      }

      const fixData = fixDoc.data()!;
      const now = new Date().toISOString();
      let winnerClubId: string | null = null;
      if (payload.homeScore > payload.awayScore) winnerClubId = fixData.homeClubId;
      else if (payload.awayScore > payload.homeScore) winnerClubId = fixData.awayClubId;

      await fixRef.update({
        status: 'CONFIRMED',
        homeScore: payload.homeScore,
        awayScore: payload.awayScore,
        winnerClubId,
        resultConfirmedAt: now,
        updatedAt: now,
      });

      // Resolve open disputes in Firestore
      const disputesSnap = await db.collection(COLLECTIONS.DISPUTES).where('fixtureId', '==', entityId).get();
      for (const d of disputesSnap.docs) {
        await d.ref.update({
          status: 'RESOLVED',
          resolvedByUserId: payload.adminUserId,
          resolutionNotes: payload.notes || 'Approved by admin via sync',
          resolvedAt: now,
        });
      }

      if (fixData.competitionId) {
        try {
          const { rebuildCompetitionStandingsFirestore } = await import('../firebase/firestoreStore');
          await rebuildCompetitionStandingsFirestore(fixData.competitionId);
        } catch {}
      }
      break;
    }

    case 'ADMIN_REJECT_RESULT': {
      // payload: { adminUserId, notes, fixtureId }
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(entityId);
      const fixDoc = await fixRef.get();
      if (!fixDoc.exists) {
        throw new Error(`Fixture ${entityId} not found in Firestore.`);
      }

      const now = new Date().toISOString();
      await fixRef.update({
        status: 'SCHEDULED',
        homeScore: null,
        awayScore: null,
        winnerClubId: null,
        resultConfirmedAt: null,
        updatedAt: now,
      });

      // Delete submissions
      const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', '==', entityId).get();
      const b = db.batch();
      for (const doc of subsSnap.docs) {
        b.delete(doc.ref);
      }
      await b.commit();

      if (fixDoc.data()?.competitionId) {
        try {
          const { rebuildCompetitionStandingsFirestore } = await import('../firebase/firestoreStore');
          await rebuildCompetitionStandingsFirestore(fixDoc.data()!.competitionId);
        } catch {}
      }
      break;
    }

    case 'CLUB_CLAIM': {
      // payload: { clubId, seasonId, userId, claimedAt }
      const { claimClubAtomicFirestore } = await import('../firebase/firestoreStore');
      const res = await claimClubAtomicFirestore(payload.userId, payload.clubId, payload.seasonId, { authoritativeOnly: true });
      if (!res || !res.authoritative || (res as any).isFallback) {
        throw new Error('AUTHORITATIVE_WRITE_FAILED: Remote claim write did not succeed.');
      }
      break;
    }

    case 'ADMIN_ASSIGN_CLUB': {
      // payload: { clubId, targetUserId, seasonId, notes }
      const { adminAssignClubFirestore } = await import('../firebase/firestoreStore');
      const res = await adminAssignClubFirestore(payload.adminUserId || 'system', payload.clubId, payload.targetUserId, payload.seasonId, { authoritativeOnly: true });
      if (!res || !res.authoritative || (res as any).isFallback) {
        throw new Error('AUTHORITATIVE_WRITE_FAILED: Remote admin assign club did not succeed.');
      }
      break;
    }

    case 'ADMIN_RELEASE_CLUB': {
      // payload: { clubId, seasonId, notes }
      const { adminReleaseClubFirestore } = await import('../firebase/firestoreStore');
      const res = await adminReleaseClubFirestore(payload.adminUserId || 'system', payload.clubId, payload.seasonId, { authoritativeOnly: true });
      if (!res || !res.authoritative || (res as any).isFallback) {
        throw new Error('AUTHORITATIVE_WRITE_FAILED: Remote admin release club did not succeed.');
      }
      break;
    }

    case 'MATCHDAY_OVERRIDE': {
      // payload: { competitionId, overrideStatus }
      const { setCompetitionMatchdayOverrideFirestore } = await import('../firebase/firestoreStore');
      await setCompetitionMatchdayOverrideFirestore(payload.competitionId, payload.overrideStatus);
      break;
    }

    case 'ADMIN_DECISION': {
      if (item.operation === 'ADMIN_APPROVE_RESULT') {
        const { adminApproveFixtureResultFirestore } = await import('../firebase/firestoreStore');
        const res = await adminApproveFixtureResultFirestore(
          payload.adminUserId,
          payload.fixtureId,
          payload.homeScore,
          payload.awayScore,
          payload.notes,
          { authoritativeOnly: true }
        );
        if (!res || !res.authoritative || (res as any).isFallback) {
          throw new Error('AUTHORITATIVE_WRITE_FAILED: Remote admin approve write did not succeed.');
        }
      } else if (item.operation === 'ADMIN_REJECT_RESULT') {
        const { reopenFixtureFirestore } = await import('../firebase/firestoreStore');
        const res = await reopenFixtureFirestore(
          payload.adminUserId,
          payload.fixtureId,
          payload.notes,
          { authoritativeOnly: true }
        );
        if (!res || !res.authoritative || (res as any).isFallback) {
          throw new Error('AUTHORITATIVE_WRITE_FAILED: Remote reopen write did not succeed.');
        }
      }
      break;
    }

    case 'USER_CREATE': {
      const { getOrCreateTelegramUserFirestore } = await import('../firebase/firestoreStore');
      await getOrCreateTelegramUserFirestore(payload);
      break;
    }

    case 'NOTIFICATION_READ': {
      const notifRef = db.collection(COLLECTIONS.NOTIFICATIONS).doc(entityId);
      const notifDoc = await notifRef.get();
      if (!notifDoc.exists) {
        console.warn(`[MUTATION_QUEUE] Notification ${entityId} not found in Firestore during sync replay. Skipping.`);
        break;
      }
      const notifData = notifDoc.data();
      if (payload.userId && notifData?.userId !== payload.userId) {
        throw new Error(`OWNERSHIP_MISMATCH: Notification ${entityId} belongs to user '${notifData?.userId}', not '${payload.userId}'.`);
      }
      await notifRef.update({ isRead: true, readAt: payload.readAt || new Date().toISOString() });
      break;
    }

    case 'NOTIFICATION_READ_ALL': {
      const targetUserId = payload.userId || entityId;
      const notifsSnap = await db
        .collection(COLLECTIONS.NOTIFICATIONS)
        .where('userId', '==', targetUserId)
        .where('isRead', '==', false)
        .get();
      if (!notifsSnap.empty) {
        const b = db.batch();
        const readAt = payload.readAt || new Date().toISOString();
        notifsSnap.docs.forEach((d) => b.update(d.ref, { isRead: true, readAt }));
        await b.commit();
      }
      break;
    }

    default:
      console.warn(`[MUTATION_QUEUE] Unknown mutation entityType: ${entityType}`);
  }
}
