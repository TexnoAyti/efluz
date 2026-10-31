import assert from 'node:assert/strict';
import {runtimeRpc} from '../postgres/documentStore';
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
