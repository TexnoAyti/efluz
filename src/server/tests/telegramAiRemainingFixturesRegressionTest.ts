import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { ReadModelKeys, redisSetRaw, getFreshKey, getLkgKey } from '../readModel/readModelStore';
import { createAiTournamentReader } from '../services/telegramAiDataService';
import { getConversationIntent, buildConversationTableReply } from '../services/telegramAiConversationCommands';
import { handleTelegramAiMessage, clearTestAiState, setTestAiResponder } from '../services/telegramAiService';
import { setTestConfigOverride, DEFAULT_AI_CONFIG } from '../services/telegramAiConfigService';
import { clearTestRateLimitState } from '../services/telegramAiRateLimitService';

await initDatabase();
const bridge = await startMockUpstashBridge();
const season = 'season-2026-27', league = 'comp-premier-league-2026', other = 'comp-la-liga-2026';
const signal = new AbortController().signal;
const question = "Hozirgacha qaysi o'yinlar qoldi o'ynalmagan APLda?";
const comps = [{ id: league, name: 'Premier League', type: 'LEAGUE', leagueId: 'league-premier-league', seasonId: season, currentMatchday: 11 }, { id: other, name: 'La Liga', type: 'LEAGUE', leagueId: 'league-la-liga', seasonId: season, currentMatchday: 11 }];
const clubs = ['Everton', 'Leeds United', 'Liverpool', 'Chelsea', 'Arsenal', 'Brighton & Hove Albion'].map((name, i) => ({ id: 'club-test-' + i, name, leagueId: 'league-premier-league' }));
const game = (id: string, matchday: number, status: string, home = 0, away = 1) => ({ id, competitionId: league, seasonId: season, matchday, status, homeClubId: clubs[home].id, awayClubId: clubs[away].id, homeScore: 8, awayScore: 9 });
const games = [game('old-unplayed', 10, 'SCHEDULED'), game('current-unplayed', 11, 'SCHEDULED', 2, 3), game('postponed', 3, 'POSTPONED', 4, 5), game('submitted', 11, 'PENDING_CONFIRMATION', 0, 2), game('disputed', 7, 'DISPUTED', 1, 3), game('played', 11, 'CONFIRMED', 4, 3), game('future', 12, 'SCHEDULED', 5, 1), game('cancelled', 2, 'CANCELLED'), game('deleted', 4, 'SCHEDULED')];
const seed = async (data: any[]) => redisSetRaw(ReadModelKeys.competitionFixtures(league, season), { data, generatedAt: new Date().toISOString() });
const db = getFirestoreDb(), originalCollection = db.collection.bind(db), originalFetch = global.fetch;
let firestore = 0, model = 0;
db.collection = (() => { firestore++; throw new Error('RESOURCE_EXHAUSTED'); }) as any;
try {
  await redisSetRaw(ReadModelKeys.competitions(season), { data: comps });
  await redisSetRaw(ReadModelKeys.clubsWithOwners(season), { data: clubs });
  await redisSetRaw(`efluz:v1:season:${season}:fixture-tombstones`, { data: [{ fixtureId: 'deleted' }] });
  await seed(games);
  for (const text of [question, 'APLda oynalmagan oyinlar', 'APL qolgan oyinlar', 'Premier League unfinished matches', 'APL yakunlanmagan uchrashuvlarni korsat']) assert.equal(getConversationIntent(text), 'fixtures', text);
  assert.equal(getConversationIntent('APL oynalmagan oyinlarni ochir'), 'admin');
  const data: any = await createAiTournamentReader(signal).read({ dataset: 'fixtures', competition: 'APL', matchdayTo: 11, fixtureState: 'unplayed', limit: 30 });
  assert.equal(data.complete, true, 'Missing other league/admin fallback must not invalidate complete APL snapshot');
  assert.equal(data.stale, false); assert.deepEqual(new Set(data.data.map((f: any) => f.id)), new Set(['old-unplayed', 'current-unplayed', 'postponed']));
  const answer = await buildConversationTableReply(question, 'fixtures', {}, signal);
  assert.match(answer.text, /1–11-turlar/); assert.match(answer.text, /O‘ynalmagan: 3 ta/);
  assert.match(answer.text, /10-tur: Everton — Leeds United/); assert.match(answer.text, /11-tur: Liverpool — Chelsea/);
  assert.match(answer.text, /Tasdiq kutilmoqda: 1 ta/); assert.match(answer.text, /Bahsli: 1 ta/);
  assert.ok(!/12-tur|8:9|to‘liq emas|to‘liq o‘qilmadi/.test(answer.text));
  const round = await buildConversationTableReply('APL 11 tur oynalmagan oyinlar', 'fixtures', {}, signal);
  assert.match(round.text, /O‘ynalmagan: 1 ta/); assert.ok(!/10-tur:/.test(round.text));
  assert.match((await buildConversationTableReply('APL butun mavsum oynalmagan oyinlar', 'fixtures', {}, signal)).text, /12-tur:/);
  const lkg = bridge.store.get(getLkgKey(ReadModelKeys.competitionFixtures(league, season)))!;
  bridge.store.delete(getFreshKey(ReadModelKeys.competitionFixtures(league, season)));
  assert.match((await buildConversationTableReply(question, 'fixtures', {}, signal)).text, /Oxirgi saqlangan/);
  bridge.store.delete(getLkgKey(ReadModelKeys.competitionFixtures(league, season)));
  const absent = await buildConversationTableReply(question, 'fixtures', {}, signal);
  assert.match(absent.text, /hammasi o‘ynalgan deb tasdiqlay olmayman/);
  bridge.store.set(getLkgKey(ReadModelKeys.competitionFixtures(league, season)), lkg);
  await seed(Array.from({ length: 45 }, (_, i) => game('many-' + i, 1 + i % 11, 'SCHEDULED')));
  assert.match((await buildConversationTableReply(question, 'fixtures', {}, signal)).text, /O‘ynalmagan: 45 ta/);
  await seed([game('only-played', 11, 'CONFIRMED')]);
  assert.match((await buildConversationTableReply(question, 'fixtures', {}, signal)).text, /yakunlanmagan o‘yin qolmagan/);
  await seed(games);
  const sent: any[] = [];
  global.fetch = async (input: any, init?: any) => {
    if (String(input).includes('api.telegram.org')) return { ok: true, json: async () => { sent.push(JSON.parse(init.body)); return { ok: true, result: { message_id: 900 + sent.length } }; } } as any;
    // This bridge does not interpret quota Lua. Quota concurrency is covered by
    // the separate real-Redis suite; allow one request for this dispatch test.
    const body = init?.body ? JSON.parse(init.body) : null;
    const command = Array.isArray(body?.[0]) ? body[0] : body;
    if (command?.[0]?.toLowerCase() === 'eval' && String(command[1]).includes('local userKey'))
      return new Response(JSON.stringify(Array.isArray(body?.[0]) ? [{ result: [1, 'OK', 1] }] : { result: [1, 'OK', 1] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return originalFetch(input, init);
  };
  process.env.TELEGRAM_BOT_TOKEN = '777:test-only';
  setTestConfigOverride({ ...DEFAULT_AI_CONFIG, enabled: true, allowedChatId: -1001, allowedThreadId: 3503, rateLimitUserPerMin: 10 });
  setTestAiResponder(async () => { model++; throw new Error('MUST_NOT_CALL_MODEL_FOR_REMAINING_FIXTURES'); });
  clearTestAiState(); clearTestRateLimitState();
  const result = await handleTelegramAiMessage({ updateId: 9910901, messageId: 77, chatId: -1001, threadId: 3503, fromUser: { id: 5209126900 }, text: question });
  assert.equal(result.replySent, true, JSON.stringify(result)); assert.equal(sent.length, 1); assert.equal(sent[0].message_thread_id, 3503);
  assert.match(sent[0].text, /10-tur: Everton — Leeds United/); assert.match(sent[0].text, /O‘ynalmagan: 3 ta/);
  let updateId = 9910901;
  for (const [text, expected] of [['10 turdagichi?', /10-tur: Everton — Leeds United/], ['11 turdagichi?', /11-tur: Liverpool — Chelsea/], ['natijalarchi?', /Arsenal 8:9 Chelsea/]] as const) {
    const follow = await handleTelegramAiMessage({ updateId: ++updateId, messageId: 80 + updateId, chatId: -1001, threadId: 3503, fromUser: { id: 5209126900 }, text });
    assert.equal(follow.replySent, true, text + JSON.stringify(follow)); assert.match(sent.at(-1).text, expected);
  }
  const outsider = await handleTelegramAiMessage({ updateId: ++updateId, messageId: 90, chatId: -1001, threadId: 3503, fromUser: { id: 123 }, text: '11 turdagichi?' });
  assert.equal(outsider.replySent, true); assert.match(sent.at(-1).text, /Qaysi liga/);
  assert.equal(model, 0); assert.equal(firestore, 0);
  console.log('PASS exact remaining APL query: prior/current rounds, future/confirmed/cancelled/deleted exclusion, submitted/disputed separation, scoped completeness, pagination, stale/missing/empty truth, Telegram dispatch; zero model/Firestore, Telegram mocked');
} finally {
  db.collection = originalCollection; global.fetch = originalFetch; setTestAiResponder(null); setTestConfigOverride(null); await bridge.close();
}
