import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readCompetitionDetail} from '../tgcloud/lib/competitionDetail.js';

function seed(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_competitions(id TEXT PRIMARY KEY,season_id TEXT,league_id TEXT,
   name TEXT,type TEXT,status TEXT,schedule_mode TEXT,current_matchday INTEGER,is_matchday_open INTEGER);
 CREATE TABLE efl_clubs(id TEXT PRIMARY KEY,name TEXT,short_name TEXT,logo_url TEXT);
 CREATE TABLE efl_competition_participants(id TEXT PRIMARY KEY,competition_id TEXT,
   season_id TEXT,club_id TEXT,seed_number INTEGER,owner_user_id TEXT);
 CREATE TABLE efl_fixtures(id TEXT PRIMARY KEY,competition_id TEXT,season_id TEXT,
   round INTEGER,status TEXT,home_club_id TEXT,away_club_id TEXT,home_score INTEGER,away_score INTEGER);
 INSERT INTO efl_competitions VALUES('cup1','season1','league1','Ispaniya kubogi','DOMESTIC_CUP','ACTIVE','BRACKET',3,1);
 INSERT INTO efl_clubs VALUES('c1','Arsenal','ARS',NULL),('c2','Chelsea','CHE',NULL);
 INSERT INTO efl_competition_participants VALUES('p1','cup1','season1','c1',1,'secret-owner'),
   ('p2','cup1','season1','c2',2,'another-owner');
 INSERT INTO efl_fixtures VALUES('f1','cup1','season1',3,'SCHEDULED','c1',NULL,NULL,NULL);
 `);
 return {sql,db:{
  async get(q,p={}){return sql.prepare(q).get(p)??null;},
  async all(q,p={}){return sql.prepare(q).all(p);}
 }};
}
test('cup catalog preserves TBD opponents, excludes private owner records',async()=>{
 const {sql,db}=seed();
 try{
  const result=await readCompetitionDetail(db,{seasonId:'season1',competitionId:'cup1'});
  assert.equal(result.competition.name,'Ispaniya kubogi');
  assert.equal(result.participants.length,2);
  assert.equal(result.fixtures[0].awayClubId,null);
  assert.equal(JSON.stringify(result).includes('secret-owner'),false);
  await assert.rejects(readCompetitionDetail(db,{seasonId:'season2',competitionId:'cup1'}),/COMPETITION_UNAVAILABLE/);
  await assert.rejects(readCompetitionDetail(db,{seasonId:'season1',competitionId:'cup1',ownerUserId:'u1'}),/UNKNOWN_DETAIL_FIELD/);
 }finally{sql.close();}
});
