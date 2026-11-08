import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {claimClub} from '../tgcloud/lib/clubClaim.js';
import {proposeFixtureResult} from '../tgcloud/lib/resultProposal.js';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
   CREATE TABLE efl_users (
     id TEXT PRIMARY KEY,telegram_id TEXT NOT NULL UNIQUE,is_banned INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE efl_seasons (id TEXT PRIMARY KEY,status TEXT NOT NULL);
   CREATE TABLE efl_leagues (
     id TEXT PRIMARY KEY,season_id TEXT NOT NULL,status TEXT NOT NULL
   );
   CREATE TABLE efl_clubs (id TEXT PRIMARY KEY,league_id TEXT NOT NULL);
   CREATE TABLE efl_club_occupancies (
     id TEXT PRIMARY KEY,season_id TEXT NOT NULL,league_id TEXT NOT NULL,
     club_id TEXT NOT NULL,user_id TEXT NOT NULL,telegram_id TEXT NOT NULL,
     status TEXT NOT NULL,joined_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
   );
   CREATE UNIQUE INDEX efl_active_club ON efl_club_occupancies(season_id,club_id)
     WHERE status='ACTIVE';
   CREATE UNIQUE INDEX efl_active_user_league ON efl_club_occupancies(season_id,league_id,user_id)
     WHERE status='ACTIVE';
   CREATE TABLE efl_competitions (
     id TEXT PRIMARY KEY,season_id TEXT NOT NULL,
     current_matchday INTEGER,is_matchday_open INTEGER
   );
   CREATE TABLE efl_fixtures (
     id TEXT PRIMARY KEY,season_id TEXT NOT NULL,competition_id TEXT NOT NULL,
     round INTEGER NOT NULL,status TEXT NOT NULL,
     home_club_id TEXT,away_club_id TEXT
   );
   CREATE TABLE efl_fixture_score_windows (
     fixture_id TEXT PRIMARY KEY,season_id TEXT NOT NULL,competition_id TEXT NOT NULL,
     is_open INTEGER NOT NULL,authorized_by TEXT NOT NULL,updated_at INTEGER NOT NULL
   );
   CREATE TABLE efl_result_submissions (
     id TEXT PRIMARY KEY,fixture_id TEXT NOT NULL,
     submitted_by_user_id TEXT NOT NULL,club_id TEXT NOT NULL,
     home_score INTEGER NOT NULL,away_score INTEGER NOT NULL,created_at INTEGER NOT NULL
   );
   CREATE UNIQUE INDEX efl_submission_once ON efl_result_submissions
     (fixture_id,submitted_by_user_id);
   INSERT INTO efl_users VALUES ('u1','123',0),('u2','456',0),('u3','789',0);
   INSERT INTO efl_seasons VALUES ('season-2','UPCOMING');
   INSERT INTO efl_leagues VALUES ('league-1','season-2','OPEN');
   INSERT INTO efl_clubs VALUES ('c1','league-1'),('c2','league-1');
   INSERT INTO efl_competitions VALUES ('comp-1','season-2',3,1);
   INSERT INTO efl_fixtures VALUES ('f1','season-2','comp-1',3,'SCHEDULED','c1','c2');
 `);
 const db={
  async get(query,values={}){return sql.prepare(query).get(values)??null;},
  async run(query,values={}){sql.prepare(query).run(values);return [];} // Actual SDK does not promise rowsAffected.
 };
 return {sql,db};
}
const claim=(clubId,requestId='request0001')=>({seasonId:'season-2',clubId,requestId});
test('real SQLite enforces unique club owner, player league limit and idempotent replay',async()=>{
 const {sql,db}=fixture();
 try{
  assert.equal((await claimClub(db,'u1',claim('c1'))).alreadyClaimed,false);
  assert.equal((await claimClub(db,'u1',claim('c1'))).alreadyClaimed,true);
  await assert.rejects(claimClub(db,'u2',claim('c1','request0002')),/CLUB_CLAIM_CONFLICT/);
  await assert.rejects(claimClub(db,'u1',claim('c2','request0003')),/CLUB_CLAIM_CONFLICT/);
  assert.equal((await claimClub(db,'u2',claim('c2','request0004'))).alreadyClaimed,false);
  assert.equal(sql.prepare("SELECT COUNT(*) count FROM efl_club_occupancies WHERE status='ACTIVE'").get().count,2);
 }finally{sql.close();}
});
test('real SQLite result proposal is pending, replay-safe and bounded to active owners',async()=>{
 const {sql,db}=fixture();
 try{
  await claimClub(db,'u1',claim('c1'));
  await claimClub(db,'u2',claim('c2','request0004'));
  const input={fixtureId:'f1',homeScore:2,awayScore:1};
  assert.equal((await proposeFixtureResult(db,'u1',input)).alreadySubmitted,false);
  assert.equal((await proposeFixtureResult(db,'u1',input)).alreadySubmitted,true);
  await assert.rejects(proposeFixtureResult(db,'u1',{...input,homeScore:9}),/PROPOSAL_CONFLICT/);
  assert.equal((await proposeFixtureResult(db,'u2',{...input,homeScore:1,awayScore:2})).pendingConfirmation,true);
  await assert.rejects(proposeFixtureResult(db,'u3',input),/FIXTURE_FORBIDDEN/);
  assert.equal(sql.prepare('SELECT COUNT(*) count FROM efl_result_submissions').get().count,2);
  assert.equal(sql.prepare("SELECT status FROM efl_fixtures WHERE id='f1'").get().status,'SCHEDULED',
    'Proposals do not confirm fixtures without opponent/admin workflow');
  sql.exec("UPDATE efl_competitions SET is_matchday_open=0 WHERE id='comp-1'");
  await assert.rejects(proposeFixtureResult(db,'u2',input),/MATCHDAY_LOCKED/);
 }finally{sql.close();}
});

test('result replay fails closed after club release or matchday closure during insert',async()=>{
 for(const change of [
  "UPDATE efl_club_occupancies SET status='RELEASED' WHERE user_id='u1'",
  "UPDATE efl_competitions SET is_matchday_open=0 WHERE id='comp-1'",
  "UPDATE efl_users SET is_banned=1 WHERE id='u1'"
 ]){
  const {sql,db}=fixture();
  try{
   await claimClub(db,'u1',claim('c1'));
   const input={fixtureId:'f1',homeScore:2,awayScore:1};
   await proposeFixtureResult(db,'u1',input);
   let changed=false;
   const racingDb={
    get:db.get,
    async run(query,params){
     if(!changed && query.includes('INSERT INTO efl_result_submissions')){
      sql.exec(change);
      changed=true;
     }
     return db.run(query,params);
    }
   };
   await assert.rejects(proposeFixtureResult(racingDb,'u1',input),
    /PROPOSAL_CONFLICT_OR_LOCKED/);
   assert.equal(changed,true);
   assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM efl_result_submissions").get().n,1);
  }finally{sql.close();}
 }
});
test('result proposal cannot commit if a fixture becomes a self-match during write',async()=>{
 const {sql,db}=fixture();
 try{
  await claimClub(db,'u1',claim('c1'));
  const input={fixtureId:'f1',homeScore:1,awayScore:0};
  let changed=false;
  const racingDb={
   get:db.get,
   async run(query,params){
    if(!changed && query.includes('INSERT INTO efl_result_submissions')){
     sql.exec("UPDATE efl_fixtures SET away_club_id=home_club_id WHERE id='f1'");
     changed=true;
    }
    return db.run(query,params);
   }
  };
  await assert.rejects(proposeFixtureResult(racingDb,'u1',input),
   /PROPOSAL_CONFLICT_OR_LOCKED/);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM efl_result_submissions').get().n,0);
 }finally{sql.close();}
});
