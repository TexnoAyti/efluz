import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {setLateScoreWindow} from '../tgcloud/lib/lateScoreWindow.js';
import {proposeFixtureResult} from '../tgcloud/lib/resultProposal.js';
import {confirmFixtureResult} from '../tgcloud/lib/confirmResult.js';

function seed(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_admin INTEGER,is_banned INTEGER);
 CREATE TABLE efl_club_occupancies(id TEXT PRIMARY KEY,season_id TEXT,club_id TEXT,
   user_id TEXT,telegram_id TEXT,status TEXT);
 CREATE TABLE efl_competitions(id TEXT PRIMARY KEY,season_id TEXT,current_matchday INTEGER,
   is_matchday_open INTEGER);
 CREATE TABLE efl_fixtures(id TEXT PRIMARY KEY,season_id TEXT,competition_id TEXT,
   round INTEGER,status TEXT,home_club_id TEXT,away_club_id TEXT,
   home_score INTEGER,away_score INTEGER,confirmation_status TEXT,
   played_at INTEGER,updated_at INTEGER);
 CREATE TABLE efl_result_submissions(id TEXT PRIMARY KEY,fixture_id TEXT,
   submitted_by_user_id TEXT,club_id TEXT,home_score INTEGER,away_score INTEGER,created_at INTEGER);
 CREATE TABLE efl_disputes(id TEXT PRIMARY KEY,fixture_id TEXT,status TEXT);
 CREATE TABLE efl_fixture_score_windows(fixture_id TEXT PRIMARY KEY,season_id TEXT NOT NULL,
   competition_id TEXT NOT NULL,is_open INTEGER NOT NULL,authorized_by TEXT NOT NULL,
   updated_at INTEGER NOT NULL);
 INSERT INTO efl_users VALUES('admin','999',1,0),('u1','123',0,0),('u2','456',0,0),
  ('other','777',0,0),('banned','789',1,1);
 INSERT INTO efl_club_occupancies VALUES('o1','s1','home','u1','123','ACTIVE'),
  ('o2','s1','away','u2','456','ACTIVE');
 INSERT INTO efl_competitions VALUES('cup','s1',3,1);
 INSERT INTO efl_fixtures VALUES('f1','s1','cup',2,'SCHEDULED','home','away',
   NULL,NULL,'NONE',NULL,0);
 `);
 const db={get:async(query,params={})=>sql.prepare(query).get(params)??null,
  run:async(query,params={})=>sql.prepare(query).run(params)};
 return {sql,db};
}
const result={fixtureId:'f1',homeScore:2,awayScore:1};
test('historical results require explicit admin grant; opponent can confirm',async()=>{
 const {sql,db}=seed();
 try{
  await assert.rejects(proposeFixtureResult(db,'u1',result),/MATCHDAY_LOCKED/);
  const granted=await setLateScoreWindow(db,'999',{fixtureId:'f1',open:true});
  assert.equal(granted.open,true);
  const proposed=await proposeFixtureResult(db,'u1',result);
  assert.equal(proposed.pendingConfirmation,true);
  const confirmed=await confirmFixtureResult(db,'u2',{submissionId:proposed.submissionId});
  assert.equal(confirmed.confirmed,true);
  assert.equal(sql.prepare("SELECT home_score AS score,status FROM efl_fixtures WHERE id='f1'").get().score,2);
  assert.equal(sql.prepare("SELECT current_matchday AS r FROM efl_competitions WHERE id='cup'").get().r,3);
 }finally{sql.close();}
});
test('closing a historical result window blocks score proposal',async()=>{
 const {sql,db}=seed();
 try{
  await setLateScoreWindow(db,'999',{fixtureId:'f1',open:true});
  await setLateScoreWindow(db,'999',{fixtureId:'f1',open:false});
  await assert.rejects(proposeFixtureResult(db,'u1',result),/MATCHDAY_LOCKED/);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM efl_result_submissions").get().n,0);
 }finally{sql.close();}
});
test('window closed after proposal prevents opponent confirmation',async()=>{
 const {sql,db}=seed();
 try{
  await setLateScoreWindow(db,'999',{fixtureId:'f1',open:true});
  const p=await proposeFixtureResult(db,'u1',result);
  await setLateScoreWindow(db,'999',{fixtureId:'f1',open:false});
  await assert.rejects(confirmFixtureResult(db,'u2',{submissionId:p.submissionId}),
    /CONFIRM_CONFLICT_OR_LOCKED/);
  assert.equal(sql.prepare("SELECT status FROM efl_fixtures WHERE id='f1'").get().status,'SCHEDULED');
 }finally{sql.close();}
});
test('only an unbanned admin may open historical fixtures, not current rounds',async()=>{
 const {sql,db}=seed();
 try{
  await assert.rejects(setLateScoreWindow(db,'777',{fixtureId:'f1',open:true}),/LATE_SCORE_WINDOW_FORBIDDEN/);
  await assert.rejects(setLateScoreWindow(db,'789',{fixtureId:'f1',open:true}),/LATE_SCORE_WINDOW_FORBIDDEN/);
  await assert.rejects(setLateScoreWindow(db,'999',{fixtureId:'missing',open:true}),/LATE_SCORE_FIXTURE_NOT_FOUND/);
  await assert.rejects(setLateScoreWindow(db,'999',{fixtureId:'f1',open:'true'}),/INVALID_LATE_SCORE_WINDOW/);
  sql.exec('UPDATE efl_competitions SET current_matchday=2');
  await assert.rejects(setLateScoreWindow(db,'999',{fixtureId:'f1',open:true}),/LATE_SCORE_NOT_HISTORICAL/);
 }finally{sql.close();}
});
test('open disputes still prevent confirmation after late window authorization',async()=>{
 const {sql,db}=seed();
 try{
  await setLateScoreWindow(db,'999',{fixtureId:'f1',open:true});
  const p=await proposeFixtureResult(db,'u1',result);
  sql.exec("INSERT INTO efl_disputes VALUES('d1','f1','OPEN')");
  await assert.rejects(confirmFixtureResult(db,'u2',{submissionId:p.submissionId}),
    /CONFIRM_CONFLICT_OR_LOCKED/);
 }finally{sql.close();}
});
