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
import { getOptionalCurrentClub } from '../readModel/readModelStore';
import { getDashboardLeagueStats } from '../services/dashboardLeagueStatsService';
import { Fixture } from '../../types';

export const meRouter = Router();
export const meResilientRouter = meRouter;

const DOMESTIC_LEAGUE_IDS = new Set([
  'comp-premier-league-2026',
  'comp-la-liga-2026',
  'comp-serie-a-2026',
  'comp-bundesliga-2026',
  'comp-ligue-1-2026',
]);

const EUROPEAN_LEAGUE_PHASE_IDS = new Set([
  'comp-champions-league-2026',
  'comp-europa-league-2026',
]);

function myMatchesPhase(fixture: Fixture): number {
  if (DOMESTIC_LEAGUE_IDS.has(fixture.competitionId)) {
    // UCL/UEL starts after the domestic first half. Bundesliga/Ligue 1 have
    // only 17 first-half rounds, so all of their first-half fixtures remain first.
    return Number(fixture.matchday || 0) <= 19 ? 10 : 30;
  }
  if (EUROPEAN_LEAGUE_PHASE_IDS.has(fixture.competitionId)) return 20;
  // Domestic cups/super cups keep their existing relative position and are not
  // reinterpreted as league matchdays.
  return 15;
}

function sortMyMatches(fixtures: Fixture[]): Fixture[] {
  return [...fixtures].sort((a, b) => {
    const phase = myMatchesPhase(a) - myMatchesPhase(b);
    if (phase !== 0) return phase;
    const md = Number(a.matchday || 0) - Number(b.matchday || 0);
    if (md !== 0) return md;
    const at = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
    const bt = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
    if (at !== bt) return at - bt;
    return String(a.id).localeCompare(String(b.id));
  });
}

// Ensure all personalized /api/me responses are never cached publicly
meRouter.use((req: Request, res: Response, next) => {
  setOwnershipSensitiveHeaders(res);
  next();
});

meRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';

  try {
    const clubState = await getOptionalCurrentClub(user.id, seasonId);
    const stats = await getDashboardLeagueStats(clubState.currentClub, seasonId);

    res.json({
      authenticated: true,
      user,
      ...clubState,
      stats,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/me');
  }
});

meRouter.get('/matches', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const status = req.query.status as string | undefined;

  try {
    const fixtures = await getFixturesFirestore({
      userId,
      seasonId,
      status,
    });

    res.json({ fixtures: sortMyMatches(fixtures) });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/me/matches');
  }
});

meRouter.get('/notifications', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const notifications = await getUserNotificationsFirestore(userId, 30);
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