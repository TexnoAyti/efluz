import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import app from '../app';
import { getFirestoreDb } from '../firebase/admin';
import { rateLimit } from '../middleware/rateLimitMiddleware';

process.env.DATABASE_PROVIDER='supabase';process.env.SUPABASE_DATA_NAMESPACE='preview';
const db=getFirestoreDb(), collection=db.collection.bind(db), transaction=db.runTransaction.bind(db);
let accesses=0;
(db as any).collection=()=>{accesses++;throw Error('DATABASE_OFFLINE');};
(db as any).runTransaction=()=>{accesses++;throw Error('DATABASE_OFFLINE');};
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${(server.address() as any).port}`;
try {
 for(const [path,status] of [['/api/health',200],['/api/seasons',200],['/api/me/bootstrap',401],['/api/me/matches',401]] as const){
  const response=await fetch(base+path);assert.equal(response.status,status,path);
  const timing=response.headers.get('server-timing')||'';assert.match(timing,/rate_limit;dur=/);
  const ms=Number(timing.match(/rate_limit;dur=([\d.]+)/)?.[1]);assert.ok(ms<100,'Broad request gate cannot wait for storage');
 }
 assert.equal(accesses,0,'Static reads and unauthenticated identity checks must not touch the database');
}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));(db as any).collection=collection;(db as any).runTransaction=transaction;}
const guards=express();
guards.get('/local',rateLimit('local-gate-regression',2,60,{distributed:false}),(_req,res)=>res.json({ok:true}));
guards.get('/shared-a',rateLimit('shared-gate-regression',2,60),(_req,res)=>res.json({ok:true}));
guards.get('/shared-b',rateLimit('shared-gate-regression',2,60),(_req,res)=>res.json({ok:true}));
guards.get('/outage',rateLimit('outage-gate-regression',2,60),(_req,res)=>res.json({ok:true}));
const guarded=guards.listen(0,'127.0.0.1');await once(guarded,'listening');
const host=`http://127.0.0.1:${(guarded.address() as any).port}`;
try {
 const request=(path:string,ip:string)=>fetch(host+path,{headers:{'x-forwarded-for':ip}});
 for(const status of [200,200,429])assert.equal((await request('/local',`198.51.100.${status}`)).status,status,'Forged proxy headers cannot rotate the local budget');
 let sharedTransactions=0;
 (db as any).runTransaction=(fn:any)=>{sharedTransactions++;return transaction(fn);};
 assert.equal((await request('/shared-a','198.51.100.1')).status,200);
 assert.equal((await request('/shared-b','198.51.100.2')).status,200);
 assert.equal((await request('/shared-a','198.51.100.3')).status,429);
 assert.equal(sharedTransactions,3,'Default/action-specific guards still use the shared PostgreSQL counter');
 (db as any).runTransaction=()=>{throw Error('DATABASE_OFFLINE');};
 for(const status of [200,200,429])assert.equal((await request('/outage','198.51.100.4')).status,status,'Outage fallback is bounded rather than fail-open');
}finally{(db as any).runTransaction=transaction;await new Promise<void>(resolve=>guarded.close(()=>resolve()));}
console.log('PASS database-independent global gate: real health/seasons/bootstrap/matches HTTP during outage, fast bounded local budget, untrusted header resistance, durable default/action guards and bounded outage fallback');
