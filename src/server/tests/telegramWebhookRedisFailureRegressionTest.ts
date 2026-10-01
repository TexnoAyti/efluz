import assert from 'node:assert/strict';
import express from 'express';
process.env.TELEGRAM_BOT_TOKEN='123456:isolated-audit-fake-token';
process.env.TELEGRAM_WEBHOOK_SECRET='audit-secret';
process.env.UPSTASH_REDIS_REST_URL='https://redis.test.invalid';process.env.UPSTASH_REDIS_REST_TOKEN='fake-token';
const originalFetch=globalThis.fetch;
globalThis.fetch=async (input:any,init?:any)=>{
 const url=typeof input==='string'?input:input.url;
 if(String(url).startsWith('https://redis.test.invalid'))return new Response(JSON.stringify({error:'AUDIT_REDIS_UNAVAILABLE'}),{status:503});
 return originalFetch(input,init);
};
const {telegramRouter}=await import('../routes/telegram.routes');
const app=express();app.use(express.json());app.use('/api/telegram',telegramRouter);app.use((err:any,req:any,res:any,next:any)=>res.status(500).json({error:'handled'}));
const rejected:any[]=[];process.on('unhandledRejection',r=>rejected.push(r));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
try{
 let response:any;let timedOut=false;
 try{response=await originalFetch(`http://127.0.0.1:${(server.address() as any).port}/api/telegram/webhook`,{signal:AbortSignal.timeout(5000),method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'audit-secret'},body:JSON.stringify({update_id:400,message:{text:'/start',chat:{id:10001},from:{id:10001}}})});}catch{timedOut=true;}
 assert.ok(response);assert.equal(response.status,503);assert.equal(timedOut,false);assert.equal(rejected.length,0);
 console.log('PASS Redis failure gives controlled 503 without an unhandled rejection.');
}finally{globalThis.fetch=originalFetch;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
