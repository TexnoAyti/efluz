import assert from 'node:assert/strict';
import {initDatabase} from '../db';import {getFirestoreDb} from '../firebase/admin';
import {initialUState,readUState} from '../services/uzeflifeService';
import {createULeagueMatches} from '../../lib/uzeflifeLeague';
import {planUzeflifeTopicResult,UZEFLIFE_RESULT_TOPIC} from '../services/uzeflifeTopicResults';
import {handleTopicResultUpdate,planTopicResult,setTestTopicResultDependencies} from '../services/telegramTopicResults';
import {findResultScores,separateResultIdentities} from '../services/telegramResultText';
import {parseAiMatchScore} from '../services/telegramAiScore';

assert.equal(parseAiMatchScore('Salom hisob2：1rahmat 🙏 soat20:15').homeScore,2);
assert.equal(parseAiMatchScore('2026-11-05 natija 2–1').awayScore,1);
assert.equal(parseAiMatchScore('2-2penalti5-4').homePenaltyScore,5);
assert.throws(()=>parseAiMatchScore('2-1 yoki 3-0'),/CLARIFY/);assert.throws(()=>parseAiMatchScore('-2:1'),/CLARIFY/);
const names=['@Jasurbek_060','@pesser280101'];
const glued=separateResultIdentities('@Jasurbek_0602-1@pesser280101',names);assert.deepEqual(findResultScores(glued).map(m=>[m[1],m[2]]),[['2','1']]);
await initDatabase();process.env.DATABASE_PROVIDER='supabase';process.env.SUPABASE_DATA_NAMESPACE='preview';process.env.TELEGRAM_BOT_TOKEN='777:flexible-test';
const db=getFirestoreDb(),ref=db.collection('uzeflife').doc('championship');
const ids=Array.from({length:16},(_,i)=>'flex-'+i),s=initialUState();s.format='LEAGUE';s.status='playing';s.round=1;s.matches=createULeagueMatches(ids);s.participants=ids.map((id,i)=>({id,name:i===0?'@Jasurbek_060':i===15?'@pesser280101':'@flex_player_'+i,status:'approved'}));
for(const [i,id] of ids.entries())await db.collection('users').doc(id).set({id,telegramId:String(1001+i),username:s.participants[i].name.slice(1),isAdmin:false,isSuspended:false});
await ref.set(s);const game=s.matches.find(m=>[m.home,m.away].includes(ids[0])&&m.round===1)!;
for(const text of ['@Jasurbek_0602-1@pesser280101','@Jasurbek_060vs@pesser280101 2-1 zor oyin boldi rahmat','salom2-1rahmat','salom 2-1 rahmat','hisob2-1 soat20:15']){
 const p=await planUzeflifeTopicResult(text,1001);assert.equal(p?.plan.targetId,game.id);assert.equal(p?.plan.body[game.home===ids[0]?'homeScore':'awayScore'],2);
}
const win='@Jasurbek_060 vs @pesser280101\n@pesser280101 win';
try{await planUzeflifeTopicResult(win,1001);assert.fail('A winner is not a score');}catch(e:any){assert.match(e.message,/g‘olib.*aniq hisob yo‘q/);assert.equal(e.followup.kind,'score');assert.equal(e.followup.choices[0].id,game.id);}
await assert.rejects(planUzeflifeTopicResult(win+' 2-1',1001),/mos emas/);
const valid=await planUzeflifeTopicResult(win+' 1-2',1001);assert.equal(valid?.plan.body[game.home===ids[15]?'homeScore':'awayScore'],2);
await assert.rejects(planUzeflifeTopicResult('@Jasurbek_060 win @pesser280101 win 2-1',1001),/Ikki xil g‘olib/);
await assert.rejects(planUzeflifeTopicResult('@Jasurbek_060 2-1 @unknown_person',1001),/username/);
const realFetch=globalThis.fetch,realNow=Date.now;let clock=realNow(),sequence=600000,visions=0;const sent:any[]=[];Date.now=()=>clock;
globalThis.fetch=(async(input:any,init:any)=>{const url=String(input);assert.ok(url.includes('api.telegram.org/'),'No external model requests in this suite');const body=JSON.parse(init?.body||'{}');if(url.endsWith('/sendMessage')){const result={...body,message_id:++sequence};sent.push(result);return Response.json({ok:true,result:{message_id:result.message_id}});}return Response.json({ok:true,result:true});}) as typeof fetch;
const image={home:'@Jasurbek_060',away:'@pesser280101',homeScore:2,awayScore:1,homePenaltyScore:null,awayPenaltyScore:null,competition:null,stage:null};
setTestTopicResultDependencies({vision:async()=>{visions++;return image;}});
let updateId=900000;const update=(text:string,extra:any={})=>{clock+=90000;return {update_id:++updateId,message:{message_id:updateId,chat:{id:-1001,username:'efleagueuz'},from:{id:1001},message_thread_id:UZEFLIFE_RESULT_TOPIC,text,...extra}};};
try{
 const missing=update(win);assert.equal((await handleTopicResultUpdate(missing)).result,'clarification');assert.equal((await readUState()).matches.find(m=>m.id===game.id)?.proposal,null);
 const reply=sent.at(-1);assert.equal((await handleTopicResultUpdate(update('salom2-1rahmat',{reply_to_message:{message_id:reply.message_id}}))).result,'proposal_sent');assert.equal((await readUState()).matches.find(m=>m.id===game.id)?.homeScore,null,'No final result before the existing approval');
 await ref.set(s);const photo=update('',{text:undefined,photo:[{file_id:'mock-image',file_size:100}]});assert.equal((await handleTopicResultUpdate(photo)).result,'proposal_sent');assert.equal(visions,1);assert.equal((await handleTopicResultUpdate(photo)).result,'duplicate_source');assert.equal(visions,1,'A repeated source is not re-read by the model');
 await ref.set(s);const conflict=update('',{text:undefined,caption:'@Jasurbek_060 4-0 @pesser280101',photo:[{file_id:'mock-image'}]});assert.equal((await handleTopicResultUpdate(conflict)).result,'photo_conflict');assert.equal((await readUState()).matches.find(m=>m.id===game.id)?.proposal,null);
 const document=update('',{text:undefined,caption:'@Jasurbek_060 vs @pesser280101',document:{file_id:'mock-document',mime_type:'image/png',file_size:100}});assert.equal((await handleTopicResultUpdate(document)).result,'proposal_sent');
 await ref.set(s);assert.equal((await handleTopicResultUpdate(update('',{text:undefined,caption:'@pesser280101 vs @Jasurbek_060',photo:[{file_id:'reversed-caption'}]}))).result,'proposal_sent');assert.equal((await readUState()).matches.find(m=>m.id===game.id)?.proposal?.home,1,'The image side order overrides a reversed scoreless caption');
 await ref.set(s);setTestTopicResultDependencies({vision:async()=>({...image,home:'Unknown left',away:'Unknown right'})});assert.equal((await handleTopicResultUpdate(update('',{text:undefined,caption:'@Jasurbek_060 vs @pesser280101',photo:[{file_id:'unmapped-sides'}]}))).result,'photo_identity_ambiguous');assert.equal((await readUState()).matches.find(m=>m.id===game.id)?.proposal,null,'Unknown image-to-user mapping is never guessed');
 setTestTopicResultDependencies({vision:async()=>{visions++;return image;}});
 const before=visions;const forwarded=update('',{text:undefined,photo:[{file_id:'mock-image'}],forward_origin:{type:'user'}});assert.equal((await handleTopicResultUpdate(forwarded)).handled,false);assert.equal(visions,before);
 await ref.set(s);setTestTopicResultDependencies({vision:async()=>null});assert.equal((await handleTopicResultUpdate(update('',{text:undefined,photo:[{file_id:'unreadable'}]}))).result,'photo_unreadable');assert.equal((await readUState()).matches.find(m=>m.id===game.id)?.homeScore,null);
}finally{globalThis.fetch=realFetch;Date.now=realNow;setTestTopicResultDependencies();}
const clubs:any[]=[{id:'rm',name:'Real Madrid',leagueId:'league-la-liga',ownerUserId:'user-1001',ownerUsername:'Jasurbek_060'},{id:'barca',name:'Barcelona',leagueId:'league-la-liga',ownerUserId:'user-1016',ownerUsername:'pesser280101'}];
const competition:any={id:'liga',name:'La Liga',type:'LEAGUE',leagueId:'league-la-liga',currentMatchday:1};
const fixture:any={id:'efl-game',competitionId:'liga',homeClubId:'barca',awayClubId:'rm',home:'Barcelona',away:'Real Madrid',competition:'La Liga',matchday:1,status:'SCHEDULED'};
setTestTopicResultDependencies({ownership:async()=>({data:clubs,available:true,stale:false}),reader:{read:async(q:any)=>({data:q.dataset==='competitions'?[competition]:[fixture],complete:true,stale:false,nextOffset:null})} as any});
try{
 const planned=await planTopicResult('@Jasurbek_0602-1@pesser280101 zor oyin boldi',1001,3,new AbortController().signal);assert.equal(planned?.plan.body.homeScore,1);assert.equal(planned?.plan.body.awayScore,2);
 await assert.rejects(planTopicResult(win,1001,3,new AbortController().signal),/aniq hisob yo‘q/);
 await assert.rejects(planTopicResult(win+' 2-1',1001,3,new AbortController().signal),/mos emas/);
 assert.equal((await planTopicResult(win+' 1-2',1001,3,new AbortController().signal))?.plan.body.homeScore,2);
 await assert.rejects(planTopicResult('@Jasurbek_060 2-1 @unknown_person',1001,3,new AbortController().signal),/aniqlanmadi/);
}finally{setTestTopicResultDependencies();}
console.log('PASS flexible results: exact reported usernames/win, glued names/scores, noisy text, dates/times, conflict/unknown-name guards, missing-score follow-up, topic photo/document proposals, caption conflict, source dedupe, forwarded denial and unreadable images; no invented win score, no final result or real Telegram/model call.');
