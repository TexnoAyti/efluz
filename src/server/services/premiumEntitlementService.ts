import crypto from 'node:crypto';
import { getUpstashClient, KEY_PREFIX } from '../readModel/readModelStore';

export const PREMIUM_PRICE_STARS = 89;
export const PREMIUM_ACTIVE_SEASON = 'season-2026-27';
export const PREMIUM_PRIVATE_LAB = true;

export type PremiumEntitlementSource = 'ADMIN' | 'TELEGRAM_STARS';
export type PremiumEntitlementStatus = 'ACTIVE' | 'REVOKED';

export interface PremiumEntitlement {
  userId: string;
  seasonId: string;
  status: PremiumEntitlementStatus;
  source: PremiumEntitlementSource;
  starsPaid?: number;
  telegramPaymentChargeId?: string;
  providerPaymentChargeId?: string;
  grantedAt: string;
  grantedByUserId?: string;
  grantedByUsername?: string;
  note?: string;
  revokedAt?: string;
  revokedByUserId?: string;
  revokedByUsername?: string;
}

export interface PremiumEvent {
  id: string;
  userId: string;
  seasonId: string;
  action: 'GRANT' | 'REVOKE' | 'PAYMENT_CONFIRMED';
  source: PremiumEntitlementSource;
  actorUserId?: string;
  actorUsername?: string;
  stars?: number;
  telegramPaymentChargeId?: string;
  note?: string;
  createdAt: string;
}

export interface PendingPremiumInvoice {
  payload: string;
  userId: string;
  telegramId: string;
  seasonId: string;
  stars: number;
  createdAt: string;
}

const memoryEntitlements = new Map<string, PremiumEntitlement>();
const memoryPendingInvoices = new Map<string, PendingPremiumInvoice>();
const memoryPayments = new Map<string, PremiumEvent>();
const memoryEvents: PremiumEvent[] = [];

function hosted(): boolean {
  return Boolean(process.env.VERCEL || process.env.K_SERVICE || process.env.NODE_ENV === 'production');
}

function entitlementKey(seasonId: string): string {
  return `${KEY_PREFIX}:premium:entitlements:${seasonId}`;
}

function eventKey(seasonId: string): string {
  return `${KEY_PREFIX}:premium:events:${seasonId}`;
}

function paymentKey(seasonId: string): string {
  return `${KEY_PREFIX}:premium:payments:${seasonId}`;
}

function pendingInvoiceKey(payload: string): string {
  const digest = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
  return `${KEY_PREFIX}:premium:invoice:${digest}`;
}

function paymentLockKey(chargeId: string): string {
  const digest = crypto.createHash('sha256').update(chargeId).digest('hex').slice(0, 32);
  return `${KEY_PREFIX}:premium:payment-lock:${digest}`;
}

function memoryEntitlementKey(userId: string, seasonId: string): string {
  return `${seasonId}:${userId}`;
}

function parseStored<T>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T; } catch { return null; }
  }
  if (typeof value === 'object') return value as T;
  return null;
}

async function appendEvent(event: PremiumEvent): Promise<void> {
  memoryEvents.unshift(event);
  if (memoryEvents.length > 500) memoryEvents.length = 500;
  const client = getUpstashClient();
  if (!client) return;
  await client.lpush(eventKey(event.seasonId), JSON.stringify(event));
  await client.ltrim(eventKey(event.seasonId), 0, 499);
}

export async function getPremiumEntitlement(
  userId: string,
  seasonId = PREMIUM_ACTIVE_SEASON
): Promise<PremiumEntitlement | null> {
  const client = getUpstashClient();
  if (client) {
    try {
      const raw = await client.hget(entitlementKey(seasonId), userId);
      return parseStored<PremiumEntitlement>(raw);
    } catch (error: any) {
      console.warn('[PREMIUM] Redis entitlement read failed:', error?.message || error);
    }
  }
  return memoryEntitlements.get(memoryEntitlementKey(userId, seasonId)) || null;
}

