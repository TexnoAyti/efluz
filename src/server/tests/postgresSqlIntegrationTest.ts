import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { getFirestoreDb } from '../firebase/admin';
import { PostgresRuntimeStore } from '../services/postgresRuntimeStore';
import { PostgresNotificationStore } from '../services/postgresNotificationStore';
import { encodeValue } from '../migration/firestoreArchive';
import { SMART_ENQUEUE_SCRIPT } from '../services/notificationBackupQueue';
import { quotaCachedRead, invalidateQuotaRead } from '../services/quotaReadCache';
import { initDatabase } from '../db';
import { adminAssignClubFirestore } from '../firebase/firestoreStore';
import { grantUserTickets, getUserTicketBalance } from '../services/customTournamentTicketService';
import { publishTournament } from '../services/customTournamentService';
import { createHash } from 'node:crypto';
import { readPostgresSnapshotBundle, clearPostgresSnapshotCache } from '../readModel/postgresSnapshots';

// Native PostgreSQL WASM engine with repository SQL, not a JS query emulator.
// The HTTP envelope is simulated; this cannot prove hosted PostgREST latency.
const pg = new PGlite();
await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
for (const path of ['20261009044907_postgres_document_runtime.sql', '20261009125000_nonblocking_runtime_reads.sql', '20261010091409_application_runtime_commit_conflicts.sql', '20261010161456_stop_postgrest_conflict_retries.sql', '20261010172440_conditional_snapshot_reads.sql']) {
  await pg.exec(await readFile('supabase/migrations/' + path, 'utf8'));
}
const privilege: any = (await pg.query(`select has_function_privilege('anon','public.efl_runtime_commit_safe(text,jsonb,text)','execute') as anonymous,
  has_function_privilege('authenticated','public.efl_runtime_commit_safe(text,jsonb,text)','execute') as authenticated,
  has_function_privilege('service_role','public.efl_runtime_commit_safe(text,jsonb,text)','execute') as service,
  (select prosecdef from pg_proc where oid='public.efl_runtime_commit_safe(text,jsonb,text)'::regprocedure) as definer;`)).rows[0];
