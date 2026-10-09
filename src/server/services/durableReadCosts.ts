import { AsyncLocalStorage } from 'node:async_hooks';
import { waitUntil } from '@vercel/functions';
import type { Request, Response, NextFunction } from 'express';
import { getBoundedRedisClient } from '../readModel/boundedRedis';

type Buckets = Map<number, Map<string, number>>;
type CostContext = { buckets: Buckets; closed: boolean; endpoint: () => string };
const context = new AsyncLocalStorage<CostContext>();
const prefix = 'efluz:v1:read-cost:';
const hourKey = (time: number) => prefix + new Date(time).toISOString().slice(0, 13);
export const READ_COST_INCREMENT_LUA = `
for i = 1, #ARGV, 2 do redis.call('HINCRBY', KEYS[1], ARGV[i], ARGV[i + 1]) end
redis.call('EXPIRE', KEYS[1], 604800)
return 1
`;
function add(entries: Map<string, number>, key: string, amount: number) { entries.set(key, (entries.get(key) || 0) + amount); }
function label(value: string) { return value.replace(/[^a-zA-Z0-9_:/ .-]/g, '_').slice(0, 120) || 'unknown'; }
function collect(buckets: Buckets, collection: string, count: number, caller: string) {
  const hour = Math.floor(Date.now() / 3600000) * 3600000;
  let entries = buckets.get(hour);
  if (!entries) { entries = new Map(); buckets.set(hour, entries); }
  add(entries, 'totalReads', count);
  add(entries, 'collection:' + label(collection), count);
  add(entries, 'caller:' + label(caller), count);
}
async function persist(entries: Map<string, number>, endpoint: string, time = Date.now()) {
  const total = entries.get('totalReads') || 0;
  if (!total) return;
  const client = getBoundedRedisClient();
  if (!client) return;
  const values = new Map(entries);
  add(values, 'requestsWithReads', 1);
  add(values, 'endpoint:' + label(endpoint), total);
  await client.eval(READ_COST_INCREMENT_LUA, [hourKey(time)], [...values].flatMap(([key, value]) => [key, value]));
}
async function persistBuckets(buckets: Buckets, endpoint: string) {
  await Promise.all([...buckets].map(([time, entries]) => persist(entries, endpoint, time)));
}
function keepAlive(work: Promise<unknown>) {
  const safe = work.catch(() => { console.warn('[READ_COST_TELEMETRY_UNAVAILABLE] Redis write failed; no Firestore fallback.'); });
  if (process.env.VERCEL === '1') waitUntil(safe);
  else void safe;
}
let background: Buckets | null = null;
/** Existing tracked reads only, not the Firebase billing counter. No user data. */
export function recordDurableRead(collection: string, count: number, caller: string) {
  if (!Number.isSafeInteger(count) || count <= 0) return;
  const active = context.getStore();
  if (active && !active.closed) { collect(active.buckets, collection, count, caller); return; }
  if (!background) {
    background = new Map();
    const buffer = background;
    keepAlive(new Promise(resolve => setTimeout(resolve, 100)).then(async () => {
      if (background === buffer) background = null;
      await persistBuckets(buffer, 'background');
    }));
  }
  collect(background, collection, count, caller);
}
/** Runs before auth/initialization so reads caused by either are attributed. */
export function readCostMiddleware(req: Request, res: Response, next: NextFunction) {
  const active: CostContext = {
    buckets: new Map(), closed: false,
    // Route templates only: never raw URLs, IDs, search strings or usernames.
    endpoint: () => `${req.method} ${req.baseUrl || ''}${typeof req.route?.path === 'string' ? req.route.path : '/unmatched'}`,
  };
  const finish = () => {
    if (active.closed) return;
    active.closed = true;
    keepAlive(persistBuckets(active.buckets, active.endpoint()));
  };
  res.once('finish', finish); res.once('close', finish);
  context.run(active, next);
}
export async function getDurableReadCosts(from?: string, to?: string) {
  const until = to ? Date.parse(to) : Date.now();
  const since = from ? Date.parse(from) : until - 24 * 3600000;
  if (!Number.isFinite(since) || !Number.isFinite(until) || until <= since || until - since > 24 * 3600000 || since < Date.now() - 7 * 86400000 || until > Date.now() + 60000)
    throw new Error('INVALID_READ_COST_WINDOW');
  const hours: number[] = [];
  for (let time = Math.floor(since / 3600000) * 3600000; time < until; time += 3600000) hours.push(time);
  const base = { from: new Date(since).toISOString(), to: new Date(until).toISOString(), timezone: 'Asia/Tashkent', retentionDays: 7, resolution: 'hour', coverage: 'instrumented reads; not Firebase billing; collection reads without tracking are excluded', bucketPolicy: 'full overlapping UTC hours; reads attributed when recorded' };
  const client = getBoundedRedisClient();
  if (!client) return { ...base, available: false, hours: [] };
  try {
    const pipeline = client.pipeline();
    for (const time of hours) pipeline.hgetall(hourKey(time));
    const rows = await pipeline.exec<Record<string, number | string>[]>();
    const totals = new Map<string, number>();
    const windows = hours.map((time, index) => {
      const values = rows[index] || {};
      for (const [field, value] of Object.entries(values)) if (Number.isFinite(Number(value))) add(totals, field, Number(value));
      const group = (kind: string) => Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith(kind + ':')).map(([key, value]) => [key.slice(kind.length + 1), Number(value)]));
      return { utcHour: new Date(time).toISOString(), tashkentHour: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).format(time), observed: Object.keys(values).length > 0, totalReads: Number(values.totalReads || 0), requestsWithReads: Number(values.requestsWithReads || 0), byEndpoint: group('endpoint'), byCollection: group('collection'), byCaller: group('caller') };
    });
    const group = (kind: string) => Object.fromEntries([...totals].filter(([key]) => key.startsWith(kind + ':')).map(([key, value]) => [key.slice(kind.length + 1), value]));
    return { ...base, available: true, totalReads: totals.get('totalReads') || 0, requestsWithReads: totals.get('requestsWithReads') || 0, byEndpoint: group('endpoint'), byCollection: group('collection'), byCaller: group('caller'), hours: windows };
  } catch { return { ...base, available: false, hours: [] }; }
}
