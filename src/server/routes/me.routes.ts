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
import { canonicalizeMyDomesticCupFixtures } from '../services/myMatchesCanonicalService';
import {
  getMyMatchOperations,
  reportNoShowV4,
  scheduleDeadlineSweep,
} from '../services/matchOperationsV4Service';
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

const DOMESTIC_CUP_IDS = new Set([
  'comp-fa-cup-2026',
  'comp-copa-del-rey-2026',
  'comp-coppa-italia-2026',
  'comp-dfb-pokal-2026',
  'comp-coupe-de-france-2026',
]);

const EUROPEAN_LEAGUE_PHASE_IDS = new Set([
  'comp-champions-league-2026',
  'comp-europa-league-2026',
]);

function myMatchesPhase(fixture: Fixture): number {
  if (DOMESTIC_LEAGUE_IDS.has(fixture.competitionId)) {
    const md = Number(fixture.matchday || 0);
    if (md <= 9) return 10;
    if (md <= 19) return 30;
    return 50;
  }
  if (DOMESTIC_CUP_IDS.has(fixture.competitionId)) return 20;
  if (EUROPEAN_LEAGUE_PHASE_IDS.has(fixture.competitionId)) return 40;
  return 25;
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
    const [fixtures, clubState] = await Promise.all([
      getFixturesFirestore({ userId, seasonId, status }),
      getOptionalCurrentClub(userId, seasonId),
    ]);
    const canonicalFixtures = await canonicalizeMyDomesticCupFixtures(fixtures, clubState.ownedClubs, seasonId);
    const statusFiltered = status ? canonicalFixtures.filter((fixture) => fixture.status === status) : canonicalFixtures;
    res.json({ fixtures: sortMyMatches(statusFiltered) });
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
