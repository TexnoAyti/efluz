import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {getAdminOverview} from '../tgcloud/lib/adminOverview.js';

function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_admin INTEGER,is_banned INTEGER);
 CREATE TABLE efl_seasons(id TEXT PRIMARY KEY);
 CREATE TABLE efl_leagues(id TEXT PRIMARY KEY);
 CREATE TABLE efl_clubs(id TEXT PRIMARY KEY);
 CREATE TABLE efl_club_occupancies(id TEXT PRIMARY KEY,status TEXT);
 CREATE TABLE efl_competitions(id TEXT PRIMARY KEY);
 CREATE TABLE efl_fixtures(id TEXT PRIMARY KEY);
 CREATE TABLE efl_result_submissions(id TEXT PRIMARY KEY);
 CREATE TABLE efl_disputes(id TEXT PRIMARY KEY,status TEXT);
 CREATE TABLE efl_notifications(id TEXT PRIMARY KEY);
 INSERT INTO efl_users VALUES('u1','123',1,0),('u2','456',0,0),('u3','789',1,1);
 INSERT INTO efl_fixtures VALUES('f1'),('f2');
 INSERT INTO efl_disputes VALUES('d1','OPEN'),('d2','RESOLVED');
 INSERT INTO efl_club_occupancies VALUES('o1','ACTIVE'),('o2','RELEASED');
 `);
 return {sql,db:{async get(q,p={}){return sql.prepare(q).get(p)??null;}}};
}
test('only signed, unbanned admin sees restricted operational counts',async()=>{
 const {sql,db}=setup();
 try{
  const result=await getAdminOverview(db,'123');
  assert.equal(result.stats.fixtures,2);
  assert.equal(result.stats.disputes,1);
  assert.equal(result.stats.occupancies,1);
  assert.equal(result.stats.users,3);
  assert.equal(Object.hasOwn(result,'users'),false);
  await assert.rejects(getAdminOverview(db,'456'),/ADMIN_FORBIDDEN/);
  await assert.rejects(getAdminOverview(db,'789'),/ADMIN_FORBIDDEN/);
  await assert.rejects(getAdminOverview(db,'999'),/ADMIN_FORBIDDEN/);
  await assert.rejects(getAdminOverview(db,'123 OR 1=1'),/AUTH_REQUIRED/);
 }finally{sql.close();}
});
