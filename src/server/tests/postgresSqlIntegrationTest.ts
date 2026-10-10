import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { getFirestoreDb } from '../firebase/admin';
import { PostgresRuntimeStore } from '../services/postgresRuntimeStore';
import { PostgresNotificationStore } from '../services/postgresNotificationStore';
import { encodeValue } from '../migration/firestoreArchive';
import { SMART_ENQUEUE_SCRIPT } from '../services/notificationBackupQueue';
import { quotaCachedRead, invalidateQuotaRead } from '../services/quotaReadCache';

// Native PostgreSQL WASM engine with repository SQL, not a JS query emulator.
// The HTTP envelope is simulated; this cannot prove hosted PostgREST latency.
const pg = new PGlite();
await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
for (const path of ['20261009044907_postgres_document_runtime.sql', '20261009125000_nonblocking_runtime_reads.sql', '20261010091409_application_runtime_commit_conflicts.sql']) {
  await pg.exec(await readFile('supabase/migrations/' + path, 'utf8'));
}
const privilege: any = (await pg.query(`select has_function_privilege('anon','public.efl_runtime_commit_safe(text,jsonb,text)','execute') as anonymous,
  has_function_privilege('authenticated','public.efl_runtime_commit_safe(text,jsonb,text)','execute') as authenticated,
  has_function_privilege('service_role','public.efl_runtime_commit_safe(text,jsonb,text)','execute') as service,
  (select prosecdef from pg_proc where oid='public.efl_runtime_commit_safe(text,jsonb,text)'::regprocedure) as definer;`)).rows[0];
assert.deepEqual(privilege, { anonymous: false, authenticated: false, service: true, definer: false });
await pg.exec('set role service_role;');
const originalFetch = globalThis.fetch;
let conflicts = 0, legacyHttpCommits = 0;
globalThis.fetch = (async (input: any, init: any) => {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://isolated-postgres.invalid');
  const name = url.pathname.split('/').at(-1), body = JSON.parse(init.body);
  try {
    let result;
    if (name === 'efl_runtime_read') result = await pg.query('select public.efl_runtime_read($1,$2::jsonb) as value', [body.p_space, JSON.stringify(body.p_query)]);
    else if (name === 'efl_runtime_commit_safe') result = await pg.query('select public.efl_runtime_commit_safe($1,$2::jsonb,$3) as value', [body.p_space, JSON.stringify(body.p_operations), body.p_generation]);
    else { legacyHttpCommits++; throw Error('LEGACY_COMMIT_ENDPOINT_FORBIDDEN'); }
    const value: any = result.rows[0].value;
    if (value.conflict) conflicts++;
    return new Response(JSON.stringify(value), { status: 200 });
  } catch (error: any) { return new Response(JSON.stringify({ code: error.code, message: error.message }), { status: 400 }); }
}) as typeof fetch;
delete process.env.FIREBASE_FORCE_LOCAL_FALLBACK;
process.env.DATABASE_PROVIDER = 'supabase'; process.env.SUPABASE_DATA_NAMESPACE = 'preview';
process.env.SUPABASE_URL = 'https://isolated-postgres.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-only';
try {
  const db = getFirestoreDb();
  const stores = [new PostgresRuntimeStore(), new PostgresRuntimeStore()];
  const claims = await Promise.all(Array.from({ length: 12 }, (_, i) => stores[i % 2].set('same-lease', 'owner-' + i, { nx: true, ex: 60 })));
  assert.equal(claims.filter(Boolean).length, 1); assert.ok(conflicts > 0, 'Exercise native CAS conflict responses and client retries');
  const counter = await Promise.all(Array.from({ length: 4 }, (_, i) => stores[i % 2].eval('EFL_RATE_LIMIT_V1', ['native-budget'], [60])));
  assert.deepEqual(counter.sort(), [1, 2, 3, 4]);
  await stores[0].set('empty-value', []); assert.deepEqual(await stores[1].get('empty-value'), []);
  await stores[0].set('expired', 'image', { ex: .01 });
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(await stores[1].get('expired'), null);
  assert.equal(await stores[0].pruneExpired(), 1);
  let loads = 0;
  await quotaCachedRead('native-cache', 60, async () => { loads++; return []; });
  assert.deepEqual(await quotaCachedRead('native-cache', 60, async () => { loads++; return ['wrong']; }), []); assert.equal(loads, 1);
  await invalidateQuotaRead('native-cache');
  assert.deepEqual(await quotaCachedRead('native-cache', 60, async () => ['new']), ['new']);
  // Stale generation cannot change data or advance the namespace generation.
  const before: any = (await pg.query("select generation from efl_runtime.spaces where name='preview'")).rows[0];
  const rejected: any = (await pg.query('select public.efl_runtime_commit_safe($1,$2::jsonb,$3) as result', ['preview', JSON.stringify([{ path: 'runtime_probes/stale', kind: 'set', encoded: encodeValue({ overwritten: true }) }]), '0'])).rows[0];
  assert.equal(rejected.result.conflict, true);
  assert.equal((await db.collection('runtime_probes').doc('stale').get()).exists, false);
  assert.deepEqual((await pg.query("select generation from efl_runtime.spaces where name='preview'")).rows[0], before);
  const balance = db.collection('runtime_probes').doc('balance'); await balance.set({ balance: 1 });
  const spends = await Promise.allSettled([0, 1].map(() => db.runTransaction(async tx => {
    const row = await tx.get(balance); if (row.data().balance < 1) throw Error('NO_TICKET'); tx.update(balance, { balance: 0 });
  })));
  assert.equal(spends.filter(row => row.status === 'fulfilled').length, 1);
  await assert.rejects(db.batch().update(balance, { balance: 20 }).create(balance, { balance: 20 }).commit(), /DOCUMENT_ALREADY_EXISTS/);
  assert.equal((await balance.get()).data()?.balance, 0, 'Whole native SQL batch must roll back');
  const notifications = new PostgresNotificationStore();
  assert.equal(await notifications.eval(SMART_ENQUEUE_SCRIPT, ['dedupe', 'records', 'queue'], [60, 'event', JSON.stringify({ id: 'event' }), JSON.stringify({ jobId: 'job', availableAt: 0 })]), 1);
  assert.equal(await notifications.eval(SMART_ENQUEUE_SCRIPT, ['dedupe', 'records', 'queue'], [60, 'event', '{}', '{}']), 0);
  assert.equal(await notifications.hexists('records', 'event'), 1);
  await notifications.set('worker', 'owner', { ex: 60 });
  const claimed = await notifications.eval<any[], any>('EFL_NOTIFY_CLAIM_V1', ['queue', 'processing', 'worker'], ['owner', Date.now()]);
  assert.equal(claimed.jobId, 'job'); assert.deepEqual(await notifications.get('queue'), []);
  assert.equal(legacyHttpCommits, 0);
  console.log('PASS native PostgreSQL SQL: private invoker grants, 12 concurrent NX attempts, atomic counters, cache invalidation, conflict retry with no stale writes, double-spend exclusion, full batch rollback, queue dedupe and worker claim; HTTP transport simulated');
} finally { globalThis.fetch = originalFetch; await pg.close(); }
