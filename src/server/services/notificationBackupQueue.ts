import { Redis } from '@upstash/redis';
import { getUpstashClient, KEY_PREFIX } from '../readModel/readModelStore';
import { resolveRedisConfig } from '../readModel/redisConfig';

export const SMART_ENQUEUE_SCRIPT = `
  if redis.call('HEXISTS', KEYS[2], ARGV[2]) == 1 then return 0 end
  local accepted = redis.call('SET', KEYS[1], '1', 'NX', 'EX', ARGV[1])
  if not accepted then return -1 end
  redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])
  redis.call('RPUSH', KEYS[3], ARGV[4])
  return 1
`;

export interface BackupEnvelope {
  dedupeKey: string;
  broadcastId: string;
  record: string;
  job: string;
}

const RECORDS = `${KEY_PREFIX}:telegram:backup:records`;
const PENDING = `${KEY_PREFIX}:telegram:backup:pending`;
let backupClient: Redis | null = null;

export function getNotificationBackupClient(): Redis | null {
  if (backupClient) return backupClient;
  const url = process.env.NOTIFICATION_BACKUP_REDIS_REST_URL?.trim();
  const token = process.env.NOTIFICATION_BACKUP_REDIS_REST_TOKEN?.trim();
  const primary = resolveRedisConfig(process.env);
  if (!url || !token || url === primary?.url) return null;
  try {
    if (new URL(url).protocol !== 'https:') return null;
    backupClient = new Redis({ url, token, retry: { retries: 1 }, signal: () => AbortSignal.timeout(5000) });
    return backupClient;
  } catch { return null; }
}

/** No expiry: an outage must not silently discard a saved event. */
export async function persistBackupNotification(envelope: BackupEnvelope, backup = getNotificationBackupClient()): Promise<boolean> {
  if (!backup) return false;
  await backup.eval(`
    redis.call('HSETNX', KEYS[1], ARGV[1], ARGV[2])
    redis.call('ZADD', KEYS[2], 'NX', ARGV[3], ARGV[1])
    return 1
  `, [RECORDS, PENDING], [envelope.broadcastId, JSON.stringify(envelope), Date.now()]);
  return true;
}

export async function pendingBackupNotifications(): Promise<number> {
  const backup = getNotificationBackupClient();
  if (!backup) return 0;
  try { return await backup.zcard(PENDING); }
  catch (error: any) {
    console.warn('[NOTIF_BACKUP_STATUS_UNAVAILABLE]', error?.message || error);
    return 0;
  }
}

/** Copy before deleting. An uncertain primary response leaves the backup intact.
 * The primary broadcast ID also deduplicates retries after the short TTL expires.
 */
export async function recoverBackupNotifications(batchSize = 25, primary = getUpstashClient(), backup = getNotificationBackupClient()): Promise<number> {
  if (!primary || !backup) return 0;
  const ids = await backup.zrange<string[]>(PENDING, 0, Math.max(1, Math.min(batchSize, 100)) - 1);
  let recovered = 0;
  for (const id of ids) {
    const envelope = await backup.hget<BackupEnvelope>(RECORDS, id);
    if (!envelope || envelope.broadcastId !== id) throw new Error('NOTIFICATION_BACKUP_RECORD_INVALID');
    const result = await primary.eval(SMART_ENQUEUE_SCRIPT,
      [envelope.dedupeKey, `${KEY_PREFIX}:telegram:broadcasts`, `${KEY_PREFIX}:telegram:queue`],
      [7 * 24 * 60 * 60, id, envelope.record, envelope.job]);
    if (Number(result) !== 0 && Number(result) !== 1) throw new Error('NOTIFICATION_BACKUP_REPLAY_UNCONFIRMED');
    await backup.eval(`
      redis.call('HDEL', KEYS[1], ARGV[1])
      redis.call('ZREM', KEYS[2], ARGV[1])
      return 1
    `, [RECORDS, PENDING], [id]);
    recovered++;
  }
  return recovered;
}
