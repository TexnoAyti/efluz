import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getFirestoreDb } from '../firebase/admin';
import { PostgresRuntimeStore } from '../services/postgresRuntimeStore';
import { batchRateIncrement } from '../services/rateIncrementBatch';
const db=getFirestoreDb(), transaction=db.runTransaction.bind(db), collection=db.collection.bind(db);
let commits=0, fail=false;
(db as any).runTransaction=(work:any)=>{commits++;if(fail)throw Error('ISOLATED_RATE_COMMIT_FAILED');return transaction(work);};
const a=new PostgresRuntimeStore(), b=new PostgresRuntimeStore();
const increment=(key:string)=>a.eval<number>('EFL_RATE_LIMIT_V1',[key],[60]);
try {
 const burst=await Promise.all(Array.from({length:200},(_,i)=>(i%2?a:b).eval<number>('EFL_RATE_LIMIT_V1',['burst'],[60])));
 assert.deepEqual(burst,[...Array(200)].map((_,i)=>i+1));assert.equal(commits,1,'200 exact increments use one commit');
 assert.equal(await a.get('burst'),200);
 const others=await Promise.all(Array.from({length:65},(_,i)=>increment('key-'+i)));
 assert.ok(others.every(value=>value===1));assert.equal(commits,4,'Distinct keys are split into <=30-key transactions');
 const key='expiry', id=createHash('sha256').update(key).digest('hex');
 await a.set(key,4,{ex:60});const expiry=(await collection('runtime_state').doc(id).get()).data()!.expiresAt;
 assert.equal(await increment(key),5);assert.ok(Math.abs((await collection('runtime_state').doc(id).get()).data()!.expiresAt-expiry)<10,'Counting cannot extend the budget window');
 await collection('runtime_state').doc(id).update({expiresAt:Date.now()-1});assert.equal(await increment(key),1);
 fail=true;
 const rejected=await Promise.allSettled([increment('burst'),increment('burst')]);assert.ok(rejected.every(r=>r.status==='rejected'));
 fail=false;assert.equal(await increment('burst'),201,'Failed commits do not spend or acknowledge budget');
 // Separate database owners cannot share transactions, even for equal key text.
 const calls:number[]=[];
 const [one,two]=await Promise.all([batchRateIncrement({},'same',60,async()=>{calls.push(1);return [11];}),batchRateIncrement({},'same',60,async()=>{calls.push(2);return [22];})]);
 assert.deepEqual([one,two],[11,22]);assert.equal(calls.length,2);
}finally{(db as any).runTransaction=transaction;}
console.log('PASS exact PostgreSQL rate budgets: shared burst commit, distinct-key bounds, expiry preservation/reset, failure rejection/recovery and database isolation');