export async function getPremiumStatus(userId: string, seasonId = PREMIUM_ACTIVE_SEASON) {
  const entitlement = await getPremiumEntitlement(userId, seasonId);
  return {
    seasonId,
    priceStars: PREMIUM_PRICE_STARS,
    privateLab: PREMIUM_PRIVATE_LAB,
    active: entitlement?.status === 'ACTIVE',
    entitlement,
  };
}

export async function listPremiumEntitlements(seasonId = PREMIUM_ACTIVE_SEASON): Promise<PremiumEntitlement[]> {
  const client = getUpstashClient();
  if (client) {
    try {
      const values = await client.hvals(entitlementKey(seasonId));
      return (values || [])
        .map((value: unknown) => parseStored<PremiumEntitlement>(value))
        .filter((value): value is PremiumEntitlement => Boolean(value))
        .sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
    } catch (error: any) {
      console.warn('[PREMIUM] Redis entitlement list failed:', error?.message || error);
    }
  }
  return [...memoryEntitlements.values()]
    .filter((item) => item.seasonId === seasonId)
    .sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
}

export async function listPremiumEvents(seasonId = PREMIUM_ACTIVE_SEASON, limit = 30): Promise<PremiumEvent[]> {
  const client = getUpstashClient();
  if (client) {
    try {
      const rows = await client.lrange(eventKey(seasonId), 0, Math.max(0, Math.min(limit, 100) - 1));
      return (rows || [])
        .map((row: unknown) => parseStored<PremiumEvent>(row))
        .filter((value): value is PremiumEvent => Boolean(value));
    } catch (error: any) {
      console.warn('[PREMIUM] Redis event list failed:', error?.message || error);
    }
  }
  return memoryEvents.filter((item) => item.seasonId === seasonId).slice(0, limit);
}

export async function grantPremium(params: {
  userId: string;
  seasonId?: string;
  source: PremiumEntitlementSource;
  actorUserId?: string;
  actorUsername?: string;
  note?: string;
  starsPaid?: number;
  telegramPaymentChargeId?: string;
  providerPaymentChargeId?: string;
}): Promise<PremiumEntitlement> {
  const seasonId = params.seasonId || PREMIUM_ACTIVE_SEASON;
  const now = new Date().toISOString();
  const entitlement: PremiumEntitlement = {
    userId: params.userId,
    seasonId,
    status: 'ACTIVE',
    source: params.source,
    starsPaid: params.starsPaid,
    telegramPaymentChargeId: params.telegramPaymentChargeId,
    providerPaymentChargeId: params.providerPaymentChargeId,
    grantedAt: now,
    grantedByUserId: params.actorUserId,
    grantedByUsername: params.actorUsername,
    note: params.note,
  };

  const client = getUpstashClient();
  if (!client && hosted()) throw new Error('PREMIUM_REDIS_UNAVAILABLE');
  if (client) await client.hset(entitlementKey(seasonId), { [params.userId]: JSON.stringify(entitlement) });
  memoryEntitlements.set(memoryEntitlementKey(params.userId, seasonId), entitlement);

  await appendEvent({
    id: crypto.randomUUID(),
    userId: params.userId,
    seasonId,
    action: params.source === 'TELEGRAM_STARS' ? 'PAYMENT_CONFIRMED' : 'GRANT',
    source: params.source,
    actorUserId: params.actorUserId,
    actorUsername: params.actorUsername,
    stars: params.starsPaid,
    telegramPaymentChargeId: params.telegramPaymentChargeId,
    note: params.note,
    createdAt: now,
  });
  return entitlement;
}

