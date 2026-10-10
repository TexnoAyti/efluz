import { createHash } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { getFirestoreDb } from '../firebase/admin';

const ref = (key: string) => getFirestoreDb().collection('durable_read_snapshots').doc(createHash('sha256').update(key).digest('hex'));
const unpack = (value: any) => typeof value?.snapshotJson === 'string' ? JSON.parse(value.snapshotJson) : value?.snapshot;

const payloads = new Map<string,{version:string;value:any;bytes:number;at:number}>();
const flights = new Map<string,Promise<Map<string,any>>>();
let payloadBytes = 0;
export function clearPostgresSnapshotCache() { payloads.clear(); payloadBytes=0; }
async function snapshotDocuments(ids:string[]):Promise<Map<string,any>> {
  const db=getFirestoreDb() as any;
  if (typeof db.readSnapshotDocuments!=='function') {
    const rows=await db.collection('durable_read_snapshots').where(FieldPath.documentId(),'in',ids).get();
    return new Map(rows.docs.map((doc:any)=>[doc.id,doc.data()]));
  }
  const scope=process.env.SUPABASE_URL+':'+db.databaseId+':';
  const flightKey=scope+ids.join(',');
  const pending=flights.get(flightKey); if(pending)return pending;
  const read=(async()=>{
    const versions:Record<string,string>={};
    const previous=new Map<string,any>();
    for(const id of ids){
      const cached=payloads.get(scope+id);
      if(cached && Date.now()-cached.at<300000){versions[id]=cached.version;previous.set(id,cached);}
    }
    const result=await db.readSnapshotDocuments(ids,versions);
    const values=new Map<string,any>();
    for(const row of result.documents){
      const key=scope+row.id;
      const old=payloads.get(key);
      if(old){payloadBytes-=old.bytes;payloads.delete(key);}
      const value=row.unchanged?previous.get(row.id)?.value:row.value;
      if(row.unchanged && value===undefined)throw Error('SNAPSHOT_REVISION_WITHOUT_PAYLOAD');
      values.set(row.id,value);
      if(value!=null){
        const bytes=row.unchanged?previous.get(row.id).bytes:Buffer.byteLength(JSON.stringify(value));
        if(bytes<=4*1024*1024){
          payloads.set(key,{version:row.version,value,bytes,at:row.unchanged?previous.get(row.id).at:Date.now()});payloadBytes+=bytes;
          while(payloadBytes>8*1024*1024 || payloads.size>128){
            const oldest=payloads.keys().next().value!;
            payloadBytes-=payloads.get(oldest)!.bytes;payloads.delete(oldest);
          }
        }
      }
    }
    return values;
  })();
  flights.set(flightKey,read);
  try{return await read;}finally{if(flights.get(flightKey)===read)flights.delete(flightKey);}
}

async function fixtureOverrides(key: string): Promise<Map<string, any>> {
  if (!key.endsWith(':fixtures')) return new Map();
  const seasonId = key.match(/:season:([^:]+):/)?.[1];
  if (!seasonId) return new Map();
  let query = getFirestoreDb().collection('durable_fixture_overrides').where('seasonId', '==', seasonId);
  const competitionId = key.match(/:competition:([^:]+):fixtures$/)?.[1];
  if (competitionId) query = query.where('competitionId', '==', competitionId);
  const rows = await query.get();
  return new Map(rows.docs.map(doc => [doc.id, doc.data()]));
}
function overlay(snapshot: any, changes: Map<string, any>): any {
  if (!Array.isArray(snapshot?.data) || !changes.size) return snapshot;
  return {...snapshot,data:snapshot.data.map((row: any) => {
    const changed = changes.get(row.id);
    return changed && (!row.updatedAt || changed.updatedAt >= row.updatedAt) ? changed : row;
  })};
}

export const usesPostgresSnapshots = () => process.env.DATABASE_PROVIDER === 'supabase';
export async function readPostgresSnapshotBundle(fresh: string, lkg: string, dirty: string): Promise<{ fresh: any; lkg: any; dirty: any }> {
  const keys = [fresh, dirty];
  const ids = keys.map(key => createHash('sha256').update(key).digest('hex'));
  const [rows, changes] = await Promise.all([
    snapshotDocuments(ids),
    fixtureOverrides(fresh),
  ]);
  const snapshots = ids.map(id => {
    const value = rows.get(id);
    return value && (value.expiresAt === null || value.expiresAt > Date.now()) ? unpack(value) : null;
  });
  const fallback = !snapshots[0] || snapshots[1]?.data ? await readPostgresSnapshot(lkg) : null;
  return { fresh: overlay(snapshots[0], changes), lkg: fallback, dirty: snapshots[1] };
}
export async function readPostgresSnapshot(key: string): Promise<any | null> {
  const id=createHash('sha256').update(key).digest('hex');
  const [documents,changes] = await Promise.all([snapshotDocuments([id]),fixtureOverrides(key)]);
  const value = documents.get(id);
  return value && (value.expiresAt === null || value.expiresAt > Date.now()) ? overlay(unpack(value), changes) : null;
}
export async function publishPostgresSnapshot(fresh: string, lkg: string, dirty: string, snapshot: any, ttl: number) {
  // Snapshot payloads historically use JSON wire semantics (omit optional undefined fields).
  const durable = JSON.parse(JSON.stringify(snapshot));
  await getFirestoreDb().runTransaction(async tx => {
    const previous = unpack((await tx.get(ref(lkg))).data());
    if (previous && (previous.actualCount > 0 && snapshot.actualCount === 0 || previous.generatedAt > snapshot.generatedAt)) throw new Error('SNAPSHOT_REJECTED: ' + lkg);
    tx.set(ref(fresh), { snapshotJson: JSON.stringify(durable), expiresAt: Date.now() + Math.max(1, ttl) * 1000 });
    tx.set(ref(lkg), { snapshotJson: JSON.stringify(durable), expiresAt: null });
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
  const db = getFirestoreDb();
  // Native adapter sends a small row delta; the database patches both copies.
  if (typeof (db as any).patchSnapshot === 'function') return (db as any).patchSnapshot(
    [fresh,lkg,dirty].map(key => createHash('sha256').update(key).digest('hex')), row, merge, ttl, version
  );
  return db.runTransaction(async tx => {
    const previous = unpack((await tx.get(ref(lkg))).data())
      || unpack((await tx.get(ref(fresh))).data());
    if (!Array.isArray(previous?.data)) return false;
    const index = previous.data.findIndex((item: any) => item.id === row.id);
    if (index < 0) return false;
    const old = previous.data[index];
    if (old.updatedAt && row.updatedAt && old.updatedAt > row.updatedAt) return true;
    const data = previous.data.slice();
    data[index] = merge ? { ...old, ...row } : row;
    const snapshot = JSON.parse(JSON.stringify({ ...previous, data, actualCount: data.length, generatedAt: new Date().toISOString(), sourceVersion: version }));
    tx.set(ref(fresh), { snapshotJson: JSON.stringify(snapshot), expiresAt: Date.now() + ttl * 1000 });
    tx.set(ref(lkg), { snapshotJson: JSON.stringify(snapshot), expiresAt: null });
    tx.delete(ref(dirty));
    return true;
  });
}
