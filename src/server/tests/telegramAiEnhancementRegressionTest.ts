import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { continueAiAdminClarification } from '../services/telegramAiAdminClarification';
import { inspectAiAdminOutcome } from '../services/telegramAiAdminOutcome';
import { parseAiMatchScore } from '../services/telegramAiScore';
import { resolveAdminScore, planNaturalAdminRequest } from '../services/telegramAiNaturalAdminPlanner';
import { resolveCupResult } from '../../lib/cupResult';
import { adminEditFixtureResultFirestore, adminDeleteFixtureResultFirestore } from '../firebase/firestoreStore';
import { normalizeFixtureSnapshot } from '../readModel/readModelStore';
import { appendAiExchange } from '../services/telegramAiConversationMemory';
import { PRIVATE_AI_MEMORY } from '../services/telegramAiPrivateAssistant';
import { DEFAULT_AI_CONFIG, setTestConfigOverride } from '../services/telegramAiConfigService';
import { setTestGroundingOverride } from '../services/telegramAiGroundingService';
import { clearTestRateLimitState } from '../services/telegramAiRateLimitService';
import { clearTestAiState, handleTelegramAiMessage, type ConversationTurn } from '../services/telegramAiService';
import { imageResultSchema, readTelegramResultPhoto } from '../services/telegramAiVision';
import { buildAiDailyReport, deliverAiDailyReport, tashkentReportDate } from '../services/telegramAiDailyReport';
import { getAiObservability, recordAiObservation } from '../services/telegramAiObservability';

await initDatabase();
process.env.DATABASE_PROVIDER='supabase';process.env.SUPABASE_DATA_NAMESPACE='ai-enhancement-test';
process.env.TELEGRAM_BOT_TOKEN='777:isolated-ai';process.env.GEMINI_API_KEY='isolated-gemini-key';
const signal = new AbortController().signal;
const score=parseAiMatchScore('Barcelona 1-1 Real Sociedad, penalti 3-1 natijasini kirit');
assert.equal(continueAiAdminClarification({request:'Barcelona 1-1 Real Sociedad Copa del Rey natijasini kirit',question:'Kubok durang tugamaydi. Penalti hisobini yozing.'},'penalti 3-1'),'Barcelona 1-1 Real Sociedad Copa del Rey natijasini kirit, penalti 3-1');
assert.deepEqual(score,{homeScore:1,awayScore:1,homeExtraTimeScore:null,awayExtraTimeScore:null,homePenaltyScore:3,awayPenaltyScore:1,decidedBy:'PENALTIES'});
assert.equal(parseAiMatchScore('A 1-1 B, qo‘shimcha vaqt 2-1').decidedBy,'EXTRA_TIME');
assert.equal(parseAiMatchScore('A 1-1 B, extra time 2-2, penalti 4-3').homeExtraTimeScore,2);
for(const text of ['A 1-1 B 3-1','A 2-1 B penalti 3-1','A 1-1 B penalti 3-3','A 1-1 B penalti','A 2-2 B extra time 1-1'])assert.throws(()=>parseAiMatchScore(text),/CLARIFY/);
const clubs:any[]=[{id:'club-barcelona',name:'Barcelona'},{id:'club-real-sociedad',name:'Real Sociedad'}];
const fixture={homeClubId:clubs[1].id,awayClubId:clubs[0].id};
const extra=resolveAdminScore('Barcelona 1-1 Real Sociedad qo‘shimcha vaqt 2-1',clubs,fixture);
assert.equal(extra.homeScore,1);assert.equal(extra.homeExtraTimeScore,1);assert.equal(extra.awayExtraTimeScore,2);
assert.equal(resolveCupResult(extra,fixture,true).winnerClubId,clubs[0].id);
assert.equal(imageResultSchema.safeParse({home:'A',away:'B',homeScore:1,awayScore:1,homeExtraTimeScore:2,homePenaltyScore:null,awayPenaltyScore:null,competition:null,stage:null}).success,false);
const reversed=resolveAdminScore('Barcelona 1-1 Real Sociedad, penalti 3-1',clubs,fixture);
assert.equal(reversed.homePenaltyScore,1);assert.equal(reversed.awayPenaltyScore,3);
assert.equal(resolveCupResult(reversed,fixture,true).winnerClubId,clubs[0].id);
assert.throws(()=>resolveCupResult(score,fixture,false),/./);
assert.throws(()=>resolveCupResult({...score,awayPenaltyScore:3},fixture,true),/./);
const cup='comp-copa-del-rey-2026',seasonId='season-2026-27',id='ai-penalty-quarter';
const db=getFirestoreDb();
await db.collection('fixtures').doc(id).set({id,competitionId:cup,seasonId,matchday:3,roundName:'Quarter-final',...fixture,status:'SCHEDULED',updatedAt:'v1',createdAt:new Date().toISOString()});
const planned=await planNaturalAdminRequest('Barcelona 1-1 Real Sociedad Copa del Rey chorak final, penalti 3-1 natijasini kirit',{
 read:async(q:any)=>({complete:true,total:q.dataset==='clubs'?2:1,data:q.dataset==='clubs'?clubs:q.dataset==='competitions'?[{id:cup,name:'Copa del Rey',type:'KNOCKOUT',seasonId}]:[{id,competitionId:cup,seasonId,...fixture,status:'SCHEDULED'}]}),users:async()=>[]
});
assert.equal(planned?.body.homePenaltyScore,1);assert.equal(planned?.body.awayPenaltyScore,3);
const result=await adminEditFixtureResultFirestore('admin','admin',id,{...reversed,status:'CONFIRMED',idempotencyKey:'ai-penalty-save'});
assert.equal(result.fixture.winnerClubId,clubs[0].id);
assert.equal(result.fixture.awayPenaltyScore,3);
assert.equal(inspectAiAdminOutcome({action:'result_edit',targetId:id,body:reversed},result).state,'verified');
assert.equal(inspectAiAdminOutcome({action:'result_edit',targetId:id,body:reversed},{fixture:{...result.fixture,awayPenaltyScore:null}}).state,'unverified');
const stored=(await db.collection('fixtures').doc(id).get()).data()!;
assert.equal(stored.homeScore,1);assert.equal(stored.awayScore,1);assert.equal(stored.winnerClubId,clubs[0].id);
assert.equal(normalizeFixtureSnapshot(stored).awayPenaltyScore,3);
assert.equal((await db.collection('durable_fixture_overrides').doc(id).get()).data()?.awayPenaltyScore,3);
assert.equal((await db.collection('result_refresh_jobs').doc(id).get()).data()?.notificationFixture.awayPenaltyScore,3);
assert.match((await db.collection('audit_logs').doc('audit_ai-penalty-save').get()).data()?.newValueJson,/homePenaltyScore/);
await assert.rejects(adminEditFixtureResultFirestore('admin','admin',id,{...score,awayPenaltyScore:3}),/./);
assert.equal((await db.collection('fixtures').doc(id).get()).data()?.awayPenaltyScore,3);
await adminEditFixtureResultFirestore('admin','admin',id,{homeScore:2,awayScore:0,idempotencyKey:'ai-penalty-replace'});
assert.equal((await db.collection('fixtures').doc(id).get()).data()?.homePenaltyScore,null,'Ordinary correction clears stale penalties');

