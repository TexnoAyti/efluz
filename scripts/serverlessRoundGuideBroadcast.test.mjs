import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ROUND_GUIDE_BODY,ROUND_GUIDE_BUTTON,ROUND_GUIDE_ID,
 prepareRoundGuideBatch,dispatchRoundGuideBatch} from '../tgcloud/lib/roundGuideBroadcast.js';
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_admin INTEGER NOT NULL,is_banned INTEGER NOT NULL);
 CREATE TABLE efl_notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,type TEXT,title TEXT,
  message TEXT,data TEXT,is_read INTEGER,created_at INTEGER);
 CREATE TABLE efl_notification_deliveries(
  id TEXT PRIMARY KEY,notification_id TEXT UNIQUE,user_id TEXT,status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until INTEGER,
  retry_after INTEGER NOT NULL DEFAULT 0,created_at INTEGER,sent_at INTEGER,last_error TEXT);
 INSERT INTO efl_users VALUES ('admin','999',1,0),('a','111',0,0),('b','222',0,0),
  ('c','333',0,0),('banned','444',0,1),('noid',NULL,0,0),('badadmin','777',1,1);
 `);
 const db={
  get:async(query,params={})=>sql.prepare(query).get(params)??null,
  all:async(query,params={})=>sql.prepare(query).all(params),
  run:async(query,params={})=>sql.prepare(query).run(params),
 };
 return {sql,db};
}
test('message is text only and has an inline bot button, not a Vercel link',()=>{
 assert.match(ROUND_GUIDE_BODY,/19 ta turdagi uchrashuvlar/);
 assert.doesNotMatch(ROUND_GUIDE_BODY,/vercel|O‘yinga kirish 👉/i);
 assert.deepEqual(ROUND_GUIDE_BUTTON.inline_keyboard[0][0],
  {text:'🎮 O‘yinga kirish',url:'https://t.me/efluzbot?start=app'});
});
test('only active admin may enqueue, and repeated pages never duplicate',async()=>{
 const {sql,db}=setup();
 try{
  await assert.rejects(prepareRoundGuideBatch(db,'111'),/ROUND_GUIDE_FORBIDDEN/);
  await assert.rejects(prepareRoundGuideBatch(db,'777'),/ROUND_GUIDE_FORBIDDEN/);
  await assert.rejects(prepareRoundGuideBatch(db,'999',{cursor:"x' OR 1=1"}),/INVALID_ROUND_GUIDE_REQUEST/);
  let p=await prepareRoundGuideBatch(db,'999',{limit:2});
  assert.equal(p.prepared,2);
  assert.equal(p.nextCursor,'admin');
  const second=await prepareRoundGuideBatch(db,'999',{cursor:p.nextCursor,limit:2});
  assert.equal(second.prepared,2);
  assert.equal(second.nextCursor,'c');
  const last=await prepareRoundGuideBatch(db,'999',{cursor:second.nextCursor,limit:2});
  assert.equal(last.prepared,0);
  assert.equal(last.nextCursor,null);
  await prepareRoundGuideBatch(db,'999',{limit:2});
  assert.equal(sql.prepare('SELECT count(*) n FROM efl_notifications').get().n,4);
  assert.equal(sql.prepare('SELECT count(*) n FROM efl_notification_deliveries').get().n,4);
  assert.equal(sql.prepare("SELECT count(*) n FROM efl_notifications WHERE id LIKE '"+ROUND_GUIDE_ID+"%'").get().n,4);
 }finally{sql.close();}
});
test('Telegram dispatch sends only queued guide and records accepted messages',async()=>{
 const {sql,db}=setup();
 try{
  await prepareRoundGuideBatch(db,'999',{limit:20});
  const sent=[];
  const api={sendMessage:async payload=>{sent.push(payload);return {ok:true};}};
  const r=await dispatchRoundGuideBatch(db,api,'999',{limit:3});
  assert.deepEqual({sent:r.sent,review:r.review,failed:r.failed},{sent:3,review:0,failed:0});
  assert.equal(sent.length,3);
  assert.equal(sent[0].text,ROUND_GUIDE_BODY);
  assert.deepEqual(sent[0].reply_markup,ROUND_GUIDE_BUTTON);
  const again=await dispatchRoundGuideBatch(db,api,'999',{limit:3});
  assert.equal(again.sent,1);
  const final=await dispatchRoundGuideBatch(db,api,'999',{limit:3});
  assert.equal(final.sent,0);
  assert.equal(sql.prepare("SELECT count(*) n FROM efl_notification_deliveries WHERE status='SENT'").get().n,4);
 }finally{sql.close();}
});
test('ambiguous send is held for review, not automatically sent again',async()=>{
 const {sql,db}=setup();
 try{
  await prepareRoundGuideBatch(db,'999',{limit:20});
  let calls=0;
  const api={sendMessage:async()=>{calls++;throw new Error('unverified connection');}};
  const first=await dispatchRoundGuideBatch(db,api,'999',{limit:3});
  assert.equal(first.review,3);
  const second=await dispatchRoundGuideBatch(db,api,'999',{limit:3});
  assert.equal(second.sent,0);
  assert.equal(second.review,1);
  const third=await dispatchRoundGuideBatch(db,api,'999',{limit:3});
  assert.equal(third.attempted,0);
  assert.equal(calls,4);
  assert.equal(sql.prepare("SELECT count(*) n FROM efl_notification_deliveries WHERE status='REVIEW'").get().n,4);
 }finally{sql.close();}
});
