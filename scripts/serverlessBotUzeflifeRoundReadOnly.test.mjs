import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleReadOnlyBotCommand} from '../tgcloud/lib/readOnlyBotCommands.js';
import {handleReadOnlyCallback} from '../tgcloud/lib/readOnlyCallbacks.js';

function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(\`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_admin INTEGER,is_banned INTEGER);
 CREATE TABLE efl_uzeflife_state(id TEXT PRIMARY KEY,name TEXT,status TEXT,format TEXT,
 current_round INTEGER,total_rounds INTEGER,round_hours INTEGER,
 participants_count INTEGER,matches_count INTEGER,source_revision INTEGER);
 CREATE TABLE efl_uzeflife_fixtures(id TEXT PRIMARY KEY,round INTEGER,bracket INTEGER,
 home TEXT,away TEXT,winner TEXT,home_score INTEGER,away_score INTEGER,
 penalty_home INTEGER,penalty_away INTEGER,deadline_at INTEGER);
 INSERT INTO efl_users VALUES('u1','123',0,0),('u2','456',1,0),('u3','789',1,1);
 INSERT INTO efl_uzeflife_state VALUES('uzeflife','UZEFLIFE','ACTIVE','EXISTING',3,8,24,242,120,1);
 INSERT INTO efl_uzeflife_fixtures VALUES
 ('old',2,1,'Former A','Former B','Former A',3,1,NULL,NULL,NULL),
 ('current1',3,1,'Player A','Player B',NULL,NULL,NULL,NULL,NULL,NULL),
 ('current2',3,2,'Player C','Player D','Player D',1,2,NULL,NULL,NULL),
 ('future',4,1,'Future A','Future B',NULL,NULL,NULL,NULL,NULL,NULL);
 \`);
 const db={
  async get(q,p={}){return sql.prepare(q).get(p)??null;},
  async all(q,p={}){return sql.prepare(q).all(p);}
 };
 return {sql,db};
}
const msg=(id,text,type='private')=>({text,from:{id,is_bot:false},chat:{id,type}});
test('bracket shows only stored current-round fixtures to the signed-in owner',async()=>{
 const {sql,db}=setup();
 try{
  const result=await handleReadOnlyBotCommand(db,msg(123,'/bracket'));
  assert.match(result.text,/3-tur/);
  assert.match(result.text,/Player A.*Player B/);
  assert.match(result.text,/Player C.*Player D.*1:2/);
  assert.doesNotMatch(result.text,/Former|Future/);
  assert.ok(result.text.includes('\n'));
  const start=await handleReadOnlyBotCommand(db,msg(123,'/start'));
  assert.ok(start.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='efl:bracket'));
  const callback=await handleReadOnlyCallback(db,{
   id:'cb1',data:'efl:bracket',from:{id:123,is_bot:false},
   message:{chat:{id:123,type:'private'}}
  });
  assert.match(callback.message.text,/Player A/);
  assert.equal(await handleReadOnlyCallback(db,{
   id:'cb2',data:'efl:bracket',from:{id:123,is_bot:false},
   message:{chat:{id:456,type:'private'}}
  }),null);
  assert.equal(await handleReadOnlyBotCommand(db,msg(123,'/bracket','supergroup')),null);
 }finally{sql.close();}
});
test('round audit requires active admin and never changes the fixtures',async()=>{
 const {sql,db}=setup();
 try{
  const ordinary=await handleReadOnlyBotCommand(db,msg(123,'/roundaudit'));
  assert.match(ordinary.text,/faqat administrator/);
  const banned=await handleReadOnlyBotCommand(db,msg(789,'/roundaudit'));
  assert.match(banned.text,/cheklangan/);
  const admin=await handleReadOnlyBotCommand(db,msg(456,'/roundaudit'));
  assert.match(admin.text,/Jami: 2/);
  assert.match(admin.text,/Yakunlangan: 1/);
  assert.match(admin.text,/Hal qilinmagan: 1/);
  assert.equal(sql.prepare('SELECT COUNT(*) AS total FROM efl_uzeflife_fixtures').get().total,4);
 }finally{sql.close();}
});
