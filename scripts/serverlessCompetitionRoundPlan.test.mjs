import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readCompetitionRoundPlan,validateCompetitionRoundPlan} from '../tgcloud/lib/competitionRoundPlan.js';

function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_admin INTEGER,is_banned INTEGER);
 CREATE TABLE efl_competitions(id TEXT PRIMARY KEY,season_id TEXT,league_id TEXT,
  name TEXT,type TEXT,status TEXT,current_matchday INTEGER,is_matchday_open INTEGER,schedule_mode TEXT);
 CREATE TABLE efl_leagues(id TEXT PRIMARY KEY,season_id TEXT,current_round INTEGER);
 CREATE TABLE efl_fixtures(id TEXT PRIMARY KEY,competition_id TEXT,season_id TEXT,
  round INTEGER,status TEXT,home_club_id TEXT,away_club_id TEXT);
 CREATE TABLE efl_disputes(id TEXT PRIMARY KEY,fixture_id TEXT,status TEXT);
 INSERT INTO efl_users VALUES('admin','123',1,0),('regular','456',0,0),('banned','789',1,1);
 INSERT INTO efl_competitions VALUES
  ('league','s1','l1','APL','LEAGUE','ACTIVE',3,1,'GENERATED_SCHEDULE'),
  ('cup','s1',NULL,'National Cup','CUP','ACTIVE',2,1,'GENERATED_SCHEDULE');
 INSERT INTO efl_leagues VALUES('l1','s1',3);
 INSERT INTO efl_fixtures VALUES
  ('f1','league','s1',3,'CONFIRMED','club1','club2'),
  ('f2','league','s1',3,'SCHEDULED','club3','club4'),
  ('f3','league','s1',4,'SCHEDULED','club2','club3'),
  ('f4','league','s1',4,'SCHEDULED','club4','club1'),
  ('f5','cup','s1',2,'SCHEDULED','club1',NULL),
  ('f6','cup','s1',3,'SCHEDULED','club2','club3');
 `);
 const db={get:async(q,p={})=>sql.prepare(q).get(p)??null};
 return {sql,db};
}
test('preview detects next real round but does not require all previous fixtures confirmed',async()=>{
 const {sql,db}=setup();
 try{
  const before=sql.prepare('SELECT * FROM efl_competitions WHERE id=?').get('league');
  const r=await readCompetitionRoundPlan(db,'123',{competitionId:'league'});
  assert.equal(r.readOnly,true);
  assert.equal(r.competition.currentRound,3);
  assert.equal(r.current.confirmed,1);
  assert.equal(r.current.unresolved,1);
  assert.equal(r.next.round,4);
  assert.equal(r.next.existingFixtures,2);
  assert.ok(r.reasons.includes('UNRESOLVED_PREVIOUS_FIXTURES'));
  assert.equal(r.canAdvanceAutomatically,false);
  assert.equal(r.canAdvanceManually,true); // Unplayed games cannot block the next round.
  const after=sql.prepare('SELECT * FROM efl_competitions WHERE id=?').get('league');
  assert.deepEqual(after,before);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM efl_fixtures').get().n,6);
 }finally{sql.close();}
});
test('cup displays incomplete participants and outstanding disputes safely',async()=>{
 const {sql,db}=setup();
 try{
  sql.exec("INSERT INTO efl_disputes VALUES('d1','f5','OPEN')");
  const r=await readCompetitionRoundPlan(db,'123',{competitionId:'cup'});
  assert.equal(r.current.incompletePairs,1);
  assert.equal(r.current.openDisputes,1);
  assert.equal(r.next.round,3);
  assert.equal(r.leagueRound,null);
  assert.ok(r.reasons.includes('OPEN_DISPUTES'));
  assert.equal(r.canAdvanceManually,false);
 }finally{sql.close();}
});
test('no future round is reported instead of inventing fixtures',async()=>{
 const {sql,db}=setup();
 try{
  sql.exec("DELETE FROM efl_fixtures WHERE competition_id='league' AND round>3");
  const r=await readCompetitionRoundPlan(db,'123',{competitionId:'league'});
  assert.equal(r.next.round,null);
  assert.ok(r.reasons.includes('NO_EXISTING_NEXT_ROUND'));
  assert.equal(r.canAdvanceManually,false);
 }finally{sql.close();}
});
test('detects mismatch between league and competition rounds',async()=>{
 const {sql,db}=setup();
 try{
  sql.exec("UPDATE efl_leagues SET current_round=2");
  const r=await readCompetitionRoundPlan(db,'123',{competitionId:'league'});
  assert.ok(r.reasons.includes('LEAGUE_ROUND_MISMATCH'));
  assert.equal(r.canAdvanceManually,false);
 }finally{sql.close();}
});
test('only signed unbanned admins can preview and cannot inject SQL or arbitrary fields',async()=>{
 const {sql,db}=setup();
 try{
  assert.throws(()=>validateCompetitionRoundPlan({competitionId:'league',userId:'admin'}),/INVALID_ROUND_PLAN_COMPETITION/);
  await assert.rejects(readCompetitionRoundPlan(db,'456',{competitionId:'league'}),/ROUND_PLAN_FORBIDDEN/);
  await assert.rejects(readCompetitionRoundPlan(db,'789',{competitionId:'league'}),/ROUND_PLAN_FORBIDDEN/);
  await assert.rejects(readCompetitionRoundPlan(db,'123 OR 1=1',{competitionId:'league'}),/AUTH_REQUIRED/);
  await assert.rejects(readCompetitionRoundPlan(db,'123',{competitionId:'x\' OR 1=1'}),/INVALID_ROUND_PLAN_COMPETITION/);
  await assert.rejects(readCompetitionRoundPlan(db,'123',{competitionId:'unknown'}),/ROUND_PLAN_COMPETITION_NOT_FOUND/);
 }finally{sql.close();}
});

test('nonconsecutive future fixtures cannot bypass an absent round',async()=>{
 const {sql,db}=setup();
 try{
  sql.exec("UPDATE efl_fixtures SET round=5 WHERE competition_id='league' AND round=4");
  const plan=await readCompetitionRoundPlan(db,'123',{competitionId:'league'});
  assert.equal(plan.next.round,5);
  assert.equal(plan.canAdvanceManually,false);
  assert.ok(plan.reasons.includes('NEXT_ROUND_GAP'));
 }finally{sql.close();}
});
test('inactive competition cannot be manually advanced despite future fixtures',async()=>{
 const {sql,db}=setup();
 try{
  sql.exec("UPDATE efl_competitions SET status='CLOSED' WHERE id='league'");
  const plan=await readCompetitionRoundPlan(db,'123',{competitionId:'league'});
  assert.equal(plan.canAdvanceManually,false);
  assert.ok(plan.reasons.includes('COMPETITION_NOT_ACTIVE'));
 }finally{sql.close();}
});
