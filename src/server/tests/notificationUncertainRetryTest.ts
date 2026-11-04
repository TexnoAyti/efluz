import assert from 'node:assert/strict';
import {PostgresNotificationStore} from '../services/postgresNotificationStore';
import {getBroadcastDetails,retryFailedBroadcastRecipients,type TelegramBroadcastRecord} from '../services/telegramNotificationQueue';

process.env.DATABASE_PROVIDER='supabase';
const record:TelegramBroadcastRecord={id:'uncertain-test',seasonId:'season-test',title:'Test',body:'Test',type:'CUSTOM_ALERT',
 targetAudience:'SELECTED_RECIPIENTS',createdById:'admin',createdByUsername:'admin',createdAt:new Date().toISOString(),status:'PARTIALLY_FAILED',
 metrics:{totalRecipients:3,sentCount:1,failedCount:2,skippedCount:0},recipients:[
  {userId:'sent',username:'sent',displayName:'Sent',status:'SENT',retryCount:0},
  {userId:'uncertain',username:'uncertain',displayName:'Unknown',status:'FAILED',retryCount:0,error:'DELIVERY_UNKNOWN: worker interrupted'},
  {userId:'rejected',username:'rejected',displayName:'Rejected',status:'FAILED',retryCount:0,error:'TELEGRAM_429: rejected'},
 ]};
const queued:any[]=[];let readFailed=false;
const prototype=PostgresNotificationStore.prototype;
const original={hget:prototype.hget,get:prototype.get,rpush:prototype.rpush,hset:prototype.hset};
prototype.hget=async function(){if(readFailed)throw Error('DATABASE_UNAVAILABLE');return structuredClone(record) as any;};
prototype.get=async function(){return record.recipients.map(r=>({userId:r.userId,telegramId:'123',messageable:true})) as any;};
prototype.rpush=async function(_key,value){queued.push(JSON.parse(value));return queued.length;};
prototype.hset=async function(_key,fields){Object.assign(record,structuredClone(fields[record.id]));return 1;};
try{
 assert.deepEqual(await retryFailedBroadcastRecipients(record.id),{retried:1,skipped:1});
 assert.equal(queued.length,1);assert.equal(queued[0].userId,'rejected');
 assert.equal(record.recipients.find(r=>r.userId==='uncertain')?.status,'FAILED');
 assert.equal(record.recipients.find(r=>r.userId==='sent')?.status,'SENT');
 assert.deepEqual(await retryFailedBroadcastRecipients(record.id,'uncertain'),{retried:0,skipped:1});
 assert.equal(queued.length,1,'Even a selected unknown recipient is excluded from a generic retry');
 // Populate process memory through the retry above, then lose the database.
 readFailed=true;await assert.rejects(getBroadcastDetails(record.id),/DATABASE_UNAVAILABLE/);
 console.log('PASS unknown-delivery and SENT receipts excluded from manual retries; unavailable database never falls back to stale delivery memory');
}finally{Object.assign(prototype,original);}
