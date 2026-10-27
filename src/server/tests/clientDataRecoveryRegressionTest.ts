import assert from 'node:assert/strict';
import {api,setSessionToken,invalidateClientCache} from '../../lib/api';
const originalFetch=globalThis.fetch;let calls=0,status=200;
const prefix='identical-jwt-header-prefix-1234567890';
globalThis.fetch=(async(_url,options)=>{calls++;return Response.json(status===200?{user:{id:(options?.headers as any).Authorization},currentClub:null}:{error:'temporarily unavailable'},{status});}) as typeof fetch;
try{
 invalidateClientCache();setSessionToken(prefix+'-alice');const alice=await api.getMe();
 setSessionToken(prefix+'-bob');const bob=await api.getMe();assert.notEqual(alice.user.id,bob.user.id,'JWT header prefixes must never merge different accounts');assert.equal(calls,2);
 status=503;assert.deepEqual(await api.getMe(undefined,true),bob,'Transient refresh failures preserve a same-account snapshot');
 for(const code of [401,403,404]){status=code;await assert.rejects(()=>api.getMe(undefined,true),(error:any)=>error.httpStatus===code,'Access errors must not return stale private data');}
 console.log('PASS private cache identity isolation, transient snapshot recovery and access error propagation');
}finally{globalThis.fetch=originalFetch;setSessionToken(null);invalidateClientCache();}
