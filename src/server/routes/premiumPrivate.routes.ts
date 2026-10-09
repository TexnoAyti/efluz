import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/authMiddleware';
import {
  getPremiumSmartAlertPreferences,
  sendPremiumCareerDigest,
  updatePremiumSmartAlertPreferences,
} from '../services/premiumSmartNotificationService';
import { PREMIUM_DEFAULT_SEASON_ID } from '../services/premiumService';

export const premiumPrivateRouter = Router();
premiumPrivateRouter.use(requireAdmin);

function seasonIdFrom(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : PREMIUM_DEFAULT_SEASON_ID;
}

const preferencesSchema = z.object({
  userId: z.string().min(1),
  seasonId: z.string().min(1).optional(),
  enabled: z.boolean(),
  deadlinePriority: z.boolean(),
  qualificationWatch: z.boolean(),
  cupProgress: z.boolean(),
  formMilestones: z.boolean(),
  careerDigest: z.boolean(),
});

premiumPrivateRouter.get('/smart-alerts/:userId', async (req: Request, res: Response) => {
  const seasonId = seasonIdFrom(req.query.seasonId);
  try {
    const preferences = await getPremiumSmartAlertPreferences(req.params.userId, seasonId);
    res.json({ preferences });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'PREMIUM_SMART_ALERTS_UNAVAILABLE' });
  }
});

premiumPrivateRouter.put('/smart-alerts', async (req: Request, res: Response) => {
  const parsed = preferencesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_PREMIUM_SMART_ALERTS', details: parsed.error.flatten() });
    return;
  }
  try {
    const { userId, seasonId, ...values } = parsed.data;
    const preferences = await updatePremiumSmartAlertPreferences({
      userId,
      seasonId: seasonId || PREMIUM_DEFAULT_SEASON_ID,
      values,
      updatedBy: req.user!.id,
    });
    res.json({ success: true, preferences });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'PREMIUM_SMART_ALERTS_SAVE_FAILED' });
  }
});

premiumPrivateRouter.post('/smart-alerts/:userId/career-digest', async (req: Request, res: Response) => {
  const seasonId = seasonIdFrom(req.body?.seasonId);
  try {
    const result = await sendPremiumCareerDigest({ userId: req.params.userId, seasonId });
    res.json({ success: true, ...result });
  } catch (err: any) {
    const code = String(err?.message || 'PREMIUM_CAREER_DIGEST_FAILED');
    const status = code === 'PREMIUM_ENTITLEMENT_REQUIRED' ? 409 : code === 'PREMIUM_TARGET_TELEGRAM_UNAVAILABLE' ? 422 : 503;
    res.status(status).json({ error: code });
  }
});
