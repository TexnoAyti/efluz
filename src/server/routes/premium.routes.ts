import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../middleware/authMiddleware';
import {
  PREMIUM_ACTIVE_SEASON,
  PREMIUM_PRICE_STARS,
  PREMIUM_PRIVATE_LAB,
  createPremiumInvoice,
  getPremiumStatus,
  grantPremium,
  listPremiumEntitlements,
  listPremiumEvents,
  revokePremium,
} from '../services/premiumEntitlementService';

export const premiumRouter = Router();

const seasonIdSchema = z.string().min(1).max(80);
const grantSchema = z.object({
  userId: z.string().min(1).max(128),
  seasonId: seasonIdSchema.optional(),
  note: z.string().max(500).optional(),
});
const revokeSchema = grantSchema;
const invoiceSchema = z.object({
  seasonId: seasonIdSchema.optional(),
});

premiumRouter.get('/status', requireAuth, async (req: Request, res: Response) => {
  const seasonId = typeof req.query.seasonId === 'string' && req.query.seasonId
    ? req.query.seasonId
    : PREMIUM_ACTIVE_SEASON;
  try {
    const status = await getPremiumStatus(req.user!.id, seasonId);
    res.json({
      ...status,
      // Public rollout intentionally disabled. The entitlement system can be exercised only by admins.
      publicVisible: false,
      canAccessPrivateLab: Boolean(req.user?.isAdmin),
      benefits: {
        career: status.active,
        advancedStats: status.active,
        smartAlerts: status.active,
        trophyCabinet: status.active,
        shareablePlayerCard: status.active,
      },
    });
  } catch (error: any) {
    res.status(503).json({ error: error?.message || 'PREMIUM_STATUS_UNAVAILABLE' });
  }
});

premiumRouter.post('/invoice', requireAdmin, async (req: Request, res: Response) => {
  const parsed = invoiceSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_PREMIUM_INVOICE_REQUEST', details: parsed.error.flatten() });
    return;
  }
  try {
    const telegramId = String(req.user!.telegramId || '');
    if (!telegramId) {
      res.status(400).json({ error: 'TELEGRAM_ACCOUNT_REQUIRED' });
      return;
    }
    const invoice = await createPremiumInvoice({
      userId: req.user!.id,
      telegramId,
      seasonId: parsed.data.seasonId || PREMIUM_ACTIVE_SEASON,
    });
    res.json({
      success: true,
      privateLab: PREMIUM_PRIVATE_LAB,
      ...invoice,
    });
  } catch (error: any) {
    const code = error?.message || 'PREMIUM_INVOICE_FAILED';
    const status = code === 'PREMIUM_ALREADY_ACTIVE' ? 409 : 503;
    res.status(status).json({ error: code });
  }
});

premiumRouter.get('/admin/overview', requireAdmin, async (req: Request, res: Response) => {
  const seasonId = typeof req.query.seasonId === 'string' && req.query.seasonId
    ? req.query.seasonId
    : PREMIUM_ACTIVE_SEASON;
  try {
    const [entitlements, events] = await Promise.all([
      listPremiumEntitlements(seasonId),
      listPremiumEvents(seasonId, 40),
    ]);
    const active = entitlements.filter((entry) => entry.status === 'ACTIVE');
    res.json({
      privateLab: PREMIUM_PRIVATE_LAB,
      publicVisible: false,
      seasonId,
      priceStars: PREMIUM_PRICE_STARS,
      metrics: {
        totalRecords: entitlements.length,
        active: active.length,
        paid: active.filter((entry) => entry.source === 'TELEGRAM_STARS').length,
        adminGranted: active.filter((entry) => entry.source === 'ADMIN').length,
        revoked: entitlements.filter((entry) => entry.status === 'REVOKED').length,
        starsBooked: active.reduce((sum, entry) => sum + (entry.starsPaid || 0), 0),
      },
      entitlements,
      events,
    });
  } catch (error: any) {
    res.status(503).json({ error: error?.message || 'PREMIUM_OVERVIEW_UNAVAILABLE' });
  }
});

premiumRouter.post('/admin/grant', requireAdmin, async (req: Request, res: Response) => {
  const parsed = grantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_PREMIUM_GRANT', details: parsed.error.flatten() });
    return;
  }
  try {
    const entitlement = await grantPremium({
      userId: parsed.data.userId,
      seasonId: parsed.data.seasonId || PREMIUM_ACTIVE_SEASON,
      source: 'ADMIN',
      actorUserId: req.user!.id,
      actorUsername: req.user!.username,
      note: parsed.data.note || 'Granted from Premium Private Lab',
    });
    res.json({ success: true, entitlement });
  } catch (error: any) {
    res.status(503).json({ error: error?.message || 'PREMIUM_GRANT_FAILED' });
  }
});

premiumRouter.post('/admin/revoke', requireAdmin, async (req: Request, res: Response) => {
  const parsed = revokeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_PREMIUM_REVOKE', details: parsed.error.flatten() });
    return;
  }
  try {
    const entitlement = await revokePremium({
      userId: parsed.data.userId,
      seasonId: parsed.data.seasonId || PREMIUM_ACTIVE_SEASON,
      actorUserId: req.user!.id,
      actorUsername: req.user!.username,
      note: parsed.data.note || 'Revoked from Premium Private Lab',
    });
    res.json({ success: true, entitlement });
  } catch (error: any) {
    res.status(503).json({ error: error?.message || 'PREMIUM_REVOKE_FAILED' });
  }
});
