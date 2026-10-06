import assert from 'node:assert/strict';
import express from 'express';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { getTelegramAiConfig, updateTelegramAiConfig } from '../services/telegramAiConfigService';

await initDatabase();
const bridge = await startMockUpstashBridge();
process.env.TELEGRAM_BOT_TOKEN = '777:isolated-recovery';
process.env.TELEGRAM_WEBHOOK_SECRET = 'isolated-recovery-secret';
const originalFetch = global.fetch, db = getFirestoreDb(), originalCollection = db.collection.bind(db);
let firestore = 0; const sent: any[] = [];
db.collection = (() => { firestore++; throw new Error('RECOVERY_MUST_NOT_READ_FIRESTORE'); }) as any;
global.fetch = async (input: any, init?: any) => String(input).includes('api.telegram.org') ? ({ ok: true, json: async () => { sent.push(JSON.parse(init.body)); return { ok: true, result: { message_id: 500 + sent.length } }; } } as any) : originalFetch(input, init);
const { telegramRouter } = await import('../routes/telegram.routes');
const app = express(); app.use(express.json()); app.use('/telegram', telegramRouter);
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
const url = 'http://127.0.0.1:' + (server.address() as any).port + '/telegram/webhook';
let id = 9920000;
const post = async (text: string, from = 5209126900, extra: any = {}, secret = process.env.TELEGRAM_WEBHOOK_SECRET!) => {
  const response = await originalFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify({ update_id: ++id, message: { message_id: id, text, chat: { id: -1001, type: 'supergroup' }, message_thread_id: 3503, from: { id: from }, ...extra } }) });
  return { status: response.status, body: await response.json() as any };
};
try {
  assert.equal((await updateTelegramAiConfig({ enabled: false, allowedChatId: -1001, allowedThreadId: 3503, rateLimitUserPerMin: 5 }, 5209126900)).success, true);
  assert.equal((await post('/ai_on', 5209126900, {}, 'wrong-secret')).status, 401);
  for (const [from, extra] of [[7573478198, {}], [123, {}], [5209126900, { sender_chat: { id: -1001 } }], [5209126900, { forward_origin: { type: 'user' } }], [5209126900, { message_thread_id: 999 }], [5209126900, { chat: { id: -1002, type: 'supergroup' } }], [5209126900, { from: { id: 5209126900, is_bot: true } }]] as const) {
    const response = await post('/ai_on', from, extra); assert.equal(response.status, 200); assert.ok(response.body.rejected);
    assert.equal((await getTelegramAiConfig()).config.enabled, false);
  }
  const on = await post('/AI_ON@efluzbot'); assert.equal(on.body.success, true); assert.equal((await getTelegramAiConfig()).config.enabled, true);
  assert.equal(sent.at(-1).message_thread_id, 3503);
  const off = await post('/ai_off'); assert.equal(off.body.success, true); assert.equal((await getTelegramAiConfig()).config.enabled, false);
  assert.match(sent.at(-1).text, /Qayta yoqish: \/ai_on/);
  const dm = await post('/ai_on', 5209126900, { chat: { id: 5209126900, type: 'private' }, message_thread_id: undefined });
  assert.equal(dm.body.success, true);
  const config = (await getTelegramAiConfig()).config;
  assert.equal(config.enabled, true); assert.equal(config.allowedChatId, -1001); assert.equal(config.allowedThreadId, 3503); assert.equal(config.rateLimitUserPerMin, 5);
  assert.equal(firestore, 0);
  console.log('PASS signed owner AI on/off recovery while disabled, bound topic/owner DM only, anonymous/forwarded/bot/other owner/topic rejects, config preserved; Redis HTTP bridge and Telegram mocked, zero Firestore/real messages');
} finally {
  await new Promise<void>(r => server.close(() => r())); db.collection = originalCollection; global.fetch = originalFetch; await bridge.close();
}
