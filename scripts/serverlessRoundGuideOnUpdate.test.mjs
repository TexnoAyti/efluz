import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {prepareRoundGuideBatch,ROUND_GUIDE_BODY,ROUND_GUIDE_BUTTON} from '../tgcloud/lib/roundGuideBroadcast.js';
import {deliverQueuedNotificationsOnUpdate} from '../tgcloud/lib/notificationDeliveryOnUpdate.js';

function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
  CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_admin INTEGER,is_banned INTEGER);
  CREATE TABLE efl_notifications(id TEXT PRIMARY KEY,user_id TEXT,type TEXT,title TEXT,
   message TEXT,data TEXT,is_read INTEGER,created_at INTEGER);
  CREATE TABLE efl_notification_deliveries(
   id TEXT PRIMARY KEY,notification_id TEXT UNIQUE,user_id TEXT,status TEXT,
   attempts INTEGER DEFAULT 0,lease_token TEXT,lease_until INTEGER,
   retry_after INTEGER DEFAULT 0,created_at INTEGER,sent_at INTEGER,last_error TEXT);
  INSERT INTO efl_users VALUES ('admin','999',1,0),('user','111',0,0);
 `);
 return {sql,db:{
  get:async(q,p={})=>sql.prepare(q).get(p)??null,
  all:async(q,p={})=>sql.prepare(q).all(p),
  run:async(q,p={})=>sql.prepare(q).run(p)
 }};
}
const privateUpdate={chat:{type:'private',id:111},from:{id:111},message_id:77,text:'/start'};
test('private update delivers prepared guide with inline button and receipt',async()=>{
 const {sql,db}=setup();
 try{
  await prepareRoundGuideBatch(db,'999',{limit:20});
  const messages=[],api={sendMessage:async p=>{messages.push(p);return {message_id:321};}};
  const first=await deliverQueuedNotificationsOnUpdate(db,api,privateUpdate);
  assert.deepEqual(first,{sent:1,reviewed:0});
  assert.equal(messages[0].text,ROUND_GUIDE_BODY);
  assert.deepEqual(messages[0].reply_markup,ROUND_GUIDE_BUTTON);
  assert.deepEqual(await deliverQueuedNotificationsOnUpdate(db,api,privateUpdate),{sent:0,reviewed:0});
  assert.equal(messages.length,1);
  assert.equal(sql.prepare("SELECT count(*) n FROM efl_notification_deliveries WHERE status='SENT'").get().n,1);
 }finally{sql.close();}
});
test('unverified Telegram response enters REVIEW and is not resent',async()=>{
 const {sql,db}=setup();
 try{
  await prepareRoundGuideBatch(db,'999',{limit:20});
  let requests=0;
  const api={sendMessage:async()=>{requests++;return {ok:true};}};
  const result=await deliverQueuedNotificationsOnUpdate(db,api,privateUpdate);
  assert.deepEqual(result,{sent:0,reviewed:1});
  assert.equal(sql.prepare("SELECT status FROM efl_notification_deliveries WHERE user_id='user'").get().status,'REVIEW');
  await deliverQueuedNotificationsOnUpdate(db,api,privateUpdate);
  assert.equal(requests,1);
 }finally{sql.close();}
});
test('group updates never trigger private notifications',async()=>{
 const {sql,db}=setup();
 try{
  await prepareRoundGuideBatch(db,'999',{limit:20});
  let requests=0;
  const result=await deliverQueuedNotificationsOnUpdate(db,{sendMessage:async()=>{requests++;return {message_id:1};}},
    {...privateUpdate,chat:{type:'supergroup',id:-123}});
  assert.deepEqual(result,{sent:0,reviewed:0});
  assert.equal(requests,0);
 }finally{sql.close();}
});
