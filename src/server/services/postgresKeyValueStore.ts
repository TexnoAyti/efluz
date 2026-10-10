import { createHash } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { getFirestoreDb } from '../firebase/admin';

export const parseStoredValue = (value: any) => {
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return value; }
};
type Entry = { value: any; expiresAt: number | null };
const documentId = (key: string) => createHash('sha256').update(key).digest('hex');
const live = (entry: Entry | undefined) => entry && (entry.expiresAt === null || entry.expiresAt > Date.now()) ? entry : undefined;

/** Server-only state in the selected database namespace. NX and multi-key
 * changes use the document adapter's optimistic PostgreSQL transaction. */
export class PostgresKeyValueStore {
  constructor(private collectionName: string, private signal?: AbortSignal) {}
  protected check() { if (this.signal?.aborted) throw Error('TIMEOUT_ABORTED'); }
  private ref(key: string) { return getFirestoreDb().collection(this.collectionName).doc(documentId(key)); }

  async get<T = any>(key: string): Promise<T | null> {
    this.check();
    const entry = live((await this.ref(key).get()).data() as Entry);
    this.check();
    return entry ? parseStoredValue(entry.value) : null;
  }

  async mget<T = any>(...keys: string[]): Promise<T> {
    if (!keys.length) return [] as T;
    this.check();
    const rows = await getFirestoreDb().collection(this.collectionName).where(FieldPath.documentId(), 'in', keys.map(documentId)).get();
    const values = new Map(rows.docs.map(row => [row.id, live(row.data() as Entry)]));
    this.check();
    return keys.map(key => { const entry = values.get(documentId(key)); return entry ? parseStoredValue(entry.value) : null; }) as T;
  }

  protected async atomic<T>(keys: string[], operation: (values: Map<string, Entry>, put: (key: string, value: any, seconds?: number) => void) => T): Promise<T> {
    this.check();
    const db = getFirestoreDb();
    return db.runTransaction(async tx => {
      this.check();
      const rows = await tx.get(db.collection(this.collectionName).where(FieldPath.documentId(), 'in', [...new Set(keys.map(documentId))]));
      const byId = new Map<string, Entry>(rows.docs.map((row: any) => [row.id, row.data()]));
      const values = new Map<string, Entry>();
      keys.forEach(key => { const entry = live(byId.get(documentId(key))); if (entry) values.set(key, entry); });
      const writes = new Map<string, Entry>();
      this.check();
      const result = operation(values, (key, value, seconds) => {
        if (!keys.includes(key)) throw Error('POSTGRES_STATE_UNREAD_KEY');
        writes.set(key, { value, expiresAt: seconds === undefined ? null : Date.now() + seconds * 1000 });
      });
      this.check();
      writes.forEach((value, key) => tx.set(this.ref(key), value));
      return result;
    });
  }

  async set(key: string, value: any, options?: { nx?: boolean; ex?: number }) {
    this.check();
    if (options?.ex !== undefined && (!Number.isFinite(options.ex) || options.ex <= 0)) throw Error('INVALID_STATE_TTL');
    if (options?.nx) return this.atomic([key], (values, put) => {
      if (values.has(key)) return null;
      put(key, value, options.ex); return 'OK';
    });
    await this.ref(key).set({ value, expiresAt: options?.ex === undefined ? null : Date.now() + options.ex * 1000 });
    this.check();
    return 'OK';
  }

  async del(...keys: string[]) {
    this.check();
    if (!keys.length) return 0;
    const batch = getFirestoreDb().batch();
    keys.forEach(key => batch.delete(this.ref(key)));
    await batch.commit();
    return keys.length;
  }

  /** Opportunistic bounded retention. Re-read and delete in one transaction so
   * a concurrently renewed lease or export is never removed. */
  async pruneExpired(limit = 100): Promise<number> {
    const db = getFirestoreDb();
    return db.runTransaction(async tx => {
      const rows = await tx.get(db.collection(this.collectionName).where('expiresAt', '>', 0).where('expiresAt', '<=', Date.now()).limit(limit));
      rows.docs.forEach((row: any) => tx.delete(row.ref));
      return rows.size;
    });
  }
}
