import assert from 'node:assert/strict';
import {PostgresDocumentStore} from '../postgres/documentStore';
import {decodeValue} from '../migration/firestoreArchive';
export async function verifyUzeflifeCompactSnapshot(){
 let generation=1,record:any={round:1,matches:[{id:'test',homeScore:null}]},calls:string[]=[];
 const db=new PostgresDocumentStore(async(name,body)=>{
  calls.push(name);
  if(name==='efl_runtime_uzeflife_snapshot')return JSON.stringify({generation:String(generation),data:record});
  if(name==='efl_runtime_commit'){
   assert.equal(body.p_generation,String(generation));for(const op of body.p_operations)record=decodeValue(op.encoded);generation++;return {generation:String(generation)};
  }
  throw Error('Unexpected generic or encoded read: '+name);
 },'preview');
 const ref=db.collection('uzeflife').doc('championship'),snapshot=await ref.get();assert.equal(snapshot.exists,true);const data=snapshot.data();data.round=9;assert.equal(snapshot.get('round'),1,'Snapshot reads do not share mutable state');
 const committed=await db.runTransaction(async tx=>{const s=(await tx.get(ref)).data();s.round++;tx.set(ref,s);return s;});assert.equal(committed.round,2);assert.equal(record.round,2);assert.equal(calls.filter(n=>n==='efl_runtime_uzeflife_snapshot').length,2);assert.equal(calls.filter(n=>n==='efl_runtime_commit').length,1);
 for(const raw of [{data:{}},{generation:12,data:{}},{generation:'2'},{generation:'2',data:[]},null]){
  const broken=new PostgresDocumentStore(async()=>JSON.stringify(raw),'preview');await assert.rejects(broken.runTransaction(async tx=>{await tx.get(broken.doc('uzeflife/championship'));tx.set(broken.doc('uzeflife/championship'),{});}),/INVALID_UZEFLIFE_SNAPSHOT/);
 }
 console.log('PASS UZEFLIFE compact snapshot: plain data + exact generation CAS, immutable reads, no encoded query, malformed snapshot fails closed before commit.');
}
