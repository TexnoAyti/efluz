import assert from 'node:assert/strict';
import { generateGroundedTelegramAnswer, AI_CLARIFICATION_REPLY, aiProviderFailureKind } from '../services/telegramAiReadTools';
import { buildAiFallbackReply } from '../services/telegramAiFallback';
import { handleTelegramAiMessage, clearTestAiState, setTestAiResponder } from '../services/telegramAiService';
import { DEFAULT_AI_CONFIG, setTestConfigOverride } from '../services/telegramAiConfigService';
import { setTestGroundingOverride } from '../services/telegramAiGroundingService';
import { clearTestRateLimitState } from '../services/telegramAiRateLimitService';

const busy = new Error(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'High demand' } }));
const quota = Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 });
assert.equal(aiProviderFailureKind(busy), 'busy');
assert.equal(aiProviderFailureKind(quota), 'quota');
assert.equal(aiProviderFailureKind(new Error('Unauthorized')), 'connection');
const base = { ai: {} as any, model: 'mock', contents: [], systemPrompt: 'test', signal: new AbortController().signal };
const grounding = { factsSummary: 'Private prompt instructions', hasStaleData: true, detectedClubs: ['Arsenal'], detectedCompetitions: [], selectedClubIds: [] };
const evidence = 'Oxirgi saqlangan ma’lumot; joriy holat qayta tasdiqlanmagan.\nArsenal: 3-o‘rin, 20 ochko.';
assert.match(buildAiFallbackReply('Arsenal kim yutadi', { ...grounding, fallbackFacts: evidence }), /3-o‘rin, 20 ochko/);
assert.match(buildAiFallbackReply('Arsenal kim yutadi', { ...grounding, fallbackFacts: evidence }), /joriy holat qayta tasdiqlanmagan/);
assert.ok(!buildAiFallbackReply('Arsenal kim yutadi', grounding).includes('Private prompt'));
assert.match(buildAiFallbackReply('taktika kerak', grounding), /Umumiy eFootball maslahati/);
assert.equal(buildAiFallbackReply('Arsenal egasi', { ...grounding, factualAnswer: '@actual_owner' }), '@actual_owner');
assert.equal(await generateGroundedTelegramAnswer({ ...base, generate: async () => ({}) }), AI_CLARIFICATION_REPLY);
assert.equal(await generateGroundedTelegramAnswer({ ...base, generate: async () => ({ text: '  ' }) }), AI_CLARIFICATION_REPLY);
assert.match(await generateGroundedTelegramAnswer({ ...base, generate: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) }), /Boshqacha yozib/);
let calls = 0;
assert.equal(await generateGroundedTelegramAnswer({ ...base, deadlineAt: Date.now() + 6000, generate: async () => {
  if (++calls === 1) throw busy;
  return { text: 'Arsenal — Chelsea.' };
} }), 'Arsenal — Chelsea.');
assert.equal(calls, 2);
calls = 0;
await assert.rejects(generateGroundedTelegramAnswer({ ...base, deadlineAt: Date.now() + 6000, generate: async () => { calls++; throw busy; } }));
assert.equal(calls, 2, 'No unbounded retry on persistent overload');
calls = 0;
await assert.rejects(generateGroundedTelegramAnswer({ ...base, deadlineAt: Date.now() + 1000, generate: async () => { calls++; throw busy; } }));
assert.equal(calls, 1, 'No retry without enough time for delivery');
calls = 0;
await assert.rejects(generateGroundedTelegramAnswer({ ...base, deadlineAt: Date.now() + 6000, generate: async () => { calls++; throw quota; } }));
assert.equal(calls, 1, 'Quota errors must not consume extra requests');
calls = 0;
const aborted = new AbortController(); aborted.abort();
await assert.rejects(generateGroundedTelegramAnswer({ ...base, signal: aborted.signal, deadlineAt: Date.now() + 6000, generate: async () => { calls++; return {}; } }));
assert.equal(calls, 0, 'Deadline abort prevents late generation');

// A blank model response must deliver clarification, once, in the authorized topic.
setTestConfigOverride({ ...DEFAULT_AI_CONFIG, enabled: true, allowedChatId: -1001, allowedThreadId: 3503 });
setTestGroundingOverride({ clubs: [], competitions: [], standings: {}, fixtures: {} });
clearTestAiState(); clearTestRateLimitState(); setTestAiResponder(async () => '  ');
process.env.TELEGRAM_BOT_TOKEN = '123456:isolated-response-test';
const original = global.fetch, sent: any[] = [];
global.fetch = async (input: any, init?: any) => String(input).includes('api.telegram.org') ? ({ ok: true, json: async () => {
  sent.push(JSON.parse(init?.body || '{}')); return { ok: true, result: { message_id: 123 } };
} } as any) : original(input, init);
try {
  const payload = { updateId: 81017, messageId: 31, chatId: -1001, threadId: 3503, fromUser: { id: 42 }, text: 'efootball nima gap' };
  assert.equal((await handleTelegramAiMessage(payload)).replySent, true);
  assert.equal(sent.at(-1).text, AI_CLARIFICATION_REPLY);
  await handleTelegramAiMessage(payload);
  assert.equal(sent.length, 1, 'Fallback respects delivery deduplication');
  setTestAiResponder(async () => { throw busy; });
  assert.equal((await handleTelegramAiMessage({ ...payload, updateId: 81018, messageId: 32, text: 'efootball taktika kerak' })).replySent, true);
  assert.match(sent.at(-1).text, /Umumiy eFootball maslahati/);
  assert.ok(!sent.at(-1).text.includes('band'));
} finally {
  global.fetch = original; setTestAiResponder(undefined); setTestGroundingOverride(null); setTestConfigOverride(null);
  clearTestAiState(); clearTestRateLimitState();
}
console.log('PASS empty response clarification, blocked response, provider error distinctions, bounded busy retry, quota/deadline protection and deduplicated topic dispatch.');
