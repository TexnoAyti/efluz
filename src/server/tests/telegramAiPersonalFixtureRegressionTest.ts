import assert from 'node:assert/strict';
import { buildPersonalFixtureReply, isPersonalFixtureQuestion } from '../services/telegramAiPersonalFixtureService';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { ReadModelKeys, redisSetRaw, getDirtyKey } from '../readModel/readModelStore';
import { getFirestoreDb } from '../firebase/admin';
import { handleTelegramAiMessage, clearTestAiState, setTestAiResponder } from '../services/telegramAiService';
import { setTestConfigOverride, DEFAULT_AI_CONFIG } from '../services/telegramAiConfigService';
import { checkAndIncrementAiRateLimits, clearTestRateLimitState } from '../services/telegramAiRateLimitService';

const season='season-2026-27',league='comp-serie-a-2026',cup='comp-coppa-italia-2026';
const bridge=await startMockUpstashBridge();
const snapshot=(data:any)=>({data,generatedAt:new Date().toISOString()});
const clubs=[{id:'club-inter',name:'Inter Milan',leagueId:'league-serie-a',ownerUserId:'user-42',ownerUsername:'player_42'},
 {id:'club-milan',name:'AC Milan',leagueId:'league-serie-a',ownerUserId:'user-17',ownerUsername:'milan_owner'},
 {id:'club-roma',name:'AS Roma',leagueId:'league-serie-a',ownerUserId:'user-18',ownerUsername:'roma_owner'}];
const fixture=(id:string,competitionId:string,matchday:number,status='SCHEDULED',away='club-milan')=>({id,competitionId,seasonId:season,matchday,status,homeClubId:'club-inter',awayClubId:away,homeScore:status==='CONFIRMED'?1:null,awayScore:status==='CONFIRMED'?0:null});
const confirmed=Array.from({length:31},(_,i)=>fixture('old-'+i,league,(i%8)+1,'CONFIRMED'));
const competitions=[{id:league,name:'Serie A',seasonId:season,type:'LEAGUE',leagueId:'league-serie-a',currentMatchday:10},
 {id:cup,name:'Coppa Italia',seasonId:season,type:'DOMESTIC_CUP'}];
