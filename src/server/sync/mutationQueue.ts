import fs from 'fs';
import path from 'path';
import { queryAll, queryGet, queryRun } from '../db';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { assertNoSyntheticIdsInProduction } from '../utils/testGuard';
import {
  persistDurableMutation,
  getDuePendingMutations,
  getDurableMutation,
  markMutationSyncing,
  markMutationSynced,
  markMutationRetryable,
  markMutationFailed,
  isRedisOutboxConfigured,
  DurablePersistenceUnavailableError,
  type DurableOutboxMutation,
} from '../outbox/redisOutbox';

export {
  isRedisOutboxConfigured,
  DurablePersistenceUnavailableError,
};
export type {
  DurableOutboxMutation,
};

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

export async function enqueueDurableOutboxMutation<T = any>(
  mutation: {
    mutationId: string;
    operation: string;
    entityType: string;
    entityId: string;
    userId?: string;
    adminUserId?: string;
    seasonId?: string;
    competitionId?: string;
    payload: T;
    createdAt?: string;
  }
): Promise<PendingMutation<T>> {
  const now = new Date().toISOString();
  const createdAt = mutation.createdAt || now;

  const fullMutation: PendingMutation<T> = {
    mutationId: mutation.mutationId,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    operation: mutation.operation,
    payload: mutation.payload,
    createdAt,
    status: 'PENDING',
    retryCount: 0,
    lastError: null,
    updatedAt: now,
  };

  const durableMutation: DurableOutboxMutation<T> = {
    mutationId: mutation.mutationId,
    operation: mutation.operation,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    userId: mutation.userId,
    adminUserId: mutation.adminUserId,
    seasonId: mutation.seasonId || 'season-2026-27',
    competitionId: mutation.competitionId,
    payload: mutation.payload,
    createdAt,
    updatedAt: now,
    retryCount: 0,
    nextRetryAt: Date.now(),
    lastError: null,
    status: 'PENDING',
  };

  // 1. MUST persist to durable Redis outbox FIRST
  await persistDurableMutation(durableMutation);

  // 2. Only after Redis persistence succeeds, update local memory & SQLite mirror
  memoryQueue.set(mutation.mutationId, fullMutation);
  saveQueueBackupToFile();

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
    console.warn('[MUTATION_QUEUE] SQLite mirror insert warning:', err);
  }

  console.log(`[MUTATION_QUEUE] Enqueued durable mutation: id=${fullMutation.mutationId} type=${fullMutation.entityType}`);
  return fullMutation;
}

