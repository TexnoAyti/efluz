import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {getFirestoreDb} from '../firebase/admin';
import {initialUState,mutateUState,readUState,applyUAction} from '../services/uzeflifeService';
import {uzeflifeRouter} from '../routes/uzeflife.routes';
import {processUNotices} from '../services/uzeflifeNotifications';
import {createULeagueMatches} from '../../lib/uzeflifeLeague';
import type {User} from '../../types';
export async function verifyUzeflifeRoundAdvance(){
 const db=getFirestoreDb(),ref=db.collection('uzeflife').doc('championship'),prior=(await ref.get()).data();
 const collection=db.collection('uzeflife_notifications'),backups=(await collection.get()).docs.map(d=>({id:d.id,data:d.data()}));
 const users=Array.from({length:16},(_,i)=>({id:'round-player-'+i,telegramId:String(942000+i),username:'round_player_'+i,firstName:'Player',isAdmin:false,isSuspended:false,createdAt:'',updatedAt:''} as User));
 const manager={...users[0],id:'round-manager',telegramId:'942100',username:'round_manager'};
 for(const u of [...users,manager])await db.collection('users').doc(u.id).set(u);
 for(const d of (await collection.get()).docs)await d.ref.delete();
 try{
  const s=initialUState();s.format='LEAGUE';s.status='playing';s.round=1;s.assistants[manager.id]=['brackets'];
  s.participants=users.map(u=>({id:u.id,name:'@'+u.username,status:'approved'}));s.matches=createULeagueMatches(users.map(u=>u.id));
  s.matches[0].homeScore=2;s.matches[0].awayScore=1;s.matches[0].winner=s.matches[0].home;
  s.matches[1].proposal={by:s.matches[1].home!,home:3,away:1,penaltyHome:null,penaltyAway:null};s.matches[1].deadlineAt='2026-10-01T00:00:00.000Z';
  const old=s.matches.filter(m=>m.round===1);await ref.set(s);
  await assert.rejects(mutateUState(users[1],'next',{expectedRound:1}),/ruxsat/);
  const next=await mutateUState(manager,'next',{expectedRound:1});assert.equal(next.round,2);
  assert.deepEqual(next.matches.filter(m=>m.round===1),old,'No scores, proposals or old deadlines are overwritten');
  assert.ok(next.matches.filter(m=>m.round===2).every(m=>Date.parse(m.deadlineAt!)>Date.now()));
  assert.ok(next.matches.filter(m=>m.round===3).every(m=>!m.deadlineAt));
  await assert.rejects(mutateUState(manager,'next',{expectedRound:1}),/allaqachon/);
  const sent:any[]=[];while(await processUNotices(30,async n=>{sent.push(n);return true;})){}
  assert.equal(sent.length,16,'Every linked player gets their new opponent');assert.equal(new Set(sent.map(n=>n.userId)).size,16);assert.ok(sent.every(n=>n.body.includes('2-tur')&&n.replyMarkup.inline_keyboard[0][0].url.includes('l2m')));
  assert.equal(await processUNotices(30,async()=>{throw Error('Duplicate notice');}),false);
  const pending=next.matches[1],away=users.find(u=>u.id===pending.away)!;
  await mutateUState(away,'confirmResult',{matchId:pending.id,expected:pending.proposal});assert.equal((await readUState()).matches[1].homeScore,3,'Past-round opponent approval still works');
  const previous=next.matches[2],home=users.find(u=>u.id===previous.home)!;
  await mutateUState(home,'result',{matchId:previous.id,home:1,away:1});assert.ok((await readUState()).matches[2].proposal,'Past-round result entry stays open');
  const future=next.matches.find(m=>m.round===3)!,futureUser=users.find(u=>u.id===future.home)!;
  await assert.rejects(mutateUState(futureUser,'result',{matchId:future.id,home:1,away:0}),/qabul qilinmaydi/);
  const knockout={...structuredClone(s),format:'KNOCKOUT' as const};assert.throws(()=>applyUAction(knockout,manager,'next',{expectedRound:1}),/tugamagan/);
  // Exercise the same HTTP route as the admin button, including a stale retry.
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user=manager;next();});app.use('/u',uzeflifeRouter);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{const url=`http://127.0.0.1:${(server.address() as any).port}/u/next`,call=()=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRound:2})});
   const responses=await Promise.all([call(),call()]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);const success=await responses.find(r=>r.status===200)!.json();assert.equal(success.round,3);assert.equal((await readUState()).round,3,'A concurrent click opens exactly one round');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  console.log('PASS UZEFLIFE round advance: unfinished games retained, old-round reports/approval, future and playoff guards, per-player opponent delivery and dedupe, exact committed HTTP state, concurrent stale retry protection.');
 }finally{
  if(prior)await ref.set(prior);else await ref.delete();for(const u of [...users,manager])await db.collection('users').doc(u.id).delete();
  for(const d of (await collection.get()).docs)await d.ref.delete();for(const d of backups)await collection.doc(d.id).set(d.data);
 }
}
