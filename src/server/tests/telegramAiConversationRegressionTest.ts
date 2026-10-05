import assert from 'node:assert/strict';
import express from 'express';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { ReadModelKeys, redisSetRaw } from '../readModel/readModelStore';
import { buildConversationTableReply, getConversationIntent, parseConversationMatchdayPlan } from '../services/telegramAiConversationCommands';
import { handleTelegramAiMessage, clearTestAiState } from '../services/telegramAiService';
import { setTestConfigOverride, DEFAULT_AI_CONFIG } from '../services/telegramAiConfigService';
import { setTestAiAdminHooks, handleAiAdminCommand, rememberDeliveredAdminPlan } from '../services/telegramAiAdminService';
import { clearTestRateLimitState, checkAndIncrementAiRateLimits } from '../services/telegramAiRateLimitService';
await initDatabase();
const season = 'season-2026-27', liga = 'comp-la-liga-2026', ucl = 'comp-champions-league-2026';
const signal = new AbortController().signal;
const bridge = await startMockUpstashBridge();
await redisSetRaw(ReadModelKeys.competitions(season), { data: [{ id: liga, name: 'La Liga', type: 'LEAGUE', seasonId: season, leagueId: 'league-la-liga', currentMatchday: 10 }, { id: ucl, name: 'UEFA Champions League', type: 'EUROPEAN_LEAGUE_PHASE', seasonId: season }], generatedAt: new Date().toISOString() });
await redisSetRaw(ReadModelKeys.clubsWithOwners(season), { data: [], generatedAt: new Date().toISOString() });
for (const [id, count] of [[liga,20],[ucl,32]] as const) await redisSetRaw(ReadModelKeys.standings(id,season), { data: Array.from({length:count},(_,i)=>({clubId:'club-'+i,clubName:'Team '+(i+1),position:i+1,points:42-i,played:18,goalDifference:20-i})), generatedAt:new Date().toISOString() });
await redisSetRaw(ReadModelKeys.competitionFixtures(liga,season), { data:[{id:'game-10',competitionId:liga,seasonId:season,matchday:10,status:'SCHEDULED',homeClubId:'club-1',awayClubId:'club-2',homeClubName:'Team 2',awayClubName:'Team 3',homeScore:8,awayScore:9}],generatedAt:new Date().toISOString() });
const db=getFirestoreDb(), collection=db.collection.bind(db); let firestore=0;
db.collection=(()=>{firestore++;throw new Error('RESOURCE_EXHAUSTED');}) as any;
try {
 assert.equal(getConversationIntent('La Liga jadvalini tashla'),'standings');
 assert.equal(getConversationIntent('Arsenal jadvalda qaysi orinda?'),'chat');
 assert.equal(getConversationIntent('La Liga 10-turni qulflang'),'admin');
 const table=await buildConversationTableReply('La Liga jadvalini tashla','standings',{},signal);
 assert.match(table.text,/20\. Team 20/); assert.match(table.text,/42 ochko/);
 const europe=await buildConversationTableReply('UCL jadvalini tashla','standings',{},signal);
 assert.match(europe.text,/32\. Team 32/); assert.ok(europe.text.length>1000);
 assert.match((await buildConversationTableReply('jadval tashla','standings',{previousUserQueries:['La Liga jadvalini tashla']},signal)).text,/La Liga/);
 assert.match((await buildConversationTableReply('jadval tashla','standings',{},signal)).text,/Qaysi liga/);
 const games=await buildConversationTableReply('La Liga 10 tur oyinlar jadvali','fixtures',{},signal); assert.ok(!games.text.includes('8:9')); assert.match(games.text,/rejalashtirilgan/);
 assert.deepEqual(await parseConversationMatchdayPlan('La Liga 10-turni qulflang',{},signal),{action:'matchday_control',targetId:liga,body:{action:'LOCK',matchday:10}});
 assert.equal(firestore,0);
} finally {db.collection=collection;await bridge.close();}
console.log('PASS natural table requests, context, all 32 standings rows, exact matchday, hidden unconfirmed scores; zero Firestore/model calls');
setTestConfigOverride({...DEFAULT_AI_CONFIG,enabled:true,allowedChatId:-1001,allowedThreadId:3503});
process.env.TELEGRAM_BOT_TOKEN='123456:isolated-conversation-test'; process.env.TELEGRAM_WEBHOOK_SECRET='isolated-conversation-secret';
const payload=(text:string,id=5209126900,extra={})=>({updateId:++update,messageId:1,chatId:-1001,threadId:3503,fromUser:{id},text,...extra}); let update=910000;
let writes=0; setTestAiAdminHooks(async()=>{writes++;return {status:200,data:{success:true}};},async()=>({action:'club_assign',targetId:'club-arsenal',body:{targetUserId:'@actual_owner'}}));
const unseen=await handleAiAdminCommand(payload('Arsenal klubini @actual_owner ga biriktir'),signal);
assert.match(await handleAiAdminCommand(payload('tasdiqlayman'),signal),/reja topilmadi/); assert.equal(writes,0);
await rememberDeliveredAdminPlan(payload('x'),unseen,55,signal);
assert.match(await handleAiAdminCommand(payload('tasdiqlayman',5209126900,{replyToMessage:{message_id:55,from:{id:999,is_bot:true}}}),signal),/reja topilmadi/);
const original=global.fetch;const sent:any[]=[];
global.fetch=async(input:any,init?:any)=>String(input).includes('api.telegram.org')?({ok:true,json:async()=>{const body=JSON.parse(init?.body||'{}');sent.push({method:String(input).split('/').pop(),...body});return {ok:true,result:{message_id:60000+sent.length}};}} as any):original(input,init);
try {
 clearTestAiState();clearTestRateLimitState();
 assert.equal((await handleTelegramAiMessage(payload('Arsenal klubini @actual_owner ga biriktir'))).replySent,true);
 const preview=sent.at(-1); assert.match(preview.text,/Arsenal|club-arsenal/);assert.ok(!/\/ai_confirm|HTTP|"action"/.test(preview.text));assert.equal(preview.message_thread_id,3503);
 assert.ok(preview.reply_markup.inline_keyboard[0][0].callback_data.startsWith('ai:confirm:'));
 assert.equal((await handleTelegramAiMessage(payload('tasdiqlayman'))).replySent,true);assert.equal(writes,1);assert.match(sent.at(-1).text,/Bajarildi/);
 await handleTelegramAiMessage(payload('tasdiqlayman'));assert.equal(writes,1);
 const {telegramRouter}=await import('../routes/telegram.routes');const app=express();app.use(express.json());app.use('/telegram',telegramRouter);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const url='http://127.0.0.1:'+(server.address() as any).port+'/telegram/webhook';
 const post=(body:any)=>original(url,{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Bot-Api-Secret-Token':process.env.TELEGRAM_WEBHOOK_SECRET!},body:JSON.stringify(body)});
 try {
  for(const text of ['/START@efluzbot','/help']) {const r=await post({update_id:++update,message:{message_id:77,chat:{id:-1001},message_thread_id:3503,from:{id:5209126900},text}});assert.equal(r.status,200); const msg=sent.filter(x=>x.method==='sendMessage').at(-1);assert.equal(msg.message_thread_id,3503);assert.equal(msg.reply_to_message_id,77);if(text.includes('START')){assert.ok(!JSON.stringify(msg.reply_markup).includes('web_app'));assert.ok(JSON.stringify(msg.reply_markup).includes('https://t.me/'));}}
  await handleTelegramAiMessage(payload('Arsenal klubini @actual_owner ga biriktir'));const button=sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data;
  const callback=(id:number)=>({update_id:++update,callback_query:{id:'cb-'+update,from:{id},data:button,message:{message_id:60000+sent.length,chat:{id:-1001},message_thread_id:3503}}});
  assert.equal((await post(callback(123))).status,200);assert.equal(writes,1);
  assert.equal((await post(callback(5209126900))).status,200);assert.equal(writes,2);
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
 setTestAiAdminHooks(async()=>{throw new Error('ADMIN_DATABASE_QUOTA');},async()=>({action:'club_release',targetId:'club-arsenal'}));
 const quota=await handleAiAdminCommand(payload('/ai_admin {"action":"club_release","targetId":"club-arsenal"}'),signal);await rememberDeliveredAdminPlan(payload('x'),quota,77,signal);
 assert.match(await handleAiAdminCommand(payload('tasdiqlayman'),signal),/Baza limiti/);
}finally{global.fetch=original;setTestAiAdminHooks();setTestConfigOverride(null);}
clearTestRateLimitState();const rate={chatId:-1009,threadId:3503,userId:1,userLimitPerMin:20,topicLimitPerMin:20,maxDailyRequests:1};
assert.equal((await checkAndIncrementAiRateLimits(rate)).allowed,true);
assert.equal((await checkAndIncrementAiRateLimits({...rate,userId:2})).shouldNotifyUser,true);
assert.equal((await checkAndIncrementAiRateLimits({...rate,userId:2})).shouldNotifyUser,false);
assert.equal((await checkAndIncrementAiRateLimits({...rate,countDaily:false})).allowed,true);
assert.equal((await checkAndIncrementAiRateLimits({...rate,countDaily:false,control:true})).allowed,true);
console.log('PASS natural owner-only delivered-plan confirmations, human previews/buttons, signed webhook callbacks, group start/help threading, quota explanation, non-model budget; Telegram mocked');
