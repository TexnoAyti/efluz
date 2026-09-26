import { createHash, randomUUID } from 'node:crypto';
import { getFirestoreDb } from '../firebase/admin';
import {
  createAuditLogFirestore,
  getUserActiveClubFirestore,
  trackFirestoreRead,
  trackFirestoreWrite,
} from '../firebase/firestoreStore';
import { queryAll, queryGet } from '../db';
import { SEED_CLUBS, SEED_COMPETITIONS } from '../db/seed';

export const PREMIUM_PRICE_STARS = 89;
export const PREMIUM_DEFAULT_SEASON_ID = 'season-2026-27';
const ENTITLEMENTS_COLLECTION = 'premium_entitlements';
const PAYMENTS_COLLECTION = 'premium_payments';
const ORDERS_COLLECTION = 'premium_orders';
const PREMIUM_ORDER_TTL_MS = 60 * 60 * 1000;

export type PremiumEntitlementStatus = 'ACTIVE' | 'REVOKED';
export type PremiumEntitlementSource = 'ADMIN' | 'TELEGRAM_STARS';

export interface PremiumEntitlement {
  id: string;
  userId: string;
  seasonId: string;
  status: PremiumEntitlementStatus;
  source: PremiumEntitlementSource;
  activatedAt: string;
  updatedAt: string;
  updatedBy?: string;
  revokedAt?: string | null;
  revokedBy?: string | null;
  note?: string | null;
  paymentChargeId?: string | null;
}

export interface PremiumCareerSnapshot {
  userId: string;
  seasonId: string;
  currentClub: { id: string; name: string; shortName?: string; leagueId?: string } | null;
  overall: {
    matches: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
    points: number;
    winRate: number;
    pointsPerMatch: number;
    goalsPerMatch: number;
    cleanSheets: number;
    longestUnbeatenRun: number;
    longestWinStreak: number;
  };
  form: Array<'W' | 'D' | 'L'>;
  competitions: Array<{
    competitionId: string;
    name: string;
    matches: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
    winRate: number;
  }>;
  achievements: Array<{ id: string; label: string; description: string; unlocked: boolean }>;
  generatedAt: string;
  source: 'sqlite' | 'empty';
}

type FixtureLike = {
  id: string;
  competition_id?: string;
  competitionId?: string;
  home_club_id?: string;
  homeClubId?: string;
  away_club_id?: string;
  awayClubId?: string;
  home_score?: number | null;
  homeScore?: number | null;
  away_score?: number | null;
  awayScore?: number | null;
};

function entitlementId(userId: string, seasonId: string) {
  return `${seasonId}__${userId}`;
}

function paymentDocumentId(chargeId: string) {
  return createHash('sha256').update(chargeId).digest('hex');
}

export function isPremiumPublicEnabled(): boolean {
  return process.env.PREMIUM_PUBLIC_ENABLED === 'true';
}

export function makePremiumPayload(orderId: string): string {
  return `eflp:${orderId}`;
}

export function parsePremiumPayload(payload: string): string | null {
  if (!payload || !payload.startsWith('eflp:')) return null;
  const orderId = payload.slice(5).trim();
  return /^[a-zA-Z0-9_-]{8,64}$/.test(orderId) ? orderId : null;
}

export async function getPremiumEntitlement(
  userId: string,
  seasonId = PREMIUM_DEFAULT_SEASON_ID
): Promise<PremiumEntitlement | null> {
  const db = getFirestoreDb();
  const snap = await db.collection(ENTITLEMENTS_COLLECTION).doc(entitlementId(userId, seasonId)).get();
  trackFirestoreRead(ENTITLEMENTS_COLLECTION, 1, 'getPremiumEntitlement');
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Omit<PremiumEntitlement, 'id'>) };
}

