import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { handleTopicResultUpdate, planTopicResult, competitionResultTopic, topicResultSeason, setTestTopicResultDependencies } from '../services/telegramTopicResults';
import { adminEditFixtureResultFirestore } from '../firebase/firestoreStore';
import { assertTopicResultCurrent } from '../services/topicResultGuard';

await initDatabase();
process.env.DATABASE_PROVIDER = 'supabase';
process.env.SUPABASE_DATA_NAMESPACE = 'preview';
process.env.TELEGRAM_BOT_TOKEN = '777:topic-result-test';
const db = getFirestoreDb(), signal = new AbortController().signal;
const seasonId = 'season-2026-27', liga = 'comp-la-liga-2026', cup = 'comp-copa-del-rey-2026';
const competitions: any[] = [{ id: liga, name: 'La Liga', type: 'LEAGUE', leagueId: 'league-la-liga', seasonId, currentMatchday: 11 }, { id: cup, name: 'Copa del Rey', type: 'KNOCKOUT', leagueId: 'league-la-liga', seasonId }];
const clubs: any[] = [{ id: 'club-real-madrid', name: 'Real Madrid', leagueId: 'league-la-liga', ownerUserId: 'user-1001' }, { id: 'club-barcelona', name: 'Barcelona', leagueId: 'league-la-liga', ownerUserId: 'user-1002' }];
const fixture = (id: string, competitionId: string) => ({ id, competitionId, seasonId, homeClubId: clubs[0].id, awayClubId: clubs[1].id, home: 'Real Madrid', away: 'Barcelona', competition: competitionId === liga ? 'La Liga' : 'Copa del Rey', matchday: 11, status: 'SCHEDULED', updatedAt: 'v1' });
let games: any[] = [fixture('league-game', liga), fixture('cup-game', cup)];
const reader: any = { read: async (q: any) => {const all=q.dataset === 'competitions' ? competitions : games.filter(f => (!q.competition || f.competitionId === q.competition) && (!q.matchday || f.matchday === q.matchday) && (!q.club || [f.homeClubId,f.awayClubId].includes(q.club)) && (!q.opponent || [f.homeClubId,f.awayClubId].includes(q.opponent)));const offset=q.offset||0,limit=q.limit||30;return {complete:true,stale:false,data:all.slice(offset,offset+limit),nextOffset:offset+limit<all.length?offset+limit:null};} };
let executions = 0;
setTestTopicResultDependencies({ reader, ownership: async () => ({ data: clubs, available: true, stale: false }), authorize: async id => id === 5209126900,
  execute: async plan => { executions++; const f = games.find(f => f.id === plan.targetId); assertTopicResultCurrent(f, plan.body.expectedFixture as any); Object.assign(f, plan.body, {updatedAt:'v2'}); return {status:200,data:{success:true,fixture:{...f}}}; } });
