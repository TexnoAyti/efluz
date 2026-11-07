import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleReadOnlyBotCommand,parseCommand} from '../tgcloud/lib/readOnlyBotCommands.js';

function seededDb(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_banned INTEGER);
 CREATE TABLE efl_seasons(id TEXT PRIMARY KEY,name TEXT,created_at INTEGER);
 CREATE TABLE efl_leagues(id TEXT PRIMARY KEY,season_id TEXT,name TEXT,sort_order INTEGER);
 CREATE TABLE efl_clubs(id TEXT PRIMARY KEY,league_id TEXT,name TEXT);
 CREATE TABLE efl_club_occupancies(id TEXT PRIMARY KEY,season_id TEXT,
   league_id TEXT,club_id TEXT,user_id TEXT,telegram_id TEXT,status TEXT);
 INSERT INTO efl_users VALUES('u1','123',0),('u2','456',0),('u3','789',1);
 INSERT INTO efl_seasons VALUES('s1','1-mavsum',1);
 INSERT INTO efl_leagues VALUES('l1','s1','APL',1);
 INSERT INTO efl_clubs VALUES('c1','l1','Arsenal'),('c2','l1','Chelsea');
 INSERT INTO efl_club_occupancies VALUES('o1','s1','l1','c1','u1','123','ACTIVE');
 `);
 return {sql,db:{
  async get(query,params){return sql.prepare(query).get(params)??null;},
  async all(query,params){return sql.prepare(query).all(params);}
 }};
}
const msg=(id,text,type='private')=>({text,chat:{id,type},from:{id,is_bot:false}});
test('read-only staging bot rejects groups, mentions, bots and unknown commands',async()=>{
 const {db,sql}=seededDb();
 try{
  assert.equal(parseCommand('/MyClub'),'/myclub');
  assert.equal(parseCommand('/myclub@anotherbot'),null);
  assert.equal(await handleReadOnlyBotCommand(db,msg(123,'/myclub','supergroup')),null);
  assert.equal(await handleReadOnlyBotCommand(db,msg(123,'/unknown')),null);
  assert.equal(await handleReadOnlyBotCommand(db,{...msg(123,'/myclub'),from:{id:123,is_bot:true}}),null);
  assert.equal(await handleReadOnlyBotCommand(db,{...msg(123,'/myclub'),from:{id:456,is_bot:false}}),null);
 }finally{sql.close();}
});
test('private bot fetches only signed sender club, never another user data',async()=>{
 const {db,sql}=seededDb();
 try{
  const own=await handleReadOnlyBotCommand(db,msg(123,'/myclub'));
  assert.match(own.text,/APL: Arsenal/);
  const unrelated=await handleReadOnlyBotCommand(db,msg(456,'/myclub'));
  assert.doesNotMatch(unrelated.text,/Arsenal/);
  const banned=await handleReadOnlyBotCommand(db,msg(789,'/myclub'));
  assert.match(banned.text,/cheklangan/);
  const start=await handleReadOnlyBotCommand(db,msg(123,'/start'));
  assert.match(start.text,/sinov boti/);
 }finally{sql.close();}
});
