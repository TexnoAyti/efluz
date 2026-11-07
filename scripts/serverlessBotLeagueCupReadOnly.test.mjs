import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleReadOnlyBotCommand} from '../tgcloud/lib/readOnlyBotCommands.js';
import {handleReadOnlyCallback} from '../tgcloud/lib/readOnlyCallbacks.js';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_banned INTEGER);
 CREATE TABLE efl_seasons(id TEXT PRIMARY KEY,name TEXT,is_active INTEGER,created_at INTEGER);
 CREATE TABLE efl_leagues(id TEXT PRIMARY KEY,season_id TEXT,name TEXT,status TEXT,current_round INTEGER,sort_order INTEGER);
 CREATE TABLE efl_competitions(id TEXT PRIMARY KEY,season_id TEXT,name TEXT,type TEXT,status TEXT);
 INSERT INTO efl_users VALUES('u1','123',0),('u2','456',1);
 INSERT INTO efl_seasons VALUES('s1','Old',0,1),('s2','Current',1,2);
 INSERT INTO efl_leagues VALUES('l1','s1','Legacy league','CLOSED',2,1),
 ('l2','s2','APL','ACTIVE',9,1),('l3','s2','La Liga','CLOSED',0,2);
 INSERT INTO efl_competitions VALUES('c1','s1','Legacy cup','CUP','DONE'),
 ('c2','s2','England Cup','CUP','ACTIVE'),
 ('c3','s2','Super Cup','SUPER_CUP','DRAFT'),
 ('c4','s2','Main league','LEAGUE','ACTIVE');
 `);
 const db={
  async get(q,p={}){return sql.prepare(q).get(p)??null;},
  async all(q,p={}){return sql.prepare(q).all(p);}
 };
 return {sql,db};
}
const msg=(id,command,type='private')=>({text:command,from:{id,is_bot:false},chat:{id,type}});
test('league and cup menu shows only current season read-only data',async()=>{
 const {sql,db}=fixture();
 try{
  const leagues=await handleReadOnlyBotCommand(db,msg(123,'/leagues'));
  assert.match(leagues.text,/APL.*tur 9/);
  assert.match(leagues.text,/La Liga/);
  assert.doesNotMatch(leagues.text,/Legacy league/);
  const cups=await handleReadOnlyBotCommand(db,msg(123,'/cups'));
  assert.match(cups.text,/England Cup/);
  assert.match(cups.text,/Super Cup/);
  assert.doesNotMatch(cups.text,/Main league|Legacy cup/);
  assert.ok(cups.text.includes('\n'));
  const start=await handleReadOnlyBotCommand(db,msg(123,'/start'));
  const buttons=start.reply_markup.inline_keyboard.flat().map(b=>b.callback_data);
  assert.ok(buttons.includes('efl:leagues'));
  assert.ok(buttons.includes('efl:cups'));
 }finally{sql.close();}
});
test('callbacks are private and cannot select a different user or season',async()=>{
 const {sql,db}=fixture();
 try{
  const response=await handleReadOnlyCallback(db,{id:'cb1',data:'efl:cups',
    from:{id:123,is_bot:false},message:{chat:{id:123,type:'private'}}});
  assert.match(response.message.text,/England Cup/);
  assert.equal(await handleReadOnlyCallback(db,{id:'cb2',data:'efl:cups',
    from:{id:123,is_bot:false},message:{chat:{id:999,type:'private'}}}),null);
  assert.equal(await handleReadOnlyBotCommand(db,msg(123,'/cups','supergroup')),null);
  const banned=await handleReadOnlyBotCommand(db,msg(456,'/leagues'));
  assert.match(banned.text,/cheklangan/);
  assert.equal((await handleReadOnlyBotCommand(db,msg(123,'/cups s1'))).text.includes('Legacy cup'),false);
 }finally{sql.close();}
});
