import test from 'node:test';
import assert from 'node:assert/strict';
import {handleReadOnlyCallback} from '../tgcloud/lib/readOnlyCallbacks.js';

const query=(data,fromId=123,chatType='private')=>({
  id:'cb-001',data,from:{id:fromId,is_bot:false},
  message:{chat:{id:123,type:chatType}}
});
const db={
 async get(){return {id:'u1',is_banned:0};},
 async all(sql){
  if(sql.includes('efl_notifications'))return [{title:'Faqat menga',isRead:0}];
  return [{seasonName:'1-mavsum',leagueName:'APL',clubName:'Arsenal'}];
 }
};
test('staging callbacks reject unknown, group and mismatched identities',async()=>{
 assert.equal(await handleReadOnlyCallback(db,query('admin:delete')),null);
 assert.equal(await handleReadOnlyCallback(db,query('efl:myclub',123,'supergroup')),null);
 assert.equal(await handleReadOnlyCallback(db,query('efl:myclub',456)),null);
});
test('staging callbacks reply and do not leak club data in callback toast',async()=>{
 const status=await handleReadOnlyCallback(db,query('efl:status'));
 assert.match(status.answer.text,/sinov rejimi/);
 const club=await handleReadOnlyCallback(db,query('efl:myclub'));
 assert.match(club.message.text,/Arsenal/);
 assert.doesNotMatch(club.answer.text,/Arsenal/);
 assert.equal(club.message.chat_id,123);
});

test('inline callback maps to signed private inbox without exposing message in toast',async()=>{
 const inbox=await handleReadOnlyCallback(db,query('efl:inbox'));
 assert.equal(inbox.message.chat_id,123);
 assert.match(inbox.message.text,/Faqat menga/);
 assert.doesNotMatch(inbox.answer.text,/Faqat menga/);
 assert.equal(await handleReadOnlyCallback(db,query('efl:inbox',456)),null);
 assert.equal(await handleReadOnlyCallback(db,query('efl:inbox',123,'group')),null);
});
