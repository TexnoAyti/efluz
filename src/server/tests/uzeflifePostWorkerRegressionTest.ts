import assert from 'node:assert/strict';
import {once} from 'node:events';
import app from '../app';
import {getFirestoreDb} from '../firebase/admin';
import {triggerRoundPostWorker} from '../services/uzeflifeRoundPost';
process.env.CRON_SECRET='isolated-round-worker-secret';
const db=getFirestoreDb(),collection=db.collection,originalFetch=globalThis.fetch;
let databaseCalls=0;
db.collection=(()=>{databaseCalls++;throw Error('WORKER_AUTH_MUST_PRECEDE_DATABASE');}) as any;
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as any).port}/api/internal/uzeflife-post-worker`;
try{
 const call=(query:string,secret='',method='POST')=>originalFetch(base+query,{method,headers:{Authorization:'Bearer '+secret}});
 assert.equal((await call('?round=1')).status,401);
 assert.equal((await call('?round=1','wrong')).status,401);
 assert.equal((await call('?round=1',process.env.CRON_SECRET,'DELETE')).status,405);
 for(const query of ['?round=0','?round=16','?round=1&hop=33','?round=1&hop=-1','?round=1.5'])assert.equal((await call(query,process.env.CRON_SECRET)).status,400);
 assert.equal(databaseCalls,0);
 process.env.VERCEL_ENV='production';process.env.VERCEL_PROJECT_PRODUCTION_URL='efluz-worker-test.vercel.app';process.env.VERCEL_URL='unrelated-preview.vercel.app';
 let target='',headers:any;
 globalThis.fetch=async(input:any,init:any)=>{target=String(input);headers=init.headers;assert.equal(init.redirect,'error');return new Response(null,{status:202});};
 await triggerRoundPostWorker(2,1);
 assert.equal(target,'https://efluz-worker-test.vercel.app/api/internal/uzeflife-post-worker?round=2&hop=1');
 assert.equal(headers.authorization,'Bearer isolated-round-worker-secret');
 process.env.VERCEL_PROJECT_PRODUCTION_URL='attacker.invalid/path';
 await assert.rejects(triggerRoundPostWorker(2),/CONFIG_REQUIRED/);
 await assert.rejects(triggerRoundPostWorker(2,99),/INVALID/);
 console.log('PASS dedicated round worker: secret/method/round/hop guards before database, trusted production host, authenticated fresh invocation and redirect rejection');
}finally{db.collection=collection;globalThis.fetch=originalFetch;await new Promise<void>(r=>server.close(()=>r()));}
