import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {queueNotificationDelivery,readNotificationDeliveryAudit} from '../tgcloud/lib/notificationDeliveryQueue.js';
import {claimNotificationForWorker,finishNotificationForWorker} from '../tgcloud/lib/notificationDeliveryWorker.js';
const tokenA='workerLeaseTokenA123',tokenB='workerLeaseTokenB456';
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT NOT NULL,
  is_admin INTEGER NOT NULL,is_banned INTEGER NOT NULL);
 CREATE TABLE efl_notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,
  title TEXT NOT NULL,message TEXT NOT NULL);
 CREATE TABLE efl_notification_deliveries(
  id TEXT PRIMARY KEY,notification_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until INTEGER,
  retry_after INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,sent_at INTEGER,last_error TEXT);
 INSERT INTO efl_users VALUES('admin','999',1,0),('user','123',0,0);
 INSERT INTO efl_notifications VALUES('n1','user','Match confirmed','A result was accepted');
 `);
 return {sql,db:{
  get:async(q,p={})=>sql.prepare(q).get(p)??null,
  run:async(q,p={})=>sql.prepare(q).run(p)
 }};
}
const lease=(leaseToken,now)=>({notificationId:'n1',leaseToken,now,leaseMs:30000});
test('delivery lease is one-owner only and successful ack clears pending queue',async()=>{
 const {sql,db}=setup();
 try{
  await queueNotificationDelivery(db,'999',{notificationId:'n1'});
  const first=await claimNotificationForWorker(db,lease(tokenA,100000));
  assert.equal(first.telegramId,'123');
  assert.equal(first.attempt,1);
  await assert.rejects(claimNotificationForWorker(db,lease(tokenB,100100)),
   /DELIVERY_NOT_CLAIMED/);
  const result=await finishNotificationForWorker(db,{
   notificationId:'n1',leaseToken:tokenA,now:100200,success:true});
  assert.equal(result.status,'SENT');
  assert.equal((await readNotificationDeliveryAudit(db,'999')).stats.sent,1);
  await assert.rejects(claimNotificationForWorker(db,lease(tokenB,200000)),
   /DELIVERY_NOT_CLAIMED/);
 }finally{sql.close();}
});
test('failed delivery backs off and exhausts retries without resending automatically',async()=>{
 const {sql,db}=setup();
 try{
  await queueNotificationDelivery(db,'999',{notificationId:'n1'});
  let now=100000;
  for(let attempt=1;attempt<=5;attempt++){
   const claimed=await claimNotificationForWorker(db,lease(tokenA,now));
   assert.equal(claimed.attempt,attempt);
   const result=await finishNotificationForWorker(db,{
    notificationId:'n1',leaseToken:tokenA,now:now+100,success:false,errorCode:'API_RETRYABLE'});
   assert.equal(result.status,attempt===5?'FAILED':'PENDING');
   if(attempt<5){
    await assert.rejects(claimNotificationForWorker(db,lease(tokenB,now+200)),
     /DELIVERY_NOT_CLAIMED/);
    now=now+200+attempt*60000;
   }
  }
  const audit=await readNotificationDeliveryAudit(db,'999');
  assert.equal(audit.stats.failed,1);
  assert.equal(audit.stats.pending,0);
  await assert.rejects(claimNotificationForWorker(db,lease(tokenA,now+300000)),
   /DELIVERY_NOT_CLAIMED/);
 }finally{sql.close();}
});
test('expired lease is quarantined; no worker can resend until review',async()=>{
 const {sql,db}=setup();
 try{
  await queueNotificationDelivery(db,'999',{notificationId:'n1'});
  await claimNotificationForWorker(db,lease(tokenA,100000));
  await assert.rejects(claimNotificationForWorker(db,lease(tokenB,140000)),
   /DELIVERY_NOT_CLAIMED/);
  await assert.rejects(finishNotificationForWorker(db,{
   notificationId:'n1',leaseToken:tokenA,now:140100,success:true
  }),/DELIVERY_ACK_CONFLICT/);
  assert.equal((await readNotificationDeliveryAudit(db,'999')).stats.review,1);
  const row=sql.prepare("SELECT status,last_error AS error FROM efl_notification_deliveries WHERE notification_id='n1'").get();
  assert.equal(row.status,'REVIEW');
  assert.equal(row.error,'LEASE_EXPIRED_UNCERTAIN');
 }finally{sql.close();}
});
test('recipient ban between queue and claim suppresses delivery',async()=>{
 const {sql,db}=setup();
 try{
  await queueNotificationDelivery(db,'999',{notificationId:'n1'});
  sql.exec("UPDATE efl_users SET is_banned=1 WHERE id='user'");
  await assert.rejects(claimNotificationForWorker(db,lease(tokenA,100000)),/DELIVERY_NOT_CLAIMED/);
 }finally{sql.close();}
});
test('invalid worker arguments and tokens cannot acquire a lease',async()=>{
 const {sql,db}=setup();
 try{
  await queueNotificationDelivery(db,'999',{notificationId:'n1'});
  await assert.rejects(claimNotificationForWorker(db,lease('short',100000)),
   /INVALID_DELIVERY_LEASE/);
  await assert.rejects(claimNotificationForWorker(db,{...lease(tokenA,100000),leaseMs:1}),
   /INVALID_DELIVERY_LEASE/);
  await assert.rejects(finishNotificationForWorker(db,{
   notificationId:'n1',leaseToken:tokenA,now:100000,success:false,errorCode:'bad phrase'}),
   /INVALID_DELIVERY_ACK/);
 }finally{sql.close();}
});

test('expired worker cannot acknowledge before or after review transition',async()=>{
 const {sql,db}=setup();
 try{
  await queueNotificationDelivery(db,'999',{notificationId:'n1'});
  await claimNotificationForWorker(db,lease(tokenA,100000));
  await assert.rejects(finishNotificationForWorker(db,{
   notificationId:'n1',leaseToken:tokenA,now:130001,success:true
  }),/DELIVERY_ACK_CONFLICT/);
  assert.equal(sql.prepare("SELECT status FROM efl_notification_deliveries WHERE notification_id='n1'").get().status,'LEASED');
  await assert.rejects(claimNotificationForWorker(db,lease(tokenB,140000)),
   /DELIVERY_NOT_CLAIMED/);
  assert.equal(sql.prepare("SELECT status FROM efl_notification_deliveries WHERE notification_id='n1'").get().status,'REVIEW');
 }finally{sql.close();}
});

test('ambiguous Telegram response is quarantined, not automatically retried',async()=>{
 const {sql,db}=setup();
 try{
  await queueNotificationDelivery(db,'999',{notificationId:'n1'});
  await claimNotificationForWorker(db,lease(tokenA,100000));
  const ack=await finishNotificationForWorker(db,{
   notificationId:'n1',leaseToken:tokenA,now:100200,
   success:false,errorCode:'TELEGRAM_TIMEOUT'});
  assert.equal(ack.status,'REVIEW');
  assert.equal((await readNotificationDeliveryAudit(db,'999')).stats.review,1);
  await assert.rejects(claimNotificationForWorker(db,lease(tokenB,200000)),
    /DELIVERY_NOT_CLAIMED/);
 }finally{sql.close();}
});

test('forged or repeated acknowledgements cannot impersonate a completed delivery',async()=>{
 const {sql,db}=setup();
 try{
  await queueNotificationDelivery(db,'999',{notificationId:'n1'});
  await claimNotificationForWorker(db,lease(tokenA,100000));
  await assert.rejects(finishNotificationForWorker(db,{
   notificationId:'n1',leaseToken:tokenB,now:100200,success:true
  }),/DELIVERY_ACK_CONFLICT/);
  assert.equal(sql.prepare("SELECT status FROM efl_notification_deliveries WHERE notification_id='n1'").get().status,'LEASED');
  await finishNotificationForWorker(db,{
   notificationId:'n1',leaseToken:tokenA,now:100200,success:true
  });
  // An attacker who knows the successful timestamp and guesses another token
  // must not receive a false success when the row is already SENT.
  await assert.rejects(finishNotificationForWorker(db,{
   notificationId:'n1',leaseToken:tokenB,now:100200,success:true
  }),/DELIVERY_ACK_CONFLICT/);
  await assert.rejects(finishNotificationForWorker(db,{
   notificationId:'n1',leaseToken:tokenA,now:100200,success:true
  }),/DELIVERY_ACK_CONFLICT/);
  assert.equal((await readNotificationDeliveryAudit(db,'999')).stats.sent,1);
 }finally{sql.close();}
});
test('cannot acknowledge a previously failed attempt as successful',async()=>{
 const {sql,db}=setup();
 try{
  await queueNotificationDelivery(db,'999',{notificationId:'n1'});
  await claimNotificationForWorker(db,lease(tokenA,100000));
  await finishNotificationForWorker(db,{
   notificationId:'n1',leaseToken:tokenA,now:100200,
   success:false,errorCode:'API_RETRYABLE'
  });
  await assert.rejects(finishNotificationForWorker(db,{
   notificationId:'n1',leaseToken:tokenA,now:100200,
   success:false,errorCode:'API_RETRYABLE'
  }),/DELIVERY_ACK_CONFLICT/);
  assert.equal((await readNotificationDeliveryAudit(db,'999')).stats.pending,1);
 }finally{sql.close();}
});
