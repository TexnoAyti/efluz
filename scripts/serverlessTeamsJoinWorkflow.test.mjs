import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {submitTeamJoin,approveTeamJoin} from '../tgcloud/lib/teamsJoinWorkflow.js';

function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT UNIQUE,
   is_admin INTEGER NOT NULL,is_banned INTEGER NOT NULL);
 CREATE TABLE efl_teams_catalog(id TEXT PRIMARY KEY,membership_required INTEGER NOT NULL,owner_user_id TEXT,admin_user_id TEXT);
 CREATE TABLE efl_team_join_requests(id TEXT PRIMARY KEY,team_id TEXT NOT NULL,
   user_id TEXT NOT NULL,telegram_id TEXT NOT NULL,status TEXT NOT NULL,
   created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
 CREATE UNIQUE INDEX one_join_per_team ON efl_team_join_requests(team_id,user_id);
 CREATE UNIQUE INDEX one_approved_team ON efl_team_join_requests(user_id)
   WHERE status='APPROVED';
 INSERT INTO efl_users VALUES ('u1','123',0,0),('u2','456',0,0),
   ('admin','999',1,0),('banned','789',0,1),('captain','777',0,0),('manager','888',0,0);
 INSERT INTO efl_teams_catalog VALUES('team1',0,'captain','manager'),('team2',0,'admin',NULL),('restricted',1,'captain',NULL);
 `);
 return {sql,db:{
  async get(q,p={}){return sql.prepare(q).get(p)??null;},
  async run(q,p={}){sql.prepare(q).run(p);return [];}
 }};
}
test('request requires signed unbanned owner, and replay cannot change id',async()=>{
 const {sql,db}=setup();
 try{
  const input={teamId:'team1',requestId:'request-0001'};
  const first=await submitTeamJoin(db,{id:'u1',telegramId:'123'},input);
  assert.equal(first.status,'PENDING');
  await submitTeamJoin(db,{id:'u1',telegramId:'123'},input);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM efl_team_join_requests').get().n,1);
  await assert.rejects(submitTeamJoin(db,{id:'u1',telegramId:'123'},
   {...input,requestId:'request-0002'}),/TEAMS_JOIN_CONFLICT/);
  await assert.rejects(submitTeamJoin(db,{id:'u2',telegramId:'123'},
   {teamId:'team2',requestId:'request-0003'}),/TEAMS_JOIN_FORBIDDEN/);
  await assert.rejects(submitTeamJoin(db,{id:'banned',telegramId:'789'},
   {teamId:'team1',requestId:'request-0004'}),/TEAMS_JOIN_FORBIDDEN/);
 }finally{sql.close();}
});
test('admin approval enforces one team per player and explicit role checks',async()=>{
 const {sql,db}=setup();
 try{
  await submitTeamJoin(db,{id:'u1',telegramId:'123'},
   {teamId:'team1',requestId:'request-0001'});
  await submitTeamJoin(db,{id:'u1',telegramId:'123'},
   {teamId:'team2',requestId:'request-0002'});
  await assert.rejects(approveTeamJoin(db,{telegramId:'456'},
   {requestId:'request-0001'}),/TEAMS_ADMIN_FORBIDDEN/);
  assert.equal((await approveTeamJoin(db,{telegramId:'999'},
   {requestId:'request-0001'})).status,'APPROVED');
  assert.equal((await approveTeamJoin(db,{telegramId:'999'},
   {requestId:'request-0001'})).replayed,true);
  await assert.rejects(approveTeamJoin(db,{telegramId:'999'},
   {requestId:'request-0002'}),/TEAMS_JOIN_APPROVAL_CONFLICT/);
  const approved=sql.prepare("SELECT count(*) AS n FROM efl_team_join_requests WHERE status='APPROVED'").get();
  assert.equal(approved.n,1);
 }finally{sql.close();}
});
test('verified captain and assigned team manager may approve only their team',async()=>{
 const {sql,db}=setup();
 try{
  await submitTeamJoin(db,{id:'u1',telegramId:'123'},
   {teamId:'team1',requestId:'request-0001'});
  await submitTeamJoin(db,{id:'u2',telegramId:'456'},
   {teamId:'team2',requestId:'request-0002'});
  assert.equal((await approveTeamJoin(db,{telegramId:'777'},
   {requestId:'request-0001'})).status,'APPROVED');
  await assert.rejects(approveTeamJoin(db,{telegramId:'777'},
   {requestId:'request-0002'}),/TEAMS_ADMIN_FORBIDDEN/);
  // Manager of team1 can operate independently of global admin privileges.
  const request=await submitTeamJoin(db,{id:'u2',telegramId:'456'},
   {teamId:'team1',requestId:'request-0003'});
  assert.equal(request.status,'PENDING');
  const approved=await approveTeamJoin(db,{telegramId:'888'},
   {requestId:'request-0003'});
  assert.equal(approved.status,'APPROVED');
 }finally{sql.close();}
});
test('mandatory group membership and bans remain fail closed',async()=>{
 const {sql,db}=setup();
 try{
  await assert.rejects(submitTeamJoin(db,{id:'u1',telegramId:'123'},
   {teamId:'restricted',requestId:'request-0001'}),/TEAMS_MEMBERSHIP_GATE_PENDING/);
  await submitTeamJoin(db,{id:'u1',telegramId:'123'},
   {teamId:'team1',requestId:'request-0001'});
  sql.exec("UPDATE efl_users SET is_banned=1 WHERE id='u1'");
  await assert.rejects(approveTeamJoin(db,{telegramId:'999'},
   {requestId:'request-0001'}),/TEAMS_JOIN_APPROVAL_CONFLICT/);
  assert.equal(sql.prepare("SELECT status FROM efl_team_join_requests WHERE id='request-0001'").get().status,'PENDING');
 }finally{sql.close();}
});
