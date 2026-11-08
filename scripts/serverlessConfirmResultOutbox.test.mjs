import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {confirmFixtureResultWithOutbox} from '../tgcloud/lib/confirmResultWithOutbox.js';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT UNIQUE,is_banned INTEGER);
 CREATE TABLE efl_club_occupancies(id TEXT PRIMARY KEY,season_id TEXT,club_id TEXT,
  user_id TEXT,telegram_id TEXT,status TEXT);
 CREATE TABLE efl_competitions(id TEXT PRIMARY KEY,season_id TEXT,
  current_matchday INTEGER,is_matchday_open INTEGER);
 CREATE TABLE efl_fixtures(id TEXT PRIMARY KEY,season_id TEXT,competition_id TEXT,
  round INTEGER,status TEXT,home_club_id TEXT,away_club_id TEXT,
  home_score INTEGER,away_score INTEGER,confirmation_status TEXT,
  played_at INTEGER,updated_at INTEGER);
 CREATE TABLE efl_result_submissions(id TEXT PRIMARY KEY,fixture_id TEXT,
  submitted_by_user_id TEXT,club_id TEXT,home_score INTEGER,away_score INTEGER);
 CREATE TABLE efl_disputes(id TEXT PRIMARY KEY,fixture_id TEXT,status TEXT);
 CREATE TABLE efl_fixture_score_windows(fixture_id TEXT PRIMARY KEY,
  season_id TEXT,competition_id TEXT,is_open INTEGER);
 CREATE TABLE efl_notifications(id TEXT PRIMARY KEY,user_id TEXT,type TEXT,
  title TEXT,message TEXT,data TEXT,is_read INTEGER,created_at INTEGER);
 CREATE TABLE efl_notification_deliveries(id TEXT PRIMARY KEY,
  notification_id TEXT UNIQUE,user_id TEXT,status TEXT,attempts INTEGER,
  created_at INTEGER);
 CREATE TABLE efl_audit_logs(id TEXT PRIMARY KEY,actor_user_id TEXT,
  actor_username TEXT,action TEXT,entity_type TEXT,entity_id TEXT,
  old_value TEXT,new_value TEXT,created_at INTEGER);
 INSERT INTO efl_users VALUES('u1','123',0),('u2','456',0),('u3','789',0);
 INSERT INTO efl_club_occupancies VALUES('o1','s1','home','u1','123','ACTIVE'),
  ('o2','s1','away','u2','456','ACTIVE');
 INSERT INTO efl_competitions VALUES('c1','s1',4,1);
 INSERT INTO efl_fixtures VALUES('f1','s1','c1',4,'SCHEDULED',
  'home','away',NULL,NULL,'NONE',NULL,0);
 INSERT INTO efl_result_submissions VALUES('p1','f1','u1','home',2,1);
 `);
 const db={get:async(q,p={})=>sql.prepare(q).get(p)??null,
  all:async(q,p={})=>sql.prepare(q).all(p),
  run:async(q,p={})=>sql.prepare(q).run(p)};
 const transaction=(fault='')=>async callback=>{
  sql.exec('BEGIN IMMEDIATE');
  let firstDelivery=true;
  const tx={
   get:db.get,all:db.all,
   run:async(q,p={})=>{
    if(fault==='delivery'&&q.includes('INSERT INTO efl_notification_deliveries')&&firstDelivery){
     firstDelivery=false;throw Error('SIMULATED_DELIVERY_FAILURE');
    }
    return db.run(q,p);
   }
  };
  try{const value=await callback(tx);sql.exec('COMMIT');return value;}
  catch(error){sql.exec('ROLLBACK');throw error;}
 };
 return {sql,db,transaction};
}
const req={submissionId:'p1'};
test('confirmation atomically persists result, audit, both notifications and queued deliveries',async()=>{
 const {sql,db,transaction}=fixture();
 try{
  await assert.rejects(confirmFixtureResultWithOutbox(db,'u2',req),/RESULT_OUTBOX_TRANSACTION_REQUIRED/);
  const result=await confirmFixtureResultWithOutbox(db,'u2',req,transaction());
  assert.equal(result.confirmed,true);
  assert.equal(result.notificationCount,2);
  assert.equal(result.notificationsQueued,true);
  assert.equal(sql.prepare("SELECT status FROM efl_fixtures WHERE id='f1'").get().status,'CONFIRMED');
  assert.deepEqual(sql.prepare('SELECT user_id AS uid FROM efl_notifications ORDER BY user_id').all().map(x=>x.uid),['u1','u2']);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM efl_notification_deliveries").get().n,2);
  assert.equal(sql.prepare("SELECT count(*) AS n FROM efl_audit_logs").get().n,1);
  const replay=await confirmFixtureResultWithOutbox(db,'u2',req,transaction());
  assert.equal(replay.confirmed,true);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM efl_notifications').get().n,2);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM efl_notification_deliveries').get().n,2);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM efl_audit_logs').get().n,1);
 }finally{sql.close();}
});
test('delivery insert exception rolls back official result, audit and inbox',async()=>{
 const {sql,db,transaction}=fixture();
 try{
  await assert.rejects(confirmFixtureResultWithOutbox(db,'u2',req,transaction('delivery')),
    /SIMULATED_DELIVERY_FAILURE/);
  assert.equal(sql.prepare("SELECT status FROM efl_fixtures WHERE id='f1'").get().status,'SCHEDULED');
  assert.equal(sql.prepare('SELECT count(*) AS n FROM efl_notifications').get().n,0);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM efl_audit_logs').get().n,0);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM efl_notification_deliveries').get().n,0);
 }finally{sql.close();}
});
test('released submitter, unrelated opponent, banned owner and disputes fail closed',async()=>{
 for(const [mutate,actor,error] of [
  [s=>s.exec("UPDATE efl_club_occupancies SET status='RELEASED' WHERE user_id='u1'"),'u2','RESULT_OUTBOX_OWNERSHIP_CONFLICT'],
  [s=>{},'u3','RESULT_OUTBOX_OWNERSHIP_CONFLICT'],
  [s=>s.exec("UPDATE efl_users SET is_banned=1 WHERE id='u1'"),'u2','RESULT_OUTBOX_OWNERSHIP_CONFLICT'],
  [s=>s.exec("INSERT INTO efl_disputes VALUES('d1','f1','OPEN')"),'u2','CONFIRM_CONFLICT_OR_LOCKED']
 ]){
  const {sql,db,transaction}=fixture();
  try{
   mutate(sql);
   await assert.rejects(confirmFixtureResultWithOutbox(db,actor,req,transaction()),new RegExp(error));
   assert.equal(sql.prepare("SELECT status FROM efl_fixtures WHERE id='f1'").get().status,'SCHEDULED');
   assert.equal(sql.prepare('SELECT count(*) AS n FROM efl_notifications').get().n,0);
  }finally{sql.close();}
 }
});

test('conflicting pre-existing notification content rolls back confirmation and audit',async()=>{
 const {sql,db,transaction}=fixture();
 try{
  sql.exec(`INSERT INTO efl_notifications
   (id,user_id,type,title,message,data,is_read,created_at)
   VALUES ('fixture_confirmed:f1:home','u1','RESULT_CONFIRMED',
    'Uchrashuv tasdiqlandi','Hisob: 99:99',NULL,0,100)`);
  await assert.rejects(
   confirmFixtureResultWithOutbox(db,'u2',req,transaction()),
   /RESULT_OUTBOX_NOTIFICATION_CONFLICT/);
  assert.equal(sql.prepare("SELECT status FROM efl_fixtures WHERE id='f1'").get().status,'SCHEDULED');
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM efl_audit_logs').get().n,0);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM efl_notification_deliveries').get().n,0);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM efl_notifications').get().n,1);
 }finally{sql.close();}
});
test('conflicting pre-existing audit entity or action never counts as a valid confirmation',async()=>{
 for(const [action,entity] of [['OTHER_ACTION','f1'],['RESULT_CONFIRMED','another_fixture']]){
  const {sql,db,transaction}=fixture();
  try{
   const audit=JSON.stringify({fixtureId:'f1',submissionId:'p1',homeScore:2,awayScore:1});
   sql.prepare(`INSERT INTO efl_audit_logs
    (id,actor_user_id,actor_username,action,entity_type,entity_id,old_value,new_value,created_at)
    VALUES ('result_confirmed:f1','u2','',:action,'FIXTURE',:entity,NULL,:value,100)`)
    .run({':action':action,':entity':entity,':value':audit});
   await assert.rejects(
    confirmFixtureResultWithOutbox(db,'u2',req,transaction()),
    /RESULT_OUTBOX_AUDIT_CONFLICT/);
   assert.equal(sql.prepare("SELECT status FROM efl_fixtures WHERE id='f1'").get().status,'SCHEDULED');
   assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM efl_notifications').get().n,0);
  }finally{sql.close();}
 }
});
