import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { redisSetRaw, ReadModelKeys } from '../readModel/readModelStore';
import { buildConversationReadReply, expandConversationReadFollowUp, getConversationIntent } from '../services/telegramAiConversationCommands';
import { hasMultipleAiReadAspects, wantsCombinedAiTables } from '../services/telegramAiMessageUnderstanding';
import { buildAiGroundingContext, setTestGroundingOverride } from '../services/telegramAiGroundingService';
import { handleTelegramAiMessage, clearTestAiState, setTestAiResponder } from '../services/telegramAiService';
import { DEFAULT_AI_CONFIG, setTestConfigOverride } from '../services/telegramAiConfigService';
import { assertSingleNaturalAdminRequest, detectNaturalAdminAction, isShorthandAiResultRequest } from '../services/telegramAiAdminLanguage';

import { setTestAiAdminHooks, setTestAiAdminModelGenerator } from '../services/telegramAiAdminService';

const query = 'APL jadvalini va 11-tur natijalarini ko‘rsat';
assert.equal(wantsCombinedAiTables(query), true);
for (const shorthand of ['Arsenal 1-1 Ipswich APL', 'Arsenal 1:1 Ipswich APL', 'Arsenal 1–1 Ipswich 11-tur APL']) {
  assert.equal(isShorthandAiResultRequest(shorthand), true);
  assert.equal(detectNaturalAdminAction(shorthand), 'result_edit');
  assert.equal(getConversationIntent(shorthand), 'admin');
}
for (const text of ['Arsenal 1-1 Ipswich APL taxmin', 'Arsenal 1-1 Ipswich APL emas', 'Arsenal 1-1 Ipswich APL?', '1-1', 'Arsenal 1-1 Ipswich APL yozma', 'Arsenal 1-1 Ipswich APL; Chelsea 2-1 Inter'])
  assert.equal(isShorthandAiResultRequest(text), false, text);
assert.equal(detectNaturalAdminAction('Arsenal 1-1 Ipswich APL tasdiqla'), 'result_approve');
assert.equal(detectNaturalAdminAction('Arsenal 1-1 Ipswich APL natijani o‘chir'), 'result_clear');
assert.equal(detectNaturalAdminAction('Arsenal 1-1 Ipswich APL natijani rad et'), 'result_reject');
assert.equal(getConversationIntent(query), 'fixtures');
for (const text of ['Arsenal egasi kim va qanday taktika ishlatay?', 'Arsenal nechanchi va keyingi raqibi kim?', 'Arsenal natijalari va taktika haqida tushuntir']) {
  assert.equal(hasMultipleAiReadAspects(text), true, text);
  assert.equal(getConversationIntent(text), 'chat', text);
}
assert.equal(wantsCombinedAiTables('APL o‘yinlar jadvalini ko‘rsat'), false);
assert.equal(getConversationIntent('APL o‘yinlar jadvalini ko‘rsat'), 'fixtures');
for (const text of ['APL turni och keyin natijani o‘chir', 'Arsenal 1-1 Ipswich APL kiritma', 'Arsenal 1-1 Ipswich APL saqlama', 'APL turni ochma'])
  assert.throws(() => assertSingleNaturalAdminRequest(text), /bitta|bir nechta/i);
const scope = { selectedCompetitionIds: ['apl'], previousUserQueries: ['APL 9 tur o‘ynalmagan o‘yinlar', 'rahmat', 'tushunarli'] };
assert.match(expandConversationReadFollowUp('11 turdagichi?', scope), /apl.*11 turdagichi/);
assert.ok(!/9 tur/.test(expandConversationReadFollowUp('11 turdagichi?', scope)));
for (const last of ['Arsenalni tahlil qil', 'La Liga haqida gaplashamiz', 'APL turni och'])
  assert.equal(expandConversationReadFollowUp('11 turdagichi?', { ...scope, previousUserQueries: [...scope.previousUserQueries, last] }), '11 turdagichi?');
assert.equal(expandConversationReadFollowUp('11 turdagichi?', { ...scope, selectedCompetitionIds: [] }), '11 turdagichi?');