assert.equal(competitionResultTopic(competitions[0]), 3); assert.equal(competitionResultTopic(competitions[1]), 8);
assert.equal(topicResultSeason(2),'season-2027-28','current domestic league must use Season 2');
assert.equal(topicResultSeason(7),'season-2026-27','existing UEFA fixtures remain in Season 1');
assert.equal(topicResultSeason(2335),'season-2026-27','Season 1 Super Cup stays open');
assert.equal(topicResultSeason(11429),'season-2026-27','Verified UEL thread uses Season 1');
assert.equal(topicResultSeason(11972),'season-2027-28','Verified Asian thread uses Season 2');
assert.equal(topicResultSeason(6),'season-2027-28','Ligue 1 topic keeps Season 2');
const europaComp={id:'comp-europa-league-2026',name:'UEFA Europa League',type:'EUROPEAN_LEAGUE_PHASE',seasonId,leagueId:null};
assert.equal(competitionResultTopic(europaComp as any),11429,'Europa League uses its separately verified topic');
assert.equal(competitionResultTopic({id:'comp-champions-league-2026',name:'UEFA Champions League'} as any),7,'UCL stays separate from UEL');
assert.equal(competitionResultTopic({id:'comp-japan-2027',name:'Japan J1 League',leagueId:'league-japan'} as any),11972,'Asia uses its verified topic');
const fillers=Array.from({length:32},(_,i)=>({id:'comp-dummy-'+i,name:'Other League '+i,type:'LEAGUE',seasonId,leagueId:'other-'+i}));
competitions.push(...fillers,europaComp as any);
games.push({...fixture('europa-game',europaComp.id),competition:'UEFA Europa League'});
assert.equal((await planTopicResult('Real Madrid 2-1 Barca',1001,11429,signal))?.plan.targetId,'europa-game','Must paginate beyond the first 30 competitions and resolve Europa fixture');
assert.equal((await planTopicResult('Real Madrid 1-1 Barca',1001,11429,signal))?.plan.body.homeScore,1,'Draws are legal in UEFA league phase');
await assert.rejects(planTopicResult('Real Madrid 1-1 Barca penalti 4-3',1001,11429,signal),/penaltilar bo‘lmaydi/);
competitions.splice(competitions.length-fillers.length-1);
games.pop();
// Asia is routable as soon as a real league and match exist in the verified
// season catalog. No synthetic fixture is created in production.
await assert.rejects(planTopicResult('Kashima 2-1 Urawa',1001,11972,signal),/Osiyo ligalari.*hali topilmadi/);
const asia={id:'comp-japan-2027',name:'Japan J1 League',type:'LEAGUE',seasonId:'season-2027-28',leagueId:'league-japan',currentMatchday:1};
const kashima={id:'club-kashima',name:'Kashima Antlers',leagueId:'league-japan',ownerUserId:'user-1001'};
const urawa={id:'club-urawa',name:'Urawa Reds',leagueId:'league-japan',ownerUserId:'user-1002'};
competitions.push(asia);clubs.push(kashima,urawa);
games.push({...fixture('japan-match',asia.id),seasonId:asia.seasonId,home:'Kashima Antlers',away:'Urawa Reds',homeClubId:kashima.id,awayClubId:urawa.id,competition:'Japan J1 League',matchday:1});
assert.equal((await planTopicResult('Kashima Antlers 2-1 Urawa Reds',1001,11972,signal))?.plan.targetId,'japan-match','Verified Asia league match must resolve in topic 11972');
competitions.pop();clubs.splice(-2);games.pop();

