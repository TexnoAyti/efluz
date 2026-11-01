import assert from 'node:assert/strict';
import {uzeflifeRequest} from '../../lib/uzeflifeApi';
import {normalizeUChannelDelivery} from '../../lib/uzeflifeChannelDelivery';
const original=globalThis.fetch;
let calls=0,signal:AbortSignal|undefined;
try{
 globalThis.fetch=async(_input:any,init:any)=>{calls++;signal=init.signal;return new Promise<Response>(()=>{});};
 await assert.rejects(uzeflifeRequest('publish-status?round=1',undefined,{timeoutMs:10}),(e:any)=>e.code==='UZEFLIFE_REQUEST_TIMEOUT');
 assert.equal(signal?.aborted,true);assert.equal(calls,1);
 globalThis.fetch=async()=>({ok:true,json:()=>new Promise(()=>{})}) as any;
 await assert.rejects(uzeflifeRequest('publish-status?round=1',undefined,{timeoutMs:10}),(e:any)=>e.code==='UZEFLIFE_REQUEST_TIMEOUT');
 calls=0;
 globalThis.fetch=async(_input:any,init:any)=>{calls++;signal=init.signal;return new Promise<Response>(()=>{});};
 await assert.rejects(uzeflifeRequest('publish-round',{round:1,expectedRevision:5},{timeoutMs:10}));
 assert.equal(calls,1,'An uncertain enqueue is never automatically posted twice');
 const cancelled=new AbortController();cancelled.abort();calls=0;
 await assert.rejects(uzeflifeRequest('publish-status?round=1',undefined,{signal:cancelled.signal}),(e:any)=>e.name==='AbortError');assert.equal(calls,0);
 const active=new AbortController();const pending=uzeflifeRequest('publish-status?round=1',undefined,{signal:active.signal});active.abort();await assert.rejects(pending,(e:any)=>e.name==='AbortError');assert.equal(signal?.aborted,true);
 globalThis.fetch=async()=>Response.json({ok:true,round:1,state:'sent',channel:'@uzeflife_turner',sentPages:16,totalPages:16,matchCount:121});
 assert.equal((await uzeflifeRequest('publish-status?round=1',undefined,{timeoutMs:1000})).state,'sent');
 globalThis.fetch=async()=>Response.json({ok:false,error:'Access denied',channels:['required-channel']},{status:403});
 await assert.rejects(uzeflifeRequest('publish-round',{}),(e:any)=>e.message==='Access denied'&&e.channels[0]==='required-channel');
 const idle=normalizeUChannelDelivery({round:1,state:'idle',channel:'@uzeflife_turner',sentPages:0,totalPages:null,matchCount:null},1,121);assert.equal(idle.totalPages,16);assert.equal(idle.matchCount,121);
 const legacy=normalizeUChannelDelivery({round:1,state:'unverified',channel:'@uzeflife_turner',sentPages:10,totalPages:null,matchCount:null,maxConfirmed:null,legacy:true},1,121);assert.equal(legacy.maxConfirmed,16);
 assert.throws(()=>normalizeUChannelDelivery({ok:true},1,121),/noto‘g‘ri/);
 assert.throws(()=>normalizeUChannelDelivery({...idle,round:2},1,121),/noto‘g‘ri/);
 assert.throws(()=>normalizeUChannelDelivery({...idle,sentPages:99},1,121),/tekshirib/);
 console.log('PASS UZEFLIFE loading bounds: stalled fetch/body, abort and unmount, no mutation retry, valid/403 receipts, idle/legacy totals and malformed/wrong-round response rejection');
}finally{globalThis.fetch=original;}
