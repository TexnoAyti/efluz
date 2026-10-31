import { verifyTelegramWebAppData } from '../auth/telegramAuth';
import {getLiveUserNotifications} from '../services/liveNotifications';
import { getLoginClubState } from '../services/loginClubState';
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import {
  getFixturesFirestore,
  getUserNotificationsFirestore,
  markNotificationsReadFirestore,
  markSingleNotificationReadFirestore,
} from '../firebase/firestoreStore';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';
import { setOwnershipSensitiveHeaders } from '../middleware/ownershipCacheControl';
import { getOptionalCurrentClub, ReadModelNotWarmedError } from '../readModel/readModelStore';
import { getDashboardLeagueStats } from '../services/dashboardLeagueStatsService';
import { canonicalizeMyDomesticCupFixtures } from '../services/myMatchesCanonicalService';
import {
  getMyMatchOperations,
  reportNoShowV4,
  scheduleDeadlineSweep,
} from '../services/matchOperationsV4Service';
import { sortSeasonFixtures } from '../../lib/fixtureOrder';
import { getMyMatchesResilient } from '../services/myMatchesReadService';

export const meRouter = Router();
export const meResilientRouter = meRouter;

meRouter.use((req: Request, res: Response, next) => {
  setOwnershipSensitiveHeaders(res);
  next();
});

meRouter.get('/bootstrap', requireAuth, async (req: Request, res: Response) => {
  const seasonId = String(req.query.seasonId || 'season-2026-27');
  if (!/^season-[a-z0-9-]+$/.test(seasonId)) { res.status(400).json({ code: 'INVALID_SEASON_ID' }); return; }
  const launch = req.get('x-telegram-launch-data');
  if (launch !== undefined) {
    const verified = launch.length <= 16384 ? verifyTelegramWebAppData(launch, process.env.TELEGRAM_BOT_TOKEN || '') : {isValid:false};
    if (!verified.isValid || !verified.user || !Number.isSafeInteger(Number(verified.user.id)) ||
        Number(verified.user.id) <= 0 || String(verified.user.id) !== String(req.user!.telegramId) ||
        !verified.authDate || verified.authDate > Math.floor(Date.now()/1000)+60) {
      res.status(401).json({error:'UNAUTHORIZED',code:'SESSION_LAUNCH_MISMATCH'});return;
    }
  }

  res.json({ authenticated: true, user: req.user!, ...await getLoginClubState(req.user!.id, 350, seasonId) });
});

// The opening screen can hydrate ownership without rebuilding league statistics.
meRouter.get('/club', requireAuth, async (req: Request, res: Response) => {
  const seasonId = String(req.query.seasonId || 'season-2026-27');
  if (!/^season-[a-z0-9-]+$/.test(seasonId)) { res.status(400).json({ code: 'INVALID_SEASON_ID' }); return; }
  try { res.json(await getOptionalCurrentClub(req.user!.id, seasonId)); }
  catch (err: any) { handleFirestoreError(res, err, 'GET /api/me/club'); }
});

meRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';

  try {
    const clubState = await getOptionalCurrentClub(user.id, seasonId);
    const stats = await getDashboardLeagueStats(clubState.currentClub, seasonId);

    res.json({ authenticated: true, user, ...clubState, stats });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/me');
  }
});

meRouter.get('/matches', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const status = req.query.status as string | undefined;

  try {
    const started = performance.now();
    const timings: string[] = [];
    const clubState = await getOptionalCurrentClub(userId, seasonId);
    if (clubState.currentClubStatus === 'unavailable') throw new ReadModelNotWarmedError('MY_MATCHES_OWNERSHIP_UNAVAILABLE');
    timings.push(`ownership;dur=${(performance.now()-started).toFixed(1)}`);
    const matchesStarted = performance.now();
    const result = await getMyMatchesResilient(userId, clubState.ownedClubs, seasonId, status);
    timings.push(`matches;dur=${(performance.now()-matchesStarted).toFixed(1)}`);
    // PostgreSQL already returns fresh, gated fixtures scoped to the verified clubs.
    // Re-reading every club's cup repeats ownership/rule enrichment and Redis probes.
    const canonicalFixtures = result.source === 'postgresql' ? result.fixtures : await canonicalizeMyDomesticCupFixtures(result.fixtures, clubState.ownedClubs, seasonId);
    const safeFixtures = canonicalFixtures.map(({ userSubmission, opponentSubmission, ...fixture }) => fixture);
    const statusFiltered = status ? safeFixtures.filter((fixture) => fixture.status === status) : safeFixtures;
    res.setHeader('Server-Timing',[res.getHeader('Server-Timing'),...timings].filter(Boolean).join(', '));
    res.json({ ...result, fixtures: sortSeasonFixtures(statusFiltered) });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/me/matches');
  }
});

meRouter.get('/match-ops', requireAuth, async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    const payload = await getMyMatchOperations(req.user!.id, seasonId);
    scheduleDeadlineSweep(seasonId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(payload);
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/me/match-ops');
  }
});

meRouter.post('/match-ops/no-show', requireAuth, async (req: Request, res: Response) => {
  const fixtureId = String(req.body?.fixtureId || '').trim();
  const seasonId = String(req.body?.seasonId || 'season-2026-27');
  const reason = String(req.body?.reason || '').trim();
  const evidenceUrl = req.body?.evidenceUrl ? String(req.body.evidenceUrl).trim() : null;
  if (!fixtureId || reason.length < 3 || reason.length > 1000) {
    res.status(400).json({ error: 'INVALID_NO_SHOW_REPORT' });
    return;
  }
  try {
    const result = await reportNoShowV4({
      fixtureId,
      seasonId,
      userId: req.user!.id,
      username: req.user!.username,
      reason,
      evidenceUrl,
    });
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (err: any) {
    const code = String(err?.message || 'NO_SHOW_REPORT_FAILED');
    const status = code.includes('NOT_OWNED') ? 403 : code.includes('CLOSED') ? 409 : code.includes('EVIDENCE') || code.includes('INVALID') ? 400 : 503;
    res.status(status).json({ error: code, message: code });
  }
});

meRouter.get('/notifications', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const notifications = await getLiveUserNotifications(userId, 30);
    res.json({ notifications });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/me/notifications');
  }
});

meRouter.post('/notifications/read', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { notificationId } = req.body || {};
  try {
    if (notificationId && typeof notificationId === 'string') {
      await markSingleNotificationReadFirestore(userId, notificationId);
    } else {
      await markNotificationsReadFirestore(userId);
    }
    res.json({ success: true });
  } catch (err: any) {
    handleFirestoreError(res, err, 'POST /api/me/notifications/read');
  }
});
