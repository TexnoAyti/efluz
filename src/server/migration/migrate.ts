import 'dotenv/config';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { exportFirestore, validateArchive, type FirestoreArchive } from './firestoreArchive';
import { importFirestoreArchive, supabaseMigrationRpc } from './supabaseMigration';

async function main() {
  const [command, filename, runId] = process.argv.slice(2);
  if (!filename || !['export', 'validate', 'import'].includes(command)) throw new Error('Usage: tsx src/server/migration/migrate.ts export|validate|import <private-backup.json> [run-id]');
  if (command === 'export') {
    if (process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true') throw new Error('MIGRATION_REQUIRES_REAL_FIRESTORE');
    const { initializeApp, cert } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const source = { projectId: process.env.FIREBASE_PROJECT_ID || '', databaseId: process.env.FIRESTORE_DATABASE_ID || '' };
    if (!source.projectId || !source.databaseId) throw new Error('EXPLICIT_FIRESTORE_SOURCE_REQUIRED');
    let credentials: any;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    else if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) credentials = { projectId: source.projectId, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') };
    else throw new Error('FIRESTORE_EXPORT_CREDENTIALS_REQUIRED');
    if ((credentials.project_id || credentials.projectId) && (credentials.project_id || credentials.projectId) !== source.projectId) throw new Error('SOURCE_PROJECT_MISMATCH');
    const app = initializeApp({ projectId: source.projectId, credential: cert(credentials) }, 'efl-migration-export');
    const db = getFirestore(app, source.databaseId);
    db.settings({ useBigInt: true });
    const archive = await exportFirestore(db, source);
    await mkdir(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 });
    await writeFile(filename, JSON.stringify(archive), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ command, count: archive.count, collections: archive.collections.length, checksum: archive.checksum, consistentSnapshot: false }));
    return;
  }
  const archive = JSON.parse(await readFile(filename, 'utf-8')) as FirestoreArchive;
  validateArchive(archive);
  if (command === 'validate') console.log(JSON.stringify({ command, count: archive.count, checksum: archive.checksum }));
  else console.log(JSON.stringify(await importFirestoreArchive(archive, supabaseMigrationRpc(), runId)));
}
main().catch(() => { console.error('Migration failed; source and production provider remain unchanged. Inspect configuration and backup validation locally.'); process.exitCode = 1; });
