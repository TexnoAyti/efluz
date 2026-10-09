import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { redisSetRaw, ReadModelKeys } from '../readModel/readModelStore';
import { continueAiAdminClarification } from '../services/telegramAiAdminClarification';
import { handleAiAdminCommand, setTestAiAdminHooks, setTestAiAdminModelGenerator } from '../services/telegramAiAdminService';
import { rememberDeliveredAiAdminDraft, getDeliveredAiAdminDraft, clearAiAdminDraft } from '../services/telegramAiAdminDraft';
import { handleTelegramAiMessage, clearTestAiState } from '../services/telegramAiService';
import { DEFAULT_AI_CONFIG, setTestConfigOverride } from '../services/telegramAiConfigService';

const cases: Array<[string, string, string, string]> = [
  ['Heidenheimga biriktir', 'Kimga biriktiray? Bitta Telegram @username yozing.', '@actual_owner', '@actual_owner'],
  ['premium ber', 'Qaysi foydalanuvchi? Bitta @username yozing.', 'user-123', 'user-123'],
  ['natijani kirit', 'Qaysi hisobni saqlay?', '5-1', '5-1'],
  ['oyinini ochir', 'O‘yinning o‘zini o‘chirish uchun sabab yozing.', 'dublikat uchrashuv', 'sabab: dublikat uchrashuv'],
  ['oyinni muddatini ozgartir', 'Aniq sana, vaqt va vaqt zonasini yozing.', '2026-10-06T21:00:00+05:00', '2026-10-06T21:00:00+05:00'],
  ['mavsumni arxivla', 'Qaysi mavsum?', 'season-2026-27', 'season-2026-27'],
  ['APL turni qulflang', 'Qaysi turni boshqaray? Tur raqamini yozing.', '11', '11-tur'],
  ['Inter Milan natijasini ochir', 'Bir nechta o‘yin topildi. Qaysi biri?', 'tur 10', '10-tur'],
  ['APL turni uzaytir', 'Necha soatga uzaytiray?', '24', '24 soat'],
  ['AI foydalanuvchi limitini qil', 'Limit uchun bitta musbat butun son yozing.', '5', '5'],
  ['AI limitini 5 qil', 'Qaysi bitta AI limiti: foydalanuvchi/daqiqa, mavzu/daqiqa yoki kunlik?', 'foydalanuvchi', 'foydalanuvchi'],
  ['turni qulflang 11-tur', 'Qaysi liga yoki kubok?', 'APL', 'APL'],
  ['ligasini pauzaga qoy', 'Qaysi bitta liga yoki kubok?', 'Bundesliga', 'Bundesliga'],
  ['@actual_owner ga biriktir', 'Qaysi klubga biriktiray? Klub nomini yozing.', 'Brighton', 'Brighton'],
];
for (const [request, question, answer, suffix] of cases)
  assert.equal(continueAiAdminClarification({ request, question }, answer), request + ' ' + suffix);
const draft = { request: 'APL turni qulflang', question: 'Qaysi turni boshqaray?' };
for (const answer of ['kim yutadi?', 'APL jadval tashla', 'eng zor admin kim', '11 turgacha', '-11', '2.5', '0', '101', '11 keyin ochir', '11; blokla', '/ai_on', 'tasdiqlayman', 'bekor qil', 'qulflama'])
  assert.equal(continueAiAdminClarification(draft, answer), null, answer);
assert.equal(continueAiAdminClarification({ request: 'APL 10 turni qulflang', question: draft.question }, '11'), null);
assert.equal(continueAiAdminClarification({ request: 'Inter Milan 2-1 natijani kirit', question: 'Qaysi hisob?' }, '5-1'), null);

