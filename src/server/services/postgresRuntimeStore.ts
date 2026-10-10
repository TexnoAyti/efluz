import { waitUntil } from '@vercel/functions';
import { PostgresKeyValueStore, parseStoredValue as parse } from './postgresKeyValueStore';

/** TTL settings, caches and distributed leases. This is not an arbitrary Lua
 * interpreter: callers must identify one of these reviewed atomic operations. */
export class PostgresRuntimeStore extends PostgresKeyValueStore {
  constructor() { super('runtime_state'); }

  async incr(key: string): Promise<number> {
    return this.atomic([key], (values, put) => {
      const next = Number(parse(values.get(key)?.value) || 0) + 1;
      put(key, next); return next;
    });
  }

  async hgetall<T = any>(key: string): Promise<T | null> { return this.get<T>(key); }
  pipeline() {
    const keys: string[] = [];
    return { hgetall(key: string) { keys.push(key); return this; }, exec: <T = any>() => this.mget<T>(...keys) };
  }

  async eval<T = any>(script: string, keys: string[], args: any[]): Promise<T> {
    return this.atomic(keys, (values, put) => {
      const get = (key: string) => parse(values.get(key)?.value);
      if (script.includes('EFL_STATE_RELEASE_V1')) {
        if (get(keys[0]) !== args[0]) return 0;
        put(keys[0], null, 0); return 1;
      }
      if (script.includes('EFL_RATE_LIMIT_V1')) {
        const next = Number(get(keys[0]) || 0) + 1;
        const expiresAt = values.get(keys[0])?.expiresAt;
        put(keys[0], next, expiresAt ? Math.max(.001, (expiresAt - Date.now()) / 1000) : Number(args[0]));
        return next;
      }
      if (script.includes('EFL_QUOTA_CACHE_INVALIDATE_V1')) {
        put(keys[1], Number(get(keys[1]) || 0) + 1);
        put(keys[0], null, 0); return 1;
      }
      if (script.includes('EFL_QUOTA_CACHE_PUBLISH_V1')) {
        if (get(keys[3]) !== args[0] || String(get(keys[2]) ?? '0') !== String(args[1])) return 0;
        put(keys[0], parse(args[2]), Number(args[3]));
        put(keys[1], parse(args[2])); return 1;
      }
      if (script.includes('EFL_ADMIN_CACHE_PUBLISH_V1')) {
        if (get(keys[0]) !== args[0] || String(get(keys[3]) ?? '0') !== String(args[4])) return 0;
        put(keys[1], parse(args[1]), Number(args[2]));
        put(keys[2], parse(args[1]), Number(args[3]));
        put(keys[0], null, 0); return 1;
      }
      if (script.includes('EFL_READ_COST_INCREMENT_V1')) {
        const hash = { ...(get(keys[0]) || {}) };
        for (let i = 0; i < args.length; i += 2) hash[args[i]] = Number(hash[args[i]] || 0) + Number(args[i + 1]);
        put(keys[0], hash, 604800); return 1;
      }
      throw Error('UNSUPPORTED_POSTGRES_RUNTIME_OPERATION');
    }) as Promise<T>;
  }
}

let cleanupAfter = 0;
/** Expired payloads are logically inaccessible immediately; active traffic also
 * removes up to 100 expired rows per minute without holding up the request. */
export function createPostgresRuntimeStore(): PostgresRuntimeStore {
  const store = new PostgresRuntimeStore();
  if (process.env.VERCEL === '1' && Date.now() >= cleanupAfter) {
    cleanupAfter = Date.now() + 60_000;
    waitUntil(store.pruneExpired().catch(() => { console.warn('[RUNTIME_STATE_RETENTION_UNAVAILABLE]'); }));
  }
  return store;
}
