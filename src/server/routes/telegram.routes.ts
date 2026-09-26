import { Router, Request, Response } from 'express';
import {
  handleTelegramStart,
  verifyTelegramGroupMembership,
  TelegramMembershipResult,
  sendTelegramMessage,
} from '../services/telegramBotService';
import { requireAdmin, requireAuth } from '../middleware/authMiddleware';
import { getUpstashClient, KEY_PREFIX } from '../readModel/readModelStore';
import {
  PREMIUM_DEFAULT_SEASON_ID,
  PREMIUM_PRICE_STARS,
  answerPremiumPreCheckout,
  createPremiumStarsInvoice,
  getPremiumCareerSnapshot,
  getPremiumEntitlement,
  grantPremiumEntitlement,
  handlePremiumSuccessfulPayment,
  isPremiumPublicEnabled,
  listPremiumEntitlements,
  revokePremiumEntitlement,
} from '../services/premiumService';

export const telegramRouter = Router();
const recentWebhookUpdates = new Map<number, number>();

async function claimTelegramUpdate(updateId: number): Promise<boolean> {
  const client = getUpstashClient();
  if (client) {
    const key = `${KEY_PREFIX}:telegram:webhook-update:${updateId}`;
    return Boolean(await client.set(key, '1', { nx: true, ex: 86400 }));
  }
  const now = Date.now();
  for (const [id, expiresAt] of recentWebhookUpdates) if (expiresAt <= now) recentWebhookUpdates.delete(id);
  if (recentWebhookUpdates.has(updateId)) return false;
  recentWebhookUpdates.set(updateId, now + 10 * 60 * 1000);
  return true;
}

function normalizedSeasonId(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : PREMIUM_DEFAULT_SEASON_ID;
}

/**
 * Telegram Webhook Handler
 * Telegram sends JSON updates to this endpoint.
 */
telegramRouter.post('/webhook', async (req: Request, res: Response) => {
  const secretToken = req.headers['x-telegram-bot-api-secret-token'];
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!expectedSecret) {
    res.status(503).json({ error: 'Webhook is not configured' });
    return;
  }
  if (secretToken !== expectedSecret) {
    res.status(401).json({ error: 'Unauthorized webhook secret token' });
    return;
  }

  const update = req.body;
  if (!update || typeof update !== 'object') {
    res.status(200).json({ ok: true, ignored: 'empty_update' });
    return;
  }
  if (!Number.isSafeInteger(update.update_id)) {
    res.status(200).json({ ok: true, ignored: 'invalid_update_id' });
    return;
  }
  if (!(await claimTelegramUpdate(update.update_id))) {
    res.status(200).json({ ok: true, ignored: 'duplicate_update' });
    return;
  }

  // Telegram Stars checkout must be answered within 10 seconds.
  if (update.pre_checkout_query) {
    try {
      const result = await answerPremiumPreCheckout(update.pre_checkout_query);
      res.status(200).json({ ok: true, handled: 'premium_pre_checkout', result });
    } catch (err: any) {
      console.error('[PREMIUM PRE-CHECKOUT ERROR]', err?.message || err);
      res.status(200).json({ ok: true, error: 'premium_pre_checkout_failed' });
    }
    return;
  }

  const message = update.message;

  // Premium is granted only after Telegram sends successful_payment.
  if (message?.successful_payment) {
    try {
      const paymentResult = await handlePremiumSuccessfulPayment(message);
      if (paymentResult?.handled && paymentResult?.userId) {
        await sendTelegramMessage(
          message.chat?.id || message.from?.id,
          `<b>EFL UZ Premium activated</b>\n\nSeason: <b>2026/27</b>\nPayment: <b>${PREMIUM_PRICE_STARS} ⭐</b>\n\nYour season access is now active.`,
          { parse_mode: 'HTML' }
        ).catch(() => undefined);
      }
      res.status(200).json({ ok: true, handled: 'premium_successful_payment', result: paymentResult });
    } catch (err: any) {
      console.error('[PREMIUM PAYMENT ERROR]', err?.message || err);
      res.status(200).json({ ok: true, error: 'premium_payment_processing_failed' });
    }
    return;
  }

  // Handle incoming /start message
  if (message && message.text && typeof message.text === 'string') {
    const text = message.text.trim();
    if (text.startsWith('/start') && Number.isSafeInteger(message.chat?.id) && Number.isSafeInteger(message.from?.id)) {
      try {
        const result = await handleTelegramStart(message.chat.id, message.from);
        res.status(200).json({ ok: true, handled: 'start', result });
        return;
      } catch (err: any) {
        console.error('[TELEGRAM WEBHOOK /start error]:', err.message);
        res.status(200).json({ ok: true, error: 'start_handler_failed' });
        return;
      }
    }
  }

  res.status(200).json({ ok: true, ignored: 'unhandled_update_type' });
});

/**
 * Status of Telegram Bot configuration
 */
telegramRouter.get('/status', (req: Request, res: Response) => {
  const hasToken = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const hasSticker = Boolean(process.env.TELEGRAM_WELCOME_STICKER_FILE_ID);
  const group = process.env.TELEGRAM_GROUP_USERNAME || '@efleagueuz';
  const webAppUrl = process.env.TELEGRAM_WEBAPP_URL || process.env.APP_URL || 'https://efluz.vercel.app';

  res.json({
    status: 'ok',
    configured: hasToken,
    hasSticker,
    group,
    webAppUrl,
  });
});

