import { waitUntil } from '@vercel/functions';
import { processCompetitionNotices } from './competitionNotices';
import { processLeagueBacklogReminders } from './leagueBacklogReminders';
import { processRequestedBacklogReminders } from './backlogReminderRequests';

/**
 * Produce only the notification intents that production users depend on.
 * This intentionally excludes mutation reconciliation, daily AI reports,
 * tournament sweeps, round-image publishing and team-maintenance jobs.
 */
export async function prepareEssentialNotifications(): Promise<boolean> {
  if (process.env.MIGRATION_WRITE_FREEZE === 'true') return false;
  if (process.env.DATABASE_PROVIDER !== 'supabase' || process.env.SUPABASE_DATA_NAMESPACE !== 'production') return false;

  let pending = false;
  const failures: unknown[] = [];
  const phases: Array<() => Promise<boolean | void>> = [
    () => processRequestedBacklogReminders(),
    () => processLeagueBacklogReminders(),
    () => processCompetitionNotices(40, undefined, Date.now() + 7000),
  ];

  for (const phase of phases) {
    try { pending = Boolean(await phase()) || pending; }
    catch (error) { failures.push(error); }
  }
  if (failures.length) {
    throw Object.assign(new AggregateError(failures, 'Essential notification preparation deferred'), { pendingWork: pending });
  }
  return pending;
}

export function scheduleEssentialNotifications(hop = 0): void {
  if (process.env.VERCEL !== '1' && !process.env.K_SERVICE) return;
  const task = (async () => {
    const queue = await import('./telegramNotificationQueue');
    let pending = false;
    try { pending = await prepareEssentialNotifications(); }
    catch (error: any) {
      pending = error?.pendingWork === true;
      console.warn('[ESSENTIAL_NOTIFICATION_PREPARATION_DEFERRED]', error?.message || error);
      if (!pending && hop < 3 && process.env.VERCEL === '1') await queue.triggerNotificationContinuation(hop + 1);
    } finally {
      queue.scheduleNotificationQueueDrain(hop);
    }
    if (pending && hop < 256) {
      if (process.env.VERCEL === '1') await queue.triggerNotificationContinuation(hop + 1);
      else scheduleEssentialNotifications(hop + 1);
    }
  })().catch((error: any) => console.warn('[ESSENTIAL_NOTIFICATION_WORKER_DEFERRED]', error?.message || error));

  if (process.env.VERCEL === '1') waitUntil(task);
  else void task;
}
