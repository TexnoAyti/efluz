import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { initDatabase } from '../db';
import { PostgresAiStore } from '../services/postgresAiStore';
import { getAiRedisClient } from '../services/telegramAiDeadline';
import { KEY_PREFIX } from '../readModel/readModelStore';
import { DEFAULT_AI_CONFIG, getAiConfigRedisKey, setTestConfigOverride } from '../services/telegramAiConfigService';
import { clearTestAiState, setTestAiResponder } from '../services/telegramAiService';
import { setTestGroundingOverride } from '../services/telegramAiGroundingService';
import { telegramRouter } from '../routes/telegram.routes';

await initDatabase();
process.env.DATABASE_PROVIDER = 'supabase';
process.env.SUPABASE_DATA_NAMESPACE = 'preview';
process.env.TELEGRAM_WEBHOOK_SECRET = 'isolated-ai-admission';
process.env.TELEGRAM_BOT_TOKEN = '777:isolated-ai-admission';
process.env.MUNFIZ_PRIVATE_CHAT_ENABLED = 'false';
const config = { ...DEFAULT_AI_CONFIG, enabled: true, allowedChatId: -1001, allowedThreadId: 3503, rateLimitUserPerMin: 20, rateLimitTopicPerMin: 60 };
setTestConfigOverride(config);
setTestGroundingOverride({ clubs: [], competitions: [], standings: {}, fixtures: {} });
clearTestAiState();
let modelCalls = 0, sends = 0, outageReads = 0;
const sentBodies: any[] = [];
setTestAiResponder(async () => { modelCalls++; return 'Umumiy eFootball tavsiyasi.'; });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: any, init?: any) => {
  if (String(input).startsWith('https://api.telegram.org/')) {
    sends++;
    sentBodies.push(JSON.parse(init.body));
    return Response.json({ ok: true, result: { message_id: 91000 + sends } });
  }
  return originalFetch(input, init);
};
const get = PostgresAiStore.prototype.get, set = PostgresAiStore.prototype.set, evaluate = PostgresAiStore.prototype.eval;
let failure: 'config' | 'claim' | 'quota' | null = null;
PostgresAiStore.prototype.get = async function(key: string) {
  if (failure === 'config') outageReads++;
  if (failure === 'config' && key === getAiConfigRedisKey()) throw new Error('POSTGRES_RPC_HTTP_500');
  return get.call(this, key);
};
PostgresAiStore.prototype.set = async function(key, value, options) {
  if (failure === 'claim' && key.includes(':ai:delivery:')) throw new Error('POSTGRES_RPC_HTTP_500');
  return set.call(this, key, value, options);
};
PostgresAiStore.prototype.eval = async function(script, keys, args) {
  if (failure === 'quota' && script.includes('EFL_AI_RATE_LIMIT_V1')) throw new Error('POSTGRES_RPC_HTTP_500');
  return evaluate.call(this, script, keys, args);
};
const app = express(); app.use(express.json()); app.use('/api/telegram', telegramRouter);
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
const url = `http://127.0.0.1:${(server.address() as any).port}/api/telegram/webhook`;
const update = (id: number, extra = {}) => ({ update_id: id, message: {
  message_id: id, chat: { id: 5209126900, type: 'private' }, from: { id: 5209126900 }, text: 'efootball taktika kerak', ...extra,
} });
const post = (body: any) => originalFetch(url, { method: 'POST', headers: {
  'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'isolated-ai-admission',
}, body: JSON.stringify(body) });
try {
  // Configuration failure used to masquerade as deliberately disabled AI.
  setTestConfigOverride(null); failure = 'config';
  assert.equal((await post(update(991001))).status, 503);
  assert.equal(modelCalls, 0); assert.equal(sends, 0);
  outageReads = 0;
  const status = await post(update(991006, { text: '/ai_status' }));
  assert.equal(status.status, 200);
  assert.equal((await status.json() as any).databaseAvailable, false);
  assert.equal(outageReads, 1, 'Status must not pile metrics/source reads onto a failing database');
  assert.match(sentBodies.at(-1).text, /yoqilgan yoki o‘chirilganini hozir tekshirib bo‘lmadi/);
  assert.equal(modelCalls, 0); assert.equal(sends, 1);
  setTestConfigOverride(config);
  failure = 'claim';
  assert.equal((await post(update(991002))).status, 503);
  failure = 'quota';
  assert.equal((await post(update(991003))).status, 503);
  assert.equal(modelCalls, 0); assert.equal(sends, 1);
  const client = getAiRedisClient()!;
  assert.equal(await client.get(`${KEY_PREFIX}:telegram:ai:delivery:991003`), 'pending', 'Outage must not falsely mark the command sent');
  // Unauthorized topics and real disabled configuration stay terminal ignores.
  const rejected = await post(update(991004, { chat: { id: -1001, type: 'supergroup' }, message_thread_id: 999 }));
  assert.equal(rejected.status, 200);
  assert.equal((await rejected.json() as any).result.ignored, 'topic_not_authorized');
  setTestConfigOverride({ ...config, enabled: false });
  const disabled = await post(update(991005)); assert.equal(disabled.status, 200);
  assert.equal((await disabled.json() as any).result.ignored, 'ai_disabled');
  // Exactly the same update survives the outage, then executes and replies once.
  failure = null; setTestConfigOverride(config);
  for (const id of [991001, 991002, 991003]) {
    const response = await post(update(id)); assert.equal(response.status, 200);
    assert.equal((await response.json() as any).result.replySent, true);
    assert.equal((await post(update(id))).status, 200);
  }
  assert.equal(modelCalls, 3); assert.equal(sends, 4);
  console.log('PASS signed AI webhook: config/claim/quota outages return 503, no model/actions/replies before admission, no false sent marker, same updates recover once, disabled/unauthorized remain terminal');
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  globalThis.fetch = originalFetch;
  PostgresAiStore.prototype.get = get; PostgresAiStore.prototype.set = set; PostgresAiStore.prototype.eval = evaluate;
  setTestConfigOverride(null); setTestGroundingOverride(null); setTestAiResponder(undefined); clearTestAiState();
}
