import assert from 'node:assert/strict';
import {getFirestoreDb} from '../firebase/admin';
import {PostgresRuntimeStore} from '../services/postgresRuntimeStore';
import {READ_COST_INCREMENT_LUA} from '../services/durableReadCosts';
import {batchReadCostIncrement} from '../services/readCostIncrementBatch';

export async function verifyReadCostBatch() {
 const db=getFirestoreDb(), original=db.runTransaction.bind(db);
 let commits=0, fail=false;
 (db as any).runTransaction=(work:any)=>{commits++;if(fail)throw Error('ISOLATED_METRICS_COMMIT_FAILED');return original(work);};
 const stores=[new PostgresRuntimeStore(),new PostgresRuntimeStore()];
 const key='capacity-metrics-hour';
 try {
  const result=await Promise.all(Array.from({length:1000},(_,i)=>stores[i%2].eval(READ_COST_INCREMENT_LUA,[key],['totalReads',3,'requestsWithReads',1,`endpoint:GET /${i%2?'table':'club'}`,3])));
  assert.ok(result.every(value=>value===1));assert.equal(commits,4,'1000 metric updates use four bounded transactions instead of 1000');
  const saved=await stores[0].hgetall(key);
  assert.deepEqual(saved,{totalReads:3000,requestsWithReads:1000,'endpoint:GET /table':1500,'endpoint:GET /club':1500});
  const more=await Promise.all(Array.from({length:65},(_,i)=>stores[0].eval(READ_COST_INCREMENT_LUA,['capacity-hour-'+i],['totalReads',1])));
  assert.ok(more.every(value=>value===1));assert.equal(commits,7,'Distinct hour keys stay within 30-key database reads');
  fail=true;
  const rejected=await Promise.allSettled([stores[0].eval(READ_COST_INCREMENT_LUA,[key],['totalReads',7]),stores[1].eval(READ_COST_INCREMENT_LUA,[key],['totalReads',9])]);
  assert.ok(rejected.every(r=>r.status==='rejected'));
  fail=false;await stores[0].eval(READ_COST_INCREMENT_LUA,[key],['totalReads',1]);
  assert.equal((await stores[1].hgetall(key)).totalReads,3001,'Failed writes must not be counted or acknowledged');
  const one={},two={};let separate=0;
  await Promise.all([batchReadCostIncrement(one,'same',[['total',1]],async entries=>{separate++;assert.equal(entries.length,1);}),batchReadCostIncrement(two,'same',[['total',2]],async entries=>{separate++;assert.equal(entries.length,1);})]);
  assert.equal(separate,2,'Database owners never share batches');
  console.log('PASS 1000 telemetry updates: four bounded commits, exact totals/per-endpoint/request counts, distinct hours, failure recovery and database isolation');
 }finally{(db as any).runTransaction=original;}
}