export async function listPremiumEntitlements(
  seasonId = PREMIUM_DEFAULT_SEASON_ID
): Promise<PremiumEntitlement[]> {
  const db = getFirestoreDb();
  const snap = await db
    .collection(ENTITLEMENTS_COLLECTION)
    .where('seasonId', '==', seasonId)
    .limit(500)
    .get();
  trackFirestoreRead(ENTITLEMENTS_COLLECTION, snap.size, 'listPremiumEntitlements');
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<PremiumEntitlement, 'id'>) }));
}

async function assertPremiumTargetUserExists(userId: string): Promise<void> {
  const db = getFirestoreDb();
  const snap = await db.collection('users').doc(userId).get();
  trackFirestoreRead('users', 1, 'assertPremiumTargetUserExists');
  if (!snap.exists) throw new Error('PREMIUM_TARGET_USER_NOT_FOUND');
}

export async function grantPremiumEntitlement(params: {
  userId: string;
  seasonId?: string;
  source: PremiumEntitlementSource;
  actorUserId?: string;
  actorUsername?: string;
  note?: string;
  paymentChargeId?: string;
}): Promise<PremiumEntitlement> {
  const seasonId = params.seasonId || PREMIUM_DEFAULT_SEASON_ID;
  await assertPremiumTargetUserExists(params.userId);
  const now = new Date().toISOString();
  const db = getFirestoreDb();
  const ref = db.collection(ENTITLEMENTS_COLLECTION).doc(entitlementId(params.userId, seasonId));
  const existing = await ref.get();
  trackFirestoreRead(ENTITLEMENTS_COLLECTION, 1, 'grantPremiumEntitlement');
  const previous = existing.exists ? existing.data() : null;

  const next: Omit<PremiumEntitlement, 'id'> = {
    userId: params.userId,
    seasonId,
    status: 'ACTIVE',
    source: params.source,
    activatedAt: previous?.activatedAt || now,
    updatedAt: now,
    updatedBy: params.actorUserId || params.userId,
    revokedAt: null,
    revokedBy: null,
    note: params.note?.trim() || previous?.note || null,
    paymentChargeId: params.paymentChargeId || previous?.paymentChargeId || null,
  };

  await ref.set(next, { merge: true });
  trackFirestoreWrite(ENTITLEMENTS_COLLECTION, 1, 'grantPremiumEntitlement');

  if (params.actorUserId) {
    await createAuditLogFirestore(
      params.actorUserId,
      'PREMIUM_GRANT',
      'premium_entitlement',
      ref.id,
      previous,
      next,
      undefined,
      params.actorUsername,
      params.note
    ).catch((err) => console.warn('[PREMIUM_AUDIT_GRANT]', err?.message || err));
  }

  return { id: ref.id, ...next };
}

export async function revokePremiumEntitlement(params: {
  userId: string;
  seasonId?: string;
  actorUserId: string;
  actorUsername?: string;
  note?: string;
}): Promise<PremiumEntitlement> {
  const seasonId = params.seasonId || PREMIUM_DEFAULT_SEASON_ID;
  await assertPremiumTargetUserExists(params.userId);
  const db = getFirestoreDb();
  const ref = db.collection(ENTITLEMENTS_COLLECTION).doc(entitlementId(params.userId, seasonId));
  const existing = await ref.get();
  trackFirestoreRead(ENTITLEMENTS_COLLECTION, 1, 'revokePremiumEntitlement');
  const previous = existing.exists ? existing.data() : null;
  const now = new Date().toISOString();

  const next: Omit<PremiumEntitlement, 'id'> = {
    userId: params.userId,
    seasonId,
    status: 'REVOKED',
    source: (previous?.source as PremiumEntitlementSource) || 'ADMIN',
    activatedAt: previous?.activatedAt || now,
    updatedAt: now,
    updatedBy: params.actorUserId,
    revokedAt: now,
    revokedBy: params.actorUserId,
    note: params.note?.trim() || previous?.note || null,
    paymentChargeId: previous?.paymentChargeId || null,
  };

  await ref.set(next, { merge: true });
  trackFirestoreWrite(ENTITLEMENTS_COLLECTION, 1, 'revokePremiumEntitlement');

  await createAuditLogFirestore(
    params.actorUserId,
    'PREMIUM_REVOKE',
    'premium_entitlement',
    ref.id,
    previous,
    next,
    undefined,
    params.actorUsername,
    params.note
  ).catch((err) => console.warn('[PREMIUM_AUDIT_REVOKE]', err?.message || err));

  return { id: ref.id, ...next };
}

