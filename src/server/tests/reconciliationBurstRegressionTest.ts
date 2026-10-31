import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { scheduleMutationReconciliation, reconcileDurableMutations } from '../sync/scheduleReconciliation';
await initDatabase();
process.env.DATABASE_PROVIDER='supabase';
const db=getFirestoreDb(), original=db.collection.bind(db), now=Date.now;
let queries=0;
(db as any).collection=(name:string)=>{
 assert.ok(['result_refresh_jobs','matchday_notification_jobs'].includes(name));
 const query:any={where:()=>query,limit:()=>query,get:async()=>{queries++;return {docs:[]};}};
 return query;
};
const settle=async(expected:number)=>{
 for(let i=0;i<100&&queries<expected;i++)await new Promise(r=>setTimeout(r,5));
 await new Promise(r=>setTimeout(r,5));assert.equal(queries,expected);
};
try {
 for(let i=0;i<100;i++)scheduleMutationReconciliation();
 await settle(2);
 for(let i=0;i<100;i++)scheduleMutationReconciliation();
 await settle(2);
 await reconcileDurableMutations();assert.equal(queries,4,'Explicit/cron recovery remains available during request cooldown');
 const later=now()+61000;Date.now=()=>later;
 scheduleMutationReconciliation();await settle(6);
}finally{Date.now=now;(db as any).collection=original;}
console.log('PASS 200 request completions schedule one recovery batch; explicit recovery and next-minute recovery remain available');
