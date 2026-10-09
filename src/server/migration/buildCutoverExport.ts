import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createExportSource, exportStep } from './serverExport';
import { supabaseMigrationRpc } from './supabaseMigration';

// A build-only worker: no HTTP handler, credentials or payloads in output.
async function main() {
  if (process.env.VERCEL_ENV !== 'preview') throw new Error('PREVIEW_REQUIRED');
  const frozen = await fetch('https://efluz.vercel.app/api/leagues', { signal: AbortSignal.timeout(15000) });
  const body = await frozen.json();
  if (frozen.status !== 503 || body.error !== 'MAINTENANCE') throw new Error('SOURCE_FREEZE_NOT_CONFIRMED');
  process.env.FIREBASE_PROJECT_ID = 'gen-lang-client-0195097895';
  process.env.FIRESTORE_DATABASE_ID = 'ai-studio-efluz-4c6c88a6-697e-4fdf-82ed-45fec68ca34d';
  const { db, source } = await createExportSource();
  const rpc = supabaseMigrationRpc();
  const results: any[] = [];
  const deadline = Date.now() + 20 * 60_000;
  for (let pass = 0; pass < 2; pass++) {
    const runId = randomUUID();
    const roots = await db.listCollections();
    await rpc('efl_export_start', { p_run_id: runId, p_source: source, p_state: { pendingCollections: roots.map((c: any) => c.path), pendingDocuments: [], collections: [] } });
    console.log('CUTOVER_EXPORT_START ' + JSON.stringify({ pass, runId }));
    let result: any;
    let steps = 0;
    do {
      if (Date.now() > deadline) throw new Error('EXPORT_DEADLINE');
      result = await exportStep(db, rpc, runId, source);
      if (++steps % 10 === 0 || result.status === 'VERIFIED') console.log('CUTOVER_EXPORT_PROGRESS ' + JSON.stringify({ pass, runId, status: result.status, count: result.count, steps }));
    } while (result.status !== 'VERIFIED');
    results.push({ runId, count: result.count, checksum: result.checksum });
  }
  if (results[0].count !== results[1].count || results[0].checksum !== results[1].checksum) throw new Error('SOURCE_CHANGED_DURING_FREEZE');
  console.log('CUTOVER_EXPORT_VERIFIED ' + JSON.stringify(results));
  fs.mkdirSync('public', { recursive: true });
  fs.writeFileSync('public/index.html', 'Export complete. No application data is served.');
}
main().catch(error => {
  const message = String(error.message || '');
  console.error('CUTOVER_EXPORT_FAILED ' + JSON.stringify({
    code: /^[A-Z_0-9-]{1,40}$/i.test(String(error.code || '')) ? String(error.code) : null,
    type: error.name,
    reason: /^[A-Z_]+$/.test(message) || /^SUPABASE_MIGRATION_RPC_FAILED:/.test(message) ? message : 'SOURCE_OR_TARGET_UNAVAILABLE',
    bigInt: /BigInt|bigint/.test(message), undefinedValue: /undefined/.test(message),
    location: String(error.stack || '').split('\n').slice(1, 3).map((s: string) => s.replace(/\/vercel\/path0\//g, '')),
  })); process.exit(1);
});
