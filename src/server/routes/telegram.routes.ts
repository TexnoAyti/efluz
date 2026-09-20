import { Router, Request, Response } from 'express';
import {
  handleTelegramStart,
  verifyTelegramGroupMembership,
  TelegramMembershipResult,
} from '../services/telegramBotService';
import { requireAuth } from '../middleware/authMiddleware';
import { getUpstashClient, KEY_PREFIX } from '../readModel/readModelStore';

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

  // Handle incoming /start message
  const message = update.message;
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