let history:ConversationTurn[]=[];
for(let i=0;i<35;i++)history=appendAiExchange(history,`Talab ${i}: maqsadim liga`, `Javob ${i}`,{},PRIVATE_AI_MEMORY);
assert.equal(history.length,48);assert.ok(history[0].memorySummary?.includes('Talab 0'));
assert.ok(history[0].memorySummary!.length<=4000);
assert.ok(history[0].memorySummary?.includes('amal dalili emas'));
const long='Tushuntir '+ 'x'.repeat(3500)+' YAKUNI-TO‘LIQ';
assert.equal(appendAiExchange([],long,'javob',{},PRIVATE_AI_MEMORY)[0].text,long);

const reportRows=[{id:'c',type:'KNOCKOUT',currentMatchday:3}];
const reportFixtures=[{id:'one',competitionId:'c',matchday:3,status:'CONFIRMED',homeScore:1,awayScore:1,home:'Barcelona',away:'Real Sociedad',competition:'Copa',roundName:'Quarter-final'}, {id:'two',competitionId:'c',matchday:3,status:'DISPUTED',home:'A',away:'B',competition:'Copa'}];
const report=await buildAiDailyReport(async q=>({data:q.dataset==='competitions'?reportRows:reportFixtures,nextOffset:null,complete:true,stale:false}));
assert.equal(report.counts.unresolved,1);assert.equal(report.counts.disputed,1);assert.equal(report.complete,true);
const partial=await buildAiDailyReport(async()=>({data:[],error:'UNAVAILABLE'}));assert.equal(partial.complete,false);assert.match(partial.text,/to‘liq emas/);
assert.equal(tashkentReportDate(new Date('2026-10-17T20:00:00Z')),'2026-10-18');

