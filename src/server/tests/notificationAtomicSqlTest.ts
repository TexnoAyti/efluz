import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {PostgresNotificationStore} from '../services/postgresNotificationStore';
import {encodeValue, decodeValue} from '../migration/firestoreArchive';

const pg=new PGlite();
await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
for(const file of ['20261009044907_postgres_document_runtime.sql','20261104143845_atomic_notification_operations.sql'])
 await pg.exec(await readFile('supabase/migrations/'+file,'utf8'));
const privileges=(await pg.query(`select has_function_privilege('anon','public.efl_runtime_notification(text,text,text[],jsonb)','execute') a,
 has_function_privilege('authenticated','public.efl_runtime_notification(text,text,text[],jsonb)','execute') b,
 has_function_privilege('service_role','public.efl_runtime_notification(text,text,text[],jsonb)','execute') s,
 (select prosecdef from pg_proc where oid='public.efl_runtime_notification(text,text,text[],jsonb)'::regprocedure) d`)).rows[0];
assert.deepEqual(privileges,{a:false,b:false,s:true,d:false});
process.env.SUPABASE_DATA_NAMESPACE='preview';
const calls:any[]=[];
const store=new PostgresNotificationStore(async(name,body)=>{
 assert.equal(name,'efl_runtime_notification');calls.push(body);
 return (await pg.query<{value:any}>('select public.efl_runtime_notification($1,$2,$3::text[],$4::jsonb) value',
  [body.p_space,body.p_action,body.p_ids,JSON.stringify(body.p_args)])).rows[0].value;
});
const id=(key:string)=>createHash('sha256').update(key).digest('hex');
const read=async(key:string)=>{
 const rows=(await pg.query<{encoded:any}>('select encoded from efl_runtime.documents where space=$1 and collection_path=$2 and document_id=$3',
  ['preview','telegram_ai_state',id(key)])).rows;
 if(!rows.length)return null;
 const entry=decodeValue(rows[0].encoded);assert.ok(entry.expiresAt===null||Number.isFinite(entry.expiresAt));
 try{return JSON.parse(entry.value);}catch{return entry.value;}
};
const old=Object.fromEntries(Array.from({length:1600},(_,i)=>['old-'+i,{id:'old-'+i,body:'x'.repeat(1000),status:'SENT'}]));
await pg.query('select public.efl_runtime_commit($1,$2::jsonb,null)',['preview',JSON.stringify([{path:'telegram_ai_state/'+id('broadcasts'),kind:'set',encoded:encodeValue({value:JSON.stringify(old),expiresAt:null})}])]);
assert.equal((await store.hget<any>('broadcasts','old-1200')).status,'SENT','Old opaque receipts remain readable');
assert.ok(JSON.stringify(calls.at(-1)).length<300,'A receipt lookup never transfers the entire history to the database');
// Namespace writes are interleaved with enqueue. The old CAS would become
// stale between its read and commit; the new operation has no exposed gap.
await Promise.all(Array.from({length:40},async(_,i)=>{
 await pg.query('select public.efl_runtime_commit($1,$2::jsonb,null)',['preview',JSON.stringify([{path:'runtime_probes/unrelated-'+i,kind:'set',encoded:encodeValue({i})}])]);
 const record={id:'new-'+i,status:'QUEUED'},job={jobId:'job-'+i,broadcastId:record.id,availableAt:0};
 assert.equal(await store.eval('EFL_NOTIFY_SMART_ENQUEUE_V1',['dedupe-'+i,'broadcasts','queue'],[86400,record.id,JSON.stringify(record),JSON.stringify(job)]),1);
}));
assert.equal((await read('queue')).length,40);
assert.equal(Object.keys(await read('broadcasts')).length,1640);
assert.equal(await store.eval('EFL_NOTIFY_SMART_ENQUEUE_V1',['dedupe-0','broadcasts','queue'],[86400,'new-0','{}','{}']),0);
assert.equal(await store.eval('EFL_NOTIFY_SMART_ENQUEUE_V1',['dedupe-0','broadcasts','queue'],[86400,'other','{}','{}']),-1);
assert.equal((await read('queue')).length,40,'Duplicate events never enqueue twice');
assert.equal(await store.set('lock','worker',{nx:true,ex:120}),'OK');
assert.equal(await store.set('lock','other',{nx:true,ex:120}),null);
assert.equal(await store.eval('EFL_NOTIFY_CLAIM_V1',['queue','processing','lock'],['other',Date.now()]),null);
const job:any=await store.eval('EFL_NOTIFY_CLAIM_V1',['queue','processing','lock'],['worker',Date.now()]);
assert.equal(job.jobId,'job-0');assert.ok(job.claimedAt);
assert.equal((await read('queue')).length,39);assert.equal((await read('processing'))[job.jobId].jobId,job.jobId);
await store.hset('broadcasts',{'new-0':{id:'new-0',status:'SENT'}});
assert.equal((await store.hget<any>('broadcasts','old-1200')).status,'SENT');
assert.equal((await store.hget<any>('broadcasts','new-0')).status,'SENT');
assert.equal(await store.hdel('processing',job.jobId),1);assert.equal(await store.hdel('processing',job.jobId),0);
await store.rpush('queue',JSON.stringify({...job,availableAt:Date.now()+300000}));
assert.equal((await store.eval<any[],any>('EFL_NOTIFY_PENDING_V1',['queue'],[])).pending,40);
assert.equal(await store.eval('EFL_NOTIFY_RELEASE_V1',['lock'],['other']),0);
assert.equal(await store.eval('EFL_NOTIFY_RELEASE_V1',['lock'],['worker']),1);
assert.equal(await store.set('lock','next',{nx:true,ex:120}),'OK','Released lease is available again');
const first=await store.eval<any[],any>('EFL_NOTIFY_ENQUEUE_V1',['broadcasts','queue'],['admin',{id:'admin'},[{jobId:'admin-job'}]].map((v,i)=>i?JSON.stringify(v):v));
assert.equal(first.id,'admin');
await store.eval('EFL_NOTIFY_ENQUEUE_V1',['broadcasts','queue'],['admin','{}','[]']);
assert.equal((await read('queue')).length,41);
const consistent=(await pg.query<{ok:boolean}>('select bool_and(data=efl_runtime.decode(encoded)) ok from efl_runtime.documents')).rows[0].ok;
assert.equal(consistent,true,'Native transitions preserve encoded/data equivalence');
await pg.exec("update efl_runtime.spaces set mode='frozen' where name='preview'");
await assert.rejects(store.hset('broadcasts',{bad:1}),/RUNTIME_FROZEN/);
assert.equal((await store.hget<any>('broadcasts','new-0')).status,'SENT','Read access survives a write freeze');
console.log('PASS native notification SQL: 1600 legacy receipts, 40 interleaved enqueues, dedupe, lease fencing, queue/claim atomicity, TTL, freeze and private grants');
await pg.close();
