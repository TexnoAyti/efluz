import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createWebhookLease, isBasicBotUpdate } from '../services/telegramWebhookLease';
import { getFirestoreDb } from '../firebase/admin';
import { telegramRouter } from '../routes/telegram.routes';
import { parseFirestoreError } from '../firebase/firestoreErrorHandler';

const down = { set: async () => { throw new Error('Upstash Fixed plan limits'); } } as any;
const first = createWebhookLease(() => down), second = createWebhookLease(() => down);
const [a, b] = await Promise.all([first.claim(801, 'a', true), second.claim(801, 'b', true)]);
assert.deepEqual([a.status, b.status].sort(), ['busy', 'claimed']);
const owner = a.status === 'claimed' ? 'a' : 'b';
await first.settle(801, 'wrong-owner', true, a);
assert.equal((await second.claim(801, 'c', true)).status, 'busy');
await first.settle(801, owner, true, a);
assert.equal((await second.claim(801, 'c', true)).status, 'done');
const healthy = createWebhookLease(() => ({ set: async () => { throw new Error('Basic commands must not call Redis'); } }) as any);
assert.equal((await healthy.claim(801, 'd', true)).status, 'done', 'Recovery uses same completed marker');
const failed = await first.claim(802, 'a', true);
await first.settle(802, 'a', false, failed);
assert.equal((await second.claim(802, 'b', true)).status, 'claimed');
await assert.rejects(first.claim(803, 'a', false), /REDIS_WEBHOOK_UNAVAILABLE/);
assert.equal(isBasicBotUpdate({message:{chat:{id:1},from:{id:1},text:'/start'}}), true);
for (const message of [{text:'/ai_on'}, {text:'/start',successful_payment:{}}, {text:'/start',sender_chat:{id:2}}, {text:'/start',forward_origin:{}}]) {
  assert.equal(isBasicBotUpdate({message:{chat:{id:1},from:{id:1},...message}}), false);
}
const unavailable = createWebhookLease(() => down, () => { throw new Error('Firestore unavailable'); });
await assert.rejects(unavailable.claim(804, 'a', true), /Firestore unavailable/, 'No local acknowledgement if both stores fail');
assert.equal(parseFirestoreError(new Error('ERR Upstash Fixed plan limits')).code, 'CACHE_TEMPORARILY_UNAVAILABLE');

// Signed webhook route integration. Intercept all Telegram sends; never contact users.
process.env.TELEGRAM_WEBHOOK_SECRET = 'isolated-webhook-secret';
process.env.TELEGRAM_BOT_TOKEN = 'isolated-bot-token';
const originalFetch = globalThis.fetch;
let sends = 0;
globalThis.fetch = (async (url: any, options: any) => {
  if (String(url).startsWith('https://api.telegram.org/')) { sends++; return new Response(JSON.stringify({ok:true,result:{message_id:1}}),{headers:{'Content-Type':'application/json'}}); }
  return originalFetch(url, options);
}) as typeof fetch;
const app = express(); app.use(express.json()); app.use('/api/telegram', telegramRouter);
const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
const url = `http://127.0.0.1:${(server.address() as any).port}/api/telegram/webhook`;
const update = {update_id:805,message:{message_id:1,chat:{id:11,type:'private'},from:{id:11,first_name:'Test'},text:'/start'}};
try {
  const request = (secret: string) => fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-telegram-bot-api-secret-token':secret},body:JSON.stringify(update)});
  assert.equal((await request('wrong')).status,401);
  assert.equal(sends,0);
  assert.equal((await request('isolated-webhook-secret')).status,200);
  assert(sends > 0);
  const count = sends;
  const duplicate = await request('isolated-webhook-secret');
  assert.equal((await duplicate.json() as any).ignored,'duplicate_update');
  assert.equal(sends,count);
  assert.equal((await getFirestoreDb().collection('telegram_webhook_leases').doc('805').get()).data()?.value,'done');
} finally { server.close(); globalThis.fetch = originalFetch; }
console.log('PASS: Redis outage, cross-worker deduplication, owner isolation, retry, recovery, sensitive fail-closed, secret validation, /start delivery and duplicate suppression');