export async function revokePremium(params: {
  userId: string;
  seasonId?: string;
  actorUserId: string;
  actorUsername?: string;
  note?: string;
}): Promise<PremiumEntitlement> {
  const seasonId = params.seasonId || PREMIUM_ACTIVE_SEASON;
  const existing = await getPremiumEntitlement(params.userId, seasonId);
  const now = new Date().toISOString();
  const entitlement: PremiumEntitlement = {
    ...(existing || {
      userId: params.userId,
      seasonId,
      source: 'ADMIN' as const,
      grantedAt: now,
    }),
    status: 'REVOKED',
    revokedAt: now,
    revokedByUserId: params.actorUserId,
    revokedByUsername: params.actorUsername,
    note: params.note || existing?.note,
  };

  const client = getUpstashClient();
  if (!client && hosted()) throw new Error('PREMIUM_REDIS_UNAVAILABLE');
  if (client) await client.hset(entitlementKey(seasonId), { [params.userId]: JSON.stringify(entitlement) });
  memoryEntitlements.set(memoryEntitlementKey(params.userId, seasonId), entitlement);

  await appendEvent({
    id: crypto.randomUUID(),
    userId: params.userId,
    seasonId,
    action: 'REVOKE',
    source: entitlement.source,
    actorUserId: params.actorUserId,
    actorUsername: params.actorUsername,
    note: params.note,
    createdAt: now,
  });
  return entitlement;
}

