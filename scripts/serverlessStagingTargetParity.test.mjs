import test from 'node:test';
import assert from 'node:assert/strict';
import {IMPORT_TABLES,PRIMARY_KEYS} from '../tgcloud/lib/importBatch.js';
import {verifyStagingParity,parseReadbackResponse} from './verifyEflStagingTargetParity.mjs';

const empty=()=>Object.fromEntries(Object.keys(IMPORT_TABLES).map(table=>[table,[]]));
const makeUser=(id,name='Test')=>Object.fromEntries(IMPORT_TABLES.users.map(key=>
 [key,key==='id'?id:key==='first_name'?name:key==='telegram_id'?'123':null]));
function fakeReadback(source,changes={}){
 return async ({table,cursor,limit})=>{
   let rows=[...source[table]];
   if(table===changes.table && changes.rows)rows=changes.rows;
   const pk=PRIMARY_KEYS[table];
   rows.sort((a,b)=>String(a[pk])<String(b[pk])?-1:1);
   const offset=cursor===null?0:rows.findIndex(r=>String(r[pk])===String(cursor))+1;
   const page=rows.slice(offset,offset+limit);
   return {ok:true,table,columns:IMPORT_TABLES[table],rows:page,
     hasMore:offset+limit<rows.length,
     nextCursor:offset+limit<rows.length?page.at(-1)?.[pk]:null};
 };
}
test('complete readback requires all tables including empty ones',async()=>{
 const source=empty();source.users=[makeUser('club.2026/27'),makeUser('club.2026/28')];
 const r=await verifyStagingParity(source,fakeReadback(source));
 assert.equal(r.verified,true);assert.equal(r.rows,2);assert.equal(r.cutoverReady,false);
 assert.equal(r.tables,Object.keys(IMPORT_TABLES).length);
});
test('tampered rows, missing rows and unexpected target rows fail closed',async()=>{
 const source=empty();source.users=[makeUser('a')];
 await assert.rejects(verifyStagingParity(source,fakeReadback(source,{
   table:'users',rows:[makeUser('a','Tampered')]
 })),/STAGING_PARITY_ROW_MISMATCH:users/);
 await assert.rejects(verifyStagingParity(source,fakeReadback(source,{
   table:'users',rows:[]
 })),/STAGING_PARITY_MISSING_ROWS:users/);
 await assert.rejects(verifyStagingParity(source,fakeReadback(source,{
   table:'users',rows:[makeUser('a'),makeUser('b')]
 })),/STAGING_PARITY_ROW_MISMATCH:users/);
});
test('readback receipts must be structured responses, not CLI status text',()=>{
 assert.equal(parseReadbackResponse(JSON.stringify({
  result:{ok:true,table:'users',columns:[],rows:[],hasMore:false,nextCursor:null}
 })).table,'users');
 assert.throws(()=>parseReadbackResponse('staging OK'),/STAGING_READBACK_RECEIPT_INVALID/);
 assert.throws(()=>parseReadbackResponse('{}'),/STAGING_READBACK_RECEIPT_INVALID/);
});
test('pagination cannot falsely report completion or repeat a cursor',async()=>{
 const source=empty();source.users=[makeUser('a')];
 const read=async ({table})=>({ok:true,table,columns:IMPORT_TABLES[table],
  rows:[],hasMore:true,nextCursor:'a'});
 await assert.rejects(verifyStagingParity(source,read),/STAGING_PARITY_INVALID_CURSOR/);
});