let firestore=0;
const db=getFirestoreDb(),collection=db.collection.bind(db);
db.collection=(()=>{firestore++;throw new Error('RESOURCE_EXHAUSTED');}) as any;
try{
 await redisSetRaw(ReadModelKeys.competitions(season),snapshot(competitions));
 await redisSetRaw(ReadModelKeys.clubsWithOwners(season),snapshot(clubs));
 await redisSetRaw(ReadModelKeys.competitionFixtures(league,season),snapshot([...confirmed,fixture('next-10',league,10),fixture('next-9',league,9,'SCHEDULED','club-roma')]));
 await redisSetRaw(ReadModelKeys.competitionFixtures(cup,season),snapshot([fixture('cup-1',cup,1)]));
 for(const text of ['meni raqibim kim','Mening raqibim kim?','keyingi o‘yinim kim bilan?','Men kimga o‘ynayman?','Mening keyingi o‘yinimni ko‘rsat','Who is my opponent?','Мой соперник кто?'])assert.equal(isPersonalFixtureQuestion(text),true,text);
 assert.equal(isPersonalFixtureQuestion('Men Arsenal o‘yinini ko‘rmoqchiman'),false);
 assert.equal(isPersonalFixtureQuestion('Milan keyingi raqibi kim?'),false);
 assert.match((await buildPersonalFixtureReply('Angliya Kubogidagi raqibim kim?',42)).text,/So‘ralgan turnir/);
 const own=await buildPersonalFixtureReply('Mening raqibim kim?',42);
 assert.match(own.text,/Sizning klubingiz: Inter Milan/);assert.match(own.text,/Raqibingiz: AS Roma/);assert.match(own.text,/@roma_owner/);assert.match(own.text,/9-tur/);
 assert.ok(!own.text.includes('old-'));assert.deepEqual(own.clubIds,['club-inter']);
 assert.match((await buildPersonalFixtureReply('Mening 10-turdagi raqibim kim?',42)).text,/Raqibingiz: AC Milan/);
 await redisSetRaw(ReadModelKeys.competitionFixtures(league,season),snapshot([...confirmed,fixture('next-10',league,10),fixture('next-9',league,9,'CONFIRMED','club-roma')]));
 assert.match((await buildPersonalFixtureReply('raqibim kim?',42)).text,/Coppa Italia/);
 await redisSetRaw(ReadModelKeys.competitionFixtures(cup,season),snapshot([fixture('cup-1',cup,1,'CONFIRMED')]));
 assert.match((await buildPersonalFixtureReply('raqibim kim?',42)).text,/Serie A · 10-tur/);
 const away=await buildPersonalFixtureReply('raqibim kim?',17);assert.match(away.text,/Sizning klubingiz: AC Milan/);assert.match(away.text,/Raqibingiz: Inter Milan/);assert.match(away.text,/safarda/);
 assert.match((await buildPersonalFixtureReply('raqibim kim?',99)).text,/tasdiqlangan klub.*topilmadi/);
 // Same username on another record must never substitute for Telegram ID.
 await redisSetRaw(ReadModelKeys.clubsWithOwners(season),snapshot([...clubs,{id:'club-extra',name:'Other Club',ownerUserId:'user-99',ownerUsername:'player_42'}]));
 assert.deepEqual((await buildPersonalFixtureReply('raqibim kim?',42)).clubIds,['club-inter']);
 await redisSetRaw(ReadModelKeys.clubsWithOwners(season),snapshot(clubs.map(c=>c.id==='club-roma'?{...c,ownerUserId:'user-42'}:c)));
 const both=await buildPersonalFixtureReply('raqibim kim?',42);assert.deepEqual(both.clubIds,['club-inter','club-roma']);assert.match(both.text,/AS Roma: navbatdagi.*topilmadi/);
 bridge.store.set(getDirtyKey(ReadModelKeys.clubsWithOwners(season)),'1');assert.match((await buildPersonalFixtureReply('raqibim kim?',42)).text,/Oxirgi saqlangan/);
 assert.equal(firestore,0);
 console.log('PASS verified sender ownership, full fixture pagination, canonical league/cup sequence, explicit round, away opponent, multiple clubs, username collision, stale/missing truth; zero Firestore/model');
}finally{db.collection=collection;await bridge.close();}

// Complete dispatcher: personal questions bypass exhausted model budget, never invoke Gemini.
setTestConfigOverride({...DEFAULT_AI_CONFIG,enabled:true,allowedChatId:-1001,allowedThreadId:3503,maxDailyRequests:1});
clearTestAiState();clearTestRateLimitState();
await checkAndIncrementAiRateLimits({chatId:-1001,threadId:3503,userId:100,userLimitPerMin:3,topicLimitPerMin:15,maxDailyRequests:1});
setTestAiResponder(async()=>{throw new Error('PERSONAL_REPLY_MUST_NOT_USE_MODEL');});
process.env.TELEGRAM_BOT_TOKEN='123456:isolated-personal-test';
const original=global.fetch,sent:any[]=[];
global.fetch=async(input:any,init?:any)=>String(input).includes('api.telegram.org')?({ok:true,json:async()=>{sent.push(JSON.parse(init?.body||'{}'));return {ok:true,result:{message_id:123}};}} as any):original(input,init);
try{
 const payload={updateId:81001,messageId:21,chatId:-1001,threadId:3503,fromUser:{id:42,username:'not_used'},text:'meni raqibim kim'};
 assert.equal((await handleTelegramAiMessage(payload)).replySent,true);
 assert.match(sent.at(-1).text,/ma’lumot hozir o‘qilmadi/);assert.equal(sent.at(-1).message_thread_id,3503);assert.equal(sent.at(-1).reply_parameters.message_id,21);
 assert.equal((await handleTelegramAiMessage({...payload,updateId:81002,forwarded:true})).replySent,true);assert.match(sent.at(-1).text,/o‘zingiz yozing/);
 console.log('PASS main dispatch uses Telegram sender and personal path, respects topic/thread, refuses forwarded identity, model budget exhausted; Telegram mocked');
}finally{global.fetch=original;setTestAiResponder(undefined);setTestConfigOverride(null);clearTestAiState();clearTestRateLimitState();}
