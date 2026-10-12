import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { redisSetRaw, ReadModelKeys } from '../readModel/readModelStore';
import { isAiHypotheticalQuestion, aiReasoningInstructions } from '../services/telegramAiMessageUnderstanding';
import { getConversationIntent } from '../services/telegramAiConversationCommands';
import { assertSingleNaturalAdminRequest } from '../services/telegramAiAdminLanguage';
import { continueAiAdminClarification } from '../services/telegramAiAdminClarification';
import { buildAiGroundingContext, setTestGroundingOverride } from '../services/telegramAiGroundingService';
import { buildTelegramAiSystemPrompt } from '../services/telegramAiPrompt';
import { handleTelegramAiMessage, clearTestAiState, setTestAiResponder } from '../services/telegramAiService';
import { setTestAiAdminHooks, setTestAiAdminModelGenerator } from '../services/telegramAiAdminService';
import { DEFAULT_AI_CONFIG, setTestConfigOverride } from '../services/telegramAiConfigService';
import { buildAiFallbackReply } from '../services/telegramAiFallback';

for (const query of ['Agar Arsenal 1-1 Ipswich APL bo‘lsa, nima o‘zgaradi?', 'Arsenal natijasini o‘chirsam nima bo‘ladi?', 'If Arsenal win, what happens?', 'Arsenal yutsa jadval qanday bo‘ladi?']) {
  assert.equal(isAiHypotheticalQuestion(query), true, query);
  assert.equal(getConversationIntent(query), 'chat', query);
  assert.throws(() => assertSingleNaturalAdminRequest(query), /shartli holat/);
}
assert.equal(getConversationIntent('Arsenal 1-1 Ipswich APL'), 'admin');
assert.doesNotThrow(() => assertSingleNaturalAdminRequest('Hammaga “Agar Arsenal yutsa?” deb xabar yubor'));
assert.throws(() => assertSingleNaturalAdminRequest('APL 10-turni 11-turni och'), /tur raqamlari/);
assert.throws(() => assertSingleNaturalAdminRequest('APL 11-tur muddatini 24 soat 48 soat uzaytir'), /Muddatlar/);
const corrected = continueAiAdminClarification({ request: 'APL 10-turni 11-turni och', question: 'Tur raqamlari mos kelmadi. Qaysi bitta tur?' }, '12-tur bo‘lsin');
assert.match(corrected!, /12-tur/); assert.ok(!/10|11/.test(corrected!));
const duration = continueAiAdminClarification({ request: 'APL 11-tur 24 soat 48 soat uzaytir', question: 'Necha soat bo‘lsin?' }, '36');
assert.match(duration!, /11-tur.*36 soat.*uzaytir/); assert.ok(!/24|48/.test(duration!));
assert.equal(continueAiAdminClarification({ request: 'Arsenal 1-1 Ipswich 2-1 qil', question: 'Qaysi hisob?' }, '3-2'), 'Arsenal 3-2 Ipswich  qil');
const prompt = buildTelegramAiSystemPrompt('', undefined, { query: 'Agar Arsenal yutsa nima bo‘ladi?' });
for (const rule of ['SHARTLI SENARIY', 'ikki marta sanamang', 'tenglik qoidasi', 'sababi aniqlanmagan']) assert.ok(prompt.includes(rule));
assert.ok(aiReasoningInstructions('Arsenal va Ipswichni taqqosla').includes('o‘yin boshiga'));
assert.match(buildAiFallbackReply('Agar Arsenal yutsa nima bo‘ladi?', { detectedClubs: ['Arsenal'], fallbackFacts: 'Arsenal: 20 ochko.' } as any), /shartli senariy.*hech narsa.*Hozirgi.*20 ochko/s);

await initDatabase();
const bridge = await startMockUpstashBridge();
const season = 'season-2026-27', league = 'comp-premier-league-2026';
const originalFetch = global.fetch;
let update = 9960000, executions = 0, adminModels = 0, chats = 0;
const sent: any[] = [];
const p = (text: string) => ({ updateId: ++update, messageId: update, chatId: -1001, threadId: 3503, fromUser: { id: 5209126900 }, text });
try {
  process.env.TELEGRAM_BOT_TOKEN = '777:reasoning-test';
  await redisSetRaw(ReadModelKeys.competitions(season), { data: [{ id: league, name: 'Premier League', type: 'LEAGUE', seasonId: season, leagueId: 'league-premier-league', currentMatchday: 11 }] });
  await redisSetRaw(ReadModelKeys.clubsWithOwners(season), { data: [{ id: 'arsenal', name: 'Arsenal', leagueId: 'league-premier-league' }, { id: 'ipswich', name: 'Ipswich Town', leagueId: 'league-premier-league' }] });
  setTestConfigOverride({ ...DEFAULT_AI_CONFIG, enabled: true, allowedChatId: -1001, allowedThreadId: 3503 });
  setTestAiAdminHooks(async () => { executions++; return { status: 200, data: { success: true } }; });
  setTestAiAdminModelGenerator(async () => { adminModels++; throw new Error('MUST_NOT_NEED_ADMIN_MODEL'); });
  setTestAiResponder(async () => { chats++; return 'Bu shartli holat. Yangi o‘rinni aytish uchun to‘liq jadval kerak.'; });
  setTestGroundingOverride({ clubs: [{ id: 'arsenal', name: 'Arsenal', ownerUserId: 'owner', ownerUsername: 'actual_owner' }] as any, competitions: [], fixtures: {}, standings: {} });
  assert.equal((await buildAiGroundingContext('Agar Arsenal egasini chiqarsam nima bo‘ladi?')).factualAnswer, undefined);
  global.fetch = async (input: any, init?: any) => {
    if (String(input).includes('api.telegram.org')) return { ok: true, json: async () => { sent.push(JSON.parse(init.body)); return { ok: true, result: { message_id: 10000 + sent.length } }; } } as any;
    const body = init?.body ? JSON.parse(init.body) : null, command = Array.isArray(body?.[0]) ? body[0] : body;
    if (command?.[0]?.toLowerCase() === 'eval' && String(command[1]).includes('local userKey')) return new Response(JSON.stringify(Array.isArray(body?.[0]) ? [{ result: [1, 'OK', 1] }] : { result: [1, 'OK', 1] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return originalFetch(input, init);
  };
  clearTestAiState();
  setTestAiResponder(async () => { chats++; return 'Bu shartli holat. Yangi o‘rinni aytish uchun to‘liq jadval kerak.'; });
  async function send(text: string) { const r = await handleTelegramAiMessage(p(text)); assert.equal(r.replySent, true, JSON.stringify(r)); return sent.at(-1); }
  assert.match((await send('Agar Arsenal yutsa jadval qanday bo‘ladi?')).text, /shartli holat/);
  assert.equal(chats, 1); assert.equal(executions, 0);
  assert.match((await send('APL 10-turni 11-turni och')).text, /tur raqamlari/);
  const preview = await send('12-tur bo‘lsin');
  assert.match(preview.text, /Reja:.*12/s); assert.ok(preview.reply_markup.inline_keyboard);
  assert.equal(executions, 0); assert.equal(adminModels, 0);
  console.log('PASS scenario routing, no fabricated exact scenario shortcut, contradictory field clarification and explicit replacement, grounded reasoning rules, full dispatch and zero pre-confirmation execution; real Telegram/model calls mocked');
} finally {
  global.fetch = originalFetch; setTestAiAdminHooks(); setTestAiAdminModelGenerator(); setTestAiResponder(null); setTestGroundingOverride(null); setTestConfigOverride(null); await bridge.close();
}
