import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readUzeflifeRoundAudit} from '../tgcloud/lib/uzeflifeRoundAudit.js';

function seed(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_admin INTEGER,is_banned INTEGER);
 CREATE TABLE efl_uzeflife_state(id TEXT PRIMARY KEY,current_round INTEGER,status TEXT,name TEXT);
 CREATE TABLE efl_uzeflife_fixtures(id TEXT PRIMARY KEY,round INTEGER,bracket INTEGER,
  home TEXT,away TEXT,winner TEXT,home_score INTEGER,away_score INTEGER,
  penalty_home INTEGER,penalty_away INTEGER);
 INSERT INTO efl_users VALUES('admin','999',1,0),('user','123',0,0),('banned','789',1,1);
 INSERT INTO efl_uzeflife_state VALUES('uzeflife',3,'PLAYING','UZEFLIFE');
 INSERT INTO efl_uzeflife_fixtures VALUES('f1',3,1,'A','B',NULL,NULL,NULL,NULL,NULL),
 ('f2',3,2,'C','D','C',2,1,NULL,NULL),
 ('f3',3,3,'','E',NULL,NULL,NULL,NULL,NULL),
 ('f4',2,1,'A','D','A',1,0,NULL,NULL);
 `);
 return {sql,db:{
  async get(q,p={}){return sql.prepare(q).get(p)??null;},
  async all(q,p={}){return sql.prepare(q).all(p);}
 }};
}
test('round audit reads existing rounds without changing or advancing matches',async()=>{
 const {sql,db}=seed();
 try{
  const audit=await readUzeflifeRoundAudit(db,999,{limit:2});
  assert.equal(audit.round,3);
  assert.equal(audit.format,'existing-rounds');
  assert.deepEqual(audit.stats,{total:3,completed:1,unresolved:2,incompleteOpponents:1});
  assert.equal(audit.fixtures.length,2);
  assert.equal(audit.nextCursor,2);
  assert.equal((await readUzeflifeRoundAudit(db,999,{cursor:2})).fixtures.length,1);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM efl_uzeflife_fixtures').get().n,4);
  assert.equal(sql.prepare("SELECT current_round AS r FROM efl_uzeflife_state WHERE id='uzeflife'").get().r,3);
 }finally{sql.close();}
});
test('non-admins and banned accounts cannot inspect private round audit',async()=>{
 const {sql,db}=seed();
 try{
  await assert.rejects(readUzeflifeRoundAudit(db,123),/UZEFLIFE_ADMIN_FORBIDDEN/);
  await assert.rejects(readUzeflifeRoundAudit(db,789),/UZEFLIFE_ADMIN_FORBIDDEN/);
  await assert.rejects(readUzeflifeRoundAudit(db,999,{round:100}),/INVALID_UZEFLIFE_AUDIT/);
  await assert.rejects(readUzeflifeRoundAudit(db,999,{limit:1000}),/INVALID_UZEFLIFE_LIMIT/);
 }finally{sql.close();}
});
