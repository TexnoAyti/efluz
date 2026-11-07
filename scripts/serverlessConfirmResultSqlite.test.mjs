import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {confirmFixtureResult,validateConfirmation} from '../tgcloud/lib/confirmResult.js';

function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
  CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT NOT NULL,is_banned INTEGER NOT NULL);
  CREATE TABLE efl_club_occupancies(id TEXT PRIMARY KEY,season_id TEXT,club_id TEXT,
    user_id TEXT,telegram_id TEXT,status TEXT);
  CREATE TABLE efl_competitions(id TEXT PRIMARY KEY,season_id TEXT,
    is_matchday_open INTEGER,current_matchday INTEGER);
  CREATE TABLE efl_fixtures(id TEXT PRIMARY KEY,season_id TEXT,competition_id TEXT,
    round INTEGER,status TEXT,home_club_id TEXT,away_club_id TEXT,
    home_score INTEGER,away_score INTEGER,confirmation_status TEXT,played_at INTEGER,updated_at INTEGER);
  CREATE TABLE efl_result_submissions(id TEXT PRIMARY KEY,fixture_id TEXT,
    submitted_by_user_id TEXT,club_id TEXT,home_score INTEGER,away_score INTEGER);
  CREATE TABLE efl_disputes(id TEXT PRIMARY KEY,fixture_id TEXT,status TEXT);
  INSERT INTO efl_users VALUES('u1','123',0),('u2','456',0),('u3','789',0);
  INSERT INTO efl_club_occupancies VALUES('o1','season1','home','u1','123','ACTIVE'),
    ('o2','season1','away','u2','456','ACTIVE');
  INSERT INTO efl_competitions VALUES('comp1','season1',1,3);
  INSERT INTO efl_fixtures VALUES('f1','season1','comp1',3,'SCHEDULED','home','away',
     NULL,NULL,'NONE',NULL,0);
  INSERT INTO efl_result_submissions VALUES('p1','f1','u1','home',2,1);
 `);
 const db={
  async get(query,params={}){return sql.prepare(query).get(params)||null;},
  async run(query,params={}){sql.prepare(query).run(params);return [];}
 };
 return {sql,db};
}
test('validates confirmation input and rejects client score overrides',()=>{
 assert.equal(validateConfirmation({submissionId:'p1'}).submissionId,'p1');
 assert.throws(()=>validateConfirmation({submissionId:'p1',homeScore:99}),/UNKNOWN_CONFIRMATION_FIELD/);
});
test('opponent only confirms submitted scores, fixture remains idempotently confirmed',async()=>{
 const {sql,db}=setup();
 try{
  const result=await confirmFixtureResult(db,'u2',{submissionId:'p1'});
  assert.equal(result.confirmed,true);
  assert.equal(result.homeScore,2);
  assert.equal((await confirmFixtureResult(db,'u2',{submissionId:'p1'})).confirmed,true);
  const row=sql.prepare("SELECT status,home_score,away_score FROM efl_fixtures WHERE id='f1'").get();
  assert.deepEqual(row,{status:'CONFIRMED',home_score:2,away_score:1});
  await assert.rejects(confirmFixtureResult(db,'u1',{submissionId:'p1'}),/SELF_CONFIRM_FORBIDDEN/);
  await assert.rejects(confirmFixtureResult(db,'u3',{submissionId:'p1'}),/CONFIRM_FORBIDDEN/);
 }finally{sql.close();}
});
test('closed round, released club and banned opponent cannot confirm',async()=>{
 for(const [action,code] of [
  [sql=>sql.exec("UPDATE efl_competitions SET is_matchday_open=0"),'CONFIRM_CONFLICT_OR_LOCKED'],
  [sql=>sql.exec("UPDATE efl_club_occupancies SET status='RELEASED' WHERE user_id='u2'"),'CONFIRM_FORBIDDEN'],
  [sql=>sql.exec("UPDATE efl_users SET is_banned=1 WHERE id='u2'"),'USER_BANNED_OR_MISSING']
 ]){
  const {sql,db}=setup();
  try{
   action(sql);
   await assert.rejects(confirmFixtureResult(db,'u2',{submissionId:'p1'}),new RegExp(code));
   assert.equal(sql.prepare("SELECT status FROM efl_fixtures WHERE id='f1'").get().status,'SCHEDULED');
  }finally{sql.close();}
 }
});

test('mismatching opponent submission or unresolved dispute prevents confirmation',async()=>{
 for(const setupConflict of [
  sql=>sql.exec("INSERT INTO efl_result_submissions VALUES('p2','f1','u2','away',1,2)"),
  sql=>sql.exec("INSERT INTO efl_disputes VALUES('d1','f1','OPEN')")
 ]){
  const {sql,db}=setup();
  try{
   setupConflict(sql);
   await assert.rejects(confirmFixtureResult(db,'u2',{submissionId:'p1'}),/CONFIRM_CONFLICT_OR_LOCKED/);
   const row=sql.prepare("SELECT status,home_score FROM efl_fixtures WHERE id='f1'").get();
   assert.equal(row.status,'SCHEDULED');
   assert.equal(row.home_score,null);
  }finally{sql.close();}
 }
});
