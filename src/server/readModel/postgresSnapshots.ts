import { createHash } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { getFirestoreDb } from '../firebase/admin';

const ref = (key: string) => getFirestoreDb().collection('durable_read_snapshots').doc(createHash('sha256').update(key).digest('hex'));
export const usesPostgresSnapshots = () => process.env.DATABASE_PROVIDER === 'supabase';
export async function readPostgresSnapshotBundle(fresh: string, lkg: string, dirty: string): Promise<{ fresh: any; lkg: any; dirty: any }> {
  const keys = [fresh, lkg, dirty];
  const ids = keys.map(key => createHash('sha256').update(key).digest('hex'));
  const rows = await getFirestoreDb().collection('durable_read_snapshots').where(FieldPath.documentId(), 'in', ids).get();
  const values = new Map(rows.docs.map(doc => [doc.id, doc.data()]));
  const snapshots = ids.map(id => {
    const value = values.get(id);
    return value && (value.expiresAt === null || value.expiresAt > Date.now()) ? value.snapshot : null;
  });
  return { fresh: snapshots[0], lkg: snapshots[1], dirty: snapshots[2] };
}
export async function readPostgresSnapshot(key: string): Promise<any | null> {
  const value = (await ref(key).get()).data();
  return value && (value.expiresAt === null || value.expiresAt > Date.now()) ? value.snapshot : null;
}
export async function publishPostgresSnapshot(fresh: string, lkg: string, dirty: string, snapshot: any, ttl: number) {
  // Snapshot payloads historically use JSON wire semantics (omit optional undefined fields).
  const durable = JSON.parse(JSON.stringify(snapshot));
  await getFirestoreDb().runTransaction(async tx => {
    const previous = (await tx.get(ref(lkg))).data()?.snapshot;
    if (previous && (previous.actualCount > 0 && snapshot.actualCount === 0 || previous.generatedAt > snapshot.generatedAt)) throw new Error('SNAPSHOT_REJECTED: ' + lkg);
    tx.set(ref(fresh), { snapshot: durable, expiresAt: Date.now() + Math.max(1, ttl) * 1000 });
    tx.set(ref(lkg), { snapshot: durable, expiresAt: null });
    tx.delete(ref(dirty));
  });
}
export async function invalidatePostgresSnapshot(fresh: string, dirty: string) {
  const batch = getFirestoreDb().batch();
  batch.delete(ref(fresh));
  batch.set(ref(dirty), { snapshot: { data: true }, expiresAt: Date.now() + 86400000 });
  await batch.commit();
}
export async function deletePostgresSnapshots(keys: string[]) {
  const batch = getFirestoreDb().batch();
  keys.forEach(key => batch.delete(ref(key)));
  await batch.commit();
}
export async function postgresSnapshotTtl(key: string) {
  const value = (await ref(key).get()).data();
  if (!value) return -2;
  if (value.expiresAt === null) return -1;
  return value.expiresAt > Date.now() ? Math.floor((value.expiresAt - Date.now()) / 1000) : -2;
}

/** Patch a single row under the same transaction as fresh/LKG publication. */
export async function patchPostgresSnapshot(fresh: string, lkg: string, dirty: string, row: any, merge: boolean, ttl: number, version: string): Promise<boolean> {
  return getFirestoreDb().runTransaction(async tx => {
    const previous = (await tx.get(ref(lkg))).data()?.snapshot
      || (await tx.get(ref(fresh))).data()?.snapshot;
    if (!Array.isArray(previous?.data)) return false;
    const index = previous.data.findIndex((item: any) => item.id === row.id);
    if (index < 0) return false;
    const old = previous.data[index];
    if (old.updatedAt && row.updatedAt && old.updatedAt > row.updatedAt) return true;
    const data = previous.data.slice();
    data[index] = merge ? { ...old, ...row } : row;
    const snapshot = JSON.parse(JSON.stringify({ ...previous, data, actualCount: data.length, generatedAt: new Date().toISOString(), sourceVersion: version }));
    tx.set(ref(fresh), { snapshot, expiresAt: Date.now() + ttl * 1000 });
    tx.set(ref(lkg), { snapshot, expiresAt: null });
    tx.delete(ref(dirty));
    return true;
  });
}
