import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {finalizeUzeflifeResult,validateUzeflifeDecision} from '../tgcloud/lib/uzeflifeResultAdmin.js';

function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_admin INTEGER,is_banned INTEGER);
 CREATE TABLE efl_uzeflife_state(id TEXT PRIMARY KEY,status TEXT,current_round INTEGER);
 CREATE TABLE efl_uzeflife_fixtures(id TEXT PRIMARY KEY,round INTEGER,
   home TEXT,away TEXT,winner TEXT,home_score INTEGER,away_score INTEGER,
   penalty_home INTEGER,penalty_away INTEGER);
 INSERT INTO efl_users VALUES('admin','123',1,0),('user','456',0,0),('banned','789',1,1);
 INSERT INTO efl_uzeflife_state VALUES('uzeflife','ACTIVE',3);
 INSERT INTO efl_uzeflife_fixtures VALUES('m1',3,'Arsenal FC','Chelsea FC',NULL,NULL,NULL,NULL,NULL);
 INSERT INTO efl_uzeflife_fixtures VALUES('m2',2,'Barcelona','Madrid',NULL,NULL,NULL,NULL,NULL);
 `);
 return {sql,db:{
  async get(q,p={}){return sql.prepare(q).get(p)??null;},
  async run(q,p={}){sql.prepare(q).run(p);return [];}
 }};
}
test('only admin can finalize once and identical replay is safe',async()=>{
 const {sql,db}=setup();
 try{
  const data={fixtureId:'m1',homeScore:2,awayScore:1};
  await assert.rejects(finalizeUzeflifeResult(db,'456',data),/UZEFLIFE_ADMIN_FORBIDDEN/);
  await assert.rejects(finalizeUzeflifeResult(db,'789',data),/UZEFLIFE_ADMIN_FORBIDDEN/);
  const first=await finalizeUzeflifeResult(db,'123',data);
  assert.equal(first.winner,'Arsenal FC');
  assert.equal(first.replayed,false);
  const replay=await finalizeUzeflifeResult(db,'123',data);
  assert.equal(replay.replayed,true);
  await assert.rejects(finalizeUzeflifeResult(db,'123',
   {...data,awayScore:3}),/UZEFLIFE_RESULT_CONFLICT/);
  const row=sql.prepare("SELECT home_score,away_score FROM efl_uzeflife_fixtures WHERE id='m1'").get();
  assert.equal(row.home_score,2);
  assert.equal(row.away_score,1);
 }finally{sql.close();}
});
test('a draw requires an explicit winner; closed round never changes',async()=>{
 const {sql,db}=setup();
 try{
  assert.throws(()=>validateUzeflifeDecision({fixtureId:'m1',homeScore:1,awayScore:1}),
   /UZEFLIFE_DRAW_NEEDS_WINNER/);
  await assert.rejects(finalizeUzeflifeResult(db,'123',
   {fixtureId:'m2',homeScore:3,awayScore:1}),/UZEFLIFE_ROUND_LOCKED/);
  const match=await finalizeUzeflifeResult(db,'123',
   {fixtureId:'m1',homeScore:1,awayScore:1,penaltyHome:3,penaltyAway:4});
  assert.equal(match.winner,'Chelsea FC');
  assert.equal(sql.prepare("SELECT winner FROM efl_uzeflife_fixtures WHERE id='m2'").get().winner,null);
 }finally{sql.close();}
});
test('write-time admin ban, state closure and races fail closed',async()=>{
 const {sql,db}=setup();
 try{
  const delegate={...db,async run(q,p){
    sql.exec("UPDATE efl_users SET is_banned=1 WHERE id='admin'");
    return db.run(q,p);
  }};
  await assert.rejects(finalizeUzeflifeResult(delegate,'123',
   {fixtureId:'m1',homeScore:2,awayScore:0}),/UZEFLIFE_WRITE_CONFLICT/);
  sql.exec("UPDATE efl_users SET is_banned=0 WHERE id='admin'");
  const closed={...db,async run(q,p){
    sql.exec("UPDATE efl_uzeflife_state SET status='CLOSED'");
    return db.run(q,p);
  }};
  await assert.rejects(finalizeUzeflifeResult(closed,'123',
   {fixtureId:'m1',homeScore:2,awayScore:0}),/UZEFLIFE_WRITE_CONFLICT/);
  assert.equal(sql.prepare("SELECT winner FROM efl_uzeflife_fixtures WHERE id='m1'").get().winner,null);
 }finally{sql.close();}
});
