import assert from 'node:assert/strict';
import {runtimeRpc,PostgresDocumentStore} from '../postgres/documentStore';
import {FieldPath} from 'firebase-admin/firestore';
import {encodeValue} from '../migration/firestoreArchive';
import {parseFirestoreError} from '../firebase/firestoreErrorHandler';
process.env.SUPABASE_URL='https://isolated-diagnostics.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='do-not-log-private-key';
const fetchOriginal=globalThis.fetch, logOriginal=console.error, logs:any[]=[];
console.error=(...args:any[])=>{logs.push(args);};
try {
 globalThis.fetch=async()=>Response.json({code:'57014',message:'private upstream diagnostic must not be logged',details:'private document contents'},{status:500});
 const rpc=runtimeRpc();let caught:any;
 try{await rpc('efl_runtime_read',{p_space:'preview',p_query:{path:'users/private-user-id'}});}catch(error){caught=error;}
 assert.equal(caught.databaseCode,'57014');assert.equal(caught.httpStatus,500);
 assert.equal(parseFirestoreError(caught).httpStatus,503);
 const text=JSON.stringify(logs);assert.ok(text.includes('57014'));
 for(const secret of ['private-key','private-user-id','private document','private upstream'])assert.ok(!text.includes(secret));
 globalThis.fetch=async()=>{throw new DOMException('timed out','TimeoutError');};
 await assert.rejects(rpc('efl_runtime_read',{p_space:'preview',p_query:{path:'users/private-user-id'}}),error=>parseFirestoreError(error).httpStatus===503);
 assert.equal(parseFirestoreError({code:5,message:'NOT_FOUND'}).httpStatus,404);
}finally{globalThis.fetch=fetchOriginal;console.error=logOriginal;}
console.log('PASS read-only RPC diagnostics: SQLSTATE/http status retained, private key/document/error contents excluded, timeout and upstream outage return honest 503, not-found preserved');

// Real adapter queries: singleton reads retain their generation and document
// shape while avoiding the generic collection filter. Other query semantics stay.
const calls:any[]=[];
const store=new PostgresDocumentStore(async(name,body)=>{
 calls.push({name,body});
 return {generation:'42',documents:[{id:'counter',encoded:encodeValue({value:7})}]};
},'preview');
const selected=await store.collection('runtime_state').where(FieldPath.documentId(),'in',['counter']).get();
assert.equal(selected.docs[0].data().value,7);assert.equal(calls[0].body.p_query.path,'runtime_state/counter');
assert.equal(calls[0].body.p_query.collection,undefined);
for(const query of [
 store.collection('runtime_state').where(FieldPath.documentId(),'in',['counter','other']),
 store.collection('runtime_state').where(FieldPath.documentId(),'in',['counter']).where('value','==',7),
 store.collection('runtime_state').where(FieldPath.documentId(),'in',['counter']).orderBy('value'),
 store.collection('runtime_state').where(FieldPath.documentId(),'in',['counter']).startAfter('counter'),
 store.collection('runtime_state').where(FieldPath.documentId(),'in',['counter']).limit(10001),
]){await query.get();assert.equal(calls.at(-1).body.p_query.collection,'runtime_state');}
await store.collection('runtime_state').where(FieldPath.documentId(),'in',['counter']).count().get();
assert.equal(calls.at(-1).body.p_query.count,true);assert.equal(calls.at(-1).body.p_query.path,undefined);
await store.runTransaction(async tx=>{
 const rows=await tx.get(store.collection('runtime_state').where(FieldPath.documentId(),'in',['counter']));
 assert.equal(rows.docs[0].data().value,7);
 tx.set(store.collection('runtime_state').doc('counter'),{value:8});
});
assert.equal(calls.at(-2).body.p_query.path,'runtime_state/counter');
assert.equal(calls.at(-1).body.p_generation,'42','Optimistic transaction generation must survive the indexed read');
console.log('PASS indexed singleton document-ID reads: real query shape/results, unchanged multi-ID/filter/order/cursor queries and transaction generation');