function scoreFixture(row: FixtureLike, clubId: string) {
  const homeClubId = row.home_club_id ?? row.homeClubId;
  const awayClubId = row.away_club_id ?? row.awayClubId;
  const homeScore = Number(row.home_score ?? row.homeScore ?? 0);
  const awayScore = Number(row.away_score ?? row.awayScore ?? 0);
  const isHome = homeClubId === clubId;
  const gf = isHome ? homeScore : awayScore;
  const ga = isHome ? awayScore : homeScore;
  const result: 'W' | 'D' | 'L' = gf > ga ? 'W' : gf === ga ? 'D' : 'L';
  return { gf, ga, result };
}

export function computeCareerStatsFromFixtures(rows: FixtureLike[], clubId: string) {
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let cleanSheets = 0;
  let currentUnbeaten = 0;
  let longestUnbeatenRun = 0;
  let currentWinStreak = 0;
  let longestWinStreak = 0;
  const form: Array<'W' | 'D' | 'L'> = [];
  const competitionMap = new Map<string, any>();
  const competitionNameMap = new Map(SEED_COMPETITIONS.map((competition: any) => [competition.id, competition.name]));

  for (const row of rows) {
    const { gf, ga, result } = scoreFixture(row, clubId);
    goalsFor += gf;
    goalsAgainst += ga;
    if (ga === 0) cleanSheets += 1;
    if (result === 'W') wins += 1;
    else if (result === 'D') draws += 1;
    else losses += 1;

    if (result !== 'L') {
      currentUnbeaten += 1;
      longestUnbeatenRun = Math.max(longestUnbeatenRun, currentUnbeaten);
    } else {
      currentUnbeaten = 0;
    }
    if (result === 'W') {
      currentWinStreak += 1;
      longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
    } else {
      currentWinStreak = 0;
    }
    form.push(result);

    const competitionId = String(row.competition_id ?? row.competitionId ?? 'unknown');
    if (!competitionMap.has(competitionId)) {
      competitionMap.set(competitionId, {
        competitionId,
        name: competitionNameMap.get(competitionId) || competitionId.replace(/^comp-/, '').replace(/-/g, ' '),
        matches: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
      });
    }
    const bucket = competitionMap.get(competitionId);
    bucket.matches += 1;
    bucket.goalsFor += gf;
    bucket.goalsAgainst += ga;
    if (result === 'W') bucket.wins += 1;
    else if (result === 'D') bucket.draws += 1;
    else bucket.losses += 1;
  }

  const matches = rows.length;
  const points = wins * 3 + draws;
  const competitions = [...competitionMap.values()]
    .map((bucket) => ({
      ...bucket,
      goalDifference: bucket.goalsFor - bucket.goalsAgainst,
      winRate: bucket.matches ? Math.round((bucket.wins / bucket.matches) * 100) : 0,
    }))
    .sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name));

  return {
    overall: {
      matches,
      wins,
      draws,
      losses,
      goalsFor,
      goalsAgainst,
      goalDifference: goalsFor - goalsAgainst,
      points,
      winRate: matches ? Math.round((wins / matches) * 100) : 0,
      pointsPerMatch: matches ? Number((points / matches).toFixed(2)) : 0,
      goalsPerMatch: matches ? Number((goalsFor / matches).toFixed(2)) : 0,
      cleanSheets,
      longestUnbeatenRun,
      longestWinStreak,
    },
    form: form.slice(-5),
    competitions,
  };
}

