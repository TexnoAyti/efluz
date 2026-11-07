import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readResultOutboxAudit} from '../tgcloud/lib/resultOutboxAudit.js';
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,
  is_admin INTEGER,is_banned INTEGER);
 CREATE TABLE efl_seasons(id TEXT PRIMARY KEY,name TEXT,is_active INTEGER,
  created_at INTEGER);
 CREATE TABLE efl_fixtures(id TEXT PRIMARY KEY,season_id TEXT,status TEXT);
 CREATE TABLE efl_audit_logs(id TEXT PRIMARY KEY,action TEXT);
 CREATE TABLE efl_notifications(id TEXT PRIMARY KEY,user_id TEXT);
 CREATE TABLE efl_notification_deliveries(notification_id TEXT PRIMARY KEY,user_id TEXT);
 INSERT INTO efl_users VALUES('admin','999',1,0),
  ('user','123',0,0),('banned','789',1,1);
 INSERT INTO efl_seasons VALUES('s1','Old',0,1),('s2','Current',1,2);
 INSERT INTO efl_fixtures VALUES
  ('old','s1','CONFIRMED'),('f1','s2','CONFIRMED'),
  ('f2','s2','CONFIRMED'),('pending','s2','SCHEDULED');
 INSERT INTO efl_audit_logs VALUES
  ('result_confirmed:old','RESULT_CONFIRMED'),
  ('result_confirmed:f1','RESULT_CONFIRMED');
 INSERT INTO efl_notifications VALUES
  ('fixture_confirmed:f1:home','u1'),
  ('fixture_confirmed:f1:away','u2');
 INSERT INTO efl_notification_deliveries VALUES
  ('fixture_confirmed:f1:home','u1'),
  ('fixture_confirmed:f1:away','u2');
 `);
 return {sql,db:{get:async(q,p={})=>sql.prepare(q).get(p)??null}};
}
test('audit reports incomplete confirmed-match outbox without leaking recipients',async()=>{
 const {sql,db}=setup();
 try{
  const r=await readResultOutboxAudit(db,'999');
  assert.equal(r.season.name,'Current');
  assert.deepEqual(r.stats,{confirmed:2,missingAudits:1,
   missingInbox:2,missingDeliveries:2});
  assert.doesNotMatch(JSON.stringify(r),/u1|u2|123|f1|f2/);
  sql.exec("INSERT INTO efl_notifications VALUES('fixture_confirmed:f2:home','u1')");
  const more=await readResultOutboxAudit(db,'999');
  assert.equal(more.stats.missingInbox,1);
  assert.equal(more.stats.missingDeliveries,2);
 }finally{sql.close();}
});
test('reject user, banned admin and injected season IDs',async()=>{
 const {sql,db}=setup();
 try{
  await assert.rejects(readResultOutboxAudit(db,'123'),/RESULT_OUTBOX_AUDIT_FORBIDDEN/);
  await assert.rejects(readResultOutboxAudit(db,'789'),/RESULT_OUTBOX_AUDIT_FORBIDDEN/);
  await assert.rejects(readResultOutboxAudit(db,'999 OR 1=1'),/AUTH_REQUIRED/);
  await assert.rejects(readResultOutboxAudit(db,'999',{seasonId:'s1'}),
   /INVALID_RESULT_OUTBOX_AUDIT_REQUEST/);
 }finally{sql.close();}
});
test('no active season returns safe zero metrics',async()=>{
 const {sql,db}=setup();
 try{
  sql.exec('UPDATE efl_seasons SET is_active=0');
  const r=await readResultOutboxAudit(db,'999');
  assert.equal(r.season,null);
  assert.deepEqual(r.stats,{confirmed:0,missingAudits:0,
   missingInbox:0,missingDeliveries:0});
 }finally{sql.close();}
});
