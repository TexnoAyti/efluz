import assert from 'node:assert/strict';
import {runtimeRpc} from '../postgres/documentStore';
import {parseFirestoreError} from '../firebase/firestoreErrorHandler';
import {api,invalidateClientCache,setSessionToken,setTelegramInitData} from '../../lib/api';

process.env.SUPABASE_URL='https://isolated-read-burst.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY='isolated-only-key';
const originalFetch=globalThis.fetch;
const originalError=console.error;
const calls:Array<{name:string,body:any,resolve:(response:Response)=>void}>=[];
const reply=(index:number,value:any)=>calls[index].resolve(Response.json(value));
const read={p_space:'preview',p_query:{path:'users/account'}};
console.error=()=>{};
globalThis.fetch=((input:any,options:any)=>new Promise<Response>(resolve=>{
 calls.push({name:String(input).split('/').at(-1)!,body:JSON.parse(options.body),resolve});
})) as typeof fetch;
try {
 const rpc=runtimeRpc();
 const burst=Array.from({length:40},()=>rpc('efl_runtime_read',read));
 assert.equal(calls.length,1,'40 overlapping identical reads should make one upstream request');
 reply(0,{generation:'10',documents:[{id:'account',encoded:{value:'original'}}]});
 const results=await Promise.all(burst);
 results[0].documents[0].encoded.value='changed by one caller';
 assert.equal(results[1].documents[0].encoded.value,'original','Shared transport must not share mutable result objects');
 const fresh=rpc('efl_runtime_read',read);assert.equal(calls.length,2,'Completed reads must never become a TTL cache');
 reply(1,{generation:'11',documents:[]});assert.equal((await fresh).generation,'11');
 const a=rpc('efl_runtime_read',read);
 const b=rpc('efl_runtime_read',{...read,p_space:'production'});
 const c=rpc('efl_runtime_read',{...read,p_query:{path:'users/other'}});
 const separate=runtimeRpc()('efl_runtime_read',read);
 assert.equal(calls.length,6,'Namespaces, queries and independently configured transports cannot share reads');
 for(let i=2;i<6;i++)reply(i,{generation:'12',documents:[]});await Promise.all([a,b,c,separate]);
 const snapshots=Array.from({length:10},()=>rpc('efl_runtime_snapshot_read',{p_space:'preview',p_ids:['one'],p_versions:{}}));
 assert.equal(calls.length,7);reply(6,{documents:[]});await Promise.all(snapshots);
 // A stale read remains in flight while a real write starts and completes.
 const old=rpc('efl_runtime_read',read);
 const write=rpc('efl_runtime_commit',{p_space:'preview',p_generation:'12',p_operations:[{path:'users/account',kind:'set',encoded:{value:'new'}}]});
 const during=rpc('efl_runtime_read',read);
 assert.equal(calls.length,10);assert.equal(calls[8].name,'efl_runtime_commit_safe');
 reply(8,{generation:'13'});await write;
 const after=rpc('efl_runtime_read',read);assert.equal(calls.length,11,'Post-write read must not join pre-write or mid-write snapshots');
 reply(10,{generation:'13',documents:[]});assert.equal((await after).generation,'13');
 reply(7,{generation:'12',documents:[]});await old;
 const afterOld=rpc('efl_runtime_read',read);assert.equal(calls.length,12,'Old completion must not retain stale data');
 reply(9,{generation:'12',documents:[]});await during;
 reply(11,{generation:'13',documents:[]});await afterOld;
 const failed=Array.from({length:10},()=>rpc('efl_runtime_read',read));
 assert.equal(calls.length,13);
 calls[12].resolve(Response.json({code:'57014',message:'cancelled'},{status:500}));
 const settled=await Promise.allSettled(failed);
 assert.ok(settled.every(r=>r.status==='rejected' && parseFirestoreError(r.reason).httpStatus===503));
 const recovery=rpc('efl_runtime_read',read);assert.equal(calls.length,14,'Failure must not poison later recovery');
 reply(13,{generation:'14',documents:[]});await recovery;
 // Identical writes must each reach the upstream and retain their own result.
 const writes=[rpc('efl_runtime_commit',{p_space:'preview',p_operations:[]}),rpc('efl_runtime_commit',{p_space:'preview',p_operations:[]})];
 assert.equal(calls.length,16);reply(14,{generation:'15'});reply(15,{generation:'16'});
 assert.deepEqual((await Promise.all(writes)).map(r=>r.generation),['15','16']);
 const beforeFailure=rpc('efl_runtime_read',read);
 const rejectedWrite=rpc('efl_runtime_commit',{p_space:'preview',p_operations:[]}).then(()=>assert.fail('Write should fail'),error=>assert.equal(parseFirestoreError(error).httpStatus,503));
 const duringFailure=rpc('efl_runtime_read',read);
 calls[17].resolve(Response.json({code:'57014',message:'cancelled'},{status:500}));await rejectedWrite;
 const afterFailure=rpc('efl_runtime_read',read);assert.equal(calls.length,20,'Failed/uncertain mutations also break read sharing');
 for(const i of [16,18,19])reply(i,{generation:'16',documents:[]});await Promise.all([beforeFailure,duringFailure,afterFailure]);
 console.log('PASS RPC burst isolation: 40 readers/one request, no completed cache, mutable result isolation, namespace/query/transport separation, snapshot sharing, write boundaries and failure recovery');
 // A confirmed database outage must not trigger the client's immediate second timeout.
 invalidateClientCache();setSessionToken('isolated');setTelegramInitData(null);
 let requests=0;
 globalThis.fetch=(async()=>{requests++;return Response.json({code:'DATABASE_TEMPORARILY_UNAVAILABLE',error:'DATABASE_TEMPORARILY_UNAVAILABLE'},{status:503});}) as typeof fetch;
 await assert.rejects(api.getCompetitions('season-2026-27',true,'league-summary'),(e:any)=>e.httpStatus===503);
 assert.equal(requests,1);
 globalThis.fetch=(async()=>{requests++;return Response.json({competitions:[]});}) as typeof fetch;
 await api.getCompetitions('season-2026-27',true,'league-summary');assert.equal(requests,2,'Manual recovery must remain available');
 invalidateClientCache();let transientRequests=0;
 globalThis.fetch=(async()=>++transientRequests===1?Response.json({error:'temporary gateway failure'},{status:500}):Response.json({competitions:[]})) as typeof fetch;
 await api.getCompetitions('season-2026-27',true,'league-summary');assert.equal(transientRequests,2,'Other transient failures retain the existing bounded retry');
 console.log('PASS real client outage handling: explicit database 503 is not repeated automatically; manual recovery and unrelated transient retries remain available');
}finally{globalThis.fetch=originalFetch;console.error=originalError;invalidateClientCache();setSessionToken(null);}
