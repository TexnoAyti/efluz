import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {validateMyFixturesQuery,readMyFixtures} from '../tgcloud/lib/myFixturesRead.js';
function source(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_fixtures(id TEXT PRIMARY KEY,season_id TEXT,competition_id TEXT,
 league_id TEXT,round INTEGER,home_club_id TEXT,away_club_id TEXT,
 home_score INTEGER,away_score INTEGER,status TEXT,confirmation_status TEXT,
 scheduled_at INTEGER,played_at INTEGER);
 CREATE TABLE efl_club_occupancies(id TEXT PRIMARY KEY,season_id TEXT,
 telegram_id TEXT,status TEXT,club_id TEXT);
 INSERT INTO efl_club_occupancies VALUES
 ('o1','legacy-season','111','ACTIVE','club-a'),
 ('o2','legacy-season','222','ACTIVE','club-b'),
 ('o3','legacy-season','333','RELEASED','club-c');
 INSERT INTO efl_fixtures VALUES
 ('f1','legacy-season','league','l',1,'club-a','club-b',2,1,'CONFIRMED','CONFIRMED',0,100),
 ('f2','legacy-season','cup','l',2,'club-c','club-b',NULL,NULL,'SCHEDULED','NONE',0,NULL),
 ('f3','other-season','league','l',1,'club-a','club-b',NULL,NULL,'SCHEDULED','NONE',0,NULL);
 `);
 return {sql,db:{async all(q,p={}){return sql.prepare(q).all(p);}}};
}
test('imports legacy season ID and shows only active owner fixtures',async()=>{
 const {sql,db}=source();
 try{
  const mine=await readMyFixtures(db,111,{seasonId:'legacy-season'});
  assert.equal(mine.fixtures.length,1);
  assert.equal(mine.fixtures[0].id,'f1');
  const opponent=await readMyFixtures(db,222,{seasonId:'legacy-season'});
  assert.equal(opponent.fixtures.length,2);
  assert.equal((await readMyFixtures(db,333,{seasonId:'legacy-season'})).fixtures.length,0);
  assert.equal((await readMyFixtures(db,111,{seasonId:'other-season'})).fixtures.length,0);
 }finally{sql.close();}
});
test('rejects user-chosen identity, bad cursors and invalid season',()=>{
 assert.equal(validateMyFixturesQuery({seasonId:'s1'}).seasonId,'s1');
 assert.throws(()=>validateMyFixturesQuery({seasonId:'s1',telegramId:'222'}),/INVALID_FIXTURE_REQUEST/);
 assert.throws(()=>validateMyFixturesQuery({seasonId:'!invalid'}),/INVALID_SEASON/);
 assert.throws(()=>validateMyFixturesQuery({seasonId:'s1',cursor:-1}),/INVALID_CURSOR/);
});
