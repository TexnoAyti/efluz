import {randomUUID} from 'node:crypto';
import {getFirestoreDb} from '../firebase/admin';
import {getRuntimeStateStore} from '../readModel/runtimeStateStore';
import {notifySmartMatchdayOpened} from './smartNotificationService';

export const MATCHDAY_NOTIFICATION_JOBS = 'matchday_notification_jobs';
/** The intent commits with the round. Partial enqueue failures remain retryable;
 * deterministic per-player broadcast IDs preserve successful work on retries. */
export async function processMatchdayNotificationJob(id: string): Promise<{queued: number; status: 'QUEUED' | 'PENDING' | 'SKIPPED'}> {
  const db = getFirestoreDb(), ref = db.collection(MATCHDAY_NOTIFICATION_JOBS).doc(id);
  const store = getRuntimeStateStore()!;
  const lease = `efluz:v1:matchday-notification-job:${id}`;
  const token = randomUUID();
  if (!await store.set(lease, token, {nx: true, ex: 120})) return {queued: 0, status: 'PENDING'};
  try {
    const job = (await ref.get()).data();
    if (!job || job.status !== 'PENDING') return {queued: 0, status: 'SKIPPED'};
    const lock = (await db.collection('matchday_locks').doc(`${job.seasonId}:${job.competitionId}:${job.matchday}`).get()).data();
    if (!lock?.isOpen || lock.expiresAt !== job.deadlineAt || Date.parse(job.deadlineAt) <= Date.now()) {
      await ref.update({status: 'SUPERSEDED', updatedAt: new Date().toISOString()});
      return {queued: 0, status: 'SKIPPED'};
    }
    const queued = await notifySmartMatchdayOpened(job as any);
    await ref.update({status: 'QUEUED', queued, updatedAt: new Date().toISOString()});
    return {queued, status: 'QUEUED'};
  } catch (error: any) {
    console.warn('[MATCHDAY_NOTIFICATION_RETRY_PENDING]', {id, reason: error?.message});
    return {queued: 0, status: 'PENDING'};
  } finally {
    // Fenced release: an expired worker cannot clear a replacement's lease.
    await store.eval('EFL_STATE_RELEASE_V1', [lease], [token]).catch(() => {});
  }
}

export async function processPendingMatchdayNotifications(): Promise<void> {
  if (process.env.DATABASE_PROVIDER !== 'supabase' || process.env.MIGRATION_WRITE_FREEZE === 'true') return;
  const docs = await getFirestoreDb().collection(MATCHDAY_NOTIFICATION_JOBS).where('status', '==', 'PENDING').limit(5).get();
  for (const doc of docs.docs) await processMatchdayNotificationJob(doc.id);
}
