import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readDomainOperationsAudit} from '../tgcloud/lib/domainOperationsAudit.js';
import {handleReadOnlyBotCommand} from '../tgcloud/lib/readOnlyBotCommands.js';

function seededDb(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_admin INTEGER,is_banned INTEGER);
 CREATE TABLE efl_seasons(id TEXT PRIMARY KEY,name TEXT,is_active INTEGER,created_at INTEGER);
 CREATE TABLE efl_leagues(id TEXT PRIMARY KEY,season_id TEXT,status TEXT);
 CREATE TABLE efl_fixtures(id TEXT PRIMARY KEY,season_id TEXT,status TEXT);
 CREATE TABLE efl_competitions(id TEXT PRIMARY KEY,season_id TEXT,type TEXT,status TEXT);
 CREATE TABLE efl_disputes(id TEXT PRIMARY KEY,season_id TEXT,status TEXT);
 CREATE TABLE efl_teams_catalog(id TEXT PRIMARY KEY,unresolved_member_count INTEGER);
 CREATE TABLE efl_team_join_requests(id TEXT PRIMARY KEY,status TEXT);
 CREATE TABLE efl_uzeflife_state(id TEXT PRIMARY KEY,current_round INTEGER,participants_count INTEGER,matches_count INTEGER,status TEXT);
 CREATE TABLE efl_uzeflife_fixtures(id TEXT PRIMARY KEY,round INTEGER,winner TEXT);
 CREATE TABLE efl_notifications(id TEXT PRIMARY KEY,is_read INTEGER);
 INSERT INTO efl_users VALUES('admin','123',1,0),('user','456',0,0),('banned','789',1,1);
 INSERT INTO efl_seasons VALUES('s1','Old',0,1),('s2','Season 2',1,2);
 INSERT INTO efl_leagues VALUES('l1','s1','ACTIVE'),('l2','s2','ACTIVE'),('l3','s2','CLOSED');
 INSERT INTO efl_fixtures VALUES('f1','s2','CONFIRMED'),('f2','s2','SCHEDULED'),('f3','s1','SCHEDULED');
 INSERT INTO efl_competitions VALUES('c1','s2','LEAGUE','ACTIVE'),('c2','s2','CUP','ACTIVE'),('c3','s1','CUP','ACTIVE');
 INSERT INTO efl_disputes VALUES('d1','s2','OPEN'),('d2','s2','RESOLVED');
 INSERT INTO efl_teams_catalog VALUES('team1',2),('team2',0);
 INSERT INTO efl_team_join_requests VALUES('r1','PENDING'),('r2','APPROVED');
 INSERT INTO efl_uzeflife_state VALUES('uzeflife',4,242,300,'RUNNING');
 INSERT INTO efl_uzeflife_fixtures VALUES('uf1',4,'p1'),('uf2',4,NULL),('uf3',3,'p2');
 INSERT INTO efl_notifications VALUES('n1',0),('n2',1);
 `);
 return {sql,db:{get:async(q,p={})=>sql.prepare(q).get(p)??null}};
}
test('domain audit aggregates current season, private TEAMS, UZEFLIFE and notifications',async()=>{
 const {sql,db}=seededDb();
 try{
  const r=await readDomainOperationsAudit(db,'123');
  assert.equal(r.readOnly,true);
  assert.equal(r.season.name,'Season 2');
  assert.deepEqual(r.leagues,{total:2,open:1});
  assert.deepEqual(r.fixtures,{total:2,confirmed:1,unresolved:1});
  assert.deepEqual(r.cups,{total:1,unfinished:1});
  assert.deepEqual(r.disputes,{unresolved:1});
  assert.deepEqual(r.teams,{total:2,unresolvedMembers:2,pendingRequests:1});
  assert.equal(r.uzeflife.currentRound,4);
  assert.equal(r.uzeflife.currentRoundUnresolved,1);
  assert.deepEqual(r.notifications,{total:2,unread:1});
  assert.ok(!JSON.stringify(r).includes('p1'));
  assert.ok(!JSON.stringify(r).includes('admin'));
 }finally{sql.close();}
});
test('audit fails closed for unauthorized identities and injected request fields',async()=>{
 const {sql,db}=seededDb();
 try{
  await assert.rejects(readDomainOperationsAudit(db,'456'),/DOMAIN_AUDIT_FORBIDDEN/);
  await assert.rejects(readDomainOperationsAudit(db,'789'),/DOMAIN_AUDIT_FORBIDDEN/);
  await assert.rejects(readDomainOperationsAudit(db,'999'),/DOMAIN_AUDIT_FORBIDDEN/);
  await assert.rejects(readDomainOperationsAudit(db,'123 OR 1=1'),/AUTH_REQUIRED/);
  await assert.rejects(readDomainOperationsAudit(db,'123',{seasonId:'s1'}),/INVALID_DOMAIN_AUDIT_REQUEST/);
  await assert.rejects(readDomainOperationsAudit(db,'123',[]),/INVALID_DOMAIN_AUDIT_REQUEST/);
 }finally{sql.close();}
});
test('no active season remains safely empty without showing past season data',async()=>{
 const {sql,db}=seededDb();
 try{
  sql.exec('UPDATE efl_seasons SET is_active=0');
  const r=await readDomainOperationsAudit(db,'123');
  assert.equal(r.season,null);
  assert.equal(r.leagues.total,0);
  assert.equal(r.fixtures.total,0);
  assert.equal(r.cups.total,0);
  assert.equal(r.teams.total,2);
 }finally{sql.close();}
});

test('private admin command reveals only aggregate counts',async()=>{
 const {sql,db}=seededDb();
 const msg=id=>({text:'/audit',chat:{id,type:'private'},from:{id,is_bot:false}});
 try{
  const admin=await handleReadOnlyBotCommand(db,msg(123));
  assert.match(admin.text,/Serverless admin auditi/);
  assert.ok(admin.text.includes('sinov)\\nMavsum:'));
  assert.match(admin.text,/UZEFLIFE joriy turi: 1\/2/);
  assert.doesNotMatch(admin.text,/p1|team1|u1/);
  const other=await handleReadOnlyBotCommand(db,msg(456));
  assert.match(other.text,/faqat administrator/);
  const banned=await handleReadOnlyBotCommand(db,msg(789));
  assert.match(banned.text,/cheklangan/);
  assert.equal(await handleReadOnlyBotCommand(db,{...msg(123),chat:{id:123,type:'group'}}),null);
 }finally{sql.close();}
});
