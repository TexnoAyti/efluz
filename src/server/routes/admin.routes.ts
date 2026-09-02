import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { getDisputes, getAllAdminUsers, getAuditLogs } from '../services/adminService';
import {
  generateCompetitionFixturesFirestore,
  reopenFixtureFirestore,
  resolveDisputeFirestore,
  rebuildCompetitionStandingsFirestore,
  getAllCompetitionsFirestore,
  getClubsByLeagueFirestore,
  getFixturesFirestore,
  adminReleaseClubFirestore,
  adminAssignClubFirestore,
  adminApproveFixtureResultFirestore,
  getPendingResultsFirestore,
  advanceCompetitionMatchdayFirestore,
  setCompetitionMatchdayOverrideFirestore,
  openCompetitionMatchdayNowFirestore,
  setCompetitionMatchdayTimerFirestore,
  validateDomesticFixturesFirestore,
  getReadMetrics,
  resetReadMetrics,
  getFromCache,
  setInCache,
  recordEndpointCall,
} from '../firebase/firestoreStore';
import { SEED_CLUBS, SEED_LEAGUES } from '../db/seed';
import { migrateSqliteToFirestore } from '../firebase/migrateSqliteToFirestore';
import { generateKnockoutBracket } from '../tournament/knockoutEngine';
import { evaluateSeasonQualifications } from '../tournament/qualificationEngine';
import { getFirebaseStatus, getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';

export const adminRouter = Router();

// Protect ALL admin routes with server-side requireAdmin
adminRouter.use(requireAdmin);

adminRouter.get('/overview', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  recordEndpointCall('/api/admin/overview', 'ADMIN', 3);

  const cacheKey = `firestore:admin_overview:${seasonId}`;
  const cached = getFromCache<any>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const status = getFirebaseStatus();
    const db = getFirestoreDb();

    const [usersCountSnap, occCountSnap, competitions, disputes, auditLogs, pendingData] = await Promise.all([
      db.collection(COLLECTIONS.USERS).count().get().catch(() => null),
      db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where('seasonId', '==', seasonId).where('status', '==', 'active').count().get().catch(() => null),
      getAllCompetitionsFirestore(seasonId).catch(() => []),
      getDisputes('OPEN').catch(() => []),
      getAuditLogs(10).catch(() => []),
      getPendingResultsFirestore(seasonId).catch(() => ({ pendingFixtures: [], total: 0 })),
    ]);

    const registeredUsers = usersCountSnap?.data().count ?? 0;
    const activeOccupancies = occCountSnap?.data().count ?? 0;

    const domesticLeagues = competitions.filter((c) => c.type === 'league');
    const domesticCups = competitions.filter((c) => c.type === 'cup');
    const europeanComps = competitions.filter(
      (c) => c.type === 'champions_league' || c.type === 'europa_league' || c.type === 'conference_league'
    );

    const payload = {
      season: {
        id: seasonId,
        name: '2026/27 Season',
        status: 'ACTIVE',
      },
      counts: {
        totalClubs: 96,
        occupiedClubs: activeOccupancies,
        availableClubs: Math.max(0, 96 - activeOccupancies),
        domesticLeaguesCount: 5,
        domesticCupsCount: domesticCups.length,
        europeanCompetitionsCount: europeanComps.length,
        totalCompetitions: competitions.length,
        totalUsers: registeredUsers,
        registeredUsers,
        activeOccupancies,
        openDisputes: disputes.length,
        pendingResultConfirmations: pendingData.total,
        recentAuditLogs: auditLogs.length,
      },
      systemHealth: {
        projectId: status.projectId,
        databaseId: status.databaseId,
        connected: true,
        authMode: status.authMode,
        timestamp: new Date().toISOString(),
      },
      openDisputes: disputes.slice(0, 10),
      pendingFixturesPreview: pendingData.pendingFixtures.slice(0, 5),
    };

    setInCache(cacheKey, payload, 15000); // 15s cache
    res.json(payload);
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/admin/overview');
  }
});

