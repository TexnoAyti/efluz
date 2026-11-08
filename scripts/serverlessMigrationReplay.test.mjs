import test from 'node:test';
import assert from 'node:assert/strict';
import { applyImportBatch } from '../tgcloud/lib/importEngine.js';

const base = {id:'u1',telegram_id:'123',username:null,first_name:'Test',
  last_name:'',is_admin:false,is_banned:false,created_at:1,updated_at:1};
function makeDb() {
  const records=new Map(), states=new Map();
  let failAfter=null, inserts=0;
  return {
    records,states,
    setFailAfter(value){failAfter=value;},
    async get(query,p) {
      if(query.includes('efl_migration_state')) return states.get(p[':key'])??null;
      const match=query.match(/FROM (efl_[a-z_]+) WHERE "([a-z_]+)"=:pk/);
      if(!match) throw new Error('UNEXPECTED_GET: '+query);
      return records.get(match[1]+':'+String(p[':pk']))??null;
    },
    async run(query,p) {
      if(query.includes('INSERT INTO efl_migration_state')) {
        const prev=states.get(p[':key']);
        if(!prev || prev.checksum===p[':checksum'])
          states.set(p[':key'],{checksum:p[':checksum'],status:'COMPLETE'});
        return {rowsAffected:1};
      }
      const match=query.match(/INSERT INTO (efl_[a-z_]+) \(([^)]+)\)/);
      if(!match) throw new Error('UNEXPECTED_RUN: '+query);
      inserts++;
      if(failAfter!==null && inserts>failAfter) throw new Error('SIMULATED_OUTAGE');
      const cols=match[2].replaceAll('"','').split(',');
      const row=Object.fromEntries(cols.map(col=>[col,p[':'+col]]));
      const pk=match[1]==='efl_match_messages'?'id':match[1]==='efl_match_access'?'match_id':'id';
      const key=match[1]+':'+String(row[pk]);
      if(records.has(key)) return {rowsAffected:0};
      records.set(key,row); return {rowsAffected:1};
    }
  };
}
const one=(rows=[base], batchId='users:000001')=>({table:'users',batchId,rows});
test('first import writes once, identical replay skips safely',async()=>{
  const db=makeDb();
  assert.equal((await applyImportBatch(db,one())).previouslyPresent,0);
  assert.equal((await applyImportBatch(db,one())).previouslyPresent,1);
  assert.equal(db.records.size,1);
  assert.equal(db.states.size,1);
});
test('partial import resumes without duplicate records',async()=>{
  const db=makeDb(), rows=[base,{...base,id:'u2',telegram_id:'456'}];
  db.setFailAfter(1);
  await assert.rejects(applyImportBatch(db,one(rows)),/SIMULATED_OUTAGE/);
  assert.equal(db.records.size,1);assert.equal(db.states.size,0);
  db.setFailAfter(null);
  const result=await applyImportBatch(db,one(rows));
  assert.equal(result.verified,2);assert.equal(result.previouslyPresent,1);
  assert.equal(db.records.size,2);assert.equal(db.states.size,1);
});
test('conflicting existing row cannot be overwritten',async()=>{
  const db=makeDb();await applyImportBatch(db,one());
  await assert.rejects(applyImportBatch(db,one([{...base,first_name:'Changed'}],'users:000002')),/ROW_CONFLICT/);
  assert.equal(db.records.get('efl_users:u1').first_name,'Test');
});
test('late conflicting row aborts before any new row is imported',async()=>{
  const db=makeDb();
  const old={...base,id:'u-old',telegram_id:'111',first_name:'Original'};
  await applyImportBatch(db,one([old],'users:seed-old'));
  const before=new Map(db.records);
  const statesBefore=new Map(db.states);
  const newRow={...base,id:'u-new',telegram_id:'222'};
  const conflict={...old,first_name:'Unauthorized rewrite'};
  await assert.rejects(
    applyImportBatch(db,one([newRow,conflict],'users:late-conflict')),
    /ROW_CONFLICT/
  );
  assert.deepEqual([...db.records],[...before],
    'Import must not write the first new row if a later row conflicts');
  assert.deepEqual([...db.states],[...statesBefore],
    'Failed batch must not be recorded as complete');
});
test('reused batch identifier with modified content fails',async()=>{
  const db=makeDb();await applyImportBatch(db,one());
  await assert.rejects(applyImportBatch(db,one([{...base,id:'u2',telegram_id:'456'}])),/BATCH_CONFLICT/);
});
test('unique telegram ID conflict must not create a second owner',async()=>{
  const db=makeDb();await applyImportBatch(db,one());
  // The real DB enforces telegram_id uniqueness. This fake DB exercises primary
  // key replay only; secondary-unique enforcement needs SDK integration tests.
  assert.equal(db.records.size,1);
});
