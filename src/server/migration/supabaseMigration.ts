import { randomUUID } from 'node:crypto';
import type { FirestoreArchive } from './firestoreArchive';
import { validateArchive } from './firestoreArchive';

export type MigrationRpc = (name: string, body: Record<string, unknown>) => Promise<any>;
export function migrationHeaders(rawKey: string): Record<string,string> {
  const key=rawKey.trim();
  if(!key || key.startsWith('sb_publishable_')) throw new Error('SUPABASE_SERVER_KEY_REQUIRED');
  // Opaque secret keys are API keys, not JWTs. A Bearer header would reject them.
  return {apikey:key,'Content-Type':'application/json',...(key.startsWith('sb_secret_')?{}:{Authorization:`Bearer ${key}`})};
}
export function supabaseMigrationRpc(): MigrationRpc {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_SERVER_CREDENTIALS_REQUIRED');
  if (new URL(url).protocol !== 'https:') throw new Error('SUPABASE_HTTPS_REQUIRED');
  return async (name, body) => {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: migrationHeaders(key),
      body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    // Never print response bodies that might contain private document data.
    if (!response.ok) throw new Error(`SUPABASE_MIGRATION_RPC_FAILED:${name}:HTTP_${response.status}`);
    return response.json();
  };
}

export async function importFirestoreArchive(archive: FirestoreArchive, rpc: MigrationRpc, runId: string = randomUUID()) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(runId)) throw new Error('INVALID_MIGRATION_RUN_ID');
  validateArchive(archive); // Validate the full backup before any target write.
  await rpc('efl_migration_begin', { p_run_id: runId, p_manifest: { ...archive, documents: undefined } });
  let chunk: FirestoreArchive['documents'] = [], bytes = 0;
  async function flush() {
    if (!chunk.length) return;
    await rpc('efl_migration_load', { p_run_id: runId, p_documents: chunk });
    chunk = []; bytes = 0;
  }
  for (const doc of archive.documents) {
    const size = Buffer.byteLength(JSON.stringify(doc));
    if (chunk.length && (chunk.length >= 100 || bytes + size > 2_000_000)) await flush();
    chunk.push(doc); bytes += size;
  }
  await flush();
  const result = await rpc('efl_migration_verify', { p_run_id: runId });
  if (result.count !== archive.count || result.checksum !== archive.checksum || result.status !== 'VERIFIED') throw new Error('TARGET_VERIFICATION_FAILED');
  return { runId, ...result };
}
