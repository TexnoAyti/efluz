import assert from 'node:assert/strict';
import { repairProductionTelegramWebhook } from '../services/telegramBotService';

const previous = { ...process.env };
const originalFetch = globalThis.fetch;
try {
  process.env.VERCEL_ENV = 'production';
  process.env.TELEGRAM_WEBHOOK_REPAIR_ENABLED = 'true';
  process.env.TELEGRAM_BOT_TOKEN = '123456:test-token-never-logged';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret-never-returned';
  let current = { url: 'https://old.invalid/webhook', pending_update_count: 3, allowed_updates: ['message'] };
  const calls: Array<{ method: string; body: any }> = [];
  globalThis.fetch = (async (input: any, init: any) => {
    const method = String(input).split('/').at(-1)!;
    const body = JSON.parse(init.body);
    calls.push({ method, body });
    if (method === 'setWebhook') current = { ...current, url: body.url, allowed_updates: body.allowed_updates };
    return new Response(JSON.stringify({ ok: true, result: method === 'getWebhookInfo' ? current : true }), { status: 200 });
  }) as typeof fetch;

  const result = await repairProductionTelegramWebhook();
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.pendingUpdates, 3);
  assert.equal(calls.filter(call => call.method === 'setWebhook').length, 1);
  const set = calls.find(call => call.method === 'setWebhook')!.body;
  assert.equal(set.url, 'https://efluz.vercel.app/api/telegram/webhook');
  assert.equal(set.drop_pending_updates, false);
  assert.ok(set.allowed_updates.includes('callback_query'));
  assert.ok(!JSON.stringify(result).includes(process.env.TELEGRAM_BOT_TOKEN));
  assert.ok(!JSON.stringify(result).includes(process.env.TELEGRAM_WEBHOOK_SECRET));
  console.log('PASS production webhook repair is fixed-target, preserves pending updates and returns no credentials');
} finally {
  globalThis.fetch = originalFetch;
  process.env = previous;
}
