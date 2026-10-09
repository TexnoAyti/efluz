import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authorizeExport, exportStep, type ExportState } from '../migration/serverExport';
import {migrationHeaders} from '../migration/supabaseMigration';

assert.deepEqual(migrationHeaders(' sb_secret_synthetic '),{apikey:'sb_secret_synthetic','Content-Type':'application/json'});
assert.equal(migrationHeaders('synthetic.legacy.jwt').Authorization,'Bearer synthetic.legacy.jwt');
assert.throws(()=>migrationHeaders('sb_publishable_synthetic'),/SUPABASE_SERVER_KEY_REQUIRED/);

const secret='synthetic-test-token';
const hash=createHash('sha256').update(secret).digest('hex');
assert.equal(authorizeExport('POST',`Bearer ${secret}`,hash,Date.now()+10000,'preview'),true);
for(const [method,env,token,expiry] of [['GET','preview',secret,Date.now()+10000],['POST','production',secret,Date.now()+10000],['POST','preview','wrong',Date.now()+10000],['POST','preview',secret,0]] as const) {
  assert.equal(authorizeExport(method,`Bearer ${token}`,hash,expiry,env),false);
}
const source={projectId:'test',databaseId:'test'};
let state:ExportState={pendingCollections:['root'],pendingDocuments:[],collections:[]};
const stored=new Map<string,unknown>();
let revision=0,finishes=0;
const rpc=async(name:string,body:any)=>{
  if(name==='efl_export_claim') return {status:'EXPORTING',state,revision,source};
  if(name==='efl_export_step') {
    assert.equal(body.p_revision,revision);
    assert.ok(body.p_documents.length<=25);
    for(const doc of body.p_documents) stored.set(doc.path,doc);
    state=body.p_state;revision++;
    return {revision,count:stored.size};
  }
  if(name==='efl_export_finish') {finishes++;return {status:'VERIFIED',count:stored.size};}
  throw new Error(name);
};
const db={
  collection:(path:string)=>({listDocuments:async()=>path==='root'?Array.from({length:26},(_,i)=>({path:`root/${i}`})):[{path:'root/0/child/1'}]}),
  doc:(path:string)=>({get:async()=>({exists:path!=='root/0',data:()=>({path})}),listCollections:async()=>path==='root/0'?[{path:'root/0/child'}]:[]}),
};
const first=await exportStep(db,rpc,'synthetic',source);
assert.equal(first.status,'EXPORTING');
assert.equal(finishes,0);
assert.equal(stored.size,24);
const second=await exportStep(db,rpc,'synthetic',source);
assert.equal(second.status,'VERIFIED');
assert.equal(stored.size,26);
assert.equal(finishes,1);
assert.ok(stored.has('root/0/child/1'));
assert.deepEqual(state.collections,['root','root/0/child']);
// Batched reads preserve missing-parent traversal and bounded checkpoints.
state={pendingCollections:['root'],pendingDocuments:[],collections:[]};
stored.clear();revision=0;finishes=0;
let batches=0;
const batchedDb={...db,getAll:async(...refs:any[])=>{
  batches++;assert.ok(refs.length<=25);
  return Promise.all(refs.map(ref=>ref.get()));
}};
await exportStep(batchedDb,rpc,'synthetic',source);
const batchedFinish=await exportStep(batchedDb,rpc,'synthetic',source);
assert.equal(batchedFinish.status,'VERIFIED');
assert.equal(stored.size,26);
assert.ok(stored.has('root/0/child/1'));
assert.equal(batches,3);
await assert.rejects(exportStep(db,async()=>({status:'EXPORTING',source:{projectId:'wrong',databaseId:'test'}}),'synthetic',source),/SOURCE_MISMATCH/);
console.log('Server export authorization, chunk checkpoints, missing-parent traversal and source isolation passed');
