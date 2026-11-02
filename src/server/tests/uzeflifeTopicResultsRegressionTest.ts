import assert from 'node:assert/strict';
import {initDatabase} from '../db';
import {getFirestoreDb} from '../firebase/admin';
import {listUzeflifeTopicQueue,handleTopicResultUpdate,planTopicResult} from '../services/telegramTopicResults';
import {planUzeflifeTopicResult,executeUzeflifeTopicResult,authorizeUzeflifeTopicResult,UZEFLIFE_RESULT_TOPIC} from '../services/uzeflifeTopicResults';
import {initialUState,generateUBracket,readUState,mutateUState,applyUAction} from '../services/uzeflifeService';
import {inspectAiAdminOutcome} from '../services/telegramAiAdminOutcome';
import type {User} from '../../types';
import {createULeagueMatches,uLeagueStandings,uMatchFinished} from '../../lib/uzeflifeLeague';
import {PostgresAiStore} from '../services/postgresAiStore';
import {UZEFLIFE_RESULT_TOPIC_URL} from '../../lib/uzeflifeResultTopic';

await initDatabase();process.env.DATABASE_PROVIDER='supabase';process.env.SUPABASE_DATA_NAMESPACE='preview';process.env.TELEGRAM_BOT_TOKEN='777:uzeflife-topic-test';
const db=getFirestoreDb(),ref=db.collection('uzeflife').doc('championship');
const user=(id:string,tg:number):User=>({id,telegramId:String(tg),firstName:id,username:id,isAdmin:false,isSuspended:false,createdAt:'',updatedAt:''});
const owner=user('custom-owner',5209126900),assistant=user('assistant',3001),channels=user('channels',3002),outsider=user('outsider',9999);
for(const u of [owner,assistant,channels,outsider,...Array.from({length:10},(_,i)=>user('player-'+i,1001+i))])await db.collection('users').doc(u.id).set(u);
const s=initialUState();s.status='playing';s.round=1;s.participants=Array.from({length:256},(_,i)=>({id:'player-'+i,name:i===0?'Azamat':i===1?'Vali':'Player '+i,status:'approved' as const}));s.matches=generateUBracket(s.participants.map(p=>p.id));s.assistants[assistant.id]=['results'];s.assistants[channels.id]=['channels'];await ref.set(s);
assert.equal(UZEFLIFE_RESULT_TOPIC,8989);
assert.equal(UZEFLIFE_RESULT_TOPIC_URL,'https://t.me/efleagueuz/8989');
assert.equal((await planTopicResult('3:1',1002,8989,new AbortController().signal))?.plan.body.homeScore,1,'Bare score starts with the verified sender');
for(const text of ['2-1','2 - 1','hisob 2-1']){const parsed=await planTopicResult(text,1002,8989,new AbortController().signal);assert.equal(parsed?.plan.body.homeScore,1);assert.equal(parsed?.plan.body.awayScore,2);}
assert.equal((await planUzeflifeTopicResult('Vali 4:1 Azamat',1002))?.plan.body.awayScore,4);
const shootout=await planUzeflifeTopicResult('2:2 penalti 5:4',1002);assert.equal(shootout?.plan.body.homePenaltyScore,4);assert.equal(shootout?.plan.body.awayPenaltyScore,5);
assert.equal((await planUzeflifeTopicResult('1-setka 1-o‘yin 2:1',3001))?.plan.targetId,'r1m0');
await assert.rejects(planUzeflifeTopicResult('2:2',1001),/penalti/);
for(const bad of ['-2:1','2:2 penalti -5:4','1.5:2','2:1.5','1-setka 1-o‘yin 200:1 penalti 5:4'])await assert.rejects(planUzeflifeTopicResult(bad,1001),/noto‘g‘ri/);
await assert.rejects(planUzeflifeTopicResult('2:1',9999),/tasdiqlangan/);
await assert.rejects(planUzeflifeTopicResult('Other 2:1 Person',1001),/bitta joriy/);
assert.equal(await planUzeflifeTopicResult('Agar 2:1 bo‘lsa nima bo‘ladi?',1001),null);
assert.equal(await authorizeUzeflifeTopicResult(3001),true);assert.equal(await authorizeUzeflifeTopicResult(3002),false);
const originalFetch=globalThis.fetch,sent:any[]=[];let sequence=800000;const originalNow=Date.now;let clock=originalNow();Date.now=()=>clock;
const update=(text:string,sender=1001)=>{clock+=61000;return {update_id:++sequence,message:{message_id:sequence,message_thread_id:8989,chat:{id:-100123,type:'supergroup',username:'efleagueuz'},from:{id:sender},text}};};
const callback=(message:any,token:string,actor=3001)=>({update_id:++sequence,callback_query:{id:'cb-'+sequence,from:{id:actor},data:token,message:{message_id:message.botId,message_thread_id:8989,chat:{id:-100123},from:{id:777}}}});
globalThis.fetch=(async(input:any,init:any)=>{assert.ok(String(input).startsWith('https://api.telegram.org/'));const body=JSON.parse(init.body);if(body.callback_query_id)return Response.json({ok:true});body.botId=9000+sent.length;sent.push(body);return Response.json({ok:true,result:{message_id:body.botId}});}) as typeof fetch;
try{
 const wrong=update('2:1');wrong.message.message_thread_id=7298;assert.equal((await handleTopicResultUpdate(wrong)).handled,false);
 const oldTopic=update('2:1');oldTopic.message.message_thread_id=7297;assert.equal((await handleTopicResultUpdate(oldTopic)).handled,false,'Retired topic cannot ingest UZEFLIFE scores');
 const source=update('2-1');assert.equal((await handleTopicResultUpdate(source)).result,'proposal_sent');assert.equal((await listUzeflifeTopicQueue(await readUState())).length,1,'Telegram pending result is visible in the tournament admin queue');const preview=sent.at(-1),token=preview.reply_markup.inline_keyboard[0][0].callback_data;
 assert.ok(preview.text.includes('Azamat 2:1 Vali')&&preview.text.includes('UZEFLIFE'));assert.match(preview.text,/Bu 1-tur o‘yinimi\?/);assert.equal(preview.message_thread_id,8989);assert.equal((await readUState()).matches[0].winner,null);
 assert.equal((await handleTopicResultUpdate(callback(preview,token,1001))).result,'unauthorized');assert.equal((await handleTopicResultUpdate(callback(preview,token,3002))).result,'unauthorized');
 const cross=callback(preview,token);cross.callback_query.message.message_thread_id=3;assert.equal((await handleTopicResultUpdate(cross)).result,'invalid');
 const race=await Promise.all([handleTopicResultUpdate(callback(preview,token)),handleTopicResultUpdate(callback(preview,token))]);assert.equal(race.filter(r=>r.result==='executing').length,1);
 assert.equal((await listUzeflifeTopicQueue(await readUState())).length,0,'Handled topic proposals leave the unified queue');let stored=await readUState();assert.equal(stored.matches[0].winner,'player-0');assert.equal(stored.matches.find(m=>m.id==='r2m0')?.home,'player-0');assert.equal(stored.revision,2);
 assert.equal((await handleTopicResultUpdate(callback(preview,token))).result,'already_processed');
 assert.ok((await db.collection('uzeflife_audit').get()).docs.some(d=>d.data().details.thread===8989&&d.data().actor===assistant.id));
 const editable=update('2:1',1003);await handleTopicResultUpdate(editable);const old=sent.at(-1);await handleTopicResultUpdate({update_id:++sequence,edited_message:{...editable.message,text:'2:3'}});const current=sent.at(-1);
 assert.equal((await handleTopicResultUpdate(callback(old,old.reply_markup.inline_keyboard[0][0].callback_data))).result,'already_processed');
 await handleTopicResultUpdate(callback(current,current.reply_markup.inline_keyboard[0][0].callback_data));stored=await readUState();assert.equal(stored.matches.find(m=>m.id==='r1m1')?.winner,'player-3');
 const stale=update('2:1',1005);await handleTopicResultUpdate(stale);const stalePreview=sent.at(-1);
 await mutateUState(owner,'schedule',{matchId:'r1m2',scheduledAt:'2026-10-23T12:00:00.000Z'});
 await handleTopicResultUpdate(callback(stalePreview,stalePreview.reply_markup.inline_keyboard[0][0].callback_data));assert.ok(sent.at(-1).text.includes('taklifdan keyin o‘zgargan'));assert.equal((await readUState()).matches.find(m=>m.id==='r1m2')?.winner,null);
 const retry=update('2:2 penalti 5:4',1005);assert.equal((await handleTopicResultUpdate(retry)).result,'proposal_sent');const retryPreview=sent.at(-1);await handleTopicResultUpdate(callback(retryPreview,retryPreview.reply_markup.inline_keyboard[0][0].callback_data));assert.equal((await readUState()).matches.find(m=>m.id==='r1m2')?.penaltyHome,5,'Known rejected proposals release their match lease for a new report');
 const revoke=update('2:1',1007);await handleTopicResultUpdate(revoke);const revokePreview=sent.at(-1),revokeToken=revokePreview.reply_markup.inline_keyboard[0][0].callback_data;
 await mutateUState(owner,'removeAssistant',{target:assistant.id});assert.equal((await handleTopicResultUpdate(callback(revokePreview,revokeToken))).result,'unauthorized');assert.equal((await readUState()).matches.find(m=>m.id==='r1m3')?.winner,null);
 await mutateUState(owner,'assistant',{target:assistant.id,permissions:['results']});await db.collection('users').doc('player-6').update({isSuspended:true});
 await handleTopicResultUpdate(callback(revokePreview,revokeToken));assert.ok(sent.at(-1).text.includes('Natija saqlanmadi'));assert.equal((await readUState()).matches.find(m=>m.id==='r1m3')?.winner,null);
 assert.equal((await db.collection('users').doc(assistant.id).get()).data()?.isAdmin,false);
 // A fresh admin-approved shootout is committed by the same scoring engine and verified receipt.
 const penaltyPlan=await planUzeflifeTopicResult('2:2 penalti 5:4',1009);assert.ok(penaltyPlan);
 const receipt=await executeUzeflifeTopicResult(penaltyPlan.plan,3001,1009,{chat:-100123,thread:8989,message:900001});assert.equal(inspectAiAdminOutcome(penaltyPlan.plan,receipt.data).state,'verified');assert.equal(receipt.data.fixture.homePenaltyScore,5);
 await assert.rejects(executeUzeflifeTopicResult(penaltyPlan.plan,3001,1009,{chat:-100123,thread:7297,message:900002}),/mavzusi/);
 // The live event is a 15-round league: current fixture, draw and caption ingestion.
 const league=initialUState();league.format='LEAGUE';league.status='playing';league.round=2;league.assistants[assistant.id]=['results'];
 league.participants=Array.from({length:16},(_,i)=>({id:'player-'+i,name:'@player_'+i,status:'approved'}));league.matches=createULeagueMatches(league.participants.map(p=>p.id));await ref.set(league);
 const currentGame=league.matches.find(m=>m.round===2&&[m.home,m.away].includes('player-0'))!;
 assert.equal((await planTopicResult('2:2',1001,8989,new AbortController().signal))?.plan.targetId,currentGame.id);
 await assert.rejects(planUzeflifeTopicResult('2:2 penalti 5:4',1001),/Liga/);
 const named=(id:string)=>league.participants.find(p=>p.id===id)!.name;
 const photo=update('unused') as any;delete photo.message.text;photo.message.photo=[{file_id:'isolated-photo'}];photo.message.caption=`${named(currentGame.home!)} 2:2 ${named(currentGame.away!)}`;
 const originalEval=PostgresAiStore.prototype.eval,sentBefore=sent.length;
 PostgresAiStore.prototype.eval=async function(script,keys,args){if(script.includes('EFL_AI_RATE_LIMIT_V1'))throw Error('ISOLATED_DATABASE_OUTAGE');return originalEval.call(this,script,keys,args);};
 try{await assert.rejects(handleTopicResultUpdate(photo),/RESULT_STATE_UNAVAILABLE/);assert.equal(sent.length,sentBefore,'Database outage cannot be acknowledged as a quota denial');}
 finally{PostgresAiStore.prototype.eval=originalEval;}
 assert.equal((await handleTopicResultUpdate(photo)).result,'proposal_sent','Same source can retry after state recovery');
 const leaguePreview=sent.at(-1);assert.equal(leaguePreview.message_thread_id,8989);assert.match(leaguePreview.text,/Umumiy liga.*2-tur/);
 assert.equal((await readUState()).matches.find(m=>m.id===currentGame.id)?.homeScore,null,'Captions do not write an unapproved result');
 assert.equal((await handleTopicResultUpdate(callback(leaguePreview,leaguePreview.reply_markup.inline_keyboard[0][0].callback_data))).result,'executing');
 const confirmed=await readUState(),match=confirmed.matches.find(m=>m.id===currentGame.id)!;assert.equal(match.homeScore,2);assert.equal(match.awayScore,2);assert.equal(uMatchFinished(match),true);
 const table=uLeagueStandings(confirmed);assert.equal(table.find(row=>row.id===currentGame.home)?.points,1);assert.equal(table.find(row=>row.id===currentGame.away)?.points,1);
 // Explicit rounds select the sender's different opponent, without advancing
 // the tournament or weakening public action/current-playoff-round guards.
 const otherGame=confirmed.matches.find(m=>m.round===3&&[m.home,m.away].includes('player-0'))!;
 for(const text of ['3-tur 2-1','3 tur 2 - 1','tur 3 2:1','3chi tur 2-1','2-1 3-tur']){
  const p=await planUzeflifeTopicResult(text,1001);assert.equal(p?.plan.targetId,otherGame.id);assert.equal(p?.plan.body[otherGame.home==='player-0'?'homeScore':'awayScore'],2);
 }
 for(const text of ['0-tur 2-1','16-tur 2-1','3-tur 4-tur 2-1'])await assert.rejects(planUzeflifeTopicResult(text,1001),/Tur noto‘g‘ri|bitta turni|bitta tur bilan/);
 const byAdmin=await planUzeflifeTopicResult('3-tur @player_0 2-1',3001);assert.equal(byAdmin?.plan.targetId,otherGame.id);assert.equal(byAdmin?.plan.body[otherGame.home==='player-0'?'homeScore':'awayScore'],2);
 await assert.rejects(planUzeflifeTopicResult('3-tur @player_0 @unknown_player 2-1',3001),/username’i topilmadi/);
 await assert.rejects(planUzeflifeTopicResult('3-tur 2-1',3001),/username/,'A nonplaying admin must identify a player');
 await assert.rejects(planUzeflifeTopicResult('3-tur @player_0 2-1',3002),/tasdiqlangan/,'Channel assistants cannot submit as result admins');
 assert.throws(()=>applyUAction(structuredClone(confirmed),assistant,'result',{matchId:otherGame.id,home:2,away:1,penaltyHome:null,penaltyAway:null}),/qabul qilinmaydi/);
 const report=update('3-tur 2-1');assert.equal((await handleTopicResultUpdate(report)).result,'proposal_sent');
 const otherPreview=sent.at(-1),otherToken=otherPreview.reply_markup.inline_keyboard[0][0].callback_data;
 assert.match(otherPreview.text,/Bu 3-tur o‘yinimi\?/);assert.ok(otherPreview.text.includes(named(otherGame.home!))&&otherPreview.text.includes(named(otherGame.away!)));
 assert.equal((await readUState()).matches.find(m=>m.id===otherGame.id)?.homeScore,null);
 assert.equal((await handleTopicResultUpdate(callback(otherPreview,otherToken,3002))).result,'unauthorized');
 assert.equal((await handleTopicResultUpdate(callback(otherPreview,otherToken))).result,'executing');
 const otherStored=await readUState(),otherMatch=otherStored.matches.find(m=>m.id===otherGame.id)!;
 assert.equal(otherStored.round,2);assert.equal(otherMatch[otherGame.home==='player-0'?'homeScore':'awayScore'],2);assert.equal(uMatchFinished(otherMatch),true);
 await assert.rejects(planUzeflifeTopicResult('3-tur 2-1',1001),/allaqachon/);
 const past=await planUzeflifeTopicResult('1-tur 1-0',1001);assert.ok(past);await executeUzeflifeTopicResult(past.plan,3001,1001,{chat:-100123,thread:8989,message:990001});assert.equal((await readUState()).round,2);
 await ref.set(s);await assert.rejects(planUzeflifeTopicResult('2-tur 2-1',1001),/Pley-off/);
 console.log('PASS UZEFLIFE topic 8989: current-round question, explicit past/future round selection, single-username admin reports, unchanged active round and public/playoff guards, verified identity, sender-first orientation, named players, shootouts, topic binding, tournament-only result admins, approval, replay/race/edit protection, stale fixture/suspension/revocation checks, progression and audit; Telegram mocked.');
}finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