export async function getPremiumCareerSnapshot(
  userId: string,
  seasonId = PREMIUM_DEFAULT_SEASON_ID
): Promise<PremiumCareerSnapshot> {
  let clubId = queryGet<{ club_id: string }>(
    "SELECT club_id FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = 'active' ORDER BY claimed_at DESC LIMIT 1",
    [userId, seasonId]
  )?.club_id;

  let club: any = clubId ? SEED_CLUBS.find((item) => item.id === clubId) : null;
  if (!clubId) {
    try {
      const currentClub = await getUserActiveClubFirestore(userId, seasonId);
      if (currentClub) {
        clubId = currentClub.id;
        club = currentClub;
      }
    } catch {}
  }

  const empty = computeCareerStatsFromFixtures([], clubId || 'none');
  if (!clubId) {
    return {
      userId,
      seasonId,
      currentClub: null,
      ...empty,
      achievements: buildAchievements(empty.overall),
      generatedAt: new Date().toISOString(),
      source: 'empty',
    };
  }

  let rows: FixtureLike[] = [];
  try {
    rows = queryAll<FixtureLike>(
      `SELECT id, competition_id, home_club_id, away_club_id, home_score, away_score
       FROM fixtures
       WHERE status = 'CONFIRMED'
         AND (season_id = ? OR season_id IS NULL)
         AND (home_club_id = ? OR away_club_id = ?)
       ORDER BY COALESCE(scheduled_at, created_at, id) ASC`,
      [seasonId, clubId, clubId]
    );
  } catch {
    rows = queryAll<FixtureLike>(
      `SELECT id, competition_id, home_club_id, away_club_id, home_score, away_score
       FROM fixtures
       WHERE status = 'CONFIRMED'
         AND (season_id = ? OR season_id IS NULL)
         AND (home_club_id = ? OR away_club_id = ?)
       ORDER BY id ASC`,
      [seasonId, clubId, clubId]
    );
  }

  const computed = computeCareerStatsFromFixtures(rows || [], clubId);
  return {
    userId,
    seasonId,
    currentClub: club
      ? { id: club.id, name: club.name, shortName: club.shortName, leagueId: club.leagueId }
      : { id: clubId, name: clubId },
    ...computed,
    achievements: buildAchievements(computed.overall),
    generatedAt: new Date().toISOString(),
    source: rows.length ? 'sqlite' : 'empty',
  };
}

function buildAchievements(overall: PremiumCareerSnapshot['overall']) {
  return [
    { id: 'first-win', label: 'First Victory', description: 'Win your first official EFL UZ match.', unlocked: overall.wins >= 1 },
    { id: 'ten-matches', label: 'Established', description: 'Complete 10 official matches.', unlocked: overall.matches >= 10 },
    { id: 'goal-machine', label: 'Goal Machine', description: 'Score 20 official goals in the season.', unlocked: overall.goalsFor >= 20 },
    { id: 'unbeaten-five', label: 'Unshaken', description: 'Build a 5-match unbeaten run.', unlocked: overall.longestUnbeatenRun >= 5 },
    { id: 'clean-sheet-five', label: 'Fortress', description: 'Keep 5 clean sheets.', unlocked: overall.cleanSheets >= 5 },
    { id: 'win-streak-three', label: 'On Fire', description: 'Win 3 consecutive matches.', unlocked: overall.longestWinStreak >= 3 },
  ];
}

async function telegramBotCall(method: string, payload: Record<string, any>) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(9000),
  });
  const data: any = await response.json();
  if (!data?.ok) throw new Error(data?.description || `${method} failed`);
  return data.result;
}

