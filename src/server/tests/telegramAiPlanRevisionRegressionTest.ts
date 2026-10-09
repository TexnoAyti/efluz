import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { ReadModelKeys, redisSetRaw } from '../readModel/readModelStore';
import { parseAiPlanRevision, reviseAiAdminPlan } from '../services/telegramAiPlanRevision';
import { handleAiAdminCommand, rememberDeliveredAdminPlan, setTestAiAdminHooks, setTestAiAdminModelGenerator } from '../services/telegramAiAdminService';
import { DEFAULT_AI_CONFIG, setTestConfigOverride } from '../services/telegramAiConfigService';
import { handleTelegramAiMessage, clearTestAiState } from '../services/telegramAiService';
import { getAiRedisClient } from '../services/telegramAiDeadline';
import type { AdminPlan } from '../services/telegramAiAdminCatalog';

for (const text of ['yo‘q, hisob 3-1', 'aslida 3:1 bolsin', 'hisobni 3-1 qil', '3-1'])
  assert.deepEqual(parseAiPlanRevision(text), { kind: 'score', first: 3, second: 1 });
assert.deepEqual(parseAiPlanRevision('yoq 12-tur bolsin'), { kind: 'round', value: 12 });
assert.deepEqual(parseAiPlanRevision('muddat 48 soat bolsin'), { kind: 'hours', value: 48 });
assert.deepEqual(parseAiPlanRevision('yoq @new_owner'), { kind: 'username', value: '@new_owner' });
assert.deepEqual(parseAiPlanRevision('matn: “12-tur ochildi”'), { kind: 'message', value: '12-tur ochildi' });
for (const text of ['-3-1', '3.5-1', '11 turgacha', '12-tur keyin ochir', '3-1; blokla', '3-1\nqil', 'matn: salom', 'yoq Arsenalni ochir', 'eng zor admin kim', '/ai_on', 'tasdiqlayman'])
  assert.equal(parseAiPlanRevision(text), null, text);
const score: AdminPlan = { action: 'result_edit', targetId: 'game', body: { homeScore: 1, awayScore: 5, status: 'CONFIRMED' } };
assert.deepEqual(reviseAiAdminPlan(score, { kind: 'score', first: 3, second: 1 }, false).body, { homeScore: 1, awayScore: 3, status: 'CONFIRMED' });
assert.equal(score.body.awayScore, 5, 'Source must remain immutable');
assert.throws(() => reviseAiAdminPlan(score, { kind: 'score', first: 3, second: 1 }), /ikkala jamoa/);
assert.throws(() => reviseAiAdminPlan(score, { kind: 'round', value: 12 }), /to‘liq yozing/);
assert.throws(() => reviseAiAdminPlan({ action: 'matchday_control', targetId: 'comp', body: { action: 'LOCK', matchday: 11 } }, { kind: 'hours', value: 48 }), /muddat belgilash/);
assert.throws(() => reviseAiAdminPlan({ action: 'matchday_timer', targetId: 'comp', body: {} }, { kind: 'hours', value: 0 }), /1–720/);
assert.throws(() => reviseAiAdminPlan({ action: 'cup_round', targetId: 'comp', body: { action: 'OPEN' } }, { kind: 'round', value: 101 }), /1–100/);

console.log('PASS bounded revision syntax, compatible fields, immutable plans and missing score orientation');

