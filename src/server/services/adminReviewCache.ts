import { waitUntil } from '@vercel/functions';
import { randomUUID } from 'node:crypto';
import { getBoundedRedisClient } from '../readModel/boundedRedis';

const flights = new Map<string, Promise<any>>();
const localResults = new Map<string, { result: SharedResult; savedAt: number; epoch: number }>();
const epochKey = 'efluz:v1:admin:read-epoch';
let localEpoch = 0;
let invalidating: Promise<void> | null = null;
/** Cache invalidation never replaces the authoritative authorization check. */
export function invalidateSharedAdminData(): Promise<void> {
  localEpoch++;
  localResults.clear();
  if (invalidating) return invalidating;
  const client = getBoundedRedisClient();
  const work = (async () => {
    if (!client) return;
    let flushed;
    do {
      flushed = localEpoch;
      await client.incr(epochKey);
    } while (flushed !== localEpoch);
  })().catch(() => { console.warn('[ADMIN_READ_CACHE_INVALIDATION_UNAVAILABLE]'); });
  invalidating = work;
  void work.finally(() => { if (invalidating === work) invalidating = null; });
  if (process.env.VERCEL === '1') waitUntil(work);
  return work;
}

export const ADMIN_REVIEW_CACHE_PUBLISH_LUA = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if (redis.call('GET', KEYS[4]) or '0') ~= ARGV[5] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3] or 10)
redis.call('SET', KEYS[3], ARGV[2], 'EX', ARGV[4] or 300)
redis.call('DEL', KEYS[1])
return 1
`;
const unlock = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;
type Result = { pendingFixtures: any[]; submissions: any[]; disputes: any[]; degraded: boolean; stale: boolean; source: string };
type SharedResult = { degraded: boolean; stale: boolean; source: string };
function decode<T extends SharedResult>(value: unknown): { result: T; savedAt: number } | null {
  try {
    const entry = typeof value === 'string' ? JSON.parse(value) : value;
    return entry && typeof (entry as any).result?.degraded === 'boolean' && typeof (entry as any).result?.stale === 'boolean' && typeof (entry as any).result?.source === 'string' && Number.isFinite((entry as any).savedAt) ? entry as any : null;
  } catch { return null; }
}
/** Scope hash is server-derived; a distributed lease prevents instance fan-out.
 * A five-minute fallback is always labelled stale and never authorizes writes. */
export function readSharedAdminData<T extends SharedResult>(key: string, loader: () => Promise<T>, ttlSeconds = 10, fallbackSeconds = 300, bypassFresh = false): Promise<T> {
  const flightKey = key + ":local:" + localEpoch;
  if (flights.has(flightKey)) return flights.get(flightKey)!;
  const work = (async () => {
    if (invalidating) await invalidating;
    const generation = localEpoch;
    const remember = (result: T) => {
      if (!result.stale && !result.degraded && generation === localEpoch) {
        if (localResults.size >= 128 && !localResults.has(key)) localResults.delete(localResults.keys().next().value!);
        localResults.set(key, { result, savedAt: Date.now(), epoch: generation });
      }
      return result;
    };
    const loadLocally = async () => {
      const saved = localResults.get(key);
      if (!bypassFresh && saved && saved.epoch === localEpoch && Date.now() - saved.savedAt < ttlSeconds * 1000) {
        if (process.env.DATABASE_PROVIDER === 'supabase') return saved.result as T;
        return { ...saved.result, stale: true, degraded: true, source: 'process_stale' } as T;
      }
      return remember(await loader());
    };
    const client = getBoundedRedisClient();
    if (!client) return loadLocally();
    let epoch = '0';
    try { epoch = String(await client.get(epochKey) || '0'); } catch { return loadLocally(); }
    const scopedKey = key + ':epoch:' + epoch;
    const freshKey = scopedKey + ':fresh', lkgKey = scopedKey + ':lkg', lockKey = scopedKey + ':lock';
    let acquired = false;
    const owner = randomUUID();
    try {
      const cached = decode<T>(await client.get(freshKey));
      if (!bypassFresh && cached && Date.now() - cached.savedAt < ttlSeconds * 1000) return remember(cached.result);
      acquired = Boolean(await client.set(lockKey, owner, { nx: true, ex: 30 }));
      if (!acquired) {
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 50));
          const ready = decode<T>(await client.get(freshKey));
          if (ready && Date.now() - ready.savedAt < ttlSeconds * 1000) return remember(ready.result);
        }
        const last = decode<T>(await client.get(lkgKey));
        if (last && Date.now() - last.savedAt < fallbackSeconds * 1000) return { ...last.result, stale: true, degraded: true, source: 'redis_stale' };
        throw new Error('ADMIN_REVIEWS_REFRESHING');
      }
    } catch (error) {
      if ((error as Error).message === 'ADMIN_REVIEWS_REFRESHING') throw error;
      // Redis outage retains the existing local/coalesced read path.
      return loadLocally();
    }
    try {
      const result = remember(await loader());
      if (!result.degraded && !result.stale && generation === localEpoch) await client.eval(ADMIN_REVIEW_CACHE_PUBLISH_LUA, [lockKey, freshKey, lkgKey, epochKey], [owner, JSON.stringify({ result, savedAt: Date.now() }), ttlSeconds, fallbackSeconds, epoch]).catch(() => undefined);
      return result;
    } finally {
      if (acquired) await client.eval(unlock, [lockKey], [owner]).catch(() => undefined);
    }
  })();
  flights.set(flightKey, work);
  void work.finally(() => { if (flights.get(flightKey) === work) flights.delete(flightKey); }).catch(() => undefined);
  return work;
}

export function readSharedAdminReview(key: string, loader: () => Promise<Result>): Promise<Result> {
  return readSharedAdminData(key, loader);
}