export async function createPremiumStarsInvoice(params: {
  userId: string;
  telegramId: string;
  seasonId?: string;
}) {
  const seasonId = params.seasonId || PREMIUM_DEFAULT_SEASON_ID;
  const orderId = randomUUID().replace(/-/g, '').slice(0, 24);
  const payload = makePremiumPayload(orderId);
  const now = new Date().toISOString();
  const db = getFirestoreDb();
  const orderRef = db.collection(ORDERS_COLLECTION).doc(orderId);

  await orderRef.set({
    orderId,
    userId: params.userId,
    telegramId: String(params.telegramId),
    seasonId,
    amount: PREMIUM_PRICE_STARS,
    currency: 'XTR',
    status: 'PENDING',
    payload,
    createdAt: now,
    updatedAt: now,
  });
  trackFirestoreWrite(ORDERS_COLLECTION, 1, 'createPremiumStarsInvoice');

  try {
    const invoiceLink = await telegramBotCall('createInvoiceLink', {
      title: 'EFL UZ Premium',
      description: `EFL UZ Premium access for the ${seasonId === 'season-2026-27' ? '2026/27' : seasonId} season`,
      payload,
      currency: 'XTR',
      prices: [{ label: 'EFL UZ Premium — Season Pass', amount: PREMIUM_PRICE_STARS }],
    });
    await orderRef.set({ invoiceCreatedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true });
    trackFirestoreWrite(ORDERS_COLLECTION, 1, 'createPremiumStarsInvoice:invoiceCreated');
    return { orderId, invoiceLink: String(invoiceLink), priceStars: PREMIUM_PRICE_STARS, seasonId };
  } catch (err: any) {
    await orderRef.set({ status: 'INVOICE_FAILED', error: err?.message || 'invoice_failed', updatedAt: new Date().toISOString() }, { merge: true }).catch(() => undefined);
    throw err;
  }
}

export async function answerPremiumPreCheckout(query: any): Promise<{ accepted: boolean; reason?: string }> {
  const orderId = parsePremiumPayload(String(query?.invoice_payload || ''));
  let accepted = false;
  let reason = 'This EFL UZ Premium order is no longer valid.';

  try {
    if (!orderId || query?.currency !== 'XTR' || Number(query?.total_amount) !== PREMIUM_PRICE_STARS) {
      reason = 'Invalid Premium order amount.';
    } else {
      const db = getFirestoreDb();
      const orderSnap = await db.collection(ORDERS_COLLECTION).doc(orderId).get();
      trackFirestoreRead(ORDERS_COLLECTION, 1, 'answerPremiumPreCheckout');
      const order: any = orderSnap.data();
      const telegramId = String(query?.from?.id || '');
      const orderAgeMs = order?.createdAt ? Date.now() - new Date(order.createdAt).getTime() : Number.POSITIVE_INFINITY;
      if (!orderSnap.exists || !order || order.status !== 'PENDING') {
        reason = 'This Premium order is already completed or expired.';
      } else if (String(order.telegramId) !== telegramId) {
        reason = 'This Premium invoice belongs to another Telegram account.';
      } else if (!Number.isFinite(orderAgeMs) || orderAgeMs > PREMIUM_ORDER_TTL_MS) {
        reason = 'This Premium invoice expired. Please create a new invoice.';
      } else {
        const entitlementSnap = await db.collection(ENTITLEMENTS_COLLECTION).doc(entitlementId(order.userId, order.seasonId)).get();
        trackFirestoreRead(ENTITLEMENTS_COLLECTION, 1, 'answerPremiumPreCheckout');
        if (entitlementSnap.exists && entitlementSnap.data()?.status === 'ACTIVE') {
          reason = 'Premium is already active for this season.';
        } else {
          accepted = true;
        }
      }
    }
  } catch (err: any) {
    reason = 'Premium checkout validation is temporarily unavailable.';
    console.warn('[PREMIUM_PRECHECKOUT]', err?.message || err);
  }

  await telegramBotCall('answerPreCheckoutQuery', accepted
    ? { pre_checkout_query_id: query.id, ok: true }
    : { pre_checkout_query_id: query.id, ok: false, error_message: reason });
  return accepted ? { accepted: true } : { accepted: false, reason };
}

