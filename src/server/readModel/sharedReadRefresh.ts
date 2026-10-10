import { randomUUID } from 'node:crypto';
import { getBoundedRedisClient } from './boundedRedis';

export const RELEASE_READ_REFRESH = `
-- EFL_STATE_RELEASE_V1
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;
export function isReadRefreshUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('READ_REFRESH_');
}
/** Shared only for read-model rebuilds, never authoritative mutation checks. */
export function createSharedReadRefresh(getClient = getBoundedRedisClient) {
  const flights = new Map<string, Promise<unknown>>();
  const failures = new Map<string, { until: number; error: unknown }>();
  let redisRetryAt = 0;
  return async function refresh<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = flights.get(key);
    if (existing) return existing as Promise<T>;
    const failed = failures.get(key);
    if (failed && failed.until > Date.now()) throw failed.error;
    const work = (async () => {
      const client = Date.now() >= redisRetryAt ? getClient() : null;
      const leaseKey = `efluz:v1:read-refresh:${key}`;
      const token = randomUUID();
      let ownsLease = false;
      if (client) {
        let acquired;
        try { acquired = await client.set(leaseKey, token, { nx: true, ex: 90 }); }
        catch { redisRetryAt = Date.now() + 60_000; acquired = 'local'; }
        if (!acquired) throw new Error('READ_REFRESH_BUSY');
        ownsLease = acquired !== 'local';
      }
      try {
        const result = await load();
        failures.delete(key);
        return result;
      } catch (error) {
        failures.set(key, { until: Date.now() + 60_000, error });
        throw error;
      }
      finally {
        if (client && ownsLease) await client.eval(RELEASE_READ_REFRESH, [leaseKey], [token]).catch(() => {});
      }
    })();
    flights.set(key, work);
    try { return await work; }
    finally { if (flights.get(key) === work) flights.delete(key); }
  };
}
export const sharedReadRefresh = createSharedReadRefresh();
