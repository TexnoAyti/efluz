/**
 * Admin Telegram AI Configuration & Diagnostics Router
 *
 * All endpoints are strictly locked to the Primary Owner (Telegram ID: 5209126900).
 * Never leaks API keys or secrets in logs or responses.
 */

import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import {
  PRIMARY_OWNER_TELEGRAM_ID,
  isPrimaryOwner,
  getTelegramAiConfig,
  updateTelegramAiConfig,
  bindTelegramAiTopic,
} from '../services/telegramAiConfigService';
import { getAiRateLimitMetrics } from '../services/telegramAiRateLimitService';
import { buildAiGroundingContext } from '../services/telegramAiGroundingService';

export const adminAiConfigRouter = Router();

// Middleware: ensure authenticated user is the primary owner
function requirePrimaryOwner(req: Request, res: Response, next: () => void) {
  const telegramId = req.user?.telegramId;
  if (!isPrimaryOwner(telegramId)) {
    res.status(403).json({
      error: 'OWNER_ONLY_FORBIDDEN',
      code: 'OWNER_ONLY_FORBIDDEN',
      message: `Faqat asosiy admin (Telegram ID: ${PRIMARY_OWNER_TELEGRAM_ID}) AI sozlamalarini boshqarishi mumkin.`,
    });
    return;
  }
  next();
}

/**
 * GET /api/admin/telegram-ai/config
 */
adminAiConfigRouter.get('/config', requireAdmin, requirePrimaryOwner, async (_req: Request, res: Response) => {
  try {
    const { config, redisAvailable } = await getTelegramAiConfig();
    const hasApiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
    const modelName = process.env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite';

    res.json({
      success: true,
      config,
      redisAvailable,
      model: {
        name: modelName,
        apiKeyConfigured: hasApiKey,
        // Explicit disclosure per user requirement
        billingNotice: "API kaliti mavjudligi bepul kvotani kafolatlamaydi. Billing tarifi va kvotalarni Google Cloud Console orqali tekshirish lozim.",
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'CONFIG_FETCH_FAILED', message: err?.message || err });
  }
});

/**
 * PUT /api/admin/telegram-ai/config
 */
adminAiConfigRouter.put('/config', requireAdmin, requirePrimaryOwner, async (req: Request, res: Response) => {
  try {
    const actorTelegramId = req.user!.telegramId!;
    const body = req.body || {};

    const updates: any = {};
    if (typeof body.enabled === 'boolean') updates.enabled = body.enabled;
    if (body.allowedChatId !== undefined) {
      updates.allowedChatId = body.allowedChatId === null || body.allowedChatId === '' ? null : Number(body.allowedChatId);
    }
    if (body.allowedThreadId !== undefined) {
      updates.allowedThreadId = body.allowedThreadId === null || body.allowedThreadId === '' ? null : Number(body.allowedThreadId);
    }
    if (typeof body.rateLimitUserPerMin === 'number' && body.rateLimitUserPerMin > 0) {
      updates.rateLimitUserPerMin = Math.min(Math.max(1, body.rateLimitUserPerMin), 20);
    }
    if (typeof body.rateLimitTopicPerMin === 'number' && body.rateLimitTopicPerMin > 0) {
      updates.rateLimitTopicPerMin = Math.min(Math.max(1, body.rateLimitTopicPerMin), 60);
    }
    if (typeof body.maxDailyRequests === 'number' && body.maxDailyRequests > 0) {
      updates.maxDailyRequests = Math.min(Math.max(10, body.maxDailyRequests), 5000);
    }

    const result = await updateTelegramAiConfig(updates, actorTelegramId);
    if (!result.success) {
      res.status(result.error === 'REDIS_UNAVAILABLE_CANNOT_PERSIST' ? 503 : 400).json(result);
      return;
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'CONFIG_UPDATE_FAILED', message: err?.message || err });
  }
});

/**
 * GET /api/admin/telegram-ai/diagnostics
 */
adminAiConfigRouter.get('/diagnostics', requireAdmin, requirePrimaryOwner, async (_req: Request, res: Response) => {
  try {
    const { config, redisAvailable } = await getTelegramAiConfig();
    const rateMetrics = await getAiRateLimitMetrics();
    const hasApiKey = Boolean(process.env.GEMINI_API_KEY?.trim());
    const modelName = process.env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite';

    res.json({
      success: true,
      config,
      redisAvailable,
      metrics: {
        todayRequests: rateMetrics.dailyRequests,
        dailyLimit: config.maxDailyRequests,
        remainingDaily: Math.max(0, config.maxDailyRequests - rateMetrics.dailyRequests),
      },
      model: {
        configuredModel: modelName,
        apiKeyConfigured: hasApiKey,
        billingNotice: "API kaliti mavjudligi bepul kvotani kafolatlamaydi. Billing tarifi va kvotalarni Google Cloud Console orqali tekshirish lozim.",
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'DIAGNOSTICS_FETCH_FAILED', message: err?.message || err });
  }
});

/**
 * POST /api/admin/telegram-ai/test-query
 * Safely inspects grounding facts for a prompt without dispatching to Telegram
 */
adminAiConfigRouter.post('/test-query', requireAdmin, requirePrimaryOwner, async (req: Request, res: Response) => {
  const query = String(req.body?.query || '').trim();
  if (!query) {
    res.status(400).json({ error: 'QUERY_REQUIRED' });
    return;
  }

  try {
    const grounding = await buildAiGroundingContext(query);
    res.json({
      success: true,
      query,
      detectedClubs: grounding.detectedClubs,
      detectedCompetitions: grounding.detectedCompetitions,
      hasStaleData: grounding.hasStaleData,
      dataDiagnostics: grounding.dataDiagnostics,
      factualAnswer: grounding.factualAnswer,
      factsSummary: grounding.factsSummary,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'TEST_QUERY_FAILED', message: err?.message || err });
  }
});
