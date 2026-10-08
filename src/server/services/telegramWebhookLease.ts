import { getBoundedRedisClient } from '../readModel/boundedRedis';
import { getFirestoreDb } from '../firebase/admin';
import { recordDurableRead } from './durableReadCosts';

export type WebhookLease = { status: 'claimed' | 'done' | 'busy'; storage: 'redis' | 'firestore' | 'memory' };
const local = new Map<number, { value: string; expiresAt: number }>();
const prefix = 'efluz:v1:telegram:webhook-update:';
const collection = 'telegram_webhook_leases';
const leaseMs = 120_000, doneMs = 86_400_000;

// Only read-only navigation commands may use the outage fallback. AI controls,
// payments, callbacks and imports retain their existing Redis prerequisite.
export function isBasicBotUpdate(update: any): boolean {
  const message = update?.message;
  return !update?.callback_query && !update?.pre_checkout_query && !message?.successful_payment
    && !message?.sender_chat && !message?.forward_origin && !message?.forward_from && !message?.forward_from_chat
    && Number.isSafeInteger(message?.chat?.id) && Number.isSafeInteger(message?.from?.id)
    && typeof message?.text === 'string'
    && /^\/(start|help|paysupport)(?:@[a-zA-Z0-9_]+)?(?:\s|$)/i.test(message.text.trim());
}

export function createWebhookLease(getRedis = getBoundedRedisClient, getDb = getFirestoreDb) {
  return {
    async claim(updateId: number, owner: string, basic: boolean): Promise<WebhookLease> {
      const client = getRedis();
      if (client && !basic) {
        try {
          if (await client.set(prefix + updateId, owner, { nx: true, ex: leaseMs / 1000 })) return { status: 'claimed', storage: 'redis' };
          const value = await client.get<string>(prefix + updateId);
          return { status: value === 'done' || value === '1' ? 'done' : 'busy', storage: 'redis' };
        } catch {
          if (!basic) throw new Error('REDIS_WEBHOOK_UNAVAILABLE');
        }
      } else if (!basic && process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
        const now = Date.now();
        for (const [id, value] of local) if (value.expiresAt <= now) local.delete(id);
        const prior = local.get(updateId);
        if (prior) return { status: prior.value === 'done' ? 'done' : 'busy', storage: 'memory' };
        local.set(updateId, { value: owner, expiresAt: now + leaseMs });
        return { status: 'claimed', storage: 'memory' };
      } else if (!basic) throw new Error('REDIS_WEBHOOK_UNAVAILABLE');

      // Basic commands always use the same durable store, including after Redis
      // recovers, so an outage-era completed update cannot be replayed in Redis.
      // One document transaction, no collection scan. Shared across server instances.
      const db = getDb(), ref = db.collection(collection).doc(String(updateId));
      const status = await db.runTransaction(async tx => {
        const previous = await tx.get(ref);
        recordDurableRead(collection, 1, 'telegramWebhookLease:claim');
        const data = previous.data();
        if (data?.expiresAt > Date.now()) return data.value === 'done' ? 'done' as const : 'busy' as const;
        tx.set(ref, { value: owner, expiresAt: Date.now() + leaseMs, deleteAfter: new Date(Date.now() + doneMs) });
        return 'claimed' as const;
      });
      return { status, storage: 'firestore' };
    },
    async settle(updateId: number, owner: string, completed: boolean, lease: WebhookLease): Promise<void> {
      if (lease.storage === 'redis') {
        const client = getRedis();
        if (!client) throw new Error('REDIS_WEBHOOK_UNAVAILABLE');
        await client.eval(`
          if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
          if ARGV[2] == 'done' then return redis.call('SET', KEYS[1], 'done', 'EX', ARGV[3]) end
          return redis.call('DEL', KEYS[1])
        `, [prefix + updateId], [owner, completed ? 'done' : 'release', doneMs / 1000]);
      } else if (lease.storage === 'firestore') {
        const db = getDb(), ref = db.collection(collection).doc(String(updateId));
        await db.runTransaction(async tx => {
          const previous = await tx.get(ref);
          recordDurableRead(collection, 1, 'telegramWebhookLease:settle');
          if (previous.data()?.value !== owner) return;
          if (completed) tx.set(ref, { value: 'done', expiresAt: Date.now() + doneMs, deleteAfter: new Date(Date.now() + doneMs) });
          else tx.delete(ref);
        });
      } else if (local.get(updateId)?.value === owner) {
        if (completed) local.set(updateId, { value: 'done', expiresAt: Date.now() + doneMs });
        else local.delete(updateId);
      }
    },
  };
}
const coordinator = createWebhookLease();
export const claimTelegramUpdate = coordinator.claim;
export const settleTelegramUpdate = coordinator.settle;