await initDatabase();
const bridge = await startMockUpstashBridge();
const season = 'season-2026-27', league = 'comp-premier-league-2026';
const db = getFirestoreDb(), originalCollection = db.collection.bind(db), originalFetch = global.fetch;
let reads = 0, models = 0, writes = 0, update = 9930000;
const sent: any[] = [];
db.collection = (() => { reads++; throw new Error('NO_FIRESTORE'); }) as any;
try {
  const clubs = [{ id: 'arsenal', name: 'Arsenal', leagueId: 'league-premier-league', ownerUserId: 'owner', ownerUsername: 'actual_owner' }, { id: 'forest', name: 'Ipswich Town', leagueId: 'league-premier-league' }];
  await redisSetRaw(ReadModelKeys.competitions(season), { data: [{ id: league, name: 'Premier League', type: 'LEAGUE', seasonId: season, leagueId: 'league-premier-league', currentMatchday: 11 }] });
  await redisSetRaw(ReadModelKeys.clubsWithOwners(season), { data: clubs });
  await redisSetRaw(ReadModelKeys.standings(league, season), { data: [{ clubId: 'arsenal', clubName: 'Arsenal', position: 1, points: 33, played: 11, won: 11, drawn: 0, lost: 0, goalsFor: 30, goalsAgainst: 4, goalDifference: 26 }] });
  await redisSetRaw(ReadModelKeys.competitionFixtures(league, season), { data: [{ id: 'game-11', competitionId: league, seasonId: season, matchday: 11, status: 'CONFIRMED', homeClubId: 'arsenal', awayClubId: 'forest', homeScore: 2, awayScore: 1 }] });
  const reply = await buildConversationReadReply(query, 'fixtures', {}, new AbortController().signal);
  assert.match(reply.text, /Jadval:.*Arsenal.*33.*Natijalar:.*Arsenal 2:1 Ipswich Town/s);
  assert.deepEqual(reply.fixtureIds, ['game-11']);
  assert.ok(reply.text.length <= 4000);
  const unknown = await buildConversationReadReply('Noma’lum liga jadvali va natijalari', 'fixtures', { selectedCompetitionIds: [league] });
  assert.deepEqual(unknown.competitionIds, [], 'An unknown explicit league cannot borrow a historical league');

  process.env.TELEGRAM_BOT_TOKEN = '777:message-meaning-test';
  setTestConfigOverride({ ...DEFAULT_AI_CONFIG, enabled: true, allowedChatId: -1001, allowedThreadId: 3503, rateLimitUserPerMin: 20, rateLimitTopicPerMin: 60 });
  global.fetch = async (input: any, init?: any) => {
    if (String(input).includes('api.telegram.org')) return { ok: true, json: async () => {
      sent.push(JSON.parse(init.body)); return { ok: true, result: { message_id: 9000 + sent.length } };
    } } as any;
    const body = init?.body ? JSON.parse(init.body) : null;
    const command = Array.isArray(body?.[0]) ? body[0] : body;
    if (command?.[0]?.toLowerCase() === 'eval' && String(command[1]).includes('local userKey'))
      return new Response(JSON.stringify(Array.isArray(body?.[0]) ? [{ result: [1, 'OK', 1] }] : { result: [1, 'OK', 1] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return originalFetch(input, init);
  };
  clearTestAiState();
  const p = (text: string) => ({ updateId: ++update, messageId: update, chatId: -1001, threadId: 3503, fromUser: { id: 778899 }, text });
  const dispatched = await handleTelegramAiMessage(p(query));
  assert.equal(dispatched.replySent, true, JSON.stringify(dispatched));
  assert.match(sent.at(-1).text, /Jadval:.*33.*Natijalar:.*2:1/s);

  setTestAiAdminHooks(async () => { writes++; return { status: 200, data: { success: true } }; });
  setTestAiAdminModelGenerator(async () => { throw new Error('SHORTHAND_MUST_NOT_NEED_MODEL'); });
  const admin = (text: string) => ({ ...p(text), fromUser: { id: 5209126900 } });
  assert.equal((await handleTelegramAiMessage(admin('Arsenal 1-1 Ipswich APL'))).replySent, true);
  assert.match(sent.at(-1).text, /Reja:.*Arsenal 1:1 Ipswich Town/s);
  assert.ok(sent.at(-1).reply_markup.inline_keyboard, 'Shorthand still requires delivered confirmation');
  assert.equal(writes, 0);
  await redisSetRaw(ReadModelKeys.competitionFixtures(league, season), { data: [11,12].map(matchday => ({ id: 'game-' + matchday, competitionId: league, seasonId: season, matchday, status: 'SCHEDULED', homeClubId: 'arsenal', awayClubId: 'forest' })) });
  assert.equal((await handleTelegramAiMessage(admin('Arsenal 1-1 Ipswich APL'))).replySent, true);
  assert.match(sent.at(-1).text, /Bir nechta o‘yin.*Qaysi biri/s);
  assert.equal((await handleTelegramAiMessage(admin('12-tur bo‘lsin'))).replySent, true);
  assert.match(sent.at(-1).text, /Reja:.*12-tur.*Arsenal 1:1 Ipswich Town/s);
  assert.equal((await handleTelegramAiMessage(p('Arsenal 1-1 Ipswich APL'))).replySent, true);
  assert.match(sent.at(-1).text, /ruxsat berilgan adminlar/);
  assert.equal(writes, 0, 'Neither shorthand nor clarification executes before confirmation');

  setTestGroundingOverride({ clubs: clubs as any, competitions: [], standings: {}, fixtures: {} });
  const mixed = 'Arsenal egasi kim va qanday taktika ishlatay?';
  const grounding = await buildAiGroundingContext(mixed);
  assert.equal(grounding.factualAnswer, undefined, 'One ownership lookup must not swallow a tactics question');
  assert.match(grounding.factsSummary, /actual_owner/, 'Verified facts remain available to the model');
  setTestAiResponder(async (text, facts) => {
    models++; assert.equal(text, mixed); assert.match(facts, /actual_owner/);
    return '1. Arsenal egasi: @actual_owner.\n2. Umumiy taktika: pressingni vaziyatga moslang.';
  });
  assert.equal((await handleTelegramAiMessage(p(mixed))).replySent, true);
  assert.equal(models, 1); assert.match(sent.at(-1).text, /actual_owner.*Umumiy taktika/s);
  assert.equal(reads, 0);
  console.log('PASS full dispatch covers both tables and mixed ownership/tactics; exact targets, negation, follow-up courtesy and explicit resets; no real model, Telegram or database writes');
} finally {
  global.fetch = originalFetch; db.collection = originalCollection;
  setTestAiAdminHooks(); setTestAiAdminModelGenerator();
  setTestAiResponder(null); setTestGroundingOverride(null); setTestConfigOverride(null);
  await bridge.close();
}
