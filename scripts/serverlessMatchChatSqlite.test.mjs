import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {runMatchChat} from '../tgcloud/lib/matchChatEngine.js';

function createDb(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(`
 CREATE TABLE efl_match_access (
   match_id TEXT PRIMARY KEY,home_telegram_id TEXT NOT NULL,
   away_telegram_id TEXT NOT NULL,writable INTEGER NOT NULL
 );
 CREATE TABLE efl_match_messages (
   id INTEGER PRIMARY KEY AUTOINCREMENT,match_id TEXT NOT NULL,
   sender_telegram_id TEXT NOT NULL,client_id TEXT NOT NULL UNIQUE,
   body TEXT NOT NULL,created_at INTEGER NOT NULL
 );
 INSERT INTO efl_match_access VALUES ('match1','123','456',1);
 INSERT INTO efl_match_access VALUES ('match2','123','789',0);
 `);
 return {
  sql,
  db:{
   async get(query,params={}){return sql.prepare(query).get(params)||null;},
   async all(query,params={}){return sql.prepare(query).all(params);},
   async run(query,params={}){sql.prepare(query).run(params);return [];}
  }
 };
}
const send={matchId:'match1',action:'send',clientId:'abcdefghijklmnop',text:'Assalomu alaykum'};
test('real SQLite: chat access is signed-user scoped, send and replay are idempotent',async()=>{
 const {sql,db}=createDb();
 try{
  const first=await runMatchChat(db,send,123);
  assert.equal(first.messages.length,1);
  assert.equal(first.messages[0].senderTelegramId,'123');
  const replay=await runMatchChat(db,send,123);
  assert.equal(replay.messages.length,1);
  assert.equal(sql.prepare('SELECT COUNT(*) count FROM efl_match_messages').get().count,1);
  await assert.rejects(runMatchChat(db,{...send,text:'Changed'},123),/CHAT_WRITE_CONFLICT/);
  await assert.rejects(runMatchChat(db,{...send,clientId:'1234567890abcdef'},999),/CHAT_FORBIDDEN/);
  assert.equal((await runMatchChat(db,{matchId:'match1'},456)).messages.length,1);
 }finally{sql.close();}
});
test('real SQLite: revoked write and read-only match cannot accept messages',async()=>{
 const {sql,db}=createDb();
 try{
  assert.equal((await runMatchChat(db,{matchId:'match2'},123)).readOnly,true);
  await assert.rejects(runMatchChat(db,{...send,matchId:'match2'},123),/CHAT_READ_ONLY/);
  sql.exec("UPDATE efl_match_access SET writable=0 WHERE match_id='match1'");
  await assert.rejects(runMatchChat(db,send,123),/CHAT_READ_ONLY/);
  assert.equal(sql.prepare('SELECT COUNT(*) count FROM efl_match_messages').get().count,0);
 }finally{sql.close();}
});
test('client ID cannot be reused for a different match by same sender',async()=>{
 const {sql,db}=createDb();
 try{
  await runMatchChat(db,send,123);
  sql.exec("UPDATE efl_match_access SET writable=1 WHERE match_id='match2'");
  await assert.rejects(runMatchChat(db,{...send,matchId:'match2'},123),/CHAT_WRITE_CONFLICT/);
  assert.equal(sql.prepare('SELECT COUNT(*) count FROM efl_match_messages').get().count,1);
 }finally{sql.close();}
});
