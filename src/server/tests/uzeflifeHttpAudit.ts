import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {getFirestoreDb} from '../firebase/admin';
import {authMiddleware} from '../middleware/authMiddleware';
import {createSessionToken} from '../auth/sessionToken';
import {uzeflifeRouter} from '../routes/uzeflife.routes';
import {initialUState} from '../services/uzeflifeService';
export async function verifyUzeflifeHttp(failNextCommit:()=>void){
 process.env.SESSION_SECRET='isolated-uzeflife-session-secret-32bytes';const db=getFirestoreDb();
 const actors=Array.from({length:5},(_,i)=>({id:`uz-user-${i}`,telegramId:i===0?'5209126900':String(975000+i),username:`uz${i}`,firstName:`UZ ${i}`,isAdmin:false,isSuspended:false,createdAt:'',updatedAt:''}));
 for(const a of actors)await db.collection('users').doc(a.id).set(a);
 await db.collection('uzeflife').doc('championship').set(initialUState());
 const app=express();app.use(express.json());app.use(authMiddleware);app.use('/api/uzeflife',uzeflifeRouter);const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}/api/uzeflife`;
 const call=async(action='',body?:unknown,actor:any=actors[0])=>{const response=await fetch(base+(action?'/'+action:''),{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(actor?{authorization:`Bearer ${createSessionToken(actor)}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json() as any};};
 try{
  assert.equal((await call()).status,200);assert.equal((await call('open',{},null)).status,401);
  assert.equal((await call('superAdmin',{target:actors[1].id},actors[2])).status,403);
  assert.equal((await call('superAdmin',{target:actors[1].id},{...actors[2],telegramId:actors[0].telegramId})).status,403,'Account lookup prevents forged/stale owner claims');
  assert.equal((await call('superAdmin',{target:actors[1].telegramId})).status,200);
  assert.equal((await call('assistant',{target:actors[2].id,permissions:['channels']},actors[1])).status,200);
  assert.equal((await call('open',{},actors[2])).status,403);
  assert.equal((await call('superAdmin',{target:actors[2].id},actors[1])).status,403);
  assert.equal((await call('customNavigation',{enabled:true},actors[1])).status,403);
  assert.equal((await call('subscriptions',{enabled:true},actors[2])).status,200);
  assert.equal((await call('addChannel',{id:'@uzeflife',title:'UZ',url:'https://t.me/uzeflife'},actors[2])).status,200);
  assert.equal((await call('open',{},actors[1])).status,200);
  // Real HTTP route + fake Telegram transport; no approval when Telegram fails.
  process.env.TELEGRAM_BOT_TOKEN='isolated-uzeflife-token-32bytes';
  const original=globalThis.fetch;let telegramMode='missing';
  globalThis.fetch=(async(input:any,init:any)=>{if(String(input).startsWith('https://api.telegram.org/')){if(telegramMode==='error')return Response.json({ok:false});return Response.json({ok:true,result:{status:telegramMode==='member'?'member':'left'}});}return original(input,init);}) as typeof fetch;
  try{
   assert.equal((await call('register',{},actors[3])).status,403);
   assert.equal((await call('addParticipant',{target:actors[4].id},actors[1])).status,403,'Admin enrollment enforces target membership');
   telegramMode='error';assert.equal((await call('addParticipant',{target:actors[4].id},actors[1])).status,503);assert.equal((await call('subscription-check',{},actors[3])).status,503);
   telegramMode='member';assert.equal((await call('subscription-check',{},actors[3])).data.subscribed,true);
   assert.equal((await call('register',{},actors[3])).status,200);
  }finally{globalThis.fetch=original;}
  assert.equal((await call('',undefined,actors[4])).data.participants.length,0,'Pending participants are private');
  assert.equal((await call('review',{target:actors[3].id,status:'approved'},actors[2])).status,403);
  assert.equal((await call('review',{target:actors[3].id,status:'approved'},actors[1])).status,200);
  assert.equal((await call('addParticipant',{target:actors[4].id},actors[2])).status,403,'Channels permission cannot enroll players');
  assert.equal((await call('subscriptions',{enabled:false},actors[1])).status,200);
  assert.equal((await call('addParticipant',{target:'missing-account'},actors[1])).status,404);
  await db.collection('users').doc(actors[4].id).update({isSuspended:true});
  assert.equal((await call('addParticipant',{target:actors[4].id},actors[1])).status,404);
  await db.collection('users').doc(actors[4].id).update({isSuspended:false});
  failNextCommit();assert.equal((await call('addParticipant',{target:actors[4].id},actors[1])).status,503);
  assert.ok(!(await call()).data.participants.some((p:any)=>p.id===actors[4].id),'Failed enrollment transaction rolls back');
  const enrolled=await call('addParticipant',{target:actors[4].telegramId,name:'Forged name'},actors[1]);
  assert.equal(enrolled.status,200);assert.deepEqual(enrolled.data.participants.find((p:any)=>p.id===actors[4].id),{id:actors[4].id,name:actors[4].firstName,status:'approved'});
  assert.equal((await call('addParticipant',{target:actors[4].id},actors[1])).status,400);
  assert.equal((await call('review',{target:actors[4].id,status:'removed'},actors[1])).status,200);
  assert.equal((await call('addParticipant',{target:actors[4].id},actors[1])).status,200);
  assert.equal((await call()).data.participants.filter((p:any)=>p.id===actors[4].id).length,1);
  assert.equal((await call('removeAssistant',{target:actors[2].id},actors[1])).status,200);
  assert.equal((await call('subscriptions',{enabled:false},actors[2])).status,403,'Revoked permissions apply immediately');
  await db.collection('users').doc(actors[1].id).update({isSuspended:true});assert.equal((await call('open',{},actors[1])).status,403);
  await db.collection('users').doc(actors[1].id).update({isSuspended:false});
  const before=(await call()).data.revision;failNextCommit();assert.equal((await call('announce',{text:'Must roll back'},actors[1])).status,503);assert.equal((await call()).data.revision,before);
  const results=await Promise.all([call('announce',{text:'A'},actors[1]),call('announce',{text:'B'},actors[1])]);assert.ok(results.every(r=>r.status===200));
  const final=(await call()).data;assert.equal(final.announcements.length,2);assert.equal(final.revision,before+2);
  assert.ok((await db.collection('uzeflife_audit').get()).size>=10);
  assert.equal((await db.collection('users').doc(actors[1].id).get()).data()!.isAdmin,false,'Tournament roles never grant platform admin');
  console.log('PASS UZEFLIFE HTTP/PostgreSQL: owner assignment, granular assistants, Telegram fail-closed, pending privacy, revocation/suspension, audit durability, failed-commit rollback and concurrent updates.');
 }finally{server.close();}
}
