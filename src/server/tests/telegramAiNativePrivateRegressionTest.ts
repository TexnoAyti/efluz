import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { PostgresAiStore } from '../services/postgresAiStore';
import { handleTelegramAiMessage, clearTestAiState, setTestAiResponder, type ConversationTurn } from '../services/telegramAiService';
import { DEFAULT_AI_CONFIG, setTestConfigOverride } from '../services/telegramAiConfigService';
import { clearTestRateLimitState } from '../services/telegramAiRateLimitService';
import { setTestGroundingOverride } from '../services/telegramAiGroundingService';
import { getAiRedisClient } from '../services/telegramAiDeadline';
import { isNativePrivateAssistant, privateAssistantContextKey, PRIVATE_AI_MEMORY } from '../services/telegramAiPrivateAssistant';
import { appendAiExchange } from '../services/telegramAiConversationMemory';
import { buildTelegramAiSystemPrompt } from '../services/telegramAiPrompt';
import { setTestAiAdminHooks } from '../services/telegramAiAdminService';

await initDatabase();
process.env.DATABASE_PROVIDER = 'supabase';
process.env.SUPABASE_DATA_NAMESPACE = 'native-test';
process.env.TELEGRAM_BOT_TOKEN = '777:isolated-native';
process.env.MUNFIZ_PRIVATE_CHAT_ENABLED = 'false';
setTestConfigOverride({ ...DEFAULT_AI_CONFIG, enabled: true, allowedChatId: -1001, allowedThreadId: 3503, rateLimitUserPerMin: 20, rateLimitTopicPerMin: 60 });
setTestGroundingOverride({ competitions: [], clubs: [], standings: {}, fixtures: {} });
const base = { chatId: 5209126900, threadId: 0, fromUser: { id: 5209126900 } };
let update = 987000, calls = 0, writes = 0;
let captured: ConversationTurn[] = [];
const sent: any[] = [], originalFetch = global.fetch, originalNow = Date.now;
const payload = (text: string, extra = {}) => ({ ...base, updateId: ++update, messageId: update, text, ...extra });
const responder = async (_text: string, _facts: string, history?: ConversationTurn[]) => {
  calls++; captured = history || []; return 'Reja: 1. Maqsad. 2. Amaliy qadam.';
};
const send = async (text: string, extra = {}) => { clearTestRateLimitState(); return handleTelegramAiMessage(payload(text, extra)); };
global.fetch = async (input: any, init?: any) => {
  assert.ok(String(input).startsWith('https://api.telegram.org/'), 'No new host or real model call');
  sent.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ ok: true, result: { message_id: 80000 + sent.length } }));
};
try {
  assert.equal(isNativePrivateAssistant({ ...base, text: '', updateId: 1, messageId: 1 }), true);
  for (const extra of [{ chatId: -1001 }, { forwarded: true }, { senderChat: true }, { fromUser: { id: 7573478198 }, chatId: 7573478198 }, { fromUser: { id: 5209126900, is_bot: true } }]) {
    assert.equal(isNativePrivateAssistant(payload('x', extra)), false);
  }
  const privatePrompt = buildTelegramAiSystemPrompt('facts', undefined, { privateAssistant: true, privateAdmin: true });
  assert.ok(privatePrompt.includes('umumiy mavzular ham ruxsat'));
  assert.ok(!privatePrompt.includes('FAQAT eFootball'));
  assert.ok(privatePrompt.includes('internetdan tekshirdim'));
  assert.ok(buildTelegramAiSystemPrompt('').includes('FAQAT eFootball'));

  clearTestAiState(); setTestAiResponder(responder);
  assert.equal((await send('Python kod yozishni o‘rgat')).replySent, true);
  const normalReply = 80000 + sent.length;
  await send('xa', { replyToMessage: { message_id: normalReply, from: { id: 777, is_bot: true } } });
  assert.equal(calls, 2, 'Reply affirmation continues chat, not a nonexistent admin plan');
  assert.equal(captured[0].text, 'Python kod yozishni o‘rgat');
  await send('salom'); assert.equal(calls, 3, 'Owner greeting uses conversational model');
  for (let i = 0; i < 9; i++) await send(`Rejamning ${i} qismini tushuntir`);
  assert.ok(captured.length > 12, 'More than six exchanges survive');

  // Destroy all in-process context; state must come from the durable store.
  clearTestAiState(); setTestAiResponder(responder);
  const future = originalNow() + 2 * 3600000; Date.now = () => future;
  await send('oldingi rejamni davom ettir');
  assert.equal(captured[0].text, 'Python kod yozishni o‘rgat', 'History survives restart and the old one-hour expiry');
  Date.now = originalNow;
  const stored = await getAiRedisClient()!.get<any>(privateAssistantContextKey(base.chatId, 0, base.fromUser.id)!);
  assert.ok(Array.isArray(stored));

  process.env.TELEGRAM_BOT_TOKEN = '778:other-bot'; await send('oldingi rejam nima?'); assert.equal(captured.length, 0);
  process.env.TELEGRAM_BOT_TOKEN = '777:isolated-native';
  process.env.SUPABASE_DATA_NAMESPACE = 'other-env'; await send('oldingi rejam nima?'); assert.equal(captured.length, 0);
  process.env.SUPABASE_DATA_NAMESPACE = 'native-test';
  const originalSet = PostgresAiStore.prototype.set;
  PostgresAiStore.prototype.set = async function(key, value, options) {
    if (key.includes(':private-context:')) throw new Error('isolated state failure');
    return originalSet.call(this, key, value, options);
  };
  try { await send('/forget'); assert.match(sent.at(-1).text, /tozalash tasdiqlanmadi/); }
  finally { PostgresAiStore.prototype.set = originalSet; }
  await send('oldingi rejam nima?'); assert.ok(captured.length > 0, 'Failed reset does not pretend memory was cleared');
  const before = calls;
  await send('/forget'); assert.equal(calls, before); assert.match(sent.at(-1).text, /xotirasi tozalandi/);
  await send('oldingi rejam nima?'); assert.equal(captured.length, 0);
  await send('xotirani tozala'); await send('davom et'); assert.equal(captured.length, 0);

  const expired = originalNow() + 31 * 86400000; Date.now = () => expired;
  await send('eslaysanmi?'); assert.equal(captured.length, 0, 'Memory really expires'); Date.now = originalNow;

  await send('python kod', { chatId: -1001, threadId: 3503 });
  assert.match(sent.at(-1).text, /faqat eFootball/);
  process.env.EFL_PRIVATE_ASSISTANT_ENABLED = 'false'; await send('python kod');
  assert.match(sent.at(-1).text, /faqat eFootball/); delete process.env.EFL_PRIVATE_ASSISTANT_ENABLED;

  // Exercise the real existing SDK orchestration against a mocked provider endpoint.
  setTestAiResponder(null); process.env.GEMINI_API_KEY = 'isolated-native-provider-key';
  const telegramFetch = global.fetch; let providerCalls = 0;
  global.fetch = async (input: any, init?: any) => {
    if (!String(input).includes('generativelanguage.googleapis.com')) return telegramFetch(input, init);
    providerCalls++;
    const body = JSON.parse(init.body);
    assert.match(body.systemInstruction.parts[0].text, /umumiy mavzular ham ruxsat/);
    assert.ok(body.contents.length > 1, 'Durable conversation reaches actual SDK request');
    assert.ok(!JSON.stringify(body).includes('isolated-native-provider-key'));
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'Python misoli: print(1 + 1)' }] }, finishReason: 'STOP' }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    await send('python kod yozishni tushuntir');
    assert.equal(providerCalls, 1); assert.match(sent.at(-1).text, /Python misoli/);
  } finally { global.fetch = telegramFetch; delete process.env.GEMINI_API_KEY; setTestAiResponder(responder); }

  // Real delivered plan is still confirmed exactly once by a short reply.
  setTestAiAdminHooks(async () => { writes++; return { status: 200, data: { success: true } }; }, async () => ({ action: 'club_release', targetId: 'club-arsenal' }));
  await send('/ai_admin test');
  assert.ok(sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data.startsWith('ai:confirm:'));
  const planReply = 80000 + sent.length;
  await send('xa', { replyToMessage: { message_id: planReply, from: { id: 777, is_bot: true } } });
  assert.equal(writes, 1); assert.match(sent.at(-1).text, /Bajarildi/);
  await send('tasdiqlayman'); assert.equal(writes, 1);

  let history: ConversationTurn[] = [];
  for (let i = 0; i < 40; i++) history = appendAiExchange(history, `${i}: savol`, 'javob', {}, PRIVATE_AI_MEMORY);
  assert.equal(history.length, 48); assert.equal(history[0].text, '16: savol');
  for (let i = 0; i < 30; i++) history = appendAiExchange(history, '⚽'.repeat(4000), 'z'.repeat(5000), {}, PRIVATE_AI_MEMORY);
  assert.ok(history.reduce((n, turn) => n + turn.text.length, 0) <= PRIVATE_AI_MEMORY.maxTextChars);
  assert.equal(history.length % 2, 0); assert.equal(history[0].role, 'user');
  console.log('PASS native owner DM, general topic and greeting routing, affirmation reply continuation, 24-exchange bounded durable memory across process reset and two hours, 30-day expiry, bot/environment isolation, memory reset, rollback/group scope and real admin confirmation replay; model/Telegram mocked');
} finally {
  Date.now = originalNow; global.fetch = originalFetch; clearTestAiState(); clearTestRateLimitState();
  setTestConfigOverride(null); setTestGroundingOverride(null); setTestAiAdminHooks();
}
