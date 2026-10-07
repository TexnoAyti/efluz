import { randomUUID } from 'node:crypto';
import { getBoundedRedisClient } from './boundedRedis';

export const RELEASE_READ_REFRESH = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;
export function isReadRefreshUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('READ_REFRESH_');
}
/** Shared only for read-model rebuilds, never authoritative mutation checks. */
export function createSharedReadRefresh(getClient = getBoundedRedisClient) {
  const flights = new Map<string, Promise<unknown>>();
  return async function refresh<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = flights.get(key);
    if (existing) return existing as Promise<T>;
    const work = (async () => {
      const client = getClient();
      const leaseKey = `efluz:v1:read-refresh:${key}`;
      const token = randomUUID();
      if (!client && (process.env.NODE_ENV === 'production' || process.env.VERCEL)) throw new Error('READ_REFRESH_REDIS_UNAVAILABLE');
      if (client) {
        let acquired;
        try { acquired = await client.set(leaseKey, token, { nx: true, ex: 90 }); }
        catch { throw new Error('READ_REFRESH_REDIS_UNAVAILABLE'); }
        if (!acquired) throw new Error('READ_REFRESH_BUSY');
      }
      try { return await load(); }
      finally {
        if (client) await client.eval(RELEASE_READ_REFRESH, [leaseKey], [token]).catch(() => {});
      }
    })();
    flights.set(key, work);
    try { return await work; }
    finally { if (flights.get(key) === work) flights.delete(key); }
  };
}
export const sharedReadRefresh = createSharedReadRefresh();
