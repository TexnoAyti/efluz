import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validationMiddleware';
import { verifyTelegramWebAppData, getOrCreateTelegramUser, getOrCreateDevUser, createSessionToken, DEV_PROFILES } from '../auth/telegramAuth';
import { getOptionalCurrentClub } from '../readModel/readModelStore';
import { refreshRecipientDirectoryIfStale } from '../services/recipientDirectoryRefreshService';
import { getDashboardLeagueStats } from '../services/dashboardLeagueStatsService';

export const authRouter = Router();

const telegramAuthSchema = z.object({
  initData: z.string().min(1, 'initData is required'),
});

const devAuthSchema = z.object({
  devUserId: z.string().min(1, 'devUserId is required'),
});

async function refreshTelegramDirectoryAfterAuth(): Promise<void> {
  await refreshRecipientDirectoryIfStale('season-2026-27').catch((error: any) => {
    console.warn('[AUTH_RECIPIENT_DIRECTORY_REFRESH_FAILED]', error?.message || error);
  });
}

authRouter.post('/telegram', validateBody(telegramAuthSchema), async (req: Request, res: Response) => {
  const { initData } = req.body;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    if (process.env.ENABLE_DEV_AUTH === 'true' || process.env.NODE_ENV !== 'production') {
      try {
        const urlParams = new URLSearchParams(initData);
        const userRaw = urlParams.get('user');
        if (userRaw) {
          const user = await getOrCreateTelegramUser(JSON.parse(userRaw));
          await refreshTelegramDirectoryAfterAuth();
          const clubState = await getOptionalCurrentClub(user.id);
          const stats = await getDashboardLeagueStats(clubState.currentClub);
          const token = createSessionToken(user);
          console.log(`[TELEGRAM AUTH - DEV SANDBOX] user=${user.username} (id: ${user.telegramId}), isAdmin=${user.isAdmin}`);
          res.json({ success: true, user, ...clubState, stats, token });
          return;
        }
      } catch {
        // continue
      }
    }
    res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is not configured on the server.' });
    return;
  }

  const verifyResult = verifyTelegramWebAppData(initData, botToken);
  if (!verifyResult.isValid || !verifyResult.user) {
    console.warn(`[TELEGRAM AUTH REJECTED] error="${verifyResult.error}"`);
    res.status(401).json({ error: 'Invalid Telegram WebApp authentication', details: verifyResult.error });
    return;
  }

  try {
    const user = await getOrCreateTelegramUser(verifyResult.user);
    await refreshTelegramDirectoryAfterAuth();
    const clubState = await getOptionalCurrentClub(user.id);
    const stats = await getDashboardLeagueStats(clubState.currentClub);
    const token = createSessionToken(user);

    console.log(`[TELEGRAM AUTH]\ninitData received: YES\nparsed user id: ${verifyResult.user.id}\nusername: ${verifyResult.user.username || '(none)'}\nauth_date valid: ${verifyResult.authDate ? 'YES' : 'NO'}\nHMAC valid: YES\ninternal user: ${user.id}\nisAdmin: ${user.isAdmin ? 'YES' : 'NO'}`);

    res.json({ success: true, user, ...clubState, stats, token });
  } catch (err: any) {
    res.status(500).json({ error: 'Authentication failed', message: err.message });
  }
});

authRouter.post('/dev', validateBody(devAuthSchema), async (req: Request, res: Response) => {
  const isDev = process.env.ENABLE_DEV_AUTH === 'true' || process.env.NODE_ENV !== 'production';
  if (!isDev) {
    res.status(403).json({ error: 'Dev auth is disabled in production.' });
    return;
  }

  try {
    const user = await getOrCreateDevUser(req.body.devUserId);
    await refreshTelegramDirectoryAfterAuth();
    const clubState = await getOptionalCurrentClub(user.id);
    const stats = await getDashboardLeagueStats(clubState.currentClub);
    const token = createSessionToken(user);
    res.json({ success: true, user, ...clubState, stats, token });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

authRouter.get('/dev-profiles', (req: Request, res: Response) => {
  const isDev = process.env.ENABLE_DEV_AUTH === 'true' || process.env.NODE_ENV !== 'production';
  if (!isDev) {
    res.status(403).json({ error: 'Dev auth is disabled in production.' });
    return;
  }
  res.json({ profiles: DEV_PROFILES });
});