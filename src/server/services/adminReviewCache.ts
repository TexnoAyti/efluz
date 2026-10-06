import { randomUUID } from 'node:crypto';
import { getBoundedRedisClient } from '../readModel/boundedRedis';

const flights = new Map<string, Promise<any>>();
export const ADMIN_REVIEW_CACHE_PUBLISH_LUA = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'EX', 10)
redis.call('SET', KEYS[3], ARGV[2], 'EX', 300)
redis.call('DEL', KEYS[1])
return 1
`;
const unlock = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;
type Result = { pendingFixtures: any[]; submissions: any[]; disputes: any[]; degraded: boolean; stale: boolean; source: string };
function decode(value: unknown): { result: Result; savedAt: number } | null {
  try {
    const entry = typeof value === 'string' ? JSON.parse(value) : value;
    return entry && Array.isArray((entry as any).result?.pendingFixtures) && Array.isArray((entry as any).result?.submissions) && Array.isArray((entry as any).result?.disputes) && Number.isFinite((entry as any).savedAt) ? entry as any : null;
  } catch { return null; }
}
/** Scope hash is server-derived; a distributed lease prevents instance fan-out.
 * A five-minute fallback is always labelled stale and never authorizes writes. */
export function readSharedAdminReview(key: string, loader: () => Promise<Result>): Promise<Result> {
  if (flights.has(key)) return flights.get(key)!;
  const work = (async () => {
    const client = getBoundedRedisClient();
    if (!client) return loader();
    const freshKey = key + ':fresh', lkgKey = key + ':lkg', lockKey = key + ':lock';
    let acquired = false;
    const owner = randomUUID();
    try {
      const cached = decode(await client.get(freshKey));
      if (cached && Date.now() - cached.savedAt < 10000) return cached.result;
      acquired = Boolean(await client.set(lockKey, owner, { nx: true, ex: 30 }));
      if (!acquired) {
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 50));
          const ready = decode(await client.get(freshKey));
          if (ready && Date.now() - ready.savedAt < 10000) return ready.result;
        }
        const last = decode(await client.get(lkgKey));
        if (last && Date.now() - last.savedAt < 300000) return { ...last.result, stale: true, degraded: true, source: 'redis_stale' };
        throw new Error('ADMIN_REVIEWS_REFRESHING');
      }
    } catch (error) {
      if ((error as Error).message === 'ADMIN_REVIEWS_REFRESHING') throw error;
      // Redis outage retains the existing local/coalesced read path.
      return loader();
    }
    try {
      const result = await loader();
      if (!result.degraded && !result.stale) await client.eval(ADMIN_REVIEW_CACHE_PUBLISH_LUA, [lockKey, freshKey, lkgKey], [owner, JSON.stringify({ result, savedAt: Date.now() })]).catch(() => undefined);
      return result;
    } finally {
      if (acquired) await client.eval(unlock, [lockKey], [owner]).catch(() => undefined);
    }
  })();
  flights.set(key, work);
  void work.finally(() => { if (flights.get(key) === work) flights.delete(key); }).catch(() => undefined);
  return work;
}
