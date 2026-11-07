import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readPrivateTeamRoster} from '../tgcloud/lib/teamsPrivateRoster.js';
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_admin INTEGER,is_banned INTEGER);
 CREATE TABLE efl_teams_catalog(id TEXT PRIMARY KEY,name TEXT,owner_user_id TEXT,
   admin_user_id TEXT,unresolved_member_count INTEGER);
 CREATE TABLE efl_team_members(id TEXT PRIMARY KEY,team_id TEXT,user_id TEXT,
   member_name TEXT,status TEXT);
 CREATE TABLE efl_team_join_requests(id TEXT PRIMARY KEY,team_id TEXT,user_id TEXT,status TEXT);
 INSERT INTO efl_users VALUES ('captain','777',0,0),('member','123',0,0),
  ('another','456',0,0),('admin','999',1,0),('banned','789',1,1);
 INSERT INTO efl_teams_catalog VALUES('team1','Alpha','captain',NULL,1);
 INSERT INTO efl_team_members VALUES('m1','team1','member','Known player','LINKED'),
  ('m2','team1',NULL,'Unmatched legacy member','UNRESOLVED');
 `);
 return {sql,db:{
  async get(q,p={}){return sql.prepare(q).get(p)??null;},
  async all(q,p={}){return sql.prepare(q).all(p);}
 }};
}
test('unaffiliated user is forbidden; linked member sees only linked names',async()=>{
 const {sql,db}=setup();
 try{
  await assert.rejects(readPrivateTeamRoster(db,456,{teamId:'team1'}),/TEAMS_ROSTER_FORBIDDEN/);
  await assert.rejects(readPrivateTeamRoster(db,789,{teamId:'team1'}),/TEAMS_ROSTER_FORBIDDEN/);
  const result=await readPrivateTeamRoster(db,123,{teamId:'team1'});
  assert.equal(result.members.length,1);
  assert.equal(result.members[0].name,'Known player');
  assert.doesNotMatch(JSON.stringify(result),/Unmatched|unresolvedMembers|m1|m2/);
  assert.doesNotMatch(JSON.stringify(result),/ownerId|managerId|memberId|userId/);
 }finally{sql.close();}
});
test('captain and global admin may privately reconcile unresolved member entries',async()=>{
 const {sql,db}=setup();
 try{
  const captain=await readPrivateTeamRoster(db,777,{teamId:'team1',limit:1});
  assert.equal(captain.members.length,1);
  assert.equal(captain.nextCursor,1);
  assert.equal(captain.unresolvedMembers,1);
  const admin=await readPrivateTeamRoster(db,999,{teamId:'team1',cursor:1});
  assert.equal(admin.members.length,1);
  assert.equal(admin.members[0].status,'UNRESOLVED');
  await assert.rejects(readPrivateTeamRoster(db,777,{teamId:'team1',userId:'member'}),
   /UNKNOWN_TEAMS_ROSTER_FIELD/);
 }finally{sql.close();}
});
test('approved request permits limited roster read but does not disclose raw source IDs',async()=>{
 const {sql,db}=setup();
 try{
  sql.exec("INSERT INTO efl_team_join_requests VALUES('r1','team1','another','APPROVED')");
  const result=await readPrivateTeamRoster(db,456,{teamId:'team1'});
  assert.equal(result.members.length,1);
  assert.doesNotMatch(JSON.stringify(result),/Unmatched legacy member/);
 }finally{sql.close();}
});
