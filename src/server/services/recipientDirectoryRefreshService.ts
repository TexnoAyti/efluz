import { getUpstashClient, KEY_PREFIX } from '../readModel/readModelStore';
import { syncRecipientDirectory } from './telegramNotificationQueue';

const DEFAULT_REFRESH_INTERVAL_SECONDS = 5 * 60;

export interface RecipientDirectoryRefreshResult {
  refreshed: boolean;
  count?: number;
  reason: 'refreshed' | 'recently-refreshed' | 'redis-unavailable' | 'refresh-failed';
}

/**
 * Keeps the durable Telegram recipient directory aligned with Firestore without
 * turning every login into a full users/occupancies scan.
 *
 * A Redis lease allows at most one authoritative rebuild per interval across
 * all serverless instances. Failures never break authentication; the existing
 * durable directory is preserved by syncRecipientDirectory().
 */
export async function refreshRecipientDirectoryIfStale(
  seasonId = 'season-2026-27',
  intervalSeconds = DEFAULT_REFRESH_INTERVAL_SECONDS
): Promise<RecipientDirectoryRefreshResult> {
  const client = getUpstashClient();
  if (!client) return { refreshed: false, reason: 'redis-unavailable' };

  const leaseKey = `${KEY_PREFIX}:telegram:recipient-directory:refresh-lease:${seasonId}`;
  const ttl = Math.max(60, Math.floor(intervalSeconds));

  try {
    const claimed = await client.eval<unknown[], number>(`
      if redis.call('EXISTS', KEYS[1]) == 1 then
        return 0
      end
      redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
      return 1
    `, [leaseKey], [String(Date.now()), ttl]);

    if (Number(claimed) !== 1) {
      return { refreshed: false, reason: 'recently-refreshed' };
    }

    try {
      const count = await syncRecipientDirectory(seasonId);
      console.info('[RECIPIENT_DIRECTORY_REFRESHED]', JSON.stringify({ seasonId, count }));
      return { refreshed: true, count, reason: 'refreshed' };
    } catch (error: any) {
      // Allow a fast retry after a failed authoritative refresh.
      await client.del(leaseKey).catch(() => {});
      console.warn('[RECIPIENT_DIRECTORY_REFRESH_FAILED]', error?.message || error);
      return { refreshed: false, reason: 'refresh-failed' };
    }
  } catch (error: any) {
    console.warn('[RECIPIENT_DIRECTORY_REFRESH_LEASE_FAILED]', error?.message || error);
    return { refreshed: false, reason: 'refresh-failed' };
  }
}
