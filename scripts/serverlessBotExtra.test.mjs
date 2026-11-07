import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleReadOnlyBotCommand} from '../tgcloud/lib/readOnlyBotCommands.js';
const msg=(id,text,type='private')=>({text,chat:{id,type},from:{id,is_bot:false}});
function create(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_banned INTEGER);
 CREATE TABLE efl_uzeflife_state(id TEXT PRIMARY KEY,name TEXT,status TEXT,format TEXT,
 current_round INTEGER,total_rounds INTEGER,round_hours INTEGER,
 participants_count INTEGER,matches_count INTEGER,source_revision INTEGER);
 CREATE TABLE efl_teams_catalog(id TEXT PRIMARY KEY,name TEXT,logo_url TEXT,
 member_count INTEGER,membership_required INTEGER);
 CREATE TABLE efl_club_occupancies(id TEXT PRIMARY KEY,season_id TEXT,
 user_id TEXT,telegram_id TEXT,status TEXT,joined_at INTEGER,club_id TEXT);
 CREATE TABLE efl_fixtures(id TEXT PRIMARY KEY,season_id TEXT,competition_id TEXT,
 league_id TEXT,round INTEGER,home_club_id TEXT,away_club_id TEXT,
 home_score INTEGER,away_score INTEGER,status TEXT,confirmation_status TEXT,
 scheduled_at INTEGER,played_at INTEGER);
 CREATE TABLE efl_notifications(id TEXT PRIMARY KEY,user_id TEXT,title TEXT,is_read INTEGER,
 created_at INTEGER);
 INSERT INTO efl_users VALUES('u1','123',0),('u2','456',0),('banned','789',1);
 INSERT INTO efl_uzeflife_state VALUES
 ('uzeflife','UZEFLIFE','PLAYING','CUSTOM',3,5,24,242,120,2);
 INSERT INTO efl_teams_catalog VALUES('team1','Alpha',NULL,3,0);
 INSERT INTO efl_club_occupancies VALUES('o1','s1','u1','123','ACTIVE',100,'c1'),
 ('o2','s1','u2','456','ACTIVE',100,'c2');
 INSERT INTO efl_fixtures VALUES('f1','s1','comp1','l1',3,'c1','c2',2,1,'CONFIRMED','CONFIRMED',100,200);
 INSERT INTO efl_notifications VALUES('n1','u1','Yangi tur',0,100),
 ('n2','u2','Maxfiy xabar',0,100);
 `);
 return {sql,db:{
  async get(q,p={}){return sql.prepare(q).get(p)??null;},
  async all(q,p={}){return sql.prepare(q).all(p);}
 }};
}
test('new private bot commands serve existing rounds and public TEAMS without leaking identities',async()=>{
 const {sql,db}=create();
 try{
  const round=await handleReadOnlyBotCommand(db,msg(123,'/uzeflife'));
  assert.match(round.text,/Joriy tur: 3/);
  assert.doesNotMatch(round.text,/pley-off|playoff/i);
  const team=await handleReadOnlyBotCommand(db,msg(123,'/teams'));
  assert.match(team.text,/Alpha/);
  assert.doesNotMatch(team.text,/u1|u2|telegram/);
  const owner=await handleReadOnlyBotCommand(db,msg(123,'/myfixtures'));
  assert.match(owner.text,/Tur 3: CONFIRMED \(2:1\)/);
  const inbox=await handleReadOnlyBotCommand(db,msg(123,'/inbox'));
  assert.match(inbox.text,/Yangi tur/);
  assert.doesNotMatch(inbox.text,/Maxfiy xabar/);
  assert.equal(await handleReadOnlyBotCommand(db,msg(123,'/inbox','supergroup')),null);
  assert.equal(await handleReadOnlyBotCommand(db,msg(123,'/inbox@anotherbot')),null);
 }finally{sql.close();}
});
test('banned user receives no private cross-domain data',async()=>{
 const {sql,db}=create();
 try{
  for(const command of ['/uzeflife','/teams','/myfixtures','/inbox']){
   const result=await handleReadOnlyBotCommand(db,msg(789,command));
   assert.match(result.text,/cheklangan/);
   assert.doesNotMatch(result.text,/UZEFLIFE|Alpha|Yangi tur/);
  }
 }finally{sql.close();}
});