setTestConfigOverride({...DEFAULT_AI_CONFIG,enabled:true,allowedChatId:-1001,allowedThreadId:3503,rateLimitUserPerMin:20,rateLimitTopicPerMin:60,dailyReportEnabled:false});
setTestGroundingOverride({competitions:[],clubs:[],standings:{},fixtures:{}});
const originalFetch=global.fetch;const sent:any[]=[];let provider=0;
global.fetch=async(input:any,init?:any)=>{
 const url=String(input);
 if(url.includes('/getFile'))return Response.json({ok:true,result:{file_path:'photos/test.jpg',file_size:10}});
 if(url.includes('/file/bot'))return new Response(new Uint8Array([255,216,255,1,2,3]));
 if(url.includes('generativelanguage.googleapis.com')){
  provider++;const body=JSON.parse(init.body);
  assert.ok(!JSON.stringify(body).includes('777:isolated-ai'));
  const photo=body.contents[0].parts.some((p:any)=>p.inlineData);
  if(!photo)assert.ok(body.contents.at(-1).parts[0].text.endsWith('YAKUNI-TO‘LIQ'),'Actual SDK receives the entire long request');
  return Response.json({candidates:[{content:{role:'model',parts:[{text:photo?JSON.stringify({home:'Barcelona',away:'Real Sociedad',homeScore:1,awayScore:1,homePenaltyScore:3,awayPenaltyScore:1,competition:'Copa del Rey',stage:'Quarter-final'}):'To‘liq javob'}]},finishReason:'STOP'}]});
 }
 if(url.includes('api.telegram.org')){sent.push(JSON.parse(init.body));return Response.json({ok:true,result:{message_id:50000+sent.length}});}
 throw Error('Unexpected external transport');
};
try{
 const vision=await readTelegramResultPhoto('file-test',signal);assert.match(vision,/penalti 3-1/);assert.match(vision,/Hali saqlanmadi/);
 clearTestAiState();clearTestRateLimitState();
 assert.equal((await handleTelegramAiMessage({updateId:91001,messageId:91001,chatId:5209126900,threadId:0,fromUser:{id:5209126900},text:long})).replySent,true);
 clearTestRateLimitState();
 const beforePhoto=provider;
 await handleTelegramAiMessage({updateId:91999,messageId:91999,chatId:-1001,threadId:3503,fromUser:{id:5209126900},text:'rasm',photoFileId:'file-test'});
 assert.equal(provider,beforePhoto,'Group photo cannot reach private image extraction');
 const before=provider;
 assert.equal((await handleTelegramAiMessage({updateId:91002,messageId:91002,chatId:5209126900,threadId:0,fromUser:{id:5209126900},text:'x'.repeat(12001)})).replySent,true);
 assert.equal(provider,before,'Over-budget input is refused before model/actions');assert.match(sent.at(-1).text,/juda uzun/);
 await Promise.all([recordAiObservation(91003,'reply',100),recordAiObservation(91003,'reply',100)]);
 const metric=await getAiObservability();assert.equal(metric.available,true);assert.equal(metric.data.replies,3,'Duplicate observation does not inflate statistics');
 assert.equal((await deliverAiDailyReport(new Date('2026-10-17T04:00:00Z'))).status,'disabled_or_unavailable');
 setTestConfigOverride({...DEFAULT_AI_CONFIG,enabled:true,allowedChatId:-1001,allowedThreadId:3503,dailyReportEnabled:true});
 const reportsBefore=sent.length;
 const deliveries=await Promise.all([deliverAiDailyReport(new Date('2026-10-18T04:00:00Z'),async()=>report),deliverAiDailyReport(new Date('2026-10-18T04:00:00Z'),async()=>report)]);
 assert.equal(deliveries.filter(d=>d.status==='sent').length,1);assert.equal(sent.length,reportsBefore+1,'Concurrent workers send one report');
 assert.equal((await deliverAiDailyReport(new Date('2026-10-19T04:00:00Z'),async()=>partial)).status,'data_incomplete');
 assert.equal((await deliverAiDailyReport(new Date('2026-10-20T01:00:00Z'),async()=>report)).status,'before_report_time');
 global.fetch=async()=>{throw Error('Telegram timeout');};
 assert.equal((await deliverAiDailyReport(new Date('2026-10-21T04:00:00Z'),async()=>report)).status,'unknown');
 assert.equal((await deliverAiDailyReport(new Date('2026-10-21T04:00:00Z'),async()=>report)).status,'already_attempted','Uncertain sends never replay automatically');
}finally{global.fetch=originalFetch;setTestConfigOverride(null);setTestGroundingOverride(null);clearTestAiState();}
console.log('PASS long SDK requests, explicit overflow refusal, compact memory, image extraction without writes, separate/reversed penalties and atomic result/audit/refresh persistence, stale penalty clearing, partial daily reports and deduplicated metrics; all external calls mocked');
