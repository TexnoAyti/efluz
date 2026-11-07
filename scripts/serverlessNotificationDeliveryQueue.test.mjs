import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {queueNotificationDelivery,readNotificationDeliveryAudit,
 validateQueueNotification} from '../tgcloud/lib/notificationDeliveryQueue.js';

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
 INSERT INTO efl_users VALUES
  ('admin','999',1,0),('member','123',0,0),('other','456',0,0),
  ('banned','789',0,1),('badadmin','555',1,1);
 INSERT INTO efl_notifications VALUES
  ('n1','member','Result approved','Sensitive content'),
  ('n2','banned','Ban test','Private'),
  ('n3','missing','Ghost','Private');
 `);
 const db={get:async(q,p={})=>sql.prepare(q).get(p)??null,
  run:async(q,p={})=>sql.prepare(q).run(p)};
 return {sql,db};
}
test('only admin enqueues an existing recipient notification, replay is idempotent',async()=>{
 const {sql,db}=setup();
 try{
  const r=await queueNotificationDelivery(db,'999',{notificationId:'n1'});
  assert.deepEqual(Object.keys(r).sort(),['notificationId','ok','queued','source','status']);
  assert.equal(r.status,'PENDING');
  await queueNotificationDelivery(db,'999',{notificationId:'n1'});
  assert.equal(sql.prepare('SELECT COUNT(*) AS total FROM efl_notification_deliveries').get().total,1);
  assert.equal(sql.prepare('SELECT user_id AS userId FROM efl_notification_deliveries').get().userId,'member');
  const audit=await readNotificationDeliveryAudit(db,'999');
  assert.deepEqual(audit.stats,{total:1,pending:1,leased:0,sent:0,failed:0,review:0});
  assert.doesNotMatch(JSON.stringify(audit),/Sensitive content|123|member/);
 }finally{sql.close();}
});
test('banned, nonadmin, nonexistent recipient and malicious requests are denied',async()=>{
 const {sql,db}=setup();
 try{
  for(const actor of ['123','555','456','999 OR 1=1']){
   await assert.rejects(queueNotificationDelivery(db,actor,{notificationId:'n1'}),
      /DELIVERY_QUEUE_FORBIDDEN|AUTH_REQUIRED/);
  }
  for(const id of ['n2','n3','unknown']){
   await assert.rejects(queueNotificationDelivery(db,'999',{notificationId:id}),
     /DELIVERY_QUEUE_NOT_ELIGIBLE/);
  }
  assert.throws(()=>validateQueueNotification({notificationId:'n1',telegramId:'123'}),
   /INVALID_NOTIFICATION_QUEUE_REQUEST/);
  assert.throws(()=>validateQueueNotification({notificationId:"x' OR 1=1"}),
   /INVALID_NOTIFICATION_QUEUE_REQUEST/);
  await assert.rejects(readNotificationDeliveryAudit(db,'123'),/DELIVERY_QUEUE_FORBIDDEN/);
  await assert.rejects(readNotificationDeliveryAudit(db,'999',{userId:'member'}),
   /INVALID_NOTIFICATION_DELIVERY_AUDIT/);
  assert.equal(sql.prepare('SELECT COUNT(*) AS total FROM efl_notification_deliveries').get().total,0);
 }finally{sql.close();}
});
test('delivery queue cannot be bypassed after recipient ban, and never copies content',async()=>{
 const {sql,db}=setup();
 try{
  sql.exec("UPDATE efl_users SET is_banned=1 WHERE id='member'");
  await assert.rejects(queueNotificationDelivery(db,'999',{notificationId:'n1'}),
   /DELIVERY_QUEUE_NOT_ELIGIBLE/);
  assert.equal(sql.prepare('SELECT COUNT(*) AS total FROM efl_notification_deliveries').get().total,0);
 }finally{sql.close();}
});
