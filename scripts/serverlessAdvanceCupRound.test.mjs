import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {advanceCupRound,validateAdvanceRound} from '../tgcloud/lib/advanceCupRound.js';

function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_admin INTEGER,is_banned INTEGER);
 CREATE TABLE efl_competitions(id TEXT PRIMARY KEY,season_id TEXT,league_id TEXT,
  type TEXT,status TEXT,current_matchday INTEGER,is_matchday_open INTEGER);
 CREATE TABLE efl_fixtures(id TEXT PRIMARY KEY,season_id TEXT,competition_id TEXT,
  round INTEGER,status TEXT);
 CREATE TABLE efl_disputes(id TEXT PRIMARY KEY,fixture_id TEXT,status TEXT);
 INSERT INTO efl_users VALUES('admin','123',1,0),('user','456',0,0),('banned','789',1,1);
 INSERT INTO efl_competitions VALUES
 ('cup','season',NULL,'CUP','ACTIVE',2,1),
 ('league','season','l1','LEAGUE','ACTIVE',2,1);
 INSERT INTO efl_fixtures VALUES
 ('f1','season','cup',2,'SCHEDULED'),
 ('f2','season','cup',3,'SCHEDULED'),
 ('f3','season','league',3,'SCHEDULED');
 `);
 const db={get:async(q,p={})=>sql.prepare(q).get(p)??null,
  run:async(q,p={})=>sql.prepare(q).run(p)};
 return {sql,db};
}
const request={competitionId:'cup',expectedRound:2,nextRound:3};
test('cup advance uses existing next fixture and preserves unresolved old results',async()=>{
 const {sql,db}=setup();
 try{
  const r=await advanceCupRound(db,'123',request);
  assert.equal(r.currentRound,3);
  assert.equal(r.oldFixturesPreserved,true);
  assert.equal(r.notificationsQueued,false);
  assert.equal(sql.prepare("SELECT status FROM efl_fixtures WHERE id='f1'").get().status,'SCHEDULED');
  assert.equal(sql.prepare("SELECT current_matchday AS round FROM efl_competitions WHERE id='cup'").get().round,3);
  assert.equal((await advanceCupRound(db,'123',request)).replayed,true);
 }finally{sql.close();}
});
test('unresolved dispute blocks cup advancement without modifying the database',async()=>{
 const {sql,db}=setup();
 try{
  sql.exec("INSERT INTO efl_disputes VALUES('d1','f1','OPEN')");
  await assert.rejects(advanceCupRound(db,'123',request),/ROUND_ADVANCE_CONFLICT_OR_DISPUTE/);
  assert.equal(sql.prepare("SELECT current_matchday AS n FROM efl_competitions WHERE id='cup'").get().n,2);
 }finally{sql.close();}
});
test('no next round never invents fixtures or advances a round',async()=>{
 const {sql,db}=setup();
 try{
  sql.exec("DELETE FROM efl_fixtures WHERE id='f2'");
  await assert.rejects(advanceCupRound(db,'123',request),/ROUND_ADVANCE_CONFLICT_OR_DISPUTE/);
  assert.equal(sql.prepare("SELECT current_matchday AS n FROM efl_competitions WHERE id='cup'").get().n,2);
 }finally{sql.close();}
});
test('league round requires atomic multi-table transaction; never partially advances',async()=>{
 const {sql,db}=setup();
 try{
  await assert.rejects(advanceCupRound(db,'123',{...request,competitionId:'league'}),/ROUND_ADVANCE_LEAGUE_REQUIRES_TRANSACTION/);
  assert.equal(sql.prepare("SELECT current_matchday AS n FROM efl_competitions WHERE id='league'").get().n,2);
 }finally{sql.close();}
});
test('admin rights and strict idempotency prevent unauthorized or stale updates',async()=>{
 const {sql,db}=setup();
 try{
  await assert.rejects(advanceCupRound(db,'456',request),/ROUND_ADVANCE_FORBIDDEN/);
  await assert.rejects(advanceCupRound(db,'789',request),/ROUND_ADVANCE_FORBIDDEN/);
  await assert.rejects(advanceCupRound(db,'123 OR 1=1',request),/AUTH_REQUIRED/);
  assert.throws(()=>validateAdvanceRound({...request,nextRound:4}),/INVALID_ADVANCE_ROUND/);
  assert.throws(()=>validateAdvanceRound({...request,telegramId:'456'}),/INVALID_ADVANCE_ROUND/);
  assert.throws(()=>validateAdvanceRound({...request,competitionId:"cup' OR 1=1"}),/INVALID_ADVANCE_ROUND/);
  sql.exec("UPDATE efl_competitions SET current_matchday=7 WHERE id='cup'");
  await assert.rejects(advanceCupRound(db,'123',request),/ROUND_ADVANCE_STALE_ROUND/);
 }finally{sql.close();}
});
