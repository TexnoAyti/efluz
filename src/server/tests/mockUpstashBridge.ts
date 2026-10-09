import http from 'node:http';
import { resetUpstashClient } from '../readModel/readModelStore';

export interface MockRedisServer {
  server: http.Server;
  port: number;
  store: Map<string, string>;
  zsets: Map<string, Map<string, number>>;
  sets: Map<string, Set<string>>;
  close: () => Promise<void>;
  simulateFailure: (fail: boolean) => void;
}

/**
 * Spins up an in-process HTTP mock for Upstash Redis REST protocol on localhost.
 * Routes https://redis.test.invalid to this loopback HTTP server without needing external network or redis-server binary.
 */
export async function startMockUpstashBridge(): Promise<MockRedisServer> {
  const store = new Map<string, string>();
  const zsets = new Map<string, Map<string, number>>();
  const sets = new Map<string, Set<string>>();
  let shouldFail = false;

  function execCommand(args: any[]): any {
    if (shouldFail) {
      return { error: 'REDIS_CONNECTION_REFUSED' };
    }
    const op = String(args[0]).toLowerCase();
    if (op === 'ping') return 'PONG';
    if (op === 'set') {
      if (args.some(a => String(a).toLowerCase() === 'nx') && store.has(String(args[1]))) return null;
      store.set(String(args[1]), typeof args[2] === 'string' ? args[2] : JSON.stringify(args[2]));
      return 'OK';
    }
    if (op === 'mget') return args.slice(1).map(key => store.get(String(key)) ?? null);
    if (op === 'get') {
      return store.has(String(args[1])) ? store.get(String(args[1])) : null;
    }
    if (op === 'del') {
      let count = 0;
      for (let i = 1; i < args.length; i++) {
        const k = String(args[i]);
        if (store.delete(k)) count++;
        if (zsets.delete(k)) count++;
        if (sets.delete(k)) count++;
      }
      return count;
    }
    if (op === 'exists') {
      const k = String(args[1]);
      return store.has(k) || zsets.has(k) || sets.has(k) ? 1 : 0;
    }
    if (op === 'ttl') {
      const k = String(args[1]);
      return store.has(k) || zsets.has(k) || sets.has(k) ? -1 : -2;
    }
    if (op === 'zadd') {
      const key = String(args[1]);
      if (!zsets.has(key)) zsets.set(key, new Map());
      const z = zsets.get(key)!;
      let added = 0;
      for (let i = 2; i < args.length; i += 2) {
        const score = Number(args[i]);
        const member = String(args[i + 1]);
        if (!z.has(member)) added++;
        z.set(member, score);
      }
      return added;
    }
    if (op === 'zrange') {
      const key = String(args[1]);
      const z = zsets.get(key) || new Map<string, number>();
      const entries = Array.from(z.entries()).sort((a, b) => a[1] - b[1]);
      const min = args[2];
      const max = args[3];
      const isByScore = args.some((a) => String(a).toLowerCase() === 'byscore');
      let res = entries;
      if (isByScore) {
        const minScore = min === '-inf' ? -Infinity : Number(min);
        const maxScore = max === '+inf' ? Infinity : Number(max);
        res = res.filter((e) => e[1] >= minScore && e[1] <= maxScore);
      }
      const offsetIdx = args.findIndex((a) => String(a).toLowerCase() === 'offset' || String(a).toLowerCase() === 'limit');
      if (offsetIdx !== -1 && args[offsetIdx + 1] !== undefined && args[offsetIdx + 2] !== undefined) {
        const offset = Number(args[offsetIdx + 1]);
        const count = Number(args[offsetIdx + 2]);
        res = res.slice(offset, offset + count);
      }
      return res.map((e) => e[0]);
    }
    if (op === 'zrem') {
      const key = String(args[1]);
      const z = zsets.get(key);
      if (!z) return 0;
      let count = 0;
      for (let i = 2; i < args.length; i++) {
        if (z.delete(String(args[i]))) count++;
      }
      return count;
    }
    if (op === 'sadd') {
      const key = String(args[1]);
      if (!sets.has(key)) sets.set(key, new Set());
      const s = sets.get(key)!;
      let added = 0;
      for (let i = 2; i < args.length; i++) {
        const m = String(args[i]);
        if (!s.has(m)) {
          s.add(m);
          added++;
        }
      }
      return added;
    }
    if (op === 'smembers') {
      const key = String(args[1]);
      const s = sets.get(key) || new Set();
      return Array.from(s);
    }
    if (op === 'eval') {
      const numKeys = Number(args[2] || 0);
      const keys = args.slice(3, 3 + numKeys);
      const argv = args.slice(3 + numKeys);
      if (String(args[1]).includes("redis.call('GET', KEYS[1]) == ARGV[1]")) {
        return store.get(String(keys[0])) === String(argv[0]) ? Number(store.delete(String(keys[0]))) : 0;
      }
      if (String(args[1]).includes('EFL_OUTBOX_TRANSITION_V1')) {
        const raw = store.get(String(keys[0]));
        if (!raw || (JSON.parse(raw).revision || '') !== String(argv[1])) return 0;
        store.set(String(keys[0]), String(argv[0]));
        if (!zsets.has(String(keys[1]))) zsets.set(String(keys[1]), new Map());
        if (argv[3] === 'SYNCED' || argv[3] === 'FAILED') zsets.get(String(keys[1]))!.delete(String(argv[2]));
        else zsets.get(String(keys[1]))!.set(String(argv[2]), Number(argv[4]));
        return 1;
      }
      if (String(args[1]).includes('EFL_OUTBOX_PERSIST_V1')) {
        store.set(String(keys[0]), String(argv[0]));
        if (!zsets.has(String(keys[1]))) zsets.set(String(keys[1]), new Map());
        if (argv[3] === 'PENDING' || argv[3] === 'SYNCING') zsets.get(String(keys[1]))!.set(String(argv[2]), Number(argv[1]));
        else zsets.get(String(keys[1]))!.delete(String(argv[2]));
        if (!sets.has(String(keys[2]))) sets.set(String(keys[2]), new Set());
        sets.get(String(keys[2]))!.add(String(argv[2]));
        return 1;
      }
      if (keys[1] && argv[0]) {
        store.set(String(keys[1]), typeof argv[0] === 'string' ? argv[0] : JSON.stringify(argv[0]));
      }
      if (keys[0] && argv[0]) {
        store.set(String(keys[0]), typeof argv[0] === 'string' ? argv[0] : JSON.stringify(argv[0]));
      }
      return 1;
    }
    return 'OK';
  }

  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      if (shouldFail) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'REDIS_CONNECTION_REFUSED' }));
        return;
      }
      const input = JSON.parse(body || '{}');
      res.setHeader('Content-Type', 'application/json');
      if (Array.isArray(input[0])) {
        res.end(JSON.stringify(input.map((cmd: any) => ({ result: execCommand(cmd) }))));
      } else {
        res.end(JSON.stringify({ result: execCommand(input) }));
      }
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err?.message || 'Server error' }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as any;
  const redisOrigin = 'https://redis.test.invalid';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: any, init?: any) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.origin === redisOrigin) {
      return originalFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
    }
    return originalFetch(input, init);
  }) as any;

  process.env.UPSTASH_REDIS_REST_URL = redisOrigin;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'isolated-test-token';
  resetUpstashClient();

  return {
    server,
    port: address.port,
    store,
    zsets,
    sets,
    close: async () => {
      globalThis.fetch = originalFetch;
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      resetUpstashClient();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    simulateFailure: (fail: boolean) => {
      shouldFail = fail;
    },
  };
}
