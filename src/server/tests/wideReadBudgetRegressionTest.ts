import express from 'express';
import { once } from 'node:events';
import { adminRouter } from '../routes/admin.routes';
import assert from 'node:assert/strict';
import { getFirestoreDb } from '../firebase/admin';
import { getAdminUserDirectory, resolveAdminUserReference } from '../services/adminUserDirectory';
import { readSharedAdminData, invalidateSharedAdminData } from '../services/adminReviewCache';
import { redisDelRaw, getFreshKey } from '../readModel/readModelStore';

// Imported only by the actual local Redis suite. No live writes or sends.
if (process.env.REDIS_TEST_PORT) {
  const db = getFirestoreDb(), collection = db.collection.bind(db);
  for (let i = 0; i < 135; i++) await collection('users').doc('budget-directory-' + i).set({ username: 'BudgetPlayer' + i, telegramId: String(8800000 + i), isAdmin: false });
  await invalidateSharedAdminData();
  await redisDelRaw(getFreshKey('efluz:v1:admin:user-directory'));
  let scans = 0, lookups = 0;
  const wrap = (query: any, scan = false): any => new Proxy(query, { get(target, field) {
    const value = target[field];
    if (field === 'get') return async () => { if (scan) scans++; else lookups++; return target.get(); };
    if (['orderBy', 'where', 'limit', 'startAfter', 'doc'].includes(String(field))) return (...args: any[]) => wrap(value.apply(target, args), field === 'orderBy' || scan);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  db.collection = ((name: string) => name === 'users' ? wrap(collection(name)) : collection(name)) as any;
  try {
    const directories = await Promise.all(Array.from({ length: 8 }, () => getAdminUserDirectory()));
    assert.ok(directories[0].some(user => user.id === 'budget-directory-134'));
    assert.ok(scans <= Math.ceil(directories[0].length / 100) + 1, 'Parallel directory loads must share one paginated scan');
    const baseline = scans;
    for (let i = 0; i < 10; i++) assert.equal(await resolveAdminUserReference('@bUdGeTpLaYeR134'), 'budget-directory-134');
    assert.equal(scans, baseline, 'Repeated username resolution must not download the entire directory');
    assert.ok(lookups <= 30, 'Username verification uses bounded indexed lookups');
    await collection('users').doc('budget-directory-134').update({ username: 'RenamedBudget' });
    await assert.rejects(resolveAdminUserReference('@BudgetPlayer134'), /USER_NOT_FOUND/);
    assert.equal(await resolveAdminUserReference('@renamedbudget'), 'budget-directory-134');
    await collection('users').doc('budget-duplicate').set({ username: 'renamedbudget', telegramId: '8800999' });
    await assert.rejects(resolveAdminUserReference('@renamedbudget'), /AMBIGUOUS_USER_REFERENCE/);
    console.log('PASS actual Redis: eight directory readers share one scan, ten mixed-case username resolutions use bounded lookups, renamed and duplicate identities reject safely, no private fields leak');
  } finally { db.collection = collection; }

  let finish!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => finish = resolve);
  const entered = new Promise<void>(resolve => started = resolve);
  let loads = 0;
  const key = 'efluz:v1:test:read-budget-invalidation';
  const old = readSharedAdminData(key, async () => { loads++; started(); await gate; return { value: 1, stale: false, degraded: false, source: 'firestore' }; });
  await entered;
  await invalidateSharedAdminData();
  finish(); await old;
  const next = await readSharedAdminData(key, async () => { loads++; return { value: 2, stale: false, degraded: false, source: 'firestore' }; });
  assert.equal(next.value, 2); assert.equal(loads, 2);
  const cached = await readSharedAdminData(key, async () => { throw Error('SHOULD_USE_SHARED_CACHE'); return next; });
  assert.equal(cached.value, 2);
  console.log('PASS actual Redis: mutation invalidation prevents slow pre-mutation readers from publishing and reuses the latest global cache');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: any, init?: any) => {
    if (String(input).includes('redis.test.invalid')) return Promise.reject(new Error('ISOLATED_REDIS_OUTAGE'));
    return originalFetch(input, init);
  }) as any;
  try {
    const fallback = await readSharedAdminData(key, async () => { throw Error('NO_EXTRA_FIRESTORE_SCAN_DURING_REDIS_OUTAGE'); return next; });
    assert.equal(fallback.value, 2); assert.equal(fallback.stale, true); assert.equal(fallback.degraded, true);
    console.log('PASS Redis transport outage retains a bounded process snapshot with stale flags instead of an extra Firestore load');
  } finally { globalThis.fetch = originalFetch; }
  await collection('fixtures').doc('budget-dispute-game').set({ seasonId: 'season-2026-27', competitionId: 'comp-premier-league-2026', matchday: 1, homeClubId: 'club-arsenal', awayClubId: 'club-chelsea', status: 'DISPUTED' });
  await collection('disputes').doc('budget-open-dispute').set({ fixtureId: 'budget-dispute-game', seasonId: 'season-2026-27', status: 'OPEN', createdAt: new Date().toISOString() });
  await collection('users').doc('budget-root').set({ id: 'budget-root', telegramId: '8800888', username: 'BudgetRoot', isAdmin: true, isSuspended: false });
  await invalidateSharedAdminData();
  let aggregations = 0;
  db.collection = ((name: string) => new Proxy(collection(name), { get(target, field) {
    const value = target[field];
    if (field === 'count') return (...args: any[]) => { aggregations++; return value.apply(target, args); };
    return typeof value === 'function' ? value.bind(target) : value;
  } })) as any;
  const app = express();
  app.use((req: any, _res, next) => { req.user = { id: 'budget-root', telegramId: '8800888', isAdmin: true }; next(); });
  app.use('/api/admin', adminRouter);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const responses = await Promise.all(Array.from({ length: 8 }, () => fetch(base + '/api/admin/overview').then(async response => ({ status: response.status, body: await response.json() }))));
    assert.ok(responses.every(response => response.status === 200 && response.body.counts.registeredUsers > 135));
    // Only the root users count is directly counted by this proxy; the filtered
    // occupancy count returns a separate query object.
    assert.ok(responses[0].body.openDisputes.some((dispute: any) => dispute.id === 'budget-open-dispute' && dispute.fixture?.id === 'budget-dispute-game'), 'Referenced dispute fixture must be enriched without a missing FieldPath runtime error');
    assert.equal(aggregations, 1, 'Eight overview calls must share one aggregate request set');
    await collection('users').doc('budget-root').update({ isAdmin: false });
    assert.equal((await fetch(base + '/api/admin/overview')).status, 403, 'A warm admin cache never grants revoked authorization');
    console.log('PASS actual Redis HTTP: eight global overview requests share one query set; revocation blocks a forged admin claim even while the payload is cached');
  } finally { db.collection = collection; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }

}
