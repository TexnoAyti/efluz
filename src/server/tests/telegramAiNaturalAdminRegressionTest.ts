import assert from 'node:assert/strict';
import { contextualFixturePlan } from '../services/telegramAiFixtureContext';
import { planNaturalAdminRequest, type NaturalPlannerDependencies } from '../services/telegramAiNaturalAdminPlanner';
import { detectNaturalAdminAction } from '../services/telegramAiAdminLanguage';
import { getConversationIntent } from '../services/telegramAiConversationCommands';
import { assertAdminPlanReady, validateModelAdminPlan } from '../services/telegramAiAdminPlanReadiness';
import { createAiTournamentReader } from '../services/telegramAiDataService';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { redisSetRaw, ReadModelKeys } from '../readModel/readModelStore';
import { getFirestoreDb } from '../firebase/admin';
import { describeAiAdminPlan, handleAiAdminCommand, setTestAiAdminHooks, rememberDeliveredAdminPlan } from '../services/telegramAiAdminService';
import { DEFAULT_AI_CONFIG, setTestConfigOverride } from '../services/telegramAiConfigService';
import type { AdminPlan } from '../services/telegramAiAdminCatalog';

const season='season-2026-27', serie='comp-serie-a-2026', liga='comp-la-liga-2026', cup='comp-fa-cup-2026', epl='comp-premier-league-2026';
const comps=[{id:epl,name:'Premier League',type:'LEAGUE',leagueId:'league-premier-league',seasonId:season},{id:serie,name:'Serie A',type:'LEAGUE',leagueId:'league-serie-a',seasonId:season},{id:liga,name:'La Liga',type:'LEAGUE',leagueId:'league-la-liga',seasonId:season},{id:cup,name:'FA Cup',type:'DOMESTIC_CUP',seasonId:season}];
// Roster order deliberately differs from user-specified score order.
const clubs=[{id:'club-arsenal',name:'Arsenal',shortName:'ARS',leagueId:'league-premier-league'},{id:'club-nottm-forest',name:'Nottingham Forest',shortName:'NFO',leagueId:'league-premier-league'},{id:'club-milan',name:'AC Milan',leagueId:'league-serie-a'},{id:'club-inter',name:'Inter Milan',leagueId:'league-serie-a'},{id:'club-heidenheim',name:'1. FC Heidenheim',leagueId:'league-bundesliga'}];
const fixtures=[1,10].map(matchday=>({id:'game-'+matchday,competitionId:serie,seasonId:season,matchday,status:'CONFIRMED',homeClubId:'club-milan',awayClubId:'club-inter',homeClubName:'AC Milan',awayClubName:'Inter Milan',homeScore:0,awayScore:1}));
const bridge=await startMockUpstashBridge();
const signal=new AbortController().signal;
let writes=0,firestore=0;
const db=getFirestoreDb(), originalCollection=db.collection.bind(db);
db.collection=(()=>{firestore++;throw new Error('RESOURCE_EXHAUSTED');}) as any;
const snapshot=(data:any)=>({data,generatedAt:new Date().toISOString()});
const payload=(text:string,id=5209126900)=>({updateId:1,messageId:1,chatId:-1001,threadId:3503,fromUser:{id},text});
try {
 await redisSetRaw(ReadModelKeys.competitions(season),snapshot(comps));
 await redisSetRaw(ReadModelKeys.clubsWithOwners(season),snapshot(clubs));
 await redisSetRaw(ReadModelKeys.competitionFixtures(serie,season),snapshot(fixtures));
 await redisSetRaw(ReadModelKeys.competitionFixtures(epl,season),snapshot([{id:'forest-11',competitionId:epl,seasonId:season,matchday:11,status:'SCHEDULED',homeClubId:'club-nottm-forest',awayClubId:'club-arsenal',homeClubName:'Nottingham Forest',awayClubName:'Arsenal'}]));
 await redisSetRaw('efluz:v1:admin:user-directory',snapshot([{id:'user-123',username:'inter_fan',telegramId:'123'}]));
 const deps:NaturalPlannerDependencies={read:createAiTournamentReader(signal).read,users:async()=>[{id:'user-123',username:'inter_fan',telegramId:'123'}]};
 const followup=await contextualFixturePlan('hisobni 3-2 qil',['game-10'],signal);
 assert.deepEqual(followup,{action:'result_edit',targetId:'game-10',body:{homeScore:3,awayScore:2,status:'CONFIRMED'}});
 await assert.rejects(contextualFixturePlan('hisobni 3-2 qil',[],signal),/Qaysi o‘yin/);
 await assert.rejects(contextualFixturePlan('hisobni 3-2 qil',['game-10','game-1'],signal),/Qaysi o‘yin/);
 await assert.rejects(contextualFixturePlan('hisobni 3-2 qil',['deleted-fixture'],signal),/hozir bazada/);
 assert.equal(await contextualFixturePlan('shu Nottingham 5-1 Arsenal 11-tur natijasini saqla',['game-10'],signal),null);
 assert.equal(await contextualFixturePlan('natijani UnknownClub 3-2 qil',['game-10'],signal),null);
 const cases:Array<[string,string,any]>=[
  ['Nottingham 5-1 Arsenal 11-tur natijasini kirit','result_edit',{homeScore:5,awayScore:1,status:'CONFIRMED'}],
  ['Nottingham 5-1 Arsenal 11 tur buni kiritib qoygin','result_edit',{homeScore:5,awayScore:1,status:'CONFIRMED'}],
  ['Arsenal 1-5 Nottingham 11-tur natijasini saqla','result_edit',{homeScore:5,awayScore:1,status:'CONFIRMED'}],
  ['Nottingham Forest — Arsenal 11-tur 0:0 tasdiqla','result_approve',{homeScore:0,awayScore:0}],
  ['Arsenal 1-5 Nottingham fixture id: forest-11 natijasini saqla','result_edit',{homeScore:5,awayScore:1,status:'CONFIRMED'}],
  ['Inter — Milan 10-tur natijasini 2-1 qil','result_edit',{homeScore:1,awayScore:2,status:'CONFIRMED'}],
  ['Milan — Inter 10-tur natijasini 3-2 tasdiqla','result_approve',{homeScore:3,awayScore:2}],
  ['Inter va Milan 10-tur natijasini o‘chir','result_clear',{}],
  ['Inter Milan 10-tur natijasini rad et','result_reject',{}],
  ['Inter Milan 10-tur o‘yinini qayta och','fixture_reopen',{}],
  ['Inter Milan 10-tur o‘yiniga eslatma yubor','fixture_remind',{}],
  ['Inter Milan 10-tur o‘yinini o‘chir sabab: dublikat','fixture_delete',{reason:'dublikat'}],
  ['Inter Milan 10-tur o‘yin muddatini o‘zgartir 2026-10-06T21:00:00+05:00','fixture_deadline',{deadlineAt:'2026-10-06T21:00:00+05:00'}],
  ['Heidenheim klubini egasidan bo‘shat','club_release',{}],
  ['@inter_fan faqat La Liga uchun admin qil','user_role',{isAdmin:true,adminPermissions:{scope:'LEAGUES',leagueIds:['league-la-liga']}}],
  ['@inter_fan barcha ligalar uchun admin qil','user_role',{isAdmin:true,adminPermissions:{scope:'ALL',leagueIds:[]}}],
  ['@inter_fan admin ruxsatini olib tashla','user_role',{isAdmin:false}],
  ['@inter_fan ni blokla sabab: qoidabuzarlik','user_suspend',{isSuspended:true,reason:'qoidabuzarlik'}],
  ['@inter_fan ni blokdan chiqar','user_suspend',{isSuspended:false}],
  ['@inter_fan ga premium ber','premium_grant',{userId:'user-123'}],
  ['@inter_fan premiumini bekor qil','premium_revoke',{userId:'user-123'}],
  ['user-123 foydalanuvchini o‘chir sabab: o‘z so‘rovi','user_delete',{reason:'o‘z so‘rovi'}],
  ['La Liga jadvalini qayta hisobla','standings_rebuild',{}],
  ['La Liga o‘yinlarini yarat','fixtures_generate',{competitionId:liga}],
  ['Angliya Kubogi qur’asini ko‘rib chiq','cup_preview',{}],
  ['Angliya Kubogi o‘yinlarini yarat','cup_preview',{}],
  ['Angliya Kubogi juftliklarini moslashtir','cup_reconcile',{}],
  ['Angliya Kubogini keyingi bosqichga o‘tkaz','cup_advance',{}],
  ['La Liga 10-turni tanla','matchday_control',{action:'SELECT',matchday:10}],
  ['La Liga keyingi turga o‘tkaz','matchday_advance',{}],
  ['AI yordamchini o‘chir','ai_config',{enabled:false}],
  ['AI yordamchini yoq','ai_config',{enabled:true}],
  ['xabarnomani yashir id: broadcast-1','notification_message',{visibility:'hidden'}],
  ['xabarnoma turi MATCH_REMINDER id: MATCH_REMINDER yashir','notification_type',{visible:false}],
  ['keshni yangila','read_model_rebuild',{}],
  ['sinxronla','sync',{}],
  ['mavsumni arxivla season-2026-27','season_archive',{seasonId:season,confirmation:'ARCHIVE_COMPLETED_SEASON'}],
  ['yangi mavsum yarat season-2026-27','season_rollover',{seasonId:season,confirmation:'CREATE_NEXT_SEASON_SHELL'}],
  ['deadline muddatlarini tekshir','deadline_sweep',{}],
  ['foydalanuvchilarni ko‘rsat','users',{limit:10}],
  ['AI sozlamalarini ko‘rsat','ai_settings',{}],
 ];
 for(const [text,action,body] of cases){
  assert.equal(getConversationIntent(text),'admin',text);
  const plan=await planNaturalAdminRequest(text,deps).catch(error=>{throw new Error(text+': '+error.message)});
  const expectedBody = /^user_|^premium_/.test(action) && text.includes('@inter_fan') ? {...body,expectedUsername:'inter_fan'} : body;
  assert.equal(plan?.action,action,text);assert.deepEqual(plan?.body,expectedBody,text);assertAdminPlanReady(plan!);
  const slash=await planNaturalAdminRequest('/ai_admin@efluzbot '+text,deps);
  assert.equal(slash?.action,action,'slash '+text);assert.deepEqual(slash?.body,expectedBody,'slash '+text);
 }
 const scorePreview=describeAiAdminPlan({action:'result_edit',targetId:'forest-11',body:{homeScore:5,awayScore:1}},'Nottingham Forest — Arsenal, Premier League, Matchday 11, SCHEDULED');
 assert.match(scorePreview,/Nottingham Forest 5:1 Arsenal/);assert.match(scorePreview,/G‘olib: Nottingham Forest/);
 const wrongModel:AdminPlan={action:'result_edit',targetId:'forest-11',body:{homeScore:1,awayScore:5,status:'CONFIRMED'}};
 await validateModelAdminPlan(wrongModel,'Nottingham 5-1 Arsenal 11 tur buni kiritib qoygin',signal);
 assert.deepEqual(wrongModel.body,{homeScore:5,awayScore:1,status:'CONFIRMED'},'Model score order cannot override explicit named teams');
 await assert.rejects(validateModelAdminPlan({action:'result_edit',targetId:'forest-11',body:{homeScore:5,awayScore:1}},'Arsenal 5-1 11-tur natijasini saqla',signal),/ikkala jamoa/);
 const announce=await planNaturalAdminRequest('Hammaga e’lon yubor\nSarlavha: Yangi tur\nMatn: Inter — Milan natijasini o‘chir degan buyruqni yozmang.',deps);
 assert.equal(announce?.action,'broadcast');assert.equal(announce?.body.targetAudience,'ALL_USERS');
 const personal=await planNaturalAdminRequest('@inter_fan ga xabar yubor\nSarlavha: Eslatma\nMatn: O‘yin vaqti',deps);
 assert.equal(personal?.body.targetAudience,'SELECTED_RECIPIENTS');assert.deepEqual(personal?.body.selectedUserIds,['user-123']);assert.equal(personal?.body.expectedUsername,'inter_fan');
 assert.equal(detectNaturalAdminAction('Inter nechanchi o‘rinda?'),null);
 for(const [text,expected] of [
  ['Arsenal 5-1 11-tur natijasini saqla',/ikkala jamoa/],
  ['Arsneal 1-5 Nottingham 11-tur natijasini kirit',/yozuv xatosi/],
  ['Unknown Club 5-1 Arsenal 11-tur natijasini saqla',/ikkala jamoa/],
  ['Inter Milan natijasini o‘chir',/Bir nechta o‘yin/],
  ['@inter_fan admin qil',/qaysi ligani/],
  ['@unknown_user ni blokla',/topilmadi/],
  ['@inter_fan @second_owner ni blokla',/Bitta @username/],
  ['Inter Milan 10-tur o‘yinini o‘chir',/sabab yozing/],
  ['Inter Milan 10-tur natijasini tasdiqla',/Qaysi hisob/],
  ['Inter Milan 9-tur natijasini o‘chir',/topilmadi/],
  ['Heidenheim va Milan klublarini egasidan bo‘shat',/bitta klub/],
  ['@inter_fan ni blokla va premium ber',/Bitta aniq amal/],
  ['La Liga va Serie A jadvalini qayta hisobla',/Bitta turnir/],
  ['hammaga e’lon yubor',/sarlavhasi/],
 ] as const)await assert.rejects(planNaturalAdminRequest(text,deps),expected,text);
 assert.throws(()=>assertAdminPlanReady({action:'result_edit',targetId:'game-10',body:{}}),/uy jamoasi hisobi/);
 await assert.rejects(validateModelAdminPlan({action:'fixture_delete',targetId:'game-10',body:{reason:'score clear'}},'Inter natijasini o‘chir',signal),/Faqat natijani/);
 await assert.rejects(validateModelAdminPlan({action:'club_release',targetId:'club-fake',body:{}},'Fake klubini bo‘shat',signal),/aniq topilmadi/);
 await assert.rejects(validateModelAdminPlan({action:'cup_generate',targetId:cup,body:{confirmation:true,drawSeed:'invented'}},'Angliya Kubogi qur’a yarat',signal),/server bergan/);
 setTestConfigOverride({...DEFAULT_AI_CONFIG,enabled:true,allowedChatId:-1001,allowedThreadId:3503});
 setTestAiAdminHooks(async()=>{writes++;return {status:200,data:{success:true}};});
 for(const text of ['Inter — Milan 10-tur natijasini 2-1 qil','@inter_fan faqat La Liga uchun admin qil','@inter_fan ga premium ber','Heidenheim klubini egasidan bo‘shat'])assert.match(await handleAiAdminCommand(payload(text),signal),/\/ai_confirm/);
 assert.match(await handleAiAdminCommand(payload('Inter Milan natijasini o‘chir'),signal),/Bir nechta o‘yin/);
 assert.match(await handleAiAdminCommand(payload('@inter_fan ni blokla',123),signal),/faqat asosiy admin/);
 assert.match(await handleAiAdminCommand(payload('foydalanuvchilarni ko‘rsat'),signal),/shaxsiy chat/);
 const contextPreview=await handleAiAdminCommand(payload('Inter — Milan 10-tur natijasini 2-1 qil'),signal);
 await rememberDeliveredAdminPlan(payload('x'),contextPreview,444,signal);
 const changedPreview=await handleAiAdminCommand(payload('hisobni 3-2 qil'),signal);
 assert.match(changedPreview,/AC Milan 3:2 Inter Milan/);assert.match(changedPreview,/Hali bajarilmadi/);
 assert.match(await handleAiAdminCommand({...payload('hisobni 3-2 qil'),threadId:999},signal),/faol emas/);
 assert.equal(writes,0);assert.equal(firestore,0);
 console.log('PASS 36 native action phrases, exact score orientation, full ambiguity/missing-field checks, owner-only cached previews, zero model/Firestore/writes');
} finally {db.collection=originalCollection;await bridge.close();setTestAiAdminHooks();}
const executed:AdminPlan[]=[];
setTestAiAdminHooks(async(plan)=>{executed.push(plan);return plan.action==='cup_preview' ? {status:200,data:{canGenerate:true,drawSeed:'server-only-seed',competitionName:'FA Cup',totalTeams:20,mode:'CREATE'}} : {status:200,data:{success:true}};},async()=>({action:'cup_preview',targetId:cup,body:{}}));
try {
 const original=await handleAiAdminCommand(payload('Angliya Kubogi qur’a tashla'),signal);
 await rememberDeliveredAdminPlan(payload('x'),original,11,signal);
 const followup=await handleAiAdminCommand(payload('tasdiqlayman'),signal);
 assert.equal(executed.length,1);assert.equal(executed[0].action,'cup_preview');assert.match(followup,/Hali o‘yinlar yaratilmagan/);
 assert.equal(executed.some(p=>p.action==='cup_generate'),false);
 await rememberDeliveredAdminPlan(payload('x'),followup,12,signal);
 assert.match(await handleAiAdminCommand(payload('tasdiqlayman'),signal),/Bajarildi/);
 assert.equal(executed.length,2);assert.deepEqual(executed[1].body,{drawSeed:'server-only-seed',confirmation:true});
 await handleAiAdminCommand(payload('tasdiqlayman'),signal);assert.equal(executed.length,2);
 console.log('PASS cup generation requires second delivered owner confirmation, authoritative seed, no duplicate generation; mocked execution only');
}finally{setTestAiAdminHooks();setTestConfigOverride(null);}