assert.deepEqual(privilege, { anonymous: false, authenticated: false, service: true, definer: false });
await assert.rejects(pg.query("select public.efl_runtime_commit('preview','[]'::jsonb,'-1')"), (error:any) => error.code === 'PT409', 'Legacy CAS conflicts must not trigger PostgREST serialization retries');
await pg.exec('set role service_role;');
const originalFetch = globalThis.fetch;
let conflicts = 0, legacyHttpCommits = 0, failAssignment = false, failPublish = false;
let snapshotResponses: {bytes:number;ids:string[]}[]=[];
globalThis.fetch = (async (input: any, init: any) => {
  const url = new URL(String(input));
  assert.equal(url.origin, 'https://isolated-postgres.invalid');
  const name = url.pathname.split('/').at(-1), body = JSON.parse(init.body);
  try {
    let result;
    if(name==='efl_runtime_snapshot_read') result=await pg.query('select public.efl_runtime_snapshot_read($1,$2::jsonb,$3::jsonb) as value',[body.p_space,JSON.stringify(body.p_ids),JSON.stringify(body.p_versions)]);
    else if (name === 'efl_runtime_read') result = await pg.query('select public.efl_runtime_read($1,$2::jsonb) as value', [body.p_space, JSON.stringify(body.p_query)]);
    else if (name === 'efl_runtime_commit_safe') {
      if (failAssignment && body.p_operations.some((op: any) => op.path.startsWith('audit_logs/'))) throw Error('ASSIGNMENT_COMMIT_UNAVAILABLE');
      if (failPublish && body.p_operations.some((op:any)=>op.path.startsWith('custom_tournaments/'))) {
        body.p_operations.push({kind:'create',path:'runtime_probes/balance',encoded:encodeValue({balance:999})});
      }
      result = await pg.query('select public.efl_runtime_commit_safe($1,$2::jsonb,$3) as value', [body.p_space, JSON.stringify(body.p_operations), body.p_generation]);
    }
    else { legacyHttpCommits++; throw Error('LEGACY_COMMIT_ENDPOINT_FORBIDDEN'); }
    const value: any = result.rows[0].value;
    if (value.conflict) conflicts++;
    if(name==='efl_runtime_snapshot_read')snapshotResponses.push({bytes:Buffer.byteLength(JSON.stringify(value)),ids:body.p_ids});
    return new Response(JSON.stringify(value), { status: 200 });
  } catch (error: any) { return new Response(JSON.stringify({ code: error.code, message: error.message }), { status: 400 }); }
}) as typeof fetch;
await initDatabase();
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
  for (const id of ['club-toulouse','club-alaves','club-monaco']) await db.collection('clubs').doc(id).set({id,name:id,leagueId:'league-ligue-1',isActive:true});
  await adminAssignClubFirestore('user-900001','club-toulouse','user-900002','season-2026-27',{authoritativeOnly:true});
  const ownershipSnapshot=async()=> (await pg.query("select collection_path,document_id,encoded from efl_runtime.documents where space='preview' and collection_path in ('clubs','club_occupancies','club_memberships','user_memberships','audit_logs') order by collection_path,document_id")).rows;
  const beforeFailure=await ownershipSnapshot();
  failAssignment=true;
  await assert.rejects(adminAssignClubFirestore('user-900001','club-alaves','user-900002','season-2026-27',{authoritativeOnly:true}),/POSTGRES_RPC_HTTP_400/);
  failAssignment=false;
  assert.deepEqual(await ownershipSnapshot(),beforeFailure,'Failed assignment must not release the previous club');
  await adminAssignClubFirestore('user-900001','club-alaves','user-900002','season-2026-27',{authoritativeOnly:true});
  for(const collection of ['club_occupancies','club_memberships']) assert.equal((await db.collection(collection).doc('season-2026-27_club-toulouse').get()).data().status,'released');
  assert.equal((await db.collection('user_memberships').doc('season-2026-27_user-900002').get()).data().clubId,'club-alaves');
  await assert.rejects(adminAssignClubFirestore('user-900001','club-alaves','user-900003','season-2026-27',{authoritativeOnly:true}),/already belongs/);
  const simultaneous=await Promise.allSettled(['user-900004','user-900005'].map(user=>adminAssignClubFirestore('user-900001','club-monaco',user,'season-2026-27',{authoritativeOnly:true})));
  assert.equal(simultaneous.filter(r=>r.status==='fulfilled').length,1,'Concurrent admin assignments must not overwrite a winner');
  console.log('PASS native PostgreSQL admin transfers: atomic failure preserves old club, previous membership releases, existing owner preserved, concurrent assignments have one winner');
  process.env.NODE_ENV='production'; // Exercise durable ticket paths, never memory fallback.
  await grantUserTickets({targetUserId:'user-900006',adminTelegramId:'5209126900',amount:3,idempotencyKey:'native-publish-grant'});
  await db.collection('custom_tournaments').doc('ct-native-publish').set({id:'ct-native-publish',organizerUserId:'user-900006',status:'DRAFT'});
  failPublish=true;
  await assert.rejects(publishTournament({tournamentId:'ct-native-publish',userId:'user-900006',idempotencyKey:'native-publish-failed'}),/DOCUMENT_ALREADY_EXISTS/);
  failPublish=false;
  assert.equal((await getUserTicketBalance('user-900006')).balance,3,'A failed publication must not spend a ticket');
  assert.equal((await db.collection('custom_tournaments').doc('ct-native-publish').get()).data().status,'DRAFT');
  const publications=await Promise.all(['native-publish-a','native-publish-b'].map(idempotencyKey=>publishTournament({tournamentId:'ct-native-publish',userId:'user-900006',idempotencyKey})));
  assert.equal((await getUserTicketBalance('user-900006')).balance,2,'Concurrent publish clicks with different keys spend one ticket');
  assert.equal(publications[0].ticketSpentTransactionId,publications[1].ticketSpentTransactionId);
  await db.collection('custom_tournaments').doc('ct-native-key-reuse').set({id:'ct-native-key-reuse',organizerUserId:'user-900006',status:'DRAFT'});
  const usedKey=(await db.collection('ticket_transactions').doc(publications[0].ticketSpentTransactionId!).get()).data().idempotencyKey;
  await assert.rejects(publishTournament({tournamentId:'ct-native-key-reuse',userId:'user-900006',idempotencyKey:usedKey}),/IDEMPOTENCY_CONFLICT/);
  assert.equal((await getUserTicketBalance('user-900006')).balance,2);
  assert.equal((await db.collection('custom_tournaments').doc('ct-native-key-reuse').get()).data().status,'DRAFT');
  process.env.NODE_ENV='test';
  const snapshotKeys=['capacity:fresh','capacity:lkg','capacity:dirty'];
  const snapshotIds=snapshotKeys.map(key=>createHash('sha256').update(key).digest('hex'));
  const fixtureRows=Array.from({length:1266},(_,i)=>({id:'fixture-'+i,matchday:i%38+1,status:'SCHEDULED',homeClubId:'club-'+i%96,awayClubId:'club-'+(i+1)%96,metadata:'x'.repeat(1600)}));
  const largeSnapshot={data:fixtureRows,generatedAt:new Date().toISOString()};
  const snapshotRef=(index:number)=>db.collection('durable_read_snapshots').doc(snapshotIds[index]);
  await snapshotRef(0).set({snapshotJson:JSON.stringify(largeSnapshot),expiresAt:Date.now()+60000});
  await snapshotRef(1).set({snapshotJson:JSON.stringify(largeSnapshot),expiresAt:null});
  clearPostgresSnapshotCache();snapshotResponses=[];
  const burst=await Promise.all(Array.from({length:8},()=>readPostgresSnapshotBundle(...snapshotKeys as [string,string,string])));
  assert.equal(burst[0].fresh.data.length,1266);
  assert.equal(snapshotResponses.length,1,'Concurrent readers share one payload fetch');
  assert.deepEqual(snapshotResponses[0].ids,[snapshotIds[0],snapshotIds[2]],'Fresh reads must not fetch the duplicate LKG');
  const coldBytes=snapshotResponses[0].bytes;
  snapshotResponses=[];
  const cpuStart=process.cpuUsage();
  for(let i=0;i<10;i++)await readPostgresSnapshotBundle(...snapshotKeys as [string,string,string]);
  const cpu=process.cpuUsage(cpuStart);
  const warmBytes=snapshotResponses.reduce((sum,row)=>sum+row.bytes,0);
  assert.ok(warmBytes<5000,'Unchanged warm reads transfer metadata only');
  const ledgerVersion=(await db.collection('user_tickets').doc('user-900006').get()).data();
  await db.collection('runtime_probes').doc('unrelated').set({value:1});
  snapshotResponses=[];
  await readPostgresSnapshotBundle(...snapshotKeys as [string,string,string]);
  assert.ok(snapshotResponses[0].bytes<500,'Unrelated writes must not invalidate large cached payloads');
  await snapshotRef(0).set({snapshotJson:JSON.stringify({...largeSnapshot,data:[{id:'changed'}]}),expiresAt:Date.now()+60000});
  assert.equal((await readPostgresSnapshotBundle(...snapshotKeys as [string,string,string])).fresh.data[0].id,'changed','Changed rows invalidate across instances through the database revision');
  await snapshotRef(0).delete();
  assert.equal((await readPostgresSnapshotBundle(...snapshotKeys as [string,string,string])).lkg.data.length,1266,'Missing fresh retains LKG');
  await snapshotRef(0).set({snapshotJson:JSON.stringify({...largeSnapshot,data:[{id:'fresh'}]}),expiresAt:Date.now()-1});
  assert.equal((await readPostgresSnapshotBundle(...snapshotKeys as [string,string,string])).fresh,null,'Expiry is checked even for cached documents');
  await snapshotRef(0).update({expiresAt:Date.now()+60000});
  await snapshotRef(2).set({snapshot:{data:true},expiresAt:Date.now()+60000});
  assert.equal((await readPostgresSnapshotBundle(...snapshotKeys as [string,string,string])).dirty.data,true);
  assert.deepEqual((await db.collection('user_tickets').doc('user-900006').get()).data(),ledgerVersion,'Read optimization never modifies business records');
  const access:any=(await pg.query("select has_function_privilege('anon','public.efl_runtime_snapshot_read(text,jsonb,jsonb)','execute') as anon,has_function_privilege('authenticated','public.efl_runtime_snapshot_read(text,jsonb,jsonb)','execute') as authenticated")).rows[0];
  assert.deepEqual(access,{anon:false,authenticated:false});
  console.log('CAPACITY_SNAPSHOT_BENCHMARK',JSON.stringify({syntheticFixtures:1266,coldBytes,warmTenReadsBytes:warmBytes,localWarmCpuMs:(cpu.user+cpu.system)/1000,note:'Local Node plus PGlite CPU; not hosted Vercel CPU or a complete user session'}));
  console.log('PASS conditional snapshot reads: one concurrent fetch, no duplicate LKG, bounded warm payloads, update/delete/expiry/dirty visibility, private RPC');
  console.log('PASS native PostgreSQL ticket publication: actual batch failure restores wallet and draft; parallel different-key publishes spend exactly once');
  console.log('PASS native PostgreSQL SQL: private invoker grants, 12 concurrent NX attempts, atomic counters, cache invalidation, conflict retry with no stale writes, double-spend exclusion, full batch rollback, queue dedupe and worker claim; HTTP transport simulated');
} finally { globalThis.fetch = originalFetch; await pg.close(); }
