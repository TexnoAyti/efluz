import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validationMiddleware';
import { verifyTelegramWebAppData, getOrCreateTelegramUser, getOrCreateDevUser, DEV_PROFILES, isDevAuthEnabled } from '../auth/telegramAuth';
import { getUserActiveClubFirestore } from '../firebase/firestoreStore';

export const authRouter = Router();

const telegramAuthSchema = z.object({ initData: z.string().min(1, 'initData is required') });
const devAuthSchema = z.object({ devUserId: z.string().min(1, 'devUserId is required') });

authRouter.post('/telegram', validateBody(telegramAuthSchema), async (req: Request, res: Response) => {
  const { initData } = req.body;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    if (isDevAuthEnabled()) {
      try {
        const urlParams = new URLSearchParams(initData);
        const userRaw = urlParams.get('user');
        if (userRaw) {
          const user = await getOrCreateTelegramUser(JSON.parse(userRaw));
          const currentClub = await getUserActiveClubFirestore(user.id, 'season-2026-27');
          console.log(`[TELEGRAM AUTH - LOCAL DEV] user=${user.username} (id: ${user.telegramId})`);
          res.json({ success: true, user, currentClub });
          return;
        }
      } catch { /* continue to configuration error */ }
    }
    res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is not configured on the server.' });
    return;
  }

  const verifyResult = verifyTelegramWebAppData(initData, botToken);
  if (!verifyResult.isValid || !verifyResult.user) {
    res.status(401).json({ error: 'Invalid Telegram WebApp authentication', details: verifyResult.error });
    return;
  }

  try {
    const user = await getOrCreateTelegramUser(verifyResult.user);
    const currentClub = await getUserActiveClubFirestore(user.id, 'season-2026-27');
    res.json({ success: true, user, currentClub });
  } catch (err: any) {
    res.status(500).json({ error: 'Authentication failed', message: err.message });
  }
});

authRouter.post('/dev', validateBody(devAuthSchema), async (req: Request, res: Response) => {
  if (!isDevAuthEnabled()) {
    res.status(403).json({ error: 'Dev auth is disabled outside local development.' });
    return;
  }
  try {
    const user = await getOrCreateDevUser(req.body.devUserId);
    const currentClub = await getUserActiveClubFirestore(user.id, 'season-2026-27');
    res.json({ success: true, user, currentClub });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

authRouter.get('/dev-profiles', (_req: Request, res: Response) => {
  if (!isDevAuthEnabled()) {
    res.status(403).json({ error: 'Dev auth is disabled outside local development.' });
    return;
  }
  res.json({ profiles: DEV_PROFILES });
});