adminRouter.get('/clubs', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const leagueId = req.query.leagueId as string | undefined;
  try {
    let targetLeagues = SEED_LEAGUES;
    if (leagueId && leagueId !== 'ALL') {
      targetLeagues = SEED_LEAGUES.filter((l) => l.id === leagueId);
    }
    const clubsByLeague = await Promise.all(
      targetLeagues.map((l) => getClubsByLeagueFirestore(l.id, seasonId))
    );
    const clubs = clubsByLeague.flat();
    res.json({ clubs, total: clubs.length });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/admin/clubs');
  }
});

adminRouter.get('/fixtures', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const competitionId = req.query.competitionId as string | undefined;
  const status = req.query.status as string | undefined;
  const matchday = req.query.matchday ? parseInt(req.query.matchday as string, 10) : undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 150;

  try {
    const fixtures = await getFixturesFirestore({
      seasonId,
      competitionId: competitionId === 'ALL' ? undefined : competitionId,
      status: status === 'ALL' ? undefined : status,
      matchday: matchday || undefined,
      limit,
    });
    res.json({ fixtures, total: fixtures.length });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/admin/fixtures');
  }
});

adminRouter.get('/read-metrics', (req: Request, res: Response) => {
  res.json({
    metrics: getReadMetrics(),
    timestamp: new Date().toISOString(),
  });
});

adminRouter.get('/firestore-diagnostics', async (req: Request, res: Response) => {
  try {
    const status = getFirebaseStatus();
    const db = getFirestoreDb();

    // Use count() aggregations (only 1 read or zero cost) instead of downloading full document collections
    const [usersCount, clubsCount, occCount, memCount, fixCount, compCount] = await Promise.all([
      db.collection(COLLECTIONS.USERS).count().get().catch(() => null),
      db.collection(COLLECTIONS.CLUBS).count().get().catch(() => null),
      db.collection(COLLECTIONS.CLUB_OCCUPANCIES).count().get().catch(() => null),
      db.collection(COLLECTIONS.USER_MEMBERSHIPS).count().get().catch(() => null),
      db.collection(COLLECTIONS.FIXTURES).count().get().catch(() => null),
      db.collection(COLLECTIONS.COMPETITIONS).count().get().catch(() => null),
    ]);

    res.json({
      projectId: status.projectId,
      databaseId: status.databaseId,
      connected: true,
      authMode: status.authMode,
      readMetrics: getReadMetrics(),
      collections: {
        users: usersCount?.data().count ?? 0,
        clubs: clubsCount?.data().count ?? 96,
        club_occupancies: occCount?.data().count ?? 0,
        user_memberships: memCount?.data().count ?? 0,
        fixtures: fixCount?.data().count ?? 0,
        competitions: compCount?.data().count ?? 0,
      },
    });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/admin/firestore-diagnostics');
  }
});

const resolveDisputeSchema = z.object({
  action: z.enum(['CONFIRM_HOME_SUBMISSION', 'CONFIRM_AWAY_SUBMISSION', 'MANUAL_SCORE', 'CANCEL_MATCH']),
  manualHomeScore: z.number().int().min(0).optional(),
  manualAwayScore: z.number().int().min(0).optional(),
  notes: z.string().optional(),
});

const reopenFixtureSchema = z.object({
  notes: z.string().optional(),
});

adminRouter.post('/migrate-to-firestore', async (req: Request, res: Response) => {
  try {
    const report = await migrateSqliteToFirestore();
    res.json({
      success: report.success,
      message: report.success
        ? 'Successfully migrated SQLite seed to Firestore.'
        : 'Migration completed with some warnings or errors.',
      report,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, 'POST /api/admin/migrate-to-firestore');
  }
});

adminRouter.get('/users', async (req: Request, res: Response) => {
  try {
    const users = await getAllAdminUsers();
    res.json({ users });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/admin/users');
  }
});

adminRouter.get('/disputes', async (req: Request, res: Response) => {
  const status = (req.query.status as string) || 'OPEN';
  try {
    const disputes = await getDisputes(status);
    res.json({ disputes });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/admin/disputes');
  }
});

adminRouter.post('/disputes/:id/resolve', validateBody(resolveDisputeSchema), async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const disputeId = req.params.id;

  try {
    const result = await resolveDisputeFirestore(adminUserId, disputeId, req.body);
    res.json({
      success: true,
      message: 'Dispute resolved successfully.',
      dispute: result.dispute,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/disputes/${disputeId}/resolve`);
  }
});

adminRouter.post('/fixtures/:id/reopen', validateBody(reopenFixtureSchema), async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const fixtureId = req.params.id;

  try {
    const result = await reopenFixtureFirestore(adminUserId, fixtureId, req.body.notes);
    res.json({
      success: true,
      message: 'Fixture has been reopened for submissions.',
      result,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/fixtures/${fixtureId}/reopen`);
  }
});

adminRouter.get('/audit-logs', async (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  try {
    const logs = await getAuditLogs(limit);
    res.json({ logs });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/admin/audit-logs');
  }
});

adminRouter.post('/fixtures/generate', async (req: Request, res: Response) => {
  const { competitionId, force } = req.body;
  if (!competitionId) {
    res.status(400).json({ error: 'competitionId is required', code: 'BAD_REQUEST', message: 'competitionId is required' });
    return;
  }

  try {
    const result = await generateCompetitionFixturesFirestore(competitionId, { force: Boolean(force) });
    res.json({
      success: true,
      competitionId,
      fixturesGenerated: result.generated,
      matchdays: result.matchdays,
      message: `Generated and persisted ${result.generated} fixtures in Firestore across ${result.matchdays} matchdays.`,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, 'POST /api/admin/fixtures/generate');
  }
});

adminRouter.post('/knockouts/generate', async (req: Request, res: Response) => {
  const { competitionId } = req.body;
  if (!competitionId) {
    res.status(400).json({ error: 'competitionId is required', code: 'BAD_REQUEST', message: 'competitionId is required' });
    return;
  }

  try {
    const result = await generateKnockoutBracket(competitionId);
    res.json({
      success: true,
      message: `Generated ${result.generated} knockout matches across ${result.rounds} rounds.`,
      result,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, 'POST /api/admin/knockouts/generate');
  }
});

adminRouter.post('/qualifications/evaluate', async (req: Request, res: Response) => {
  const seasonId = req.body.seasonId || 'season-2026-27';

  try {
    const result = await evaluateSeasonQualifications(seasonId);
    res.json({
      success: true,
      message: `Evaluated European qualifications: ${result.qualifications.length} spots assigned, ${result.participantsAdded} participants registered.`,
      result,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, 'POST /api/admin/qualifications/evaluate');
  }
});

adminRouter.post('/fixtures/reset', async (req: Request, res: Response) => {
  const { competitionId } = req.body;
  if (!competitionId) {
    res.status(400).json({ error: 'competitionId is required', code: 'BAD_REQUEST', message: 'competitionId is required' });
    return;
  }

  try {
    const result = await generateCompetitionFixturesFirestore(competitionId, { force: true });
    res.json({
      success: true,
      competitionId,
      fixturesGenerated: result.generated,
      matchdays: result.matchdays,
      message: `Reset and regenerated schedule for competition '${competitionId}'.`,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, 'POST /api/admin/fixtures/reset');
  }
});

adminRouter.post('/competitions/:id/rebuild-standings', async (req: Request, res: Response) => {
  const competitionId = req.params.id;
  try {
    const standings = await rebuildCompetitionStandingsFirestore(competitionId);
    res.json({
      success: true,
      competitionId,
      standings,
      totalClubs: standings.length,
      message: `Rebuilt and persisted materialized standings for competition '${competitionId}'.`,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/competitions/${competitionId}/rebuild-standings`);
  }
});

// Club Management Endpoints
adminRouter.post('/clubs/:id/release', async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const clubId = req.params.id;
  const seasonId = (req.body.seasonId as string) || 'season-2026-27';

  try {
    const result = await adminReleaseClubFirestore(adminUserId, clubId, seasonId);
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/clubs/${clubId}/release`);
  }
});

adminRouter.post('/clubs/:id/assign', async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const clubId = req.params.id;
  const { targetUserId, seasonId = 'season-2026-27' } = req.body;

  if (!targetUserId) {
    res.status(400).json({ error: 'targetUserId is required', code: 'BAD_REQUEST', message: 'targetUserId is required' });
    return;
  }

  try {
    const result = await adminAssignClubFirestore(adminUserId, clubId, targetUserId, seasonId);
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/clubs/${clubId}/assign`);
  }
});

// Results & Pending Workflow Endpoints
adminRouter.get('/results/pending', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    const result = await getPendingResultsFirestore(seasonId);
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/admin/results/pending');
  }
});

const approveResultSchema = z.object({
  homeScore: z.number().int().min(0),
  awayScore: z.number().int().min(0),
  notes: z.string().optional(),
});

adminRouter.post('/results/:fixtureId/approve', validateBody(approveResultSchema), async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const fixtureId = req.params.fixtureId;
  const { homeScore, awayScore, notes } = req.body;

  try {
    const result = await adminApproveFixtureResultFirestore(adminUserId, fixtureId, homeScore, awayScore, notes);
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/results/${fixtureId}/approve`);
  }
});

adminRouter.post('/results/:fixtureId/reject', validateBody(reopenFixtureSchema), async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const fixtureId = req.params.fixtureId;
  const { notes } = req.body;

  try {
    const result = await reopenFixtureFirestore(adminUserId, fixtureId, notes || 'Rejected by tournament administrator');
    res.json({
      success: true,
      message: 'Pending result rejected and match reopened for re-submission.',
      result,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/results/${fixtureId}/reject`);
  }
});

// Competition Matchday Controls
adminRouter.post('/competitions/:id/matchday/override', async (req: Request, res: Response) => {
  const competitionId = req.params.id;
  const { overrideStatus } = req.body;
  if (!overrideStatus || !['AUTO', 'FORCE_OPEN', 'FORCE_LOCKED', 'PAUSED'].includes(overrideStatus)) {
    res.status(400).json({ error: 'Valid overrideStatus is required (AUTO, FORCE_OPEN, FORCE_LOCKED, PAUSED)', code: 'BAD_REQUEST' });
    return;
  }

  try {
    const result = await setCompetitionMatchdayOverrideFirestore(competitionId, overrideStatus);
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/competitions/${competitionId}/matchday/override`);
  }
});

adminRouter.post('/competitions/:id/matchday/advance', async (req: Request, res: Response) => {
  const competitionId = req.params.id;
  const { durationHours } = req.body;

  try {
    const result = await advanceCompetitionMatchdayFirestore(competitionId, { durationHours });
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/competitions/${competitionId}/matchday/advance`);
  }
});

adminRouter.post('/competitions/:id/matchday/open-now', async (req: Request, res: Response) => {
  const competitionId = req.params.id;
  const { durationHours = 30 } = req.body;

  try {
    const result = await openCompetitionMatchdayNowFirestore(competitionId, durationHours);
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/competitions/${competitionId}/matchday/open-now`);
  }
});

adminRouter.post('/competitions/:id/matchday/set-timer', async (req: Request, res: Response) => {
  const competitionId = req.params.id;
  const { currentMatchday, durationHours, nextOpenAt, overrideStatus } = req.body;

  try {
    const result = await setCompetitionMatchdayTimerFirestore(competitionId, {
      currentMatchday,
      durationHours,
      nextOpenAt,
      overrideStatus,
    });
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/competitions/${competitionId}/matchday/set-timer`);
  }
});

adminRouter.get('/fixtures/validation', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    const report = await validateDomesticFixturesFirestore(seasonId);
    res.json(report);
  } catch (err: any) {
    handleFirestoreError(res, err, `GET /api/admin/fixtures/validation`);
  }
});

adminRouter.get('/read-metrics', async (_req: Request, res: Response) => {
  res.json(getReadMetrics());
});

adminRouter.post('/read-metrics/reset', async (_req: Request, res: Response) => {
  resetReadMetrics();
  res.json({ success: true, message: 'Firestore read metrics have been reset.' });
});


