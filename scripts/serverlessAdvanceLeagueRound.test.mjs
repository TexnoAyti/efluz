import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {advanceLeagueRound} from '../tgcloud/lib/advanceLeagueRound.js';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_admin INTEGER,is_banned INTEGER);
 CREATE TABLE efl_leagues(id TEXT PRIMARY KEY,season_id TEXT,status TEXT,current_round INTEGER,updated_at INTEGER);
 CREATE TABLE efl_competitions(id TEXT PRIMARY KEY,season_id TEXT,league_id TEXT,
  type TEXT,status TEXT,current_matchday INTEGER,is_matchday_open INTEGER,updated_at INTEGER);
 CREATE TABLE efl_fixtures(id TEXT PRIMARY KEY,season_id TEXT,competition_id TEXT,
  round INTEGER,status TEXT,home_score INTEGER,away_score INTEGER);
 CREATE TABLE efl_disputes(id TEXT PRIMARY KEY,fixture_id TEXT,status TEXT);
 INSERT INTO efl_users VALUES('admin','123',1,0),('other','456',0,0),('banned','789',1,1);
 INSERT INTO efl_leagues VALUES('apl','s1','ACTIVE',3,100);
 INSERT INTO efl_competitions VALUES('league','s1','apl','LEAGUE','ACTIVE',3,1,100);
 INSERT INTO efl_fixtures VALUES
  ('old','s1','league',3,'SCHEDULED',NULL,NULL),
  ('next','s1','league',4,'SCHEDULED',NULL,NULL);
 `);
 const db={get:async(q,p={})=>sql.prepare(q).get(p)??null,
  run:async(q,p={})=>sql.prepare(q).run(p)};
 function transaction(failSecond=false){
  return async callback=>{
   sql.exec('BEGIN IMMEDIATE');
   let writes=0;
   const tx={
    get:db.get,
    run:async(q,p={})=>{
     writes++;
     if(failSecond&&writes===2)throw Error('SIMULATED_SECOND_WRITE_FAILURE');
     return db.run(q,p);
    }
   };
   try{
    const value=await callback(tx);
    sql.exec('COMMIT');
    return value;
   }catch(error){sql.exec('ROLLBACK');throw error;}
  };
 }
 return {sql,db,transaction};
}
const args={competitionId:'league',expectedRound:3,nextRound:4};
test('only an actual transaction provider advances both league and competition',async()=>{
 const {sql,db,transaction}=fixture();
 try{
  await assert.rejects(advanceLeagueRound(db,'123',args),/LEAGUE_TRANSACTION_REQUIRED/);
  const before=sql.prepare("SELECT current_round AS r FROM efl_leagues WHERE id='apl'").get();
  assert.equal(before.r,3);
  const res=await advanceLeagueRound(db,'123',args,transaction());
  assert.equal(res.currentRound,4);
  assert.equal(res.oldFixturesPreserved,true);
  assert.equal(sql.prepare("SELECT current_round AS r FROM efl_leagues WHERE id='apl'").get().r,4);
  assert.equal(sql.prepare("SELECT current_matchday AS r FROM efl_competitions WHERE id='league'").get().r,4);
  assert.equal(sql.prepare("SELECT status FROM efl_fixtures WHERE id='old'").get().status,'SCHEDULED');
  assert.equal((await advanceLeagueRound(db,'123',args,transaction())).replayed,true);
 }finally{sql.close();}
});
test('failed second write rolls back first league update',async()=>{
 const {sql,db,transaction}=fixture();
 try{
  await assert.rejects(advanceLeagueRound(db,'123',args,transaction(true)),/SIMULATED_SECOND_WRITE_FAILURE/);
  assert.equal(sql.prepare("SELECT current_round AS r FROM efl_leagues WHERE id='apl'").get().r,3);
  assert.equal(sql.prepare("SELECT current_matchday AS r FROM efl_competitions WHERE id='league'").get().r,3);
 }finally{sql.close();}
});
test('unresolved previous match remains untouched, unresolved dispute blocks round',async()=>{
 const {sql,db,transaction}=fixture();
 try{
  sql.exec("INSERT INTO efl_disputes VALUES('d1','old','OPEN')");
  await assert.rejects(advanceLeagueRound(db,'123',args,transaction()),/LEAGUE_ADVANCE_CONFLICT/);
  assert.equal(sql.prepare("SELECT current_round AS r FROM efl_leagues WHERE id='apl'").get().r,3);
  assert.equal(sql.prepare("SELECT current_matchday AS r FROM efl_competitions WHERE id='league'").get().r,3);
 }finally{sql.close();}
});
test('missing future fixture, mismatched counters and stale replay fail closed',async()=>{
 for(const change of [
  "DELETE FROM efl_fixtures WHERE id='next'",
  "UPDATE efl_leagues SET current_round=2"
 ]){
  const {sql,db,transaction}=fixture();
  try{
   sql.exec(change);
   await assert.rejects(advanceLeagueRound(db,'123',args,transaction()),
    /LEAGUE_ADVANCE_CONFLICT|LEAGUE_ROUND_MISMATCH/);
   assert.notEqual(sql.prepare("SELECT current_matchday AS r FROM efl_competitions WHERE id='league'").get().r,4);
  }finally{sql.close();}
 }
});
test('banned and non-admin actors cannot mutate rounds',async()=>{
 const {sql,db,transaction}=fixture();
 try{
  await assert.rejects(advanceLeagueRound(db,'456',args,transaction()),/LEAGUE_ADVANCE_FORBIDDEN/);
  await assert.rejects(advanceLeagueRound(db,'789',args,transaction()),/LEAGUE_ADVANCE_FORBIDDEN/);
  await assert.rejects(advanceLeagueRound(db,'123 OR 1=1',args,transaction()),/AUTH_REQUIRED/);
  await assert.rejects(advanceLeagueRound(db,'123',{...args,nextRound:5},transaction()),/INVALID_ADVANCE_ROUND/);
  assert.equal(sql.prepare("SELECT current_round AS r FROM efl_leagues WHERE id='apl'").get().r,3);
 }finally{sql.close();}
});
