import { Router, Request, Response } from 'express';
import {
  handleTelegramStart,
  verifyTelegramGroupMembership,
  TelegramMembershipResult,
} from '../services/telegramBotService';

export const telegramRouter = Router();

/**
 * Telegram Webhook Handler
 * Telegram sends JSON updates to this endpoint.
 */
telegramRouter.post('/webhook', async (req: Request, res: Response) => {
  const secretToken = req.headers['x-telegram-bot-api-secret-token'];
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (expectedSecret && secretToken !== expectedSecret) {
    res.status(401).json({ error: 'Unauthorized webhook secret token' });
    return;
  }

  const update = req.body;
  if (!update || typeof update !== 'object') {
    res.status(200).json({ ok: true, ignored: 'empty_update' });
    return;
  }

  // Handle incoming /start message
  const message = update.message;
  if (message && message.text && typeof message.text === 'string') {
    const text = message.text.trim();
    if (text.startsWith('/start')) {
      try {
        const result = await handleTelegramStart(message.chat.id, message.from);
        res.status(200).json({ ok: true, handled: 'start', result });
        return;
      } catch (err: any) {
        console.error('[TELEGRAM WEBHOOK /start error]:', err.message);
        res.status(200).json({ ok: true, error: err.message });
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
 * Verification endpoint for group membership
 */
telegramRouter.post('/check-membership', async (req: Request, res: Response) => {
  const userId = req.body.userId || req.user?.telegramId;
  if (!userId) {
    res.status(400).json({ error: 'Missing userId or user authentication' });
    return;
  }

  const result: TelegramMembershipResult = await verifyTelegramGroupMembership(userId);
  res.json(result);
});
