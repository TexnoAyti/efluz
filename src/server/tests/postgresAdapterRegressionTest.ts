import assert from 'node:assert/strict';
import { PostgresDocumentStore, type RuntimeRpc } from '../postgres/documentStore';
import { encodeValue, decodeValue } from '../migration/firestoreArchive';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
let generation=0,commits=0;
let rows=new Map<string,any>();
const conflict=()=>Object.assign(new Error('CONFLICT'),{code:10});
const rpc:RuntimeRpc=async(name,body)=>{
 if(name==='efl_runtime_read'){
  const q=body.p_query;
  let docs=[...rows].filter(([path])=>q.path?path===q.path:path.split('/').slice(0,-1).join('/')===q.collection)
   .map(([path,encoded])=>({id:path.split('/').at(-1)!,encoded}));
  for(const f of q.filters||[])docs=docs.filter(d=>{const value=f.field==='__name__'?d.id:decodeValue(d.encoded)[f.field];return f.op==='=='?value===f.value:f.value.includes(value);});
  docs.sort((a,b)=>a.id.localeCompare(b.id));if(q.cursor)docs=docs.filter(d=>d.id>q.cursor.id);if(q.limit)docs=docs.slice(0,q.limit);
  return {generation:String(generation),documents:structuredClone(docs),count:docs.length};
 }
 if(name==='efl_runtime_commit'){
  if(body.p_generation!==null&&body.p_generation!==String(generation))throw conflict();
  const next=new Map(rows);
  for(const op of body.p_operations){
   if(op.kind==='delete'){next.delete(op.path);continue;}
   if(op.kind==='create'&&next.has(op.path))throw new Error('DOCUMENT_ALREADY_EXISTS');
   if(op.kind==='update'&&!next.has(op.path))throw new Error('DOCUMENT_NOT_FOUND');
   next.set(op.path,op.encoded);
  }
  rows=next;if(body.p_operations.length){generation++;commits++;}return {generation:String(generation)};
 }
 throw new Error('UNKNOWN_RPC');
};
const servers=[new PostgresDocumentStore(rpc,'preview'),new PostgresDocumentStore(rpc,'preview')];
const claim=servers[0].collection('claims').doc('club');
const outcomes=await Promise.allSettled(Array.from({length:12},(_,i)=>servers[i%2].runTransaction(async tx=>{
 const ref=servers[i%2].doc(claim.path);const prior=await tx.get(ref);
 if(prior.exists)throw new Error('CLUB_TAKEN');tx.create(ref,{owner:i});return i;
})));
assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
assert.equal(commits,1);
const balance=servers[0].doc('accounts/u');await balance.set({balance:1});
const spends=await Promise.allSettled([0,1].map(i=>servers[i].runTransaction(async tx=>{
 const old=await tx.get(balance);if(old.get('balance')<1)throw new Error('NO_TICKET');tx.update(balance,{balance:0});return true;
})));
assert.equal(spends.filter(r=>r.status==='fulfilled').length,1);assert.equal((await balance.get()).get('balance'),0);
await assert.rejects(servers[0].batch().update(balance,{balance:20}).create(claim,{owner:20}).commit());
assert.equal((await balance.get()).get('balance'),0);
rows.set('values/typed',encodeValue({small:123n,timestamp:new Timestamp(1234,987654321)}));
const typed=(await servers[0].doc('values/typed').get()).data();assert.equal(typed.small,123);assert.equal(typed.timestamp.nanoseconds,987654321);
await assert.rejects(servers[0].runTransaction(async tx=>{tx.set(balance,{balance:0});await tx.get(balance);}),/READ_AFTER_WRITE/);
const byId=await servers[0].collection('claims').where(FieldPath.documentId(),'in',['club']).get();assert.equal(byId.size,1);
assert.throws(()=>servers[0].collection('claims').where('owner','made-up',1),/UNSUPPORTED/);
assert.throws(()=>new PostgresDocumentStore(rpc,'unknown'),/NAMESPACE/);
console.log('PASS PostgreSQL adapter: two-server claim race, double spend, atomic batch rollback, typed values, unsupported query rejection and transaction ordering');
