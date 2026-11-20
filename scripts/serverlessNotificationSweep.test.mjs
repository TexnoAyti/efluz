import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {enqueueCurrentFixtureNotices} from '../tgcloud/lib/notificationSweep.js';

function fixtureDb(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_banned INTEGER);
 CREATE TABLE efl_clubs(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE efl_leagues(id TEXT PRIMARY KEY,current_round INTEGER);
 CREATE TABLE efl_competitions(id TEXT PRIMARY KEY,current_matchday INTEGER);
 CREATE TABLE efl_fixtures(id TEXT PRIMARY KEY,round INTEGER,home_telegram_id TEXT,away_telegram_id TEXT,
   home_club_id TEXT,away_club_id TEXT,scheduled_at INTEGER,status TEXT,confirmation_status TEXT,
   league_id TEXT,competition_id TEXT);
 CREATE TABLE efl_notifications(id TEXT PRIMARY KEY,user_id TEXT,type TEXT,title TEXT,message TEXT,data TEXT,is_read INTEGER,created_at INTEGER);
 CREATE TABLE efl_notification_deliveries(id TEXT PRIMARY KEY,notification_id TEXT UNIQUE,user_id TEXT,status TEXT,attempts INTEGER,created_at INTEGER,retry_after INTEGER DEFAULT 0);
 INSERT INTO efl_users VALUES('u1','101',0),('u2','202',0);
 INSERT INTO efl_clubs VALUES('c1','Arsenal'),('c2','Chelsea');
 INSERT INTO efl_leagues VALUES('l1',3);
 INSERT INTO efl_competitions VALUES('x1',NULL);
 INSERT INTO efl_fixtures VALUES('f1',3,'101','202','c1','c2',1000,'SCHEDULED','NONE','l1','x1');
 `);
 return {sql,db:{
  async all(q,p={}){return sql.prepare(q).all(p);},
  async get(q,p={}){return sql.prepare(q).get(p)??null;},
  async run(q,p={}){return sql.prepare(q).run(p);}
 }};
}

test('current unplayed fixture notices are idempotent and bounded to current round',async()=>{
 const {sql,db}=fixtureDb();
 try{
  const first=await enqueueCurrentFixtureNotices(db,2000);
  assert.equal(first.queued,2);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM efl_notification_deliveries').get().n,2);
  const second=await enqueueCurrentFixtureNotices(db,2000);
  assert.equal(second.queued,0);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM efl_notifications').get().n,2);
 }finally{sql.close();}
});
