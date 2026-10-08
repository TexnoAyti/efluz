import { createHash } from 'node:crypto';
import { Timestamp, GeoPoint, DocumentReference } from 'firebase-admin/firestore';

export type EncodedValue = { type: string; value?: any };
// Every value is tagged, including maps: user data cannot collide with type markers.
export function encodeValue(value: any): EncodedValue {
  if (value === null) return { type: 'null' };
  if (value instanceof Timestamp) return { type: 'timestamp', value: [String(value.seconds), value.nanoseconds] };
  if (value instanceof GeoPoint) return { type: 'geopoint', value: [value.latitude, value.longitude] };
  if (value instanceof DocumentReference) return { type: 'reference', value: { path: value.path, projectId: value.firestore.projectId, databaseId: value.firestore.databaseId } };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { type: 'bytes', value: Buffer.from(value).toString('base64') };
  if (value instanceof Date) return { type: 'date', value: value.toISOString() };
  if (typeof value === 'bigint') return { type: 'integer', value: String(value) };
  if (typeof value === 'number') return { type: 'number', value: Object.is(value, -0) ? '-0' : String(value) };
  if (typeof value === 'string' || typeof value === 'boolean') return { type: typeof value, value };
  if (Array.isArray(value)) return { type: 'array', value: value.map(encodeValue) };
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return { type: 'map', value: Object.fromEntries(Object.keys(value).sort().map(key => [key, encodeValue(value[key])])) };
  }
  throw new Error('UNSUPPORTED_FIRESTORE_VALUE');
}

export function decodeValue(encoded: EncodedValue, reference: (identity: {path: string; projectId: string; databaseId: string}) => unknown = identity => identity): any {
  switch (encoded.type) {
    case 'null': return null;
    case 'timestamp': return new Timestamp(Number(encoded.value[0]), encoded.value[1]);
    case 'geopoint': return new GeoPoint(...encoded.value as [number, number]);
    case 'reference': return reference(encoded.value);
    case 'bytes': return Buffer.from(encoded.value, 'base64');
    case 'date': return new Date(encoded.value);
    case 'integer': return BigInt(encoded.value);
    case 'number': return Number(encoded.value);
    case 'string': case 'boolean': return encoded.value;
    case 'array': return encoded.value.map((value: EncodedValue) => decodeValue(value, reference));
    case 'map': return Object.fromEntries(Object.entries(encoded.value).map(([key, value]) => [key, decodeValue(value as EncodedValue, reference)]));
    default: throw new Error('UNKNOWN_ARCHIVE_TYPE');
  }
}

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export type ArchivedDocument = { path: string; payload: string; checksum: string };
export type FirestoreArchive = {
  version: 1; source: { projectId: string; databaseId: string };
  startedAt: string; finishedAt: string; collections: string[];
  documents: ArchivedDocument[]; count: number; checksum: string;
  consistentSnapshot: false;
};
export function manifestDigest(documents: ArchivedDocument[]): string {
  return digest([...documents].sort((a,b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
    .map(doc => `${doc.path}:${doc.checksum}\n`).join(''));
}
export function validateArchive(archive: FirestoreArchive): void {
  if (archive.version !== 1 || !archive.source?.projectId || !archive.source?.databaseId || archive.consistentSnapshot !== false) throw new Error('INVALID_ARCHIVE_METADATA');
  if (archive.count !== archive.documents.length) throw new Error('ARCHIVE_COUNT_MISMATCH');
  const paths = new Set<string>();
  for (const doc of archive.documents) {
    const parts = doc.path.split('/');
    if (parts.length % 2 || parts.some(part => !part) || paths.has(doc.path)) throw new Error('INVALID_OR_DUPLICATE_DOCUMENT_PATH');
    paths.add(doc.path);
    if (digest(doc.payload) !== doc.checksum) throw new Error('DOCUMENT_CHECKSUM_MISMATCH');
    decodeValue(JSON.parse(doc.payload));
  }
  if (manifestDigest(archive.documents) !== archive.checksum) throw new Error('ARCHIVE_CHECKSUM_MISMATCH');
}

/** Includes subcollections below missing parent documents (listDocuments enumerates them). */
export async function exportFirestore(db: any, source: FirestoreArchive['source']): Promise<FirestoreArchive> {
  const startedAt = new Date().toISOString();
  const collections: string[] = [], documents: ArchivedDocument[] = [];
  async function visit(collection: any): Promise<void> {
    collections.push(collection.path);
    const references = await collection.listDocuments();
    // Sequential bounded reads avoid a burst of requests during production export.
    for (const ref of references) {
      const snapshot = await ref.get();
      if (snapshot.exists) {
        const payload = JSON.stringify(encodeValue(snapshot.data()));
        documents.push({ path: ref.path, payload, checksum: digest(payload) });
      }
      for (const child of await ref.listCollections()) await visit(child);
    }
  }
  for (const collection of await db.listCollections()) await visit(collection);
  documents.sort((a,b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const archive: FirestoreArchive = { version: 1, source, startedAt, finishedAt: new Date().toISOString(), collections: collections.sort(), documents, count: documents.length, checksum: manifestDigest(documents), consistentSnapshot: false };
  validateArchive(archive);
  return archive;
}
