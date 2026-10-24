import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { ReadModelKeys,redisSetRaw } from '../readModel/readModelStore';
import { planNaturalAdminRequest } from '../services/telegramAiNaturalAdminPlanner';
import { planReplyReminder,reminderSelectionFromLegacyHeader } from '../services/telegramAiReminderSelection';
import { handleTelegramAiMessage,clearTestAiState,setTestAiResponder,indexBotSentMessage } from '../services/telegramAiService';
import { setTestAiAdminHooks } from '../services/telegramAiAdminService';
import { DEFAULT_AI_CONFIG,setTestConfigOverride } from '../services/telegramAiConfigService';
import { clearTestRateLimitState } from '../services/telegramAiRateLimitService';
import { notifyOutstandingMatchdayOwners,type MatchdayReminderDependencies } from '../services/matchdayReminderService';
import { inspectAiAdminOutcome } from '../services/telegramAiAdminOutcome';

await initDatabase();
process.env.DATABASE_PROVIDER='supabase';process.env.TELEGRAM_BOT_TOKEN='777:isolated-reminder-reply';
const season='season-2026-27',bundes='comp-bundesliga-2026',apl='comp-premier-league-2026';
const comps=[{id:bundes,name:'Bundesliga',type:'LEAGUE',leagueId:'league-bundesliga',seasonId:season,currentMatchday:10,updatedAt:'2026-10-24T00:00:00Z'},{id:apl,name:'Premier League',type:'LEAGUE',leagueId:'league-premier-league',seasonId:season,currentMatchday:10}];
const clubs=[{id:'club-bayern',name:'Bayern Munich',leagueId:'league-bundesliga'},{id:'club-dortmund',name:'Borussia Dortmund',leagueId:'league-bundesliga'}];
const games=[1,9,10].map(matchday=>({id:`game-${matchday}`,competitionId:bundes,seasonId:season,matchday,status:'SCHEDULED' as const,scheduledAt:'2026-10-24T00:00:00Z',createdAt:'2026-10-24T00:00:00Z',updatedAt:'2026-10-24T00:00:00Z',homeClubId:'club-bayern',awayClubId:'club-dortmund',homeOwnerId:'user-home',awayOwnerId:'user-away'}));
const read:any=async(q:any)=>({data:q.dataset==='competitions'?comps.filter(c=>!q.competition||c.id===q.competition):games,complete:true,total:2});
const question="Bundesliga 9 turgacha o'ynalmagan o'yinlarga Eslatma yubor";
const plan=await planNaturalAdminRequest(question,{read,users:async()=>[]});
assert.equal(plan?.action,'matchday_remind');assert.equal(plan?.targetId,bundes);assert.deepEqual(plan?.body,{matchday:9,fromMatchday:1});
for(const text of ['Bundesliga 9-turgacha eslatma yuborma','Bundesliga 9-turgacha turni och','Bundesliga 9-turgacha eslatma yubor va 10-turni och'])await assert.rejects(planNaturalAdminRequest(text,{read,users:async()=>[]}),/CLARIFY/);
const source={competitionId:bundes,fromMatchday:1,toMatchday:9};
assert.equal((await planReplyReminder('Eslatma yubor',source,read))?.body.fromMatchday,1);
await assert.rejects(planReplyReminder('Eslatma yubor',undefined,read),/CLARIFY/);
assert.deepEqual(await reminderSelectionFromLegacyHeader('Bundesliga — 1–9-turlar\nO‘ynalmagan: 2 ta',read),source);
assert.equal(await reminderSelectionFromLegacyHeader('Bundesliga — 1–9-turlar\nManbalar to‘liq o‘qilmadi.',read),undefined);
assert.equal(await reminderSelectionFromLegacyHeader('Salom, hamma ligaga yubor',read),undefined);

const queued:any[]=[];
const deps:MatchdayReminderDependencies={fixtures:async()=>[...games,{...games[0],id:'other',competitionId:apl}],owners:async f=>f,submissions:async()=>[{submittedByUserId:'user-home'}],enqueue:async m=>{queued.push(m);return true;}};
const receipt=await notifyOutstandingMatchdayOwners({competitionId:bundes,seasonId:season,matchday:9,fromMatchday:1},deps);
assert.equal(receipt.queued,2);assert.equal(receipt.fromMatchday,1);assert.ok(queued.every(m=>m.userId==='user-away'));assert.ok(queued.some(m=>m.body.includes('Matchday 1')));assert.ok(queued.some(m=>m.body.includes('Matchday 9')));assert.ok(!queued.some(m=>m.body.includes('Matchday 10')));
assert.equal(inspectAiAdminOutcome(plan!,{success:true,...receipt}).state,'queued');
assert.match(inspectAiAdminOutcome(plan!,{success:true,...receipt}).message,/1–9/);
queued.length=0;
await notifyOutstandingMatchdayOwners({competitionId:bundes,seasonId:season,matchday:9,fromMatchday:1,fixtureIds:['game-9']},deps);
assert.equal(queued.length,1);assert.ok(queued[0].eventId.includes(':9:game-9:'));
queued.length=0;
await assert.rejects(notifyOutstandingMatchdayOwners({competitionId:bundes,seasonId:season,matchday:9,fromMatchday:1}, {...deps,submissions:async id=>{if(id==='game-9')throw Error('READ_DOWN');return [];}}),/READ_DOWN/);assert.equal(queued.length,0);