export async function handlePremiumSuccessfulPayment(message: any) {
  const payment = message?.successful_payment;
  const orderId = parsePremiumPayload(String(payment?.invoice_payload || ''));
  if (!orderId) return { handled: false, reason: 'not_premium_payload' };
  if (payment?.currency !== 'XTR' || Number(payment?.total_amount) !== PREMIUM_PRICE_STARS) {
    throw new Error('PREMIUM_PAYMENT_AMOUNT_MISMATCH');
  }

  const chargeId = String(payment.telegram_payment_charge_id || '').trim();
  if (!chargeId) throw new Error('PREMIUM_PAYMENT_CHARGE_ID_MISSING');

  const db = getFirestoreDb();
  const orderRef = db.collection(ORDERS_COLLECTION).doc(orderId);
  const paymentRef = db.collection(PAYMENTS_COLLECTION).doc(paymentDocumentId(chargeId));
  let result: any = null;

  await db.runTransaction(async (tx) => {
    const [orderSnap, paymentSnap] = await Promise.all([tx.get(orderRef), tx.get(paymentRef)]);
    trackFirestoreRead(ORDERS_COLLECTION, 1, 'handlePremiumSuccessfulPayment');
    trackFirestoreRead(PAYMENTS_COLLECTION, 1, 'handlePremiumSuccessfulPayment');
    if (paymentSnap.exists) {
      result = { handled: true, idempotent: true, ...(paymentSnap.data() || {}) };
      return;
    }
    if (!orderSnap.exists) throw new Error('PREMIUM_ORDER_NOT_FOUND');
    const order: any = orderSnap.data();
    if (String(order.telegramId) !== String(message?.from?.id || '')) throw new Error('PREMIUM_PAYMENT_USER_MISMATCH');
    if (order.currency !== 'XTR' || Number(order.amount) !== PREMIUM_PRICE_STARS) throw new Error('PREMIUM_ORDER_AMOUNT_MISMATCH');

    const now = new Date().toISOString();
    const paymentRecord = {
      orderId,
      userId: order.userId,
      telegramId: String(order.telegramId),
      seasonId: order.seasonId,
      currency: 'XTR',
      amount: PREMIUM_PRICE_STARS,
      telegramPaymentChargeId: chargeId,
      providerPaymentChargeId: payment.provider_payment_charge_id || null,
      paidAt: now,
      createdAt: now,
    };
    tx.set(paymentRef, paymentRecord);
    tx.set(orderRef, { status: 'PAID', paidAt: now, updatedAt: now, telegramPaymentChargeId: chargeId }, { merge: true });
    tx.set(db.collection(ENTITLEMENTS_COLLECTION).doc(entitlementId(order.userId, order.seasonId)), {
      userId: order.userId,
      seasonId: order.seasonId,
      status: 'ACTIVE',
      source: 'TELEGRAM_STARS',
      activatedAt: now,
      updatedAt: now,
      updatedBy: order.userId,
      revokedAt: null,
      revokedBy: null,
      paymentChargeId: chargeId,
    }, { merge: true });
    result = { handled: true, idempotent: false, ...paymentRecord };
  });
  trackFirestoreWrite(PAYMENTS_COLLECTION, 1, 'handlePremiumSuccessfulPayment');
  trackFirestoreWrite(ORDERS_COLLECTION, 1, 'handlePremiumSuccessfulPayment');
  trackFirestoreWrite(ENTITLEMENTS_COLLECTION, 1, 'handlePremiumSuccessfulPayment');

  if (result?.userId) {
    await createAuditLogFirestore(
      result.userId,
      'PREMIUM_STARS_PAYMENT',
      'premium_entitlement',
      entitlementId(result.userId, result.seasonId),
      null,
      { seasonId: result.seasonId, amount: PREMIUM_PRICE_STARS, currency: 'XTR', chargeId },
      undefined,
      undefined,
      'Telegram Stars payment confirmed'
    ).catch(() => undefined);
  }

  return result;
}
