import assert from 'node:assert/strict';
import { Timestamp, GeoPoint, Firestore } from 'firebase-admin/firestore';
import { encodeValue, decodeValue, digest, exportFirestore, validateArchive, manifestDigest } from '../migration/firestoreArchive';
import { importFirestoreArchive } from '../migration/supabaseMigration';

const referenceDb = new Firestore({projectId:'isolated-reference-project',databaseId:'isolated-reference-db'});
const encodedReference = encodeValue(referenceDb.doc('users/exact-id'));
assert.deepEqual(decodeValue(encodedReference),{path:'users/exact-id',projectId:'isolated-reference-project',databaseId:'isolated-reference-db'});
const original = { timestamp: new Timestamp(1700000000,123456789), point: new GeoPoint(41.3,69.2), bytes:Buffer.from([0,255]), integer:9223372036854775807n,
  negativeZero:-0, infinity:Infinity, nan:NaN, null:null, map:{type:'timestamp',value:['ordinary','user data']}, array:[true,'Uzbek',4], date:new Date('2026-10-08T00:00:00Z') };
const result = decodeValue(JSON.parse(JSON.stringify(encodeValue(original))));
assert.deepEqual(result,original);
assert.equal(result.timestamp.nanoseconds,123456789);
assert(Object.is(result.negativeZero,-0));
assert.throws(() => encodeValue(undefined),/UNSUPPORTED/);

const ref = (path: string, data: any, children: any[] = []) => ({path,get:async () => ({exists:data !== undefined,data:() => data}),listCollections:async () => children});
const child = {path:'users/missing/profile',listDocuments:async () => [ref('users/missing/profile/p',{name:'Child below missing parent'})]};
const db = {listCollections:async () => [
  {path:'users',listDocuments:async () => [ref('users/a',{name:'Actual',ticket:3}),ref('users/missing',undefined,[child])]},
  {path:'empty',listDocuments:async () => []},
]};
const archive = await exportFirestore(db,{projectId:'isolated-project',databaseId:'isolated-db'});
assert.equal(archive.count,2);
assert(archive.collections.includes('empty'));
assert.equal(archive.documents[1].path,'users/missing/profile/p');
assert.equal(archive.consistentSnapshot,false,'Live recursive reads cannot claim a point-in-time snapshot');
validateArchive(archive);
const tampered = structuredClone(archive); tampered.documents[0].payload += ' ';
assert.throws(() => validateArchive(tampered),/DOCUMENT_CHECKSUM/);
let writes = 0;
await assert.rejects(importFirestoreArchive(tampered,async () => {writes++;}),/DOCUMENT_CHECKSUM/);
assert.equal(writes,0,'Validate backup before target mutations');
const duplicate = structuredClone(archive); duplicate.documents.push(duplicate.documents[0]); duplicate.count++;
assert.throws(() => validateArchive(duplicate),/DUPLICATE/);

const many = structuredClone(archive);
many.documents = Array.from({length:205},(_,i) => {const payload=JSON.stringify(encodeValue({id:i}));return {path:`items/${i}`,payload,checksum:digest(payload)};});
many.count = many.documents.length; many.checksum=manifestDigest(many.documents);
const chunks:number[] = [], imported = new Map<string,string>();
const rpc = async (name:string,body:Record<string,any>) => {
  if(name==='efl_migration_load') { chunks.push(body.p_documents.length); for(const doc of body.p_documents) imported.set(doc.path,doc.checksum); }
  if(name==='efl_migration_verify') return {count:imported.size,checksum:many.checksum,status:'VERIFIED'};
  return {};
};
const migrated = await importFirestoreArchive(many,rpc,'00000000-0000-0000-0000-000000000001');
assert.equal(migrated.count,205); assert.deepEqual(chunks,[100,100,5]);
await importFirestoreArchive(many,rpc,migrated.runId);
assert.equal(imported.size,205,'Same run/document IDs support resumable upload');
await assert.rejects(importFirestoreArchive(archive,async name => name==='efl_migration_verify'?{count:999,checksum:archive.checksum,status:'VERIFIED'}:{}),/TARGET_VERIFICATION/);
console.log('PASS migration: typed values/nanoseconds/large integers, nested collections/missing parents, checksum tampering, duplicate rejection, chunk boundaries, resumable RPC orchestration and failed target verification. SQL execution still requires PostgreSQL.');
