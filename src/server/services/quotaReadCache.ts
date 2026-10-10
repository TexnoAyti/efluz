import { getRuntimeStateStore } from '../readModel/runtimeStateStore';
import { randomUUID } from 'node:crypto';
import { KEY_PREFIX } from '../readModel/readModelStore';

interface Cached<T> { data: T; cachedAt: number; }
const local = new Map<string, Cached<unknown>>();
const LOCAL_CACHE_LIMIT = 2000;
const pending = new Map<string, Promise<unknown>>();
const versions = new Map<string, number>();
const keys = (key: string) => ['fresh', 'lkg', 'version', 'lease'].map(part => `${KEY_PREFIX}:quota-read:${key}:${part}`);

/** Non-security reads only. Redis lease prevents refresh fan-out across Vercel instances. */
export async function quotaCachedRead<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  const current = pending.get(key) as Promise<T> | undefined;
  if (current) return current;
  const localVersion = versions.get(key) || 0;
  const remember = (snapshot: Cached<T>) => {
    if ((versions.get(key) || 0) === localVersion) {
      local.delete(key);
      local.set(key, snapshot);
      if (local.size > LOCAL_CACHE_LIMIT) local.delete(local.keys().next().value!);
    }
    return snapshot.data;
  };
  const work = (async () => {
    const client = getRuntimeStateStore();
    const [freshKey, lkgKey, versionKey, leaseKey] = keys(key);
    if (!client) {
      const cached = local.get(key) as Cached<T> | undefined;
      if (cached && Date.now() - cached.cachedAt < ttlSeconds * 1000) return cached.data;
      local.delete(key);
      const data = await load();
      remember({ data, cachedAt: Date.now() });
      return data;
    }
    const owner = randomUUID();
    let owned = false;
    try {
      const fresh = await client.get<Cached<T>>(freshKey);
      if (fresh && Object.hasOwn(fresh, 'data')) return remember(fresh);
      owned = Boolean(await client.set(leaseKey, owner, { nx: true, ex: 15 }));
      if (!owned) {
        // Reuse last-known-good while one worker refreshes; a cold cache waits briefly.
        const lkg = await client.get<Cached<T>>(lkgKey);
        if (lkg && Object.hasOwn(lkg, 'data')) return remember(lkg);
        for (let attempt = 0; attempt < 12; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 150));
          const next = await client.get<Cached<T>>(freshKey);
          if (next && Object.hasOwn(next, 'data')) return remember(next);
        }
        throw new Error('QUOTA_CACHE_REFRESH_IN_PROGRESS');
      }
      // A previous worker may have published between our first GET and acquiring the lease.
      const recheck = await client.get<Cached<T>>(freshKey);
      if (recheck && Object.hasOwn(recheck, 'data')) return remember(recheck);
      const version = String(await client.get(versionKey) ?? '0');
      const data = await load();
      const cached = { data, cachedAt: Date.now() };
      const snapshot = JSON.stringify(cached);
      // A mutation or expired lease must prevent a slow reader from publishing old data.
      const published = await client.eval(`
        -- EFL_QUOTA_CACHE_PUBLISH_V1
        if redis.call('GET', KEYS[4]) ~= ARGV[1] then return 0 end
        if (redis.call('GET', KEYS[3]) or '0') ~= ARGV[2] then return 0 end
        redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4])
        redis.call('SET', KEYS[2], ARGV[3])
        return 1
      `, [freshKey, lkgKey, versionKey, leaseKey], [owner, version, snapshot, ttlSeconds]);
      if (Number(published) === 1) remember(cached);
      return data;
    } catch (error) {
      const lkg = await client.get<Cached<T>>(lkgKey).catch(() => null);
      if (lkg && Object.hasOwn(lkg, 'data')) return remember(lkg);
      const cached = local.get(key) as Cached<T> | undefined;
      if (cached && Date.now() - cached.cachedAt < ttlSeconds * 1000) return cached.data;
      throw error;
    } finally {
      if (owned) await client.eval(`-- EFL_STATE_RELEASE_V1\nif redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`, [leaseKey], [owner]).catch(() => {});
    }
  })();
  pending.set(key, work);
  try { return await work; } finally { if (pending.get(key) === work) pending.delete(key); }
}

export async function invalidateQuotaRead(key: string): Promise<void> {
  pending.delete(key);
  local.delete(key); versions.set(key, (versions.get(key) || 0) + 1);
  const client = getRuntimeStateStore();
  if (!client) return;
  const [freshKey, , versionKey] = keys(key);
  await client.eval(`-- EFL_QUOTA_CACHE_INVALIDATE_V1\nredis.call('INCR', KEYS[2]); redis.call('DEL', KEYS[1]); return 1`, [freshKey, versionKey], []);
}