await redisSetRaw(ReadModelKeys.competitions(season),{data:comps});await redisSetRaw(ReadModelKeys.clubsWithOwners(season),{data:clubs});
await redisSetRaw(ReadModelKeys.competitionFixtures(bundes,season),{data:games});await redisSetRaw(ReadModelKeys.competitionFixtures(apl,season),{data:[]});
setTestConfigOverride({...DEFAULT_AI_CONFIG,enabled:true,allowedChatId:-1001,allowedThreadId:3503,rateLimitUserPerMin:20,rateLimitTopicPerMin:60});
clearTestAiState();setTestAiResponder(async()=>{throw Error('MODEL_MUST_NOT_RUN');});
let id=880000;const sent:any[]=[];const executed:any[]=[];const originalFetch=global.fetch;
const p=(text:string,replyToMessage?:any,user=5209126900)=>({chatId:user,threadId:0,fromUser:{id:user},text,updateId:++id,messageId:id,replyToMessage});
const token=()=>sent.at(-1)?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data?.split(':')[2];
global.fetch=async(input:any,init?:any)=>{assert.match(String(input),/api.telegram.org/);sent.push(JSON.parse(init.body));return Response.json({ok:true,result:{message_id:9000+sent.length}});};
setTestAiAdminHooks(async plan=>{executed.push(plan);return {status:200,data:{success:true,competitionId:plan.targetId,matchday:plan.body.matchday,fromMatchday:plan.body.fromMatchday,queued:2,skipped:0,failed:0,outstandingPlayers:2}};});
async function dispatch(payload:any){clearTestRateLimitState();assert.equal((await handleTelegramAiMessage(payload)).replySent,true);}
try{
 await dispatch(p('Bundesliga 9-turgacha o‘ynalmagan o‘yinlarni ko‘rsat'));
 const list={message_id:9000+sent.length,from:{id:777,is_bot:true},text:sent.at(-1).text};
 assert.match(list.text,/Bundesliga.*1–9/s);
 // Move latest conversation to another league, then reply to the older Bundesliga list.
 await dispatch(p('APL o‘yinlarini ko‘rsat'));
 await dispatch(p('Eslatma yubor',list));
 assert.match(sent.at(-1).text,/Bundesliga.*1–9/s);assert.ok(token());assert.equal(executed.length,0);
 const first=token();await dispatch(p('/ai_confirm '+first));assert.equal(executed.length,1);assert.equal(executed[0].targetId,bundes);assert.equal(executed[0].body.fromMatchday,1);assert.equal(executed[0].body.matchday,9);
 await dispatch(p('/ai_confirm '+first));assert.equal(executed.length,1,'Replayed confirmation cannot enqueue again');
 await dispatch(p('Eslatma yubor',list,7573478198));assert.ok(!token());assert.match(sent.at(-1).text,/Qaysi o‘yin/);
 await dispatch(p('Eslatma yubor',{...list,message_id:999999}));assert.ok(!token());
 await dispatch(p('Eslatma yubor',{...list,from:{id:888,is_bot:true}}));assert.ok(!token());
 await dispatch(p('Bundesliga 9-tur o‘yinlarini ko‘rsat'));
 const single={message_id:9000+sent.length,from:{id:777,is_bot:true},text:sent.at(-1).text};
 await dispatch(p('Eslatma yubor',single));assert.ok(token());assert.match(sent.at(-1).text,/reply qilingan 1 ta o‘yin/);
 const exact=token();await dispatch(p('/ai_confirm '+exact));assert.equal(executed.length,2);assert.deepEqual(executed[1].body.fixtureIds,['game-9']);
 await indexBotSentMessage(8900,5209126900,0,5209126900);
 await dispatch(p('Eslatma yubor',{message_id:8900,from:{id:777,is_bot:true},text:'Bundesliga — 1–9-turlar\nO‘ynalmagan: 2 ta'}));assert.ok(token());assert.match(sent.at(-1).text,/1–9/);
 await dispatch(p(question));assert.match(sent.at(-1).text,/Bundesliga.*1–9/s);assert.ok(token());assert.equal(executed.length,2);
}finally{global.fetch=originalFetch;setTestAiAdminHooks();setTestAiResponder(null);setTestConfigOverride(null);clearTestAiState();}
console.log('PASS exact Bundesliga 1–9 inclusive reminder, reply-specific older list despite newer APL context, owner/message/bot isolation, delivered preview and once-only confirmation, bounded fixture recipients, per-game round labels and fail-closed range reads; Telegram/execution mocked');