export async function createPremiumInvoice(params: {
  userId: string;
  telegramId: string;
  seasonId?: string;
}): Promise<{ invoiceLink: string; payload: string; priceStars: number }> {
  const seasonId = params.seasonId || PREMIUM_ACTIVE_SEASON;
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN_NOT_CONFIGURED');

  const current = await getPremiumEntitlement(params.userId, seasonId);
  if (current?.status === 'ACTIVE') throw new Error('PREMIUM_ALREADY_ACTIVE');

  const nonce = crypto.randomBytes(8).toString('hex');
  const payload = `efluz-premium:${seasonId}:${params.userId}:${nonce}`;
  const pending: PendingPremiumInvoice = {
    payload,
    userId: params.userId,
    telegramId: String(params.telegramId),
    seasonId,
    stars: PREMIUM_PRICE_STARS,
    createdAt: new Date().toISOString(),
  };

  const client = getUpstashClient();
  if (!client && hosted()) throw new Error('PREMIUM_REDIS_UNAVAILABLE');
  if (client) await client.set(pendingInvoiceKey(payload), JSON.stringify(pending), { ex: 3600 });
  memoryPendingInvoices.set(payload, pending);

  const response = await fetch(`https://api.telegram.org/bot${botToken}/createInvoiceLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      title: 'EFL UZ Premium 2026/27',
      description: 'Private beta: EFL Career, advanced stats and premium smart alerts for the 2026/27 season.',
      payload,
      currency: 'XTR',
      prices: [{ label: 'EFL UZ Premium • 2026/27', amount: PREMIUM_PRICE_STARS }],
    }),
  });
  const data: any = await response.json();
  if (!response.ok || !data?.ok || !data?.result) {
    throw new Error(data?.description || 'TELEGRAM_INVOICE_CREATE_FAILED');
  }
  return { invoiceLink: data.result, payload, priceStars: PREMIUM_PRICE_STARS };
}

export async function getPendingPremiumInvoice(payload: string): Promise<PendingPremiumInvoice | null> {
  const client = getUpstashClient();
  if (client) {
    try {
      const raw = await client.get(pendingInvoiceKey(payload));
      const parsed = parseStored<PendingPremiumInvoice>(raw);
      if (parsed) return parsed;
    } catch (error: any) {
      console.warn('[PREMIUM] Pending invoice read failed:', error?.message || error);
    }
  }
  return memoryPendingInvoices.get(payload) || null;
}

export async function validatePremiumCheckout(params: {
  payload: string;
  telegramId: string | number;
  currency: string;
  totalAmount: number;
}): Promise<{ ok: boolean; error?: string; pending?: PendingPremiumInvoice }> {
  const pending = await getPendingPremiumInvoice(params.payload);
  if (!pending) return { ok: false, error: 'Invoice expired or is not recognized.' };
  if (String(pending.telegramId) !== String(params.telegramId)) return { ok: false, error: 'Invoice owner mismatch.' };
  if (params.currency !== 'XTR' || params.totalAmount !== pending.stars || pending.stars !== PREMIUM_PRICE_STARS) {
    return { ok: false, error: 'Invoice price mismatch.' };
  }
  return { ok: true, pending };
}

export async function applySuccessfulPremiumPayment(params: {
  userId: string;
  payload: string;
  telegramId: string | number;
  currency: string;
  totalAmount: number;
  telegramPaymentChargeId: string;
  providerPaymentChargeId?: string;
}): Promise<{ entitlement: PremiumEntitlement; duplicate: boolean }> {
  const validation = await validatePremiumCheckout({
    payload: params.payload,
    telegramId: params.telegramId,
    currency: params.currency,
    totalAmount: params.totalAmount,
  });
  if (!validation.ok || !validation.pending) throw new Error(validation.error || 'PREMIUM_PAYMENT_VALIDATION_FAILED');
  if (validation.pending.userId !== params.userId) throw new Error('PAYMENT_USER_MISMATCH');

  const client = getUpstashClient();
  if (!client && hosted()) throw new Error('PREMIUM_REDIS_UNAVAILABLE');

  if (client) {
    const priorRaw = await client.hget(paymentKey(validation.pending.seasonId), params.telegramPaymentChargeId);
    const prior = parseStored<PremiumEvent>(priorRaw);
    if (prior) {
      const existing = await getPremiumEntitlement(params.userId, validation.pending.seasonId);
      if (!existing) throw new Error('PAYMENT_LEDGER_ENTITLEMENT_MISSING');
      return { entitlement: existing, duplicate: true };
    }

    const locked = await client.set(paymentLockKey(params.telegramPaymentChargeId), '1', { nx: true, ex: 60 });
    if (!locked) throw new Error('PAYMENT_ALREADY_PROCESSING');
  } else if (memoryPayments.has(params.telegramPaymentChargeId)) {
    const existing = await getPremiumEntitlement(params.userId, validation.pending.seasonId);
    if (!existing) throw new Error('PAYMENT_LEDGER_ENTITLEMENT_MISSING');
    return { entitlement: existing, duplicate: true };
  }

  try {
    const entitlement = await grantPremium({
      userId: params.userId,
      seasonId: validation.pending.seasonId,
      source: 'TELEGRAM_STARS',
      starsPaid: PREMIUM_PRICE_STARS,
      telegramPaymentChargeId: params.telegramPaymentChargeId,
      providerPaymentChargeId: params.providerPaymentChargeId,
      note: 'Telegram Stars payment confirmed',
    });

    const paymentEvent: PremiumEvent = {
      id: crypto.randomUUID(),
      userId: params.userId,
      seasonId: validation.pending.seasonId,
      action: 'PAYMENT_CONFIRMED',
      source: 'TELEGRAM_STARS',
      stars: PREMIUM_PRICE_STARS,
      telegramPaymentChargeId: params.telegramPaymentChargeId,
      createdAt: new Date().toISOString(),
    };
    if (client) {
      await client.hset(paymentKey(validation.pending.seasonId), {
        [params.telegramPaymentChargeId]: JSON.stringify(paymentEvent),
      });
      await client.del(paymentLockKey(params.telegramPaymentChargeId));
    }
    memoryPayments.set(params.telegramPaymentChargeId, paymentEvent);
    return { entitlement, duplicate: false };
  } catch (error) {
    if (client) await client.del(paymentLockKey(params.telegramPaymentChargeId)).catch(() => undefined);
    throw error;
  }
}

export async function answerPremiumPreCheckoutQuery(
  queryId: string,
  ok: boolean,
  errorMessage?: string
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN_NOT_CONFIGURED');
  const response = await fetch(`https://api.telegram.org/bot${botToken}/answerPreCheckoutQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      pre_checkout_query_id: queryId,
      ok,
      ...(ok ? {} : { error_message: errorMessage || 'Payment validation failed.' }),
    }),
  });
  const data: any = await response.json();
  if (!response.ok || !data?.ok) throw new Error(data?.description || 'PRE_CHECKOUT_RESPONSE_FAILED');
}
