import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readTeamJoinQueue} from '../tgcloud/lib/teamsJoinQueue.js';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_admin INTEGER,is_banned INTEGER);
 CREATE TABLE efl_teams_catalog(id TEXT PRIMARY KEY,name TEXT);
 CREATE TABLE efl_team_join_requests(id TEXT PRIMARY KEY,team_id TEXT,user_id TEXT,
   status TEXT,created_at INTEGER);
 INSERT INTO efl_users VALUES('u1','123',0,0),('u2','456',0,0),
   ('admin','999',1,0),('banned','789',1,1);
 INSERT INTO efl_teams_catalog VALUES('t1','Alpha'),('t2','Beta');
 INSERT INTO efl_team_join_requests VALUES('r1','t1','u1','PENDING',100),
   ('r2','t2','u2','PENDING',200),('r3','t2','u1','APPROVED',300);
 `);
 return {sql,db:{
  async get(q,p={}){return sql.prepare(q).get(p)??null;},
  async all(q,p={}){return sql.prepare(q).all(p);}
 }};
}
test('TEAMS user queue returns only caller records, no other private identities',async()=>{
 const {sql,db}=fixture();
 try{
  const res=await readTeamJoinQueue(db,123);
  assert.equal(res.requests.length,2);
  assert.deepEqual(res.requests.map(x=>x.requestId),['r3','r1']);
  assert.doesNotMatch(JSON.stringify(res),/r2|u2/);
  const another=await readTeamJoinQueue(db,456);
  assert.equal(another.requests.length,1);
  assert.equal(another.requests[0].requestId,'r2');
  await assert.rejects(readTeamJoinQueue(db,123,{scope:'admin'}),/TEAMS_ADMIN_FORBIDDEN/);
 }finally{sql.close();}
});
test('admin sees pending only, with pagination and ban enforcement',async()=>{
 const {sql,db}=fixture();
 try{
  const page=await readTeamJoinQueue(db,999,{scope:'admin',limit:1});
  assert.equal(page.requests.length,1);
  assert.equal(page.requests[0].requestId,'r2');
  assert.equal(page.nextCursor,1);
  const last=await readTeamJoinQueue(db,999,{scope:'admin',limit:1,cursor:1});
  assert.equal(last.requests[0].requestId,'r1');
  assert.equal(last.nextCursor,null);
  await assert.rejects(readTeamJoinQueue(db,789,{scope:'admin'}),/TEAMS_QUEUE_FORBIDDEN/);
  await assert.rejects(readTeamJoinQueue(db,999,{scope:'admin',userId:'u1'}),/UNKNOWN_TEAMS_QUEUE_FIELD/);
 }finally{sql.close();}
});