await initDatabase();
const bridge = await startMockUpstashBridge();
const signal = new AbortController().signal;
const season = 'season-2026-27', league = 'comp-premier-league-2026';
const db = getFirestoreDb(), originalCollection = db.collection.bind(db), originalFetch = global.fetch;
let reads = 0, models = 0, writes = 0, update = 9920000;
const p = (text: string) => ({ updateId: ++update, messageId: update, chatId: -1001, threadId: 3503, fromUser: { id: 5209126900 }, text });
const sent: any[] = [];
const dailyCharges: unknown[] = [];
db.collection = (() => { reads++; throw new Error('NO_FIRESTORE'); }) as any;
try {
  process.env.TELEGRAM_BOT_TOKEN = '777:test-only';
  await redisSetRaw(ReadModelKeys.competitions(season), { data: [{ id: league, name: 'Premier League', type: 'LEAGUE', seasonId: season, leagueId: 'league-premier-league', currentMatchday: 11 }] });
  await redisSetRaw(ReadModelKeys.clubsWithOwners(season), { data: [{ id: 'forest', name: 'Nottingham Forest', leagueId: 'league-premier-league' }, { id: 'arsenal', name: 'Arsenal', leagueId: 'league-premier-league' }] });
  await redisSetRaw(ReadModelKeys.competitionFixtures(league, season), { data: [{ id: 'forest-11', competitionId: league, seasonId: season, matchday: 11, status: 'SCHEDULED', homeClubId: 'arsenal', awayClubId: 'forest' }] });
  setTestConfigOverride({ ...DEFAULT_AI_CONFIG, enabled: true, allowedChatId: -1001, allowedThreadId: 3503 });
  setTestAiAdminHooks(async () => { writes++; return { status: 200, data: { success: true } }; });
  setTestAiAdminModelGenerator(async () => { models++; throw new Error('MUST_NOT_USE_MODEL'); });
  const request = p('Nottingham Arsenal 11 tur natijasini kirit');
  const question = await handleAiAdminCommand(request, signal);
  assert.match(question, /Qaysi hisob/);
  assert.ok(!/ai_confirm/.test(question));
  assert.ok(!/ai_confirm/.test(await handleAiAdminCommand(p('5-1'), signal)), 'Undelivered questions cannot continue');
  await rememberDeliveredAiAdminDraft(request, question, 888, signal);
  assert.match(await handleAiAdminCommand(p('bekor qil'), signal), /Topshiriq bekor qilindi/);
  assert.equal(await getDeliveredAiAdminDraft(request, signal), null);
  assert.equal(await handleAiAdminCommand(request, signal), question);
  await rememberDeliveredAiAdminDraft(request, question, 889, signal);
  const preview = await handleAiAdminCommand(p('5-1'), signal);
  assert.match(preview, /ai_confirm/); assert.match(preview, /Arsenal 1:5 Nottingham Forest/);
  assert.equal(await getDeliveredAiAdminDraft(request, signal), null);
  // Full dispatch, two missing fields, each question actually delivered.
  global.fetch = async (input: any, init?: any) => {
    if (String(input).includes('api.telegram.org')) return { ok: true, json: async () => { sent.push(JSON.parse(init.body)); return { ok: true, result: { message_id: 900 + sent.length } }; } } as any;
    const body = init?.body ? JSON.parse(init.body) : null;
    const command = Array.isArray(body?.[0]) ? body[0] : body;
    if (command?.[0]?.toLowerCase() === 'eval' && String(command[1]).includes('local userKey')) {
      dailyCharges.push(command.at(-1));
      return new Response(JSON.stringify(Array.isArray(body?.[0]) ? [{ result: [1, 'OK', 1] }] : { result: [1, 'OK', 1] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(input, init);
  };
  clearTestAiState();
  for (const [text, expected] of [['turni qulflang', /Qaysi turni/], ['11-tur', /Qaysi liga/], ['APL', /Reja:.*Premier League/s]] as const) {
    const result = await handleTelegramAiMessage(p(text));
    assert.equal(result.replySent, true, text + JSON.stringify(result));
    assert.match(sent.at(-1).text, expected);
  }
  assert.match(sent.at(-1).text, /11.*LOCK|11.*qulflash/); assert.ok(sent.at(-1).reply_markup.inline_keyboard);
  assert.equal(dailyCharges.length, 3); assert.ok(dailyCharges.every(n => Number(n) === 0), 'Native continuations must not charge model daily quota');
  const missing = p('AI foydalanuvchi limitini qil');
  const limitQuestion = await handleAiAdminCommand(missing, signal);
  await rememberDeliveredAiAdminDraft(missing, limitQuestion, 999, signal);
  assert.ok(!/ai_confirm/.test(await handleAiAdminCommand(p('eng zor admin kim'), signal)));
  assert.ok(await getDeliveredAiAdminDraft(missing, signal), 'Unrelated chat must not consume the pending field');
  assert.match(await handleAiAdminCommand(p('5'), signal), /so‘rov\/daqiqa: 5/);
  assert.equal(models, 0); assert.equal(reads, 0); assert.equal(writes, 0);
  console.log('PASS 14 native missing-field forms; unrelated, conflicting and invalid answers rejected; delivered multi-step dispatch; reversed score mapping; zero model, Firestore or writes');
} finally {
  await clearAiAdminDraft(p(''), signal);
  global.fetch = originalFetch; db.collection = originalCollection;
  setTestAiAdminHooks(); setTestAiAdminModelGenerator(); setTestConfigOverride(null);
  await bridge.close();
}
