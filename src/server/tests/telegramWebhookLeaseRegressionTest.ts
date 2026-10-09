import assert from 'node:assert/strict';
import express from 'express';
process.env.TELEGRAM_BOT_TOKEN='123456:isolated-fake-token';
process.env.TELEGRAM_WEBHOOK_SECRET='isolated-secret';
process.env.UPSTASH_REDIS_REST_URL='https://redis.test.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN='fake-token';
const originalFetch=globalThis.fetch;
const keys=new Map<string, string>();
let sends=0, failCompletion=false;
let releaseSend: (()=>void) | undefined;
let sending: (()=>void) | undefined;
const sendStarted=new Promise<void>(resolve=>sending=resolve);
const sendGate=new Promise<void>(resolve=>releaseSend=resolve);
globalThis.fetch=async (input:any,init:any={})=>{
 const url=typeof input==='string'?input:input.url;
 if(new URL(url).hostname==='api.telegram.org') {
   sends++;sending?.();await sendGate;
   return new Response(JSON.stringify({ok:true,result:{message_id:sends}}));
 }
 if(new URL(url).hostname==='redis.test.invalid') {
   const raw=JSON.parse(init.body),batch=Array.isArray(raw[0]);
   const results=(batch?raw:[raw]).map((c:any[])=>{
     const [name,key,...args]=c;
     if(name==='set') {
       if(keys.has(key)) return {result:null};
       assert.ok(args.includes('ex'));assert.ok(args.includes('nx'));
       keys.set(key,args[0]);return {result:'OK'};
     }
     if(name==='get') return {result:keys.get(key)??null};
     assert.equal(name,'eval');
     assert.ok(key.includes("redis.call('GET', KEYS[1]) ~= ARGV[1]"));
     const [count,redisKey,owner,state]=args;assert.equal(Number(count),1);
     if(state==='done' && failCompletion) return {error:'SIMULATED_REDIS_COMPLETION_FAILURE'};
     if(keys.get(redisKey)!==owner)return {result:0};
     if(state==='done')keys.set(redisKey,'done');else keys.delete(redisKey);
     return {result:1};
   });
   const encoded=results.map(r => 'result' in r && typeof r.result === 'string' && r.result !== 'OK' ? {...r,result:Buffer.from(r.result).toString('base64')} : r);
   return new Response(JSON.stringify(batch?encoded:encoded[0]));
 }
 return originalFetch(input,init);
};
const {telegramRouter}=await import('../routes/telegram.routes');
const app=express();app.use(express.json());app.use(telegramRouter);
const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
const post=async (update:any)=>{
 const res=await originalFetch(`http://127.0.0.1:${(server.address() as any).port}/webhook`,{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'isolated-secret'},body:JSON.stringify(update)});
 return {status:res.status,body:await res.json()};
};
try {
 const update={update_id:800,message:{text:'/start',chat:{id:10001},from:{id:10001}}};
 const first=post(update);await sendStarted;
 assert.equal((await post(update)).status,503);assert.equal(sends,1);
 releaseSend!();assert.equal((await first).status,200);
 const duplicate=await post(update);assert.equal(duplicate.body.ignored,'duplicate_update');assert.equal(sends,1);
 failCompletion=true;
 const failed=await post({update_id:801});assert.equal(failed.status,503);
 assert.equal([...keys.keys()].some(key=>key.endsWith(':801')),false);
 failCompletion=false;
 assert.equal((await post({update_id:801})).status,200);
 console.log('PASS concurrent duplicate returns retryable 503; one welcome sent; completed update deduplicated; completion outage releases lease for retry. Redis REST mocked.');
} finally {
 globalThis.fetch=originalFetch;server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
}