/**
 * Verification endpoint for group membership.
 * Uses authenticated Telegram user ID (never trusts arbitrary req.body.userId).
 * Always calls verifyTelegramGroupMembership with forceRefresh: true.
 */
telegramRouter.post('/check-membership', requireAuth, async (req: Request, res: Response) => {
  const telegramId = req.user?.telegramId;
  if (!telegramId) {
    res.status(400).json({ error: 'Authenticated user does not have a linked Telegram account' });
    return;
  }

  const result: TelegramMembershipResult = await verifyTelegramGroupMembership(telegramId, true);
  res.json(result);
});

// -----------------------------------------------------------------------------
// PRIVATE PREMIUM LAB
// Public UI is intentionally disabled. These endpoints provide the production
// foundation while the product is being iterated by authorized admins.
// -----------------------------------------------------------------------------
telegramRouter.get('/premium/me', requireAuth, async (req: Request, res: Response) => {
  const seasonId = normalizedSeasonId(req.query.seasonId);
  try {
    const entitlement = await getPremiumEntitlement(req.user!.id, seasonId);
    res.json({
      seasonId,
      priceStars: PREMIUM_PRICE_STARS,
      publicEnabled: isPremiumPublicEnabled(),
      active: entitlement?.status === 'ACTIVE',
      entitlement,
    });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'PREMIUM_STATUS_UNAVAILABLE' });
  }
});

telegramRouter.post('/premium/invoice', requireAuth, async (req: Request, res: Response) => {
  const seasonId = normalizedSeasonId(req.body?.seasonId);
  if (!req.user!.isAdmin && !isPremiumPublicEnabled()) {
    res.status(404).json({ error: 'PREMIUM_NOT_PUBLIC' });
    return;
  }
  if (!req.user!.telegramId) {
    res.status(400).json({ error: 'TELEGRAM_ACCOUNT_REQUIRED' });
    return;
  }
  try {
    const existing = await getPremiumEntitlement(req.user!.id, seasonId);
    if (existing?.status === 'ACTIVE') {
      res.status(409).json({ error: 'PREMIUM_ALREADY_ACTIVE', entitlement: existing });
      return;
    }
    const invoice = await createPremiumStarsInvoice({
      userId: req.user!.id,
      telegramId: req.user!.telegramId,
      seasonId,
    });
    res.json({ success: true, ...invoice });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'PREMIUM_INVOICE_FAILED' });
  }
});

telegramRouter.get('/premium/admin/overview', requireAdmin, async (req: Request, res: Response) => {
  const seasonId = normalizedSeasonId(req.query.seasonId);
  try {
    const entitlements = await listPremiumEntitlements(seasonId);
    const active = entitlements.filter((item) => item.status === 'ACTIVE');
    res.json({
      seasonId,
      priceStars: PREMIUM_PRICE_STARS,
      publicEnabled: isPremiumPublicEnabled(),
      counts: {
        totalRecords: entitlements.length,
        active: active.length,
        revoked: entitlements.filter((item) => item.status === 'REVOKED').length,
        stars: active.filter((item) => item.source === 'TELEGRAM_STARS').length,
        admin: active.filter((item) => item.source === 'ADMIN').length,
      },
      entitlements,
    });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'PREMIUM_OVERVIEW_UNAVAILABLE' });
  }
});

telegramRouter.post('/premium/admin/grant', requireAdmin, async (req: Request, res: Response) => {
  const userId = String(req.body?.userId || '').trim();
  const seasonId = normalizedSeasonId(req.body?.seasonId);
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined;
  if (!userId) {
    res.status(400).json({ error: 'USER_ID_REQUIRED' });
    return;
  }
  try {
    const entitlement = await grantPremiumEntitlement({
      userId,
      seasonId,
      source: 'ADMIN',
      actorUserId: req.user!.id,
      actorUsername: req.user!.username,
      note,
    });
    res.json({ success: true, entitlement });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'PREMIUM_GRANT_FAILED' });
  }
});

telegramRouter.post('/premium/admin/revoke', requireAdmin, async (req: Request, res: Response) => {
  const userId = String(req.body?.userId || '').trim();
  const seasonId = normalizedSeasonId(req.body?.seasonId);
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined;
  if (!userId) {
    res.status(400).json({ error: 'USER_ID_REQUIRED' });
    return;
  }
  try {
    const entitlement = await revokePremiumEntitlement({
      userId,
      seasonId,
      actorUserId: req.user!.id,
      actorUsername: req.user!.username,
      note,
    });
    res.json({ success: true, entitlement });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'PREMIUM_REVOKE_FAILED' });
  }
});

telegramRouter.get('/premium/admin/career/:userId', requireAdmin, async (req: Request, res: Response) => {
  const seasonId = normalizedSeasonId(req.query.seasonId);
  try {
    const [career, entitlement] = await Promise.all([
      getPremiumCareerSnapshot(req.params.userId, seasonId),
      getPremiumEntitlement(req.params.userId, seasonId),
    ]);
    res.json({ career, entitlement, seasonId, priceStars: PREMIUM_PRICE_STARS });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'PREMIUM_CAREER_UNAVAILABLE' });
  }
});