assert.equal((await planTopicResult('Real Madrid 1-2 Barca',1001,3,signal))?.plan.targetId, 'league-game');
assert.equal((await planTopicResult('Barca 2-1 Real Madrid',1002,8,signal))?.plan.targetId, 'cup-game');
assert.equal((await planTopicResult('2-1',1002,3,signal))?.plan.body.homeScore, 1);
await assert.rejects(planTopicResult('Real Madrid 2-1 Barca La Liga',1001,8,signal), /boshqa turnir/);
await assert.rejects(planTopicResult('Real Madrid 2-1 Barca',9999,3,signal), /klub biriktirilganligi/);
await assert.rejects(planTopicResult('Real Madrid 1-1 Barca',1001,8,signal), /penalti/);
assert.equal(await planTopicResult('Agar Real Madrid 2-1 Barca bo‘lsa nima bo‘ladi?',1001,3,signal), null);
// Real production failure: named teams played round 6 while the league clock was 5.
// Verify planning, ownership and score orientation in every domestic league.
const originalGames=games;
for (const [leagueId,name,thread] of [['league-premier-league','Premier League',2],['league-la-liga','La Liga',3],['league-serie-a','Serie A',4],['league-bundesliga','Bundesliga',5],['league-ligue-1','Ligue 1',6]] as const) {
  const comp={id:'round-test-'+leagueId,name,type:'LEAGUE',leagueId,seasonId,currentMatchday:5};
  const home={id:'club-torino',name:'Torino',leagueId,ownerUserId:'user-1001'};
  const away={id:'club-monza',name:'Monza',leagueId,ownerUserId:'user-1002'};
  competitions.push(comp); clubs.push(home,away);
  games=[{...fixture('round-six-'+leagueId,comp.id),homeClubId:away.id,awayClubId:home.id,home:'Monza',away:'Torino',matchday:6}];
  const planned=await planTopicResult('Torino 4-3 Monza',1001,thread,signal);
  assert.equal(planned?.plan.targetId,games[0].id); assert.equal(planned?.plan.body.homeScore,3); assert.equal(planned?.plan.body.awayScore,4);
  await assert.rejects(planTopicResult('Torino 4-3 Monza 5-tur',1001,thread,signal),error => {
    assert.match(String(error),/5-tur.*shu turda o‘yin topilmadi/s); assert.match(String(error),/Monza — Torino.*6-tur/s); return true;
  });
  assert.equal((await planTopicResult('Torino 4-3 Monza 6-tur',1001,thread,signal))?.plan.targetId,games[0].id);
  for (const text of ['4-3', '4-3 5-tur']) {
    await assert.rejects(planTopicResult(text,1001,thread,signal),error => {
      assert.match(String(error),/shu turda o‘yin topilmadi.*Monza — Torino.*6-tur.*Variant raqamini/s);
      return true;
    });
  }
  const bareRound=await planTopicResult('4-3 6-tur',1001,thread,signal);
  assert.equal(bareRound?.plan.targetId,games[0].id);
  assert.equal(bareRound?.plan.body.homeScore,3);
  assert.equal(bareRound?.plan.body.awayScore,4);
  games.push({...games[0],id:'return-leg-'+leagueId,matchday:25});
  await assert.rejects(planTopicResult('Torino 4-3 Monza',1001,thread,signal),error => {
    assert.match(String(error),/Bir nechta.*6-tur.*25-tur/s); return true;
  });
  games[1].status='CONFIRMED';
  assert.equal((await planTopicResult('Torino 4-3 Monza',1001,thread,signal))?.plan.targetId,games[0].id);
  competitions.pop(); clubs.splice(-2);
}
games=originalGames;
// A user's match can be outside the first 30 fixture rows; a page limit
// cannot make the AI silently miss an otherwise verified current game.
const pagingComp={id:'page-fixtures-league',name:'La Liga',type:'LEAGUE',seasonId,leagueId:'league-la-liga',currentMatchday:31};
competitions.push(pagingComp);
const savedGames=games;
games=Array.from({length:31},(_,i)=>({...fixture('paged-fixture-'+i,pagingComp.id),matchday:i+1,status:i===30?'SCHEDULED':'CONFIRMED'}));
const paged=await planTopicResult('2-1 31-tur',1001,3,signal);
assert.equal(paged?.plan.targetId,'paged-fixture-30','A valid fixture beyond page one must be recognized');
assert.equal((paged?.plan.body.expectedFixture as any)?.seasonId,seasonId,'Proposal must bind exact season');
assert.throws(()=>assertTopicResultCurrent(
 {...games[30],seasonId:'season-2027-28'},
 paged!.plan.body.expectedFixture as any
),/o‘zgargan/,'A mismatched season cannot be confirmed');
games=savedGames;competitions.pop();
const reported=games[0];
Object.assign(reported,{status:'CONFIRMED',homeScore:3,awayScore:2});
await assert.rejects(planTopicResult('Real Madrid 4-1 Barca',1001,3,signal),/allaqachon tasdiqlangan.*Real Madrid 3:2 Barcelona/s);
reported.status='DISPUTED';
await assert.rejects(planTopicResult('Real Madrid 4-1 Barca',1001,3,signal),/natija nizoli.*Admin ko‘rib chiqishi kerak/s);
reported.status='SCHEDULED'; delete reported.homeScore; delete reported.awayScore;
games.push(fixture('second-cup-game',cup));
await assert.rejects(planTopicResult('Real Madrid 2-1 Barca',1001,8,signal), /Bir nechta/); games.pop();
const originalFetch = global.fetch, sent: any[] = [], alerts: any[] = [];
let sequence = 100000;
const update = (text: string, thread = 3, sender = 1001) => ({ update_id: ++sequence, message: { message_id: sequence, message_thread_id: thread, chat: { id:-1001,type:'supergroup',username:'efleagueuz' }, from: {id:sender}, text } });
const callback = (message: any, data: string, actor = 5209126900) => ({ update_id: ++sequence, callback_query: { id:'cb-'+sequence, from:{id:actor}, data, message: { message_id:message.botId, message_thread_id:message.message_thread_id, chat:{id:-1001},from:{id:777} } } });
global.fetch = async (_input: any, init?: any) => {
  const body = JSON.parse(init.body);
  if (body.callback_query_id) { alerts.push(body); return new Response(JSON.stringify({ok:true})); }
  body.botId = 9000 + sent.length; sent.push(body);
  return new Response(JSON.stringify({ok:true,result:{message_id:body.botId}}));
};
try {
  const source = update('Real Madrid 1-2 Barca');
  assert.equal((await handleTopicResultUpdate(source)).result, 'proposal_sent');
  const first = sent.at(-1);
  assert.equal(first.reply_parameters.message_id, source.message.message_id); assert.equal(first.message_thread_id, 3);
  assert.match(first.text, /Real Madrid 1:2 Barcelona.*La Liga/s);
  const token = first.reply_markup.inline_keyboard[0][0].callback_data;
  assert.equal(executions, 0);
  assert.equal((await handleTopicResultUpdate(callback(first,token,1001))).result, 'unauthorized');
  assert.equal(executions, 0);
  assert.equal((await handleTopicResultUpdate(source)).result, 'duplicate_source');
  const race = await Promise.all([handleTopicResultUpdate(callback(first,token)),handleTopicResultUpdate(callback(first,token))]);
  assert.equal(race.filter(r=>r.result==='executing').length,1); assert.equal(executions,1);
  assert.match(sent.at(-1).text,/Natija saqlandi:.*Real Madrid — Barcelona.*La Liga.*11-tur.*Hisob: 1:2/s);
  assert.equal((await handleTopicResultUpdate(callback(first,token))).result, 'already_processed');
  const cupSource = update('Barca 2-3 Real Madrid',8,1002);
  assert.equal((await handleTopicResultUpdate(cupSource)).result, 'proposal_sent');
  const old = sent.at(-1), oldToken=old.reply_markup.inline_keyboard[0][0].callback_data;
  const edited = {update_id:++sequence,edited_message:{...cupSource.message,text:'Barca 1-3 Real Madrid'}};
  assert.equal((await handleTopicResultUpdate(edited)).result, 'proposal_sent');
  const current = sent.at(-1), currentToken=current.reply_markup.inline_keyboard[0][0].callback_data;
  assert.match(current.text, /Real Madrid 3:1 Barcelona.*Copa del Rey/s);
  assert.equal((await handleTopicResultUpdate(callback(old,oldToken))).result, 'already_processed');
  assert.equal((await handleTopicResultUpdate(edited)).result, 'duplicate_source');
  const wrongPlace = callback(current,currentToken); wrongPlace.callback_query.message.message_thread_id=3;
  assert.equal((await handleTopicResultUpdate(wrongPlace)).result,'invalid');
  assert.equal((await handleTopicResultUpdate(callback(current,currentToken))).result,'executing'); assert.equal(executions,2);
  const unrelated=update('Real Madrid 2-1 Barca'); unrelated.message.chat.username='unrelated'; assert.equal((await handleTopicResultUpdate(unrelated)).handled,false);
  const forwarded=update('Real Madrid 2-1 Barca'); (forwarded.message as any).forward_origin={type:'user'}; assert.equal((await handleTopicResultUpdate(forwarded)).handled,false);
  games.push(fixture('caption-game',liga));
  const caption=update('Real Madrid 2-1 Barca');
  (caption.message as any).caption=caption.message.text; delete (caption.message as any).text;
  (caption.message as any).photo=[{file_id:'mock-photo'}];
  assert.equal((await handleTopicResultUpdate(caption)).result,'proposal_sent');
  const captionReply=sent.at(-1), rejectToken=captionReply.reply_markup.inline_keyboard[0][1].callback_data;
  assert.equal((await handleTopicResultUpdate(callback(captionReply,rejectToken))).result,'cancelled');
  assert.equal(executions,2); assert.equal(games.at(-1).status,'SCHEDULED');
  assert.equal((await handleTopicResultUpdate(callback(captionReply,captionReply.reply_markup.inline_keyboard[0][0].callback_data))).result,'already_processed');
  // A real 400 validation error must not strand subsequent approval buttons.
  // The first click fails; a new result proposal for the same unsaved fixture
  // must then be independently confirmable exactly once.
  let validationFails = true;
  setTestTopicResultDependencies({
    reader,
    ownership: async () => ({ data:clubs,available:true,stale:false }),
    authorize: async id => id === 5209126900,
    execute: async plan => {
      if (validationFails) {
        validationFails = false;
        return { status:400, data:{ success:false,error:'VALIDATION_ERROR',message:'validation error' } };
      }
      executions++;
      const found = games.find(f=>f.id===plan.targetId)!;
      assertTopicResultCurrent(found,plan.body.expectedFixture as any);
      Object.assign(found,plan.body,{updatedAt:'v3'});
      return {status:200,data:{success:true,fixture:{...found}}};
    },
  });
  const rejectedSource=update('Real Madrid 1-2 Barca');
  assert.equal((await handleTopicResultUpdate(rejectedSource)).result,'proposal_sent');
  const rejectedPrompt=sent.at(-1);
  const rejectedToken=rejectedPrompt.reply_markup.inline_keyboard[0][0].callback_data;
  assert.equal((await handleTopicResultUpdate(callback(rejectedPrompt,rejectedToken))).result,'executing');
  assert.match(sent.at(-1).text,/Natija saqlanmadi: validation error/);
  const retriedSource=update('Real Madrid 1-2 Barca');
  assert.equal((await handleTopicResultUpdate(retriedSource)).result,'proposal_sent');
  const retryPrompt=sent.at(-1);
  const retryToken=retryPrompt.reply_markup.inline_keyboard[0][0].callback_data;
  assert.equal((await handleTopicResultUpdate(callback(retryPrompt,retryToken))).result,'executing');
  assert.match(sent.at(-1).text,/Natija saqlandi:/);
  assert.equal((await handleTopicResultUpdate(callback(retryPrompt,retryToken))).result,'already_processed');
  assert.equal(executions,3);

  const failedDelivery=update('Real Madrid 3-1 Barca');
  global.fetch=async (_input: any, init?: any) => { const body=JSON.parse(init.body); sent.push({...body,botId:99999}); return new Response(JSON.stringify({ok:false,description:'mock delivery rejected'})); };
  assert.equal((await handleTopicResultUpdate(failedDelivery)).result,'delivery_unknown');
  const undelivered=sent.at(-1);
  global.fetch=async () => new Response(JSON.stringify({ok:true}));
  assert.equal((await handleTopicResultUpdate(callback(undelivered,undelivered.reply_markup.inline_keyboard[0][0].callback_data))).result,'invalid');
  assert.equal(executions,3);
  // Guarded real document writes: two competing confirmations cannot overwrite each other.
  const live=fixture('atomic-result',liga);
  await db.collection('fixtures').doc(live.id).set(live);
  const expectedFixture={competitionId:liga,homeClubId:live.homeClubId,awayClubId:live.awayClubId,status:live.status,updatedAt:live.updatedAt};
  const writes=await Promise.allSettled([2,3].map(score=>adminEditFixtureResultFirestore('admin','admin',live.id,{homeScore:score,awayScore:1,status:'CONFIRMED',expectedFixture,idempotencyKey:'atomic-topic-'+score})));
  assert.equal(writes.filter(w=>w.status==='fulfilled').length,1);
  assert.equal(writes.filter(w=>w.status==='rejected').length,1);
  assert.equal((await db.collection('fixtures').doc(live.id).get()).data()?.status,'CONFIRMED');
  assert.ok((await db.collection('result_refresh_jobs').doc(live.id).get()).data()?.notifyResult);
  await assert.rejects(adminEditFixtureResultFirestore('admin','admin',live.id,{homeScore:9,awayScore:9,expectedFixture}), /o‘zgargan|tasdiqlangan/);
  console.log('PASS topic league/cup separation, participant identity, score orientation, reply buttons, admin-only approval, concurrent/replayed clicks, edit invalidation, cross-topic denial and atomic guarded result/audit/notification persistence; Telegram mocked');
} finally { global.fetch=originalFetch; setTestTopicResultDependencies(); }