export function enqueueMutation<T = any>(
  mutation: Omit<PendingMutation<T>, 'status' | 'retryCount' | 'lastError' | 'updatedAt'>
): PendingMutation<T> {
  // If Redis is not configured, we cannot durably accept the mutation.
  if (!isRedisOutboxConfigured()) {
    throw Object.assign(
      new DurablePersistenceUnavailableError('Remote database unavailable. Change was not accepted; retry when service recovers.'),
      { code: 'DURABLE_PERSISTENCE_UNAVAILABLE', statusCode: 503 }
    );
  }

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

  // Asynchronously persist to Redis
  const durableMutation: DurableOutboxMutation<T> = {
    mutationId: mutation.mutationId,
    operation: mutation.operation,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    userId: (mutation.payload as any)?.userId,
    adminUserId: (mutation.payload as any)?.adminUserId,
    seasonId: (mutation.payload as any)?.seasonId || 'season-2026-27',
    competitionId: (mutation.payload as any)?.competitionId,
    payload: mutation.payload,
    createdAt: mutation.createdAt || now,
    updatedAt: now,
    retryCount: fullMutation.retryCount,
    nextRetryAt: Date.now(),
    lastError: null,
    status: 'PENDING',
  };
  persistDurableMutation(durableMutation).catch((err) => {
    console.warn('[MUTATION_QUEUE] Background Redis persistence failed:', err);
  });

  memoryQueue.set(mutation.mutationId, fullMutation);
  saveQueueBackupToFile();

  // Persist into SQLite mirror
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
  let processed = 0;
  let synced = 0;
  let failed = 0;
  const errors: Array<{ mutationId: string; error: string }> = [];

  try {
    const db = getFirestoreDb();

    // 1. Fetch due items from durable Redis outbox first
    let dueMutations: PendingMutation[] = [];
    if (isRedisOutboxConfigured()) {
      try {
        const redisDue = await getDuePendingMutations(15);
        dueMutations = redisDue.map((m) => ({
          mutationId: m.mutationId,
          entityType: m.entityType,
          entityId: m.entityId,
          operation: m.operation,
          payload: m.payload,
          createdAt: m.createdAt,
          status: m.status,
          retryCount: m.retryCount,
          lastError: m.lastError,
          updatedAt: m.updatedAt,
        }));
      } catch (err: any) {
        console.warn('[MUTATION_QUEUE] Failed to fetch due mutations from Redis outbox:', err?.message || err);
      }
    }

    // 2. If Redis returned no items or is not configured, check local SQLite / memory fallback
    if (dueMutations.length === 0) {
      dueMutations = getPendingMutations('PENDING').sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    }

    for (const item of dueMutations) {
      // Check circuit breaker before each mutation
      if (!firestoreCircuitBreaker.canExecute()) {
        console.warn('[MUTATION_QUEUE] Circuit breaker tripped during sync. Aborting remaining mutations.');
        break;
      }

      processed++;
      await markMutationSyncing(item.mutationId).catch(() => {});
      updateMutationStatus(item.mutationId, 'SYNCING');

      try {
        await executeSingleMutationSync(db, item);
        await markMutationSynced(item.mutationId).catch(() => {});
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
        if (isTerminalError) {
          await markMutationFailed(item.mutationId, err.message).catch(() => {});
        } else {
          await markMutationRetryable(item.mutationId, err.message).catch(() => {});
        }
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

      if (newStatus === 'CONFIRMED' && winnerClubId) {
        try {
          const { advanceKnockoutWinnerFirestore } = await import('../tournament/knockoutEngine');
          await advanceKnockoutWinnerFirestore(entityId);
        } catch (kErr) {
          console.warn('[KNOCKOUT_ADVANCE] Non-blocking advance error in sync replay:', kErr);
        }
      }

      if (newStatus === 'CONFIRMED' && fixData.competitionId) {
        try {
          const { rebuildCompetitionStandingsFirestore } = await import('../firebase/firestoreStore');
          await rebuildCompetitionStandingsFirestore(fixData.competitionId);
        } catch (sErr) {
          console.warn('[STANDINGS_UPDATE] Non-blocking standings update in sync replay:', sErr);
        }
      }

      // Replay-safe deterministic audit log
      const auditId = `audit_${item.mutationId}_submit`;
      await db.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId).set({
        id: auditId,
        actorUserId: payload.userId,
        action: 'SUBMIT_RESULT',
        entityType: 'fixture',
        entityId: entityId,
        notes: `Result submitted: ${payload.homeScore}-${payload.awayScore} (status: ${newStatus})`,
        createdAt: payload.createdAt || new Date().toISOString(),
      }, { merge: true });

      // Replay-safe deterministic opponent notification
      const opponentClubId = payload.userClubId === fixData.homeClubId ? fixData.awayClubId : fixData.homeClubId;
      if (opponentClubId && fixData.seasonId) {
        try {
          const notifId = `notif_${item.mutationId}_opponent`;
          const opponentOcc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${fixData.seasonId}_${opponentClubId}`).get();
          if (opponentOcc.exists && opponentOcc.data()?.userId) {
            const oppUserId = opponentOcc.data()!.userId;
            await db.collection(COLLECTIONS.NOTIFICATIONS).doc(notifId).set({
              id: notifId,
              userId: oppUserId,
              type: newStatus === 'CONFIRMED' ? 'RESULT_CONFIRMED' : 'RESULT_SUBMITTED',
              title: newStatus === 'CONFIRMED' ? 'Match Result Confirmed' : 'Opponent Submitted Score',
              message: `Match result: ${payload.homeScore}-${payload.awayScore}`,
              fixtureId: entityId,
              isRead: false,
              createdAt: new Date().toISOString(),
            }, { merge: true });
          }
        } catch {}
      }

      if (newStatus === 'CONFIRMED') {
        try {
          const { refreshChangedFixtureReadModel, invalidateFixtureReadModels, invalidateStandingsReadModels } = await import('../readModel/readModelStore');
          await refreshChangedFixtureReadModel(entityId).catch(() => {});
          if (fixData.competitionId) {
            await invalidateFixtureReadModels(fixData.competitionId, fixData.seasonId || 'season-2026-27').catch(() => {});
            await invalidateStandingsReadModels(fixData.competitionId, fixData.seasonId || 'season-2026-27').catch(() => {});
          }
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

      // Synchronize SQLite mirror
      try {
        const { upsertFixtureToSqlite } = await import('../db');
        upsertFixtureToSqlite({
          id: entityId,
          seasonId: fixData.seasonId || 'season-2026-27',
          competitionId: fixData.competitionId,
          matchday: fixData.matchday || 1,
          roundName: fixData.roundName,
          homeClubId: fixData.homeClubId,
          awayClubId: fixData.awayClubId,
          scheduledAt: fixData.scheduledAt || now,
          status: 'CONFIRMED',
          homeScore: payload.homeScore,
          awayScore: payload.awayScore,
          winnerClubId,
          resultConfirmedAt: now,
          updatedAt: now,
        });
      } catch {}

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

      if (winnerClubId) {
        try {
          const { advanceKnockoutWinnerFirestore } = await import('../tournament/knockoutEngine');
          await advanceKnockoutWinnerFirestore(entityId);
        } catch {}
      }

      if (fixData.competitionId) {
        try {
          const { rebuildCompetitionStandingsFirestore } = await import('../firebase/firestoreStore');
          await rebuildCompetitionStandingsFirestore(fixData.competitionId);
        } catch {}
        try {
          const { refreshMaterializedStandingsForCompetition } = await import('../db/sqliteStandings');
          refreshMaterializedStandingsForCompetition(fixData.competitionId);
        } catch {}
      }

      // Replay-safe deterministic audit log
      const auditId = `audit_${item.mutationId}_approve`;
      await db.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId).set({
        id: auditId,
        actorUserId: payload.adminUserId,
        action: 'ADMIN_APPROVE_RESULT',
        entityType: 'fixture',
        entityId: entityId,
        notes: payload.notes || 'Approved by admin via sync',
        createdAt: now,
      }, { merge: true });

      // Propagate to read models on replay
      try {
        const { refreshChangedFixtureReadModel, invalidateFixtureReadModels, invalidateStandingsReadModels } = await import('../readModel/readModelStore');
        await refreshChangedFixtureReadModel(entityId).catch(() => {});
        if (fixData.competitionId) {
          await invalidateFixtureReadModels(fixData.competitionId, fixData.seasonId || 'season-2026-27').catch(() => {});
          await invalidateStandingsReadModels(fixData.competitionId, fixData.seasonId || 'season-2026-27').catch(() => {});
        }
      } catch {}
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

      // Synchronize SQLite mirror
      try {
        const { upsertFixtureToSqlite } = await import('../db');
        upsertFixtureToSqlite({
          id: entityId,
          seasonId: fixDoc.data()?.seasonId || 'season-2026-27',
          competitionId: fixDoc.data()?.competitionId,
          matchday: fixDoc.data()?.matchday || 1,
          roundName: fixDoc.data()?.roundName,
          homeClubId: fixDoc.data()?.homeClubId,
          awayClubId: fixDoc.data()?.awayClubId,
          scheduledAt: fixDoc.data()?.scheduledAt || now,
          status: 'SCHEDULED',
          homeScore: null,
          awayScore: null,
          winnerClubId: null,
          resultConfirmedAt: null,
          updatedAt: now,
        });
      } catch {}

      // Delete submissions
      const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', '==', entityId).get();
      const b = db.batch();
      for (const doc of subsSnap.docs) {
        b.delete(doc.ref);
      }
      await b.commit();
      try {
        queryRun('DELETE FROM result_submissions WHERE fixture_id = ?', [entityId]);
      } catch {}

      if (fixDoc.data()?.competitionId) {
        try {
          const { rebuildCompetitionStandingsFirestore } = await import('../firebase/firestoreStore');
          await rebuildCompetitionStandingsFirestore(fixDoc.data()!.competitionId);
        } catch {}
        try {
          const { refreshMaterializedStandingsForCompetition } = await import('../db/sqliteStandings');
          refreshMaterializedStandingsForCompetition(fixDoc.data()!.competitionId);
        } catch {}
      }

      // Replay-safe deterministic audit log
      const auditId = `audit_${item.mutationId}_reject`;
      await db.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId).set({
        id: auditId,
        actorUserId: payload.adminUserId,
        action: 'ADMIN_REJECT_RESULT',
        entityType: 'fixture',
        entityId: entityId,
        notes: payload.notes || 'Rejected by admin via sync',
        createdAt: now,
      }, { merge: true });

      // Propagate to read models on replay
      try {
        const { refreshChangedFixtureReadModel, invalidateFixtureReadModels, invalidateStandingsReadModels } = await import('../readModel/readModelStore');
        await refreshChangedFixtureReadModel(entityId).catch(() => {});
        if (fixDoc.data()?.competitionId) {
          await invalidateFixtureReadModels(fixDoc.data()!.competitionId, fixDoc.data()?.seasonId || 'season-2026-27').catch(() => {});
          await invalidateStandingsReadModels(fixDoc.data()!.competitionId, fixDoc.data()?.seasonId || 'season-2026-27').catch(() => {});
        }
      } catch {}
      break;
    }

    case 'ADMIN_EDIT_RESULT': {
      // payload: { fixtureId, adminUserId, adminUsername, homeScore, awayScore, status, notes, competitionId, seasonId, matchday, roundName, homeClubId, awayClubId, winnerClubId }
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(entityId);
      const fixDoc = await fixRef.get();
      if (!fixDoc.exists) {
        throw new Error(`Fixture ${entityId} not found in Firestore.`);
      }

      const fixData = fixDoc.data()!;
      const now = new Date().toISOString();
      const targetStatus = payload.status || 'CONFIRMED';
      let winnerClubId: string | null = null;
      if (payload.homeScore > payload.awayScore) winnerClubId = fixData.homeClubId || payload.homeClubId;
      else if (payload.awayScore > payload.homeScore) winnerClubId = fixData.awayClubId || payload.awayClubId;

      await fixRef.update({
        status: targetStatus,
        homeScore: payload.homeScore,
        awayScore: payload.awayScore,
        winnerClubId,
        resultConfirmedAt: targetStatus === 'CONFIRMED' ? now : null,
        updatedAt: now,
      });

      const compId = fixData.competitionId || payload.competitionId;
      const seasonId = fixData.seasonId || payload.seasonId || 'season-2026-27';

      try {
        const { upsertFixtureToSqlite } = await import('../db');
        upsertFixtureToSqlite({
          id: entityId,
          seasonId,
          competitionId: compId,
          matchday: fixData.matchday || payload.matchday || 1,
          roundName: fixData.roundName || payload.roundName,
          homeClubId: fixData.homeClubId || payload.homeClubId,
          awayClubId: fixData.awayClubId || payload.awayClubId,
          scheduledAt: fixData.scheduledAt || payload.scheduledAt || now,
          status: targetStatus,
          homeScore: payload.homeScore,
          awayScore: payload.awayScore,
          winnerClubId,
          resultConfirmedAt: targetStatus === 'CONFIRMED' ? now : null,
          updatedAt: now,
        });
      } catch (err: any) {
        console.warn('[REPLAY SQLITE UPSERT WARNING]:', err.message);
      }

      if (winnerClubId && targetStatus === 'CONFIRMED') {
        try {
          const { advanceKnockoutWinnerFirestore } = await import('../tournament/knockoutEngine');
          await advanceKnockoutWinnerFirestore(entityId);
        } catch {}
      }

      if (compId) {
        try {
          const { rebuildCompetitionStandingsFirestore } = await import('../firebase/firestoreStore');
          await rebuildCompetitionStandingsFirestore(compId);
        } catch {}
        try {
          const { refreshMaterializedStandingsForCompetition } = await import('../db/sqliteStandings');
          refreshMaterializedStandingsForCompetition(compId);
        } catch {}
      }

      // Replay-safe deterministic audit log
      const auditId = `audit_${item.mutationId}`;
      await db.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId).set({
        id: auditId,
        actorUserId: payload.adminUserId,
        actorUsername: payload.adminUsername,
        action: 'ADMIN_EDIT_RESULT',
        entityType: 'fixture',
        entityId: entityId,
        notes: payload.notes || `Admin set result ${payload.homeScore}-${payload.awayScore}`,
        createdAt: payload.createdAt || now,
      }, { merge: true });

      try {
        const { refreshChangedFixtureReadModel, invalidateFixtureReadModels, invalidateStandingsReadModels } = await import('../readModel/readModelStore');
        await refreshChangedFixtureReadModel(entityId).catch(() => {});
        if (compId) {
          await invalidateFixtureReadModels(compId, seasonId).catch(() => {});
          await invalidateStandingsReadModels(compId, seasonId).catch(() => {});
        }
      } catch (rmErr: any) {
        console.warn('[REPLAY READ_MODEL_PROPAGATION_WARNING]:', rmErr?.message);
      }
      break;
    }

    case 'ADMIN_DELETE_RESULT': {
      // payload: { fixtureId, adminUserId, adminUsername, deleteSubmissions, notes, competitionId, seasonId, matchday, roundName, homeClubId, awayClubId }
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(entityId);
      const fixDoc = await fixRef.get();
      if (!fixDoc.exists) {
        throw new Error(`Fixture ${entityId} not found in Firestore.`);
      }

      const fixData = fixDoc.data()!;
      const now = new Date().toISOString();
      await fixRef.update({
        status: 'SCHEDULED',
        homeScore: null,
        awayScore: null,
        winnerClubId: null,
        resultConfirmedAt: null,
        updatedAt: now,
      });

      const compId = fixData.competitionId || payload.competitionId;
      const seasonId = fixData.seasonId || payload.seasonId || 'season-2026-27';

      try {
        const { upsertFixtureToSqlite } = await import('../db');
        upsertFixtureToSqlite({
          id: entityId,
          seasonId,
          competitionId: compId,
          matchday: fixData.matchday || payload.matchday || 1,
          roundName: fixData.roundName || payload.roundName,
          homeClubId: fixData.homeClubId || payload.homeClubId,
          awayClubId: fixData.awayClubId || payload.awayClubId,
          scheduledAt: fixData.scheduledAt || payload.scheduledAt || now,
          status: 'SCHEDULED',
          homeScore: null,
          awayScore: null,
          winnerClubId: null,
          resultConfirmedAt: null,
          updatedAt: now,
        });
      } catch (err: any) {
        console.warn('[REPLAY SQLITE UPSERT DELETE WARNING]:', err.message);
      }

      if (payload.deleteSubmissions) {
        try {
          const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', '==', entityId).get();
          const b = db.batch();
          for (const doc of subsSnap.docs) {
            b.delete(doc.ref);
          }
          await b.commit();
          queryRun('DELETE FROM result_submissions WHERE fixture_id = ?', [entityId]);
        } catch {}
      }

      if (compId) {
        try {
          const { rebuildCompetitionStandingsFirestore } = await import('../firebase/firestoreStore');
          await rebuildCompetitionStandingsFirestore(compId);
        } catch {}
        try {
          const { refreshMaterializedStandingsForCompetition } = await import('../db/sqliteStandings');
          refreshMaterializedStandingsForCompetition(compId);
        } catch {}
      }

      // Replay-safe deterministic audit log
      const auditId = `audit_${item.mutationId}`;
      await db.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId).set({
        id: auditId,
        actorUserId: payload.adminUserId,
        actorUsername: payload.adminUsername,
        action: 'ADMIN_DELETE_RESULT',
        entityType: 'fixture',
        entityId: entityId,
        notes: payload.notes || 'Admin deleted match result and reset status to SCHEDULED',
        createdAt: payload.createdAt || now,
      }, { merge: true });

      try {
        const { refreshChangedFixtureReadModel, invalidateFixtureReadModels, invalidateStandingsReadModels } = await import('../readModel/readModelStore');
        await refreshChangedFixtureReadModel(entityId).catch(() => {});
        if (compId) {
          await invalidateFixtureReadModels(compId, seasonId).catch(() => {});
          await invalidateStandingsReadModels(compId, seasonId).catch(() => {});
        }
      } catch (rmErr: any) {
        console.warn('[REPLAY READ_MODEL_PROPAGATION_WARNING]:', rmErr?.message);
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