// Integration runs inside the real-Redis durability suite, never the mock Lua bridge.
if (process.env.REDIS_TEST_PORT) {
await initDatabase();
const signal = new AbortController().signal;
const db = getFirestoreDb(), originalCollection = db.collection.bind(db), originalFetch = global.fetch;
let firestore = 0, models = 0, update = 9940000;
const executed: AdminPlan[] = [], sent: any[] = [];
const p = (text: string, user = 5209126900) => ({ updateId: ++update, messageId: update, chatId: -1001, threadId: 3503, fromUser: { id: user }, text });
const token = (text: string) => { const match = /\/ai_confirm ([a-f0-9]{24})/.exec(text); assert.ok(match, text); return match[1]; };
db.collection = (() => { firestore++; throw new Error('NO_FIRESTORE'); }) as any;
try {
  const season = 'season-2026-27', league = 'comp-premier-league-2026';
  await redisSetRaw(ReadModelKeys.competitions(season), { data: [{ id: league, name: 'Premier League', type: 'LEAGUE', leagueId: 'league-premier-league', seasonId: season }] });
  await redisSetRaw(ReadModelKeys.clubsWithOwners(season), { data: [{ id: 'forest', name: 'Nottingham Forest', leagueId: 'league-premier-league' }, { id: 'arsenal', name: 'Arsenal', leagueId: 'league-premier-league' }] });
  await redisSetRaw(ReadModelKeys.competitionFixtures(league, season), { data: [{ id: 'game', competitionId: league, seasonId: season, matchday: 11, homeClubId: 'arsenal', awayClubId: 'forest', status: 'SCHEDULED' }] });
  process.env.TELEGRAM_BOT_TOKEN = '777:test-only';
  setTestConfigOverride({ ...DEFAULT_AI_CONFIG, enabled: true, allowedChatId: -1001, allowedThreadId: 3503 });
  setTestAiAdminHooks(async plan => { executed.push(plan); return { status: 200, data: { success: true } }; });
  setTestAiAdminModelGenerator(async () => { models++; throw new Error('NO_MODEL'); });
  const request = p('Nottingham 5-1 Arsenal 11-tur natijasini kirit');
  const original = await handleAiAdminCommand(request, signal), old = token(original);
  assert.ok(!/ai_confirm/.test(await handleAiAdminCommand(p('yoq hisob 3-1'), signal)), 'Undelivered preview must not be revised');
  await rememberDeliveredAdminPlan(request, original, 900, signal);
  assert.ok(!/ai_confirm/.test(await handleAiAdminCommand(p('yoq hisob 3-1', 7573478198), signal)));
  const wrongReply = { ...p('yoq hisob 3-1'), replyToMessage: { message_id: 900, from: { id: 888, is_bot: true } } };
  assert.ok(!/ai_confirm/.test(await handleAiAdminCommand(wrongReply, signal)));
  const corrected = await handleAiAdminCommand(p('yoq hisob 3-1'), signal), fresh = token(corrected);
  assert.notEqual(fresh, old); assert.match(corrected, /Oldingi tasdiqlash tugmasi bekor/);
  assert.match(corrected, /Arsenal 1:3 Nottingham Forest/); assert.match(corrected, /G‘olib: Nottingham Forest/);
  assert.equal(executed.length, 0);
  assert.match(await handleAiAdminCommand(p('/ai_confirm ' + old), signal), /allaqachon|bekor/);
  assert.ok(!/Bajarildi/.test(await handleAiAdminCommand(p('tasdiqlayman'), signal)), 'New latest plan must first be delivered');
  await rememberDeliveredAdminPlan(request, corrected, 901, signal);
  const again = await handleAiAdminCommand(p('hisob 4-2 bolsin'), signal), final = token(again);
  assert.match(again, /Arsenal 2:4 Nottingham Forest/);
  assert.match(await handleAiAdminCommand(p('/ai_confirm ' + fresh), signal), /allaqachon|bekor/);
  await rememberDeliveredAdminPlan(request, again, 902, signal);
  await handleAiAdminCommand(p('/ai_confirm ' + final), signal);
  await handleAiAdminCommand(p('/ai_confirm ' + final), signal);
  assert.equal(executed.length, 1); assert.deepEqual(executed[0].body, { homeScore: 2, awayScore: 4, status: 'CONFIRMED' });
  // Full dispatch: an admin-classified correction produces a new button/token.
  clearTestAiState();
  global.fetch = async (input: any, init?: any) => String(input).includes('api.telegram.org') ? { ok: true, json: async () => { sent.push(JSON.parse(init.body)); return { ok: true, result: { message_id: 1000 + sent.length } }; } } as any : originalFetch(input, init);
  const start = p('APL 11-turni qulflang');
  assert.equal((await handleTelegramAiMessage(start)).replySent, true);
  const firstButton = sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data;
  assert.equal((await handleTelegramAiMessage(p('yoq 12-tur bolsin'))).replySent, true);
  assert.match(sent.at(-1).text, /Reja tuzatildi/); assert.match(sent.at(-1).text, /12-turni qulflash/);
  const newButton = sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data;
  assert.notEqual(newButton, firstButton);
  assert.match(await handleAiAdminCommand(p('/ai_confirm ' + firstButton.split(':')[2]), signal), /allaqachon|bekor/);
  // Broadcast body changes retain exact recipient scope and title.
  const broadcast = p('Hammaga “11-tur ochildi” deb xabar yubor');
  const proposal = await handleAiAdminCommand(broadcast, signal);
  await rememberDeliveredAdminPlan(broadcast, proposal, 1100, signal);
  const message = await handleAiAdminCommand(p('matn: “12-tur ochildi”'), signal);
  assert.match(message, /12-tur ochildi/); assert.match(message, /barcha foydalanuvchilar/);
  assert.equal(executed.length, 1);
  const assignment = p('@old_owner Arsenalga biriktir');
  const assigned = await handleAiAdminCommand(assignment, signal);
  await rememberDeliveredAdminPlan(assignment, assigned, 1150, signal);
  const changedOwner = await handleAiAdminCommand(p('yoq @new_owner'), signal);
  assert.match(changedOwner, /@new_owner.*biriktirish/);
  assert.match(await handleAiAdminCommand(p('/ai_confirm ' + token(assigned)), signal), /allaqachon|bekor/);
  await rememberDeliveredAdminPlan(assignment, changedOwner, 1151, signal);
  const redis = getAiRedisClient(signal)!;
  const ownerKey = 'efluz:v1:telegram:ai:admin:' + token(changedOwner);
  const ownerRecord = await redis.get<any>(ownerKey);
  await redis.set(ownerKey, JSON.stringify({ ...ownerRecord, expiresAt: Date.now() - 1 }), { ex: 300 });
  assert.ok(!/ai_confirm/.test(await handleAiAdminCommand(p('yoq @other_owner'), signal)), 'Expired plans cannot be revised');
  const concurrent = p('APL tur muddatini 30 soat qil');
  const before = await handleAiAdminCommand(concurrent, signal);
  await rememberDeliveredAdminPlan(concurrent, before, 1200, signal);
  const attempts = await Promise.all(Array.from({ length: 8 }, () => handleAiAdminCommand(p('muddat 48 soat bolsin'), signal)));
  assert.equal(attempts.filter(text => text.includes('/ai_confirm ')).length, 1, 'Atomic replacement admits one revision');
  const client = getAiRedisClient(signal)!;
  const oldKey = 'efluz:v1:telegram:ai:admin:' + token(before);
  assert.equal((await client.get<any>(oldKey)).state, 'cancelled');
  assert.ok(await client.ttl(oldKey) > 0, 'Replacing a pending plan preserves its expiry');
  for (let i = 0; i < 8; i++) {
    const source = p('APL tur muddatini 30 soat qil');
    const pending = await handleAiAdminCommand(source, signal);
    await rememberDeliveredAdminPlan(source, pending, 1300 + i, signal);
    const executionCount = executed.length;
    const [replacement] = await Promise.all([
      handleAiAdminCommand(p('muddat 48 soat bolsin'), signal),
      handleAiAdminCommand(p('/ai_confirm ' + token(pending)), signal),
    ]);
    const revised = replacement.includes('/ai_confirm ');
    assert.equal(Number(revised) + executed.length - executionCount, 1, 'Old confirmation and replacement are mutually exclusive');
    if (revised) assert.match(await handleAiAdminCommand(p('/ai_confirm ' + token(pending)), signal), /allaqachon|bekor/);
  }
  assert.equal(models, 0); assert.equal(firestore, 0);
  console.log('PASS actual Redis: 5 correction fields, native dispatch, original score order, actor/reply/delivery isolation, old button invalidation, repeated revisions, one winner among 8 parallel replacements and 8 confirmation races; zero model/Firestore, no real mutations/messages');
} finally { global.fetch = originalFetch; db.collection = originalCollection; setTestAiAdminHooks(); setTestAiAdminModelGenerator(); setTestConfigOverride(null); }
}
