import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {uzeflifeRouter} from '../routes/uzeflife.routes';
import {getFirestoreDb} from '../firebase/admin';
import {initialUState,readUState,ensureUPlayerLinked,mutateUState} from '../services/uzeflifeService';
import {planUzeflifeTopicResult,prepareUzeflifeTopicResult,authorizeUzeflifeTopicResult,executeUzeflifeTopicResult,uzeflifeMatchFingerprint,UZEFLIFE_RESULT_TOPIC} from '../services/uzeflifeTopicResults';
import {createULeagueMatches,uLeagueStandings} from '../../lib/uzeflifeLeague';
import type {User} from '../../types';
export async function verifyUzeflifeAutoLink(){
 const db=getFirestoreDb(),ref=db.collection('uzeflife').doc('championship'),prior=(await ref.get()).data();
 const users=Array.from({length:18},(_,i)=>({id:'auto-link-'+i,telegramId:String(931000+i),username:'auto_player_'+i,firstName:'Player',isAdmin:false,isSuspended:false,createdAt:'',updatedAt:''} as User));
 const collections=['uzeflife_notifications','uzeflife_round_summaries'];
 const backups=await Promise.all(collections.map(async name=>({name,rows:(await db.collection(name).get()).docs.map(d=>({id:d.id,data:d.data()}))})));
 for(const u of users)await db.collection('users').doc(u.id).set(u);
 try{
  const s=initialUState();s.format='LEAGUE';s.totalRounds=15;s.status='playing';s.round=1;
  s.roster=users.slice(0,16).map((u,i)=>({group:1,slot:i+1,username:u.username,originalUsername:u.username,userId:null}));
  s.participants=s.roster.map(r=>({id:`uze-slot-${r.group}-${r.slot}`,name:'@'+r.username,status:'approved'}));s.matches=createULeagueMatches(s.participants.map(p=>p.id));
  // A completed past fixture, unrelated proposals and standings must survive linking.
  const historic=s.matches.find(m=>m.round===2)!;historic.homeScore=3;historic.awayScore=0;historic.winner=historic.home;
  const originalStandings=uLeagueStandings(s).map(({id,...r})=>r);await ref.set(s);
  const m=s.matches[0],home=users[Number(m.home!.split('-').at(-1))-1],away=users[Number(m.away!.split('-').at(-1))-1];
  await db.collection('users').doc(home.id).update({username:'@'+home.username.toUpperCase()});
  const plan=await planUzeflifeTopicResult('2-1',Number(home.telegramId));assert.ok(plan,'A roster player reports without pressing register');
  assert.equal(plan.fixture.home,'@'+home.username);let current=await readUState();assert.equal(current.roster!.find(r=>r.username===home.username)!.userId,home.id);
  const prepared=await prepareUzeflifeTopicResult(plan.plan,Number(home.telegramId));plan.plan.body.expectedFixture=prepared.expectedFixture;
  const before=await readUState(),fingerprint=uzeflifeMatchFingerprint(before,before.matches[0]);
  assert.equal(await authorizeUzeflifeTopicResult(Number(away.telegramId),plan.plan),true,'Unlinked roster opponent can confirm directly from Telegram');
  current=await readUState();assert.equal(uzeflifeMatchFingerprint(current,current.matches[0]),fingerprint,'Opponent linking does not stale a pending proposal');
  const revision=current.revision;await Promise.all([ensureUPlayerLinked(away),ensureUPlayerLinked(away)]);assert.equal((await readUState()).revision,revision,'Idempotent after linking');
  assert.deepEqual(uLeagueStandings(current).map(({id,...r})=>r),originalStandings);assert.equal(current.matches.find(x=>x.id===historic.id)!.homeScore,3);
  const result=await executeUzeflifeTopicResult(plan.plan,Number(away.telegramId),Number(home.telegramId),{chat:-1001,thread:UZEFLIFE_RESULT_TOPIC,message:1});assert.equal(result.data.fixture.homeScore,2);
  const blocked=users[2],slot=current.roster!.find(r=>r.username===blocked.username)!;
  current=await readUState();current.participants.find(p=>p.id===`uze-slot-1-${slot.slot}`)!.status='removed';await ref.set(current);
  await ensureUPlayerLinked(blocked);assert.equal((await readUState()).roster!.find(r=>r.slot===slot.slot)!.userId,null,'Removed placeholder stays removed');
  const suspended=users[3];await db.collection('users').doc(suspended.id).update({isSuspended:true});await assert.rejects(ensureUPlayerLinked(suspended),/vakolati/);
  await ensureUPlayerLinked({...users[16],username:home.username});assert.equal((await readUState()).roster!.find(r=>r.username===home.username)!.userId,home.id,'An occupied slot cannot be reclaimed');
  await ensureUPlayerLinked({...users[16],username:users[4].username});assert.equal((await readUState()).roster!.find(r=>r.username===users[4].username)!.userId,null,'Fresh DB identity overrides supplied username');
  await assert.rejects(planUzeflifeTopicResult('2-1',Number(users[16].telegramId)),/faqat tasdiqlangan/);
  const [a,b]=await Promise.all([ensureUPlayerLinked(users[5]),ensureUPlayerLinked(users[5])]);assert.equal(Math.abs(a.revision-b.revision),0,'Concurrent same-account claims are idempotent');
  current=await readUState();assert.equal(current.participants.filter(p=>p.id===users[5].id).length,1);
  // The Mini App action also repairs an old open session before applying a score.
  const appUser=users[6];current=await readUState();const appMatch=current.matches.find(x=>x.round===1&&[x.home,x.away].includes('uze-slot-1-7'))!;
  await mutateUState(appUser,'result',{matchId:appMatch.id,home:1,away:0});assert.ok((await readUState()).matches.find(x=>x.id===appMatch.id)!.proposal);
  const app=express();app.use((req,_res,next)=>{req.user=users[7];next();});app.use('/uzeflife',uzeflifeRouter);
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try{
   const response=await fetch(`http://127.0.0.1:${(server.address() as any).port}/uzeflife`),data=await response.json();
   assert.equal(response.status,200);assert.ok(data.participants.some(p=>p.id===users[7].id&&p.status==='approved'),'First Mini App GET links the player automatically');
   const again=await (await fetch(`http://127.0.0.1:${(server.address() as any).port}/uzeflife`)).json();assert.equal(again.revision,data.revision,'Reopening is read-only');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  console.log('PASS roster auto-link: direct topic report/opponent confirmation, stable proposal identity, completed scores/standings, case normalization, fresh account checks, outsider/removed/suspended/occupied denial and concurrent idempotency.');
 }finally{
  if(prior)await ref.set(prior);else await ref.delete();for(const u of users)await db.collection('users').doc(u.id).delete();
  for(const c of backups){for(const d of (await db.collection(c.name).get()).docs)await d.ref.delete();for(const row of c.rows)await db.collection(c.name).doc(row.id).set(row.data);}
 }
}
