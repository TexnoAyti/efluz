import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readAdminRoundOverview} from '../tgcloud/lib/adminRoundOverview.js';
import {handleReadOnlyBotCommand} from '../tgcloud/lib/readOnlyBotCommands.js';
import {handleReadOnlyCallback} from '../tgcloud/lib/readOnlyCallbacks.js';
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_users(id TEXT PRIMARY KEY,telegram_id TEXT,is_admin INTEGER,is_banned INTEGER);
 CREATE TABLE efl_seasons(id TEXT PRIMARY KEY,name TEXT,is_active INTEGER,created_at INTEGER);
 CREATE TABLE efl_competitions(id TEXT PRIMARY KEY,season_id TEXT,league_id TEXT,
  name TEXT,type TEXT,status TEXT,current_matchday INTEGER,is_matchday_open INTEGER,schedule_mode TEXT);
 CREATE TABLE efl_leagues(id TEXT PRIMARY KEY,season_id TEXT,current_round INTEGER);
 CREATE TABLE efl_fixtures(id TEXT PRIMARY KEY,competition_id TEXT,season_id TEXT,
  round INTEGER,status TEXT,home_club_id TEXT,away_club_id TEXT);
 CREATE TABLE efl_disputes(id TEXT PRIMARY KEY,fixture_id TEXT,status TEXT);
 INSERT INTO efl_users VALUES('admin','123',1,0),('regular','456',0,0),('banned','789',1,1);
 INSERT INTO efl_seasons VALUES('old','Previous',0,100),('current','S2',1,200);
 INSERT INTO efl_competitions VALUES
  ('prior','old',NULL,'Private history','CUP','ACTIVE',2,1,'GENERATED'),
  ('league','current','l1','APL','LEAGUE','ACTIVE',3,1,'GENERATED'),
  ('cup','current',NULL,'Cup','CUP','ACTIVE',2,1,'GENERATED');
 INSERT INTO efl_leagues VALUES('l1','current',3);
 INSERT INTO efl_fixtures VALUES
  ('l-old','league','current',3,'SCHEDULED','a','b'),
  ('l-next','league','current',4,'SCHEDULED','b','c'),
  ('c-old','cup','current',2,'CONFIRMED','a','b'),
  ('c-next','cup','current',3,'SCHEDULED','b','c'),
  ('old','prior','old',3,'SCHEDULED','x','y');
 `);
 return {sql,db:{
  async get(q,p={}){return sql.prepare(q).get(p)??null;},
  async all(q,p={}){return sql.prepare(q).all(p);}
 }};
}
const msg=(id,text,type='private')=>({text,chat:{id,type},from:{id,is_bot:false}});
test('admin overview stays in active season and never changes fixtures',async()=>{
 const {sql,db}=setup();
 try{
  const before=sql.prepare('SELECT COUNT(*) AS count FROM efl_fixtures').get().count;
  const overview=await readAdminRoundOverview(db,'123');
  assert.equal(overview.season.name,'S2');
  assert.equal(overview.items.length,2);
  assert.equal(overview.items[0].name,'APL');
  assert.equal(overview.items[0].unresolved,1);
  assert.equal(overview.items[0].canAdvanceManually,true);
  assert.equal(overview.items[1].canAdvanceManually,true);
  assert.equal(overview.items.some(item=>item.name==='Private history'),false);
  assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM efl_fixtures').get().count,before);
 }finally{sql.close();}
});
test('rounds command and callback are private and admin-only',async()=>{
 const {sql,db}=setup();
 try{
  const admin=await handleReadOnlyBotCommand(db,msg(123,'/rounds'));
  assert.match(admin.text,/Admin: turlar/);
  assert.match(admin.text,/APL/);
  assert.doesNotMatch(admin.text,/Private history/);
  assert.equal(await handleReadOnlyBotCommand(db,msg(123,'/rounds','supergroup')),null);
  assert.match((await handleReadOnlyBotCommand(db,msg(456,'/rounds'))).text,/faqat administrator/);
  assert.match((await handleReadOnlyBotCommand(db,msg(789,'/rounds'))).text,/cheklangan/);
  const callback=await handleReadOnlyCallback(db,{
   id:'round1',data:'efl:rounds',from:{id:123,is_bot:false},
   message:{chat:{id:123,type:'private'}}
  });
  assert.match(callback.message.text,/APL/);
  assert.equal(await handleReadOnlyCallback(db,{
   id:'round2',data:'efl:rounds',from:{id:123,is_bot:false},
   message:{chat:{id:456,type:'private'}}
  }),null);
  const start=await handleReadOnlyBotCommand(db,msg(123,'/start'));
  assert.ok(start.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='efl:rounds'));
 }finally{sql.close();}
});
