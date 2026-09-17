import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/authMiddleware';
import { setOwnershipSensitiveHeaders } from '../middleware/ownershipCacheControl';
import { validateBody } from '../middleware/validationMiddleware';
import {
  getDisputes,
  getAllAdminUsers,
  getAuditLogs,
  editFixtureResult,
  deleteFixtureResult,
  deleteFixture,
  getUserDetail,
  setUserAdminRole,
  setUserSuspension,
  deleteUser,
  getResultSubmissions,
  deleteResultSubmission,
} from '../services/adminService';
import {
  generateCompetitionFixturesFirestore,
  reopenFixtureFirestore,
  resolveDisputeFirestore,
  rebuildCompetitionStandingsFirestore,
  getAllCompetitionsFirestore,
  getClubsByLeagueFirestore,
  getFixturesFirestore,
  getAdminFixturesPagedFirestore,
  executeAdminFixturesPagedFallback,
  getLocalDisputes,
  getLocalPendingResults,
  getLocalSubmissions,
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
import { processPendingMutations } from '../sync/mutationQueue';
import { generateKnockoutBracket } from '../tournament/knockoutEngine';
import {
  evaluateSeasonQualifications,
  previewEuropeanQualificationSync,
  applyEuropeanQualificationSync,
  rebuildEuropeanStandings,
  getEuropeanStandings,
} from '../tournament/qualificationEngine';
import {
  DOMESTIC_CUPS,
  getDomesticCupDetails,
  previewDomesticCupBracket,
  generateDomesticCupBracketSafe,
  advanceDomesticCupWinnerSafe,
} from '../tournament/domesticCupService';
import {
  getSafeEligibleRecipients,
  enqueueTelegramBroadcast,
  processNotificationQueue,
  getBroadcastHistory,
  getBroadcastDetails,
} from '../services/telegramNotificationQueue';
import { getFirebaseStatus, getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { queryAll, queryGet } from '../db/index';
import {
  rebuildAllReadModels,
  getReadModelHealthStatus,
  getAdminClubsFromReadModel,
  invalidateClubReadModels,
  invalidateFixtureReadModels,
  invalidateStandingsReadModels,
  invalidateCompetitionReadModels,
  invalidateUserMembershipReadModel,
  ReadModelNotWarmedError,
} from '../readModel/readModelStore';

export const adminRouter = Router();

// Protect ALL admin routes with server-side requireAdmin
adminRouter.use(requireAdmin);

function getFallbackAdminOverview(seasonId: string) {
  const status = getFirebaseStatus();
  const occRow = queryGet<{ count: number }>("SELECT COUNT(*) as count FROM club_memberships WHERE season_id = ? AND status = 'active'", [seasonId]);
  const userRow = queryGet<{ count: number }>("SELECT COUNT(*) as count FROM users", []);
  const disputeRow = queryGet<{ count: number }>("SELECT COUNT(*) as count FROM disputes WHERE status = 'OPEN'", []);
  const pendingRow = queryGet<{ count: number }>("SELECT COUNT(*) as count FROM fixtures WHERE status = 'PENDING_CONFIRMATION'", []);
  const auditRow = queryGet<{ count: number }>("SELECT COUNT(*) as count FROM audit_logs", []);
  const compRows = queryAll<any>("SELECT * FROM competitions WHERE season_id = ?", [seasonId]);

  const activeOccupancies = occRow?.count ?? 0;
  const registeredUsers = userRow?.count ?? 0;
  const openDisputes = disputeRow?.count ?? 0;
  const pendingCount = pendingRow?.count ?? 0;
  const auditLogsCount = auditRow?.count ?? 0;

  const domesticCups = compRows.filter((c) => c.type === 'cup');
  const europeanComps = compRows.filter(
    (c) => c.type === 'champions_league' || c.type === 'europa_league' || c.type === 'conference_league'
  );

  const disputes = getLocalDisputes('OPEN', 10);
  const pendingData = getLocalPendingResults(seasonId, 5);

  return {
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
      totalCompetitions: compRows.length || 8,
      totalUsers: registeredUsers,
      registeredUsers,
      activeOccupancies,
      openDisputes,
      pendingResultConfirmations: pendingCount,
      recentAuditLogs: auditLogsCount,
    },
    systemHealth: {
      projectId: status.projectId,
      databaseId: status.databaseId,
      connected: false,
      authMode: status.authMode,
      timestamp: new Date().toISOString(),
    },
    openDisputes: disputes.slice(0, 10),
    pendingFixturesPreview: pendingData.pendingFixtures.slice(0, 5),
    source: 'sqlite',
    degraded: true,
    stale: true,
    generatedAt: new Date().toISOString(),
  };
}

adminRouter.get('/overview', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  recordEndpointCall('/api/admin/overview', 'ADMIN', 1);

  const cacheKey = `firestore:admin_overview:${seasonId}`;
  const cached = getFromCache<any>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  if (!firestoreCircuitBreaker.canExecute()) {
    const fallback = getFallbackAdminOverview(seasonId);
    setInCache(cacheKey, fallback, 60000);
    res.json(fallback);
    return;
  }

  try {
    const status = getFirebaseStatus();
    const db = getFirestoreDb();

    // Bounded queries with limits
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
      source: 'firestore',
      degraded: false,
      stale: false,
      generatedAt: new Date().toISOString(),
    };

    setInCache(cacheKey, payload, 60000); // 60s cache
    res.json(payload);
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    const fallback = getFallbackAdminOverview(seasonId);
    setInCache(cacheKey, fallback, 60000);
    res.status(200).json(fallback);
  }
});

adminRouter.get('/clubs', async (req: Request, res: Response) => {
  setOwnershipSensitiveHeaders(res);
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const leagueId = req.query.leagueId as string | undefined;

  try {
    const result = await getAdminClubsFromReadModel(seasonId, leagueId);
    res.json({
      clubs: result.clubs,
      total: result.total,
      source: result.source,
      degraded: result.degraded,
      stale: result.stale,
      generatedAt: result.snapshotAt,
    });
  } catch (err: any) {
    console.error('[ADMIN_CLUBS_ERROR]', err);
    res.status(503).json({
      errorCode: 'READ_MODEL_ERROR',
      message: err.message || 'Failed to retrieve admin clubs read model',
      generatedAt: new Date().toISOString(),
    });
  }
});

adminRouter.get('/fixtures', async (req: Request, res: Response) => {
  setOwnershipSensitiveHeaders(res);
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const competitionId = req.query.competitionId as string | undefined;
  const status = req.query.status as string | undefined;
  const matchday = req.query.matchday ? parseInt(req.query.matchday as string, 10) : undefined;
  const clubId = req.query.clubId as string | undefined;
  const userId = req.query.userId as string | undefined;
  const search = (req.query.search as string)?.trim().toLowerCase();
  const cursor = (req.query.cursor as string) || undefined;
  const limit = req.query.limit !== undefined ? Math.min(Math.max(parseInt(req.query.limit as string, 10), 1), 100) : 25;
  const page = req.query.page ? Math.max(1, parseInt(req.query.page as string, 10)) : 1;

  try {
    const result = await getAdminFixturesPagedFirestore({
      seasonId,
      competitionId: competitionId === 'ALL' ? undefined : competitionId,
      status: status === 'ALL' ? undefined : status,
      matchday: matchday || undefined,
      clubId: clubId || undefined,
      userId: userId || undefined,
      search,
      cursor,
      limit,
    });

    res.json({
      fixtures: result.fixtures,
      total: result.total,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      page,
      totalPages: Math.ceil(result.total / limit) || 1,
      limit,
      source: result.source,
      degraded: result.degraded,
      stale: result.stale,
      errorCode: result.errorCode,
      generatedAt: result.generatedAt,
    });
  } catch (err: any) {
    if (err instanceof ReadModelNotWarmedError || err?.errorCode === 'READ_MODEL_NOT_WARMED') {
      res.status(503).json({
        errorCode: 'READ_MODEL_NOT_WARMED',
        message: 'Read model is not warmed and authoritative database is unreachable.',
        generatedAt: new Date().toISOString(),
      });
      return;
    }
    console.error('[ADMIN_FIXTURES_FAILED]', {
      message: err?.message,
      code: err?.code,
      seasonId,
      competitionId,
      status,
      matchday,
    });
    res.status(503).json({
      errorCode: 'READ_MODEL_ERROR',
      message: err.message || 'Failed to retrieve admin fixtures read model',
      generatedAt: new Date().toISOString(),
    });
  }
});

// Admin manually enter or edit fixture result
const adminEditResultSchema = z.object({
  homeScore: z.number().int().min(0, 'Home score must be >= 0'),
  awayScore: z.number().int().min(0, 'Away score must be >= 0'),
  status: z.enum(['CONFIRMED', 'AWAITING_RESULT', 'SCHEDULED']).optional(),
  notes: z.string().optional(),
});

adminRouter.post('/fixtures/:id/result', validateBody(adminEditResultSchema), async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const adminUsername = req.user!.username || 'admin';
  const fixtureId = req.params.id;

  try {
    const result = await editFixtureResult(adminUserId, adminUsername, fixtureId, req.body);
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/fixtures/${fixtureId}/result`);
  }
});

// Admin delete fixture result (reset score and status back to SCHEDULED)
const adminDeleteResultSchema = z.object({
  deleteSubmissions: z.boolean().optional(),
  notes: z.string().optional(),
});

adminRouter.post('/fixtures/:id/delete-result', validateBody(adminDeleteResultSchema), async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const adminUsername = req.user!.username || 'admin';
  const fixtureId = req.params.id;

  try {
    const result = await deleteFixtureResult(adminUserId, adminUsername, fixtureId, req.body);
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/fixtures/${fixtureId}/delete-result`);
  }
});

// Admin delete fixture
const adminDeleteFixtureSchema = z.object({
  reason: z.string().min(3, 'Reason must be at least 3 characters'),
});

adminRouter.delete('/fixtures/:id', validateBody(adminDeleteFixtureSchema), async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const adminUsername = req.user!.username || 'admin';
  const fixtureId = req.params.id;

  try {
    const result = await deleteFixture(adminUserId, adminUsername, fixtureId, req.body.reason);
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `DELETE /api/admin/fixtures/${fixtureId}`);
  }
});

// Submissions management
adminRouter.get('/submissions', async (req: Request, res: Response) => {
  const fixtureId = req.query.fixtureId as string | undefined;
  const userId = req.query.userId as string | undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

  try {
    const submissions = await getResultSubmissions({ fixtureId, userId, limit });
    res.json({ submissions, total: submissions.length, source: 'firestore', degraded: false, stale: false });
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    const submissions = getLocalSubmissions({ fixtureId, userId, limit });
    res.json({ submissions, total: submissions.length, source: 'sqlite', degraded: true, stale: true });
  }
});

adminRouter.delete('/submissions/:id', async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const adminUsername = req.user!.username || 'admin';
  const submissionId = req.params.id;
  const notes = req.body?.notes as string | undefined;

  try {
    const result = await deleteResultSubmission(adminUserId, adminUsername, submissionId, notes);
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `DELETE /api/admin/submissions/${submissionId}`);
  }
});

// User detailed inspect
adminRouter.get('/users/:id/detail', async (req: Request, res: Response) => {
  const targetUserId = req.params.id;
  try {
    const detail = await getUserDetail(targetUserId);
    res.json({ ...detail, source: 'firestore', degraded: false, stale: false });
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    const localUser = queryGet<any>('SELECT * FROM users WHERE id = ?', [targetUserId]);
    if (!localUser) {
      res.status(404).json({ error: `User '${targetUserId}' not found.` });
      return;
    }
    const memberships = queryAll<any>('SELECT * FROM club_memberships WHERE user_id = ?', [targetUserId]);
    const submissions = getLocalSubmissions({ userId: targetUserId, limit: 30 });
    res.json({
      user: {
        id: localUser.id,
        telegramId: localUser.telegram_id,
        username: localUser.username,
        firstName: localUser.first_name,
        lastName: localUser.last_name || '',
        photoUrl: localUser.photo_url || '',
        isAdmin: Boolean(localUser.is_admin),
        isSuspended: Boolean(localUser.is_suspended),
        createdAt: localUser.created_at,
        updatedAt: localUser.updated_at,
      },
      activeClub: null,
      memberships,
      submissionsCount: submissions.length,
      recentSubmissions: submissions,
      auditLogs: [],
      notificationsCount: 0,
      source: 'sqlite',
      degraded: true,
      stale: true,
    });
  }
});

// User role management (Make/Remove Admin)
const adminSetRoleSchema = z.object({
  isAdmin: z.boolean(),
});

adminRouter.post('/users/:id/role', validateBody(adminSetRoleSchema), async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const adminUsername = req.user!.username || 'admin';
  const targetUserId = req.params.id;

  try {
    const result = await setUserAdminRole(adminUserId, adminUsername, targetUserId, req.body.isAdmin);
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/users/${targetUserId}/role`);
  }
});

// User suspension management
const adminSetSuspensionSchema = z.object({
  isSuspended: z.boolean(),
  reason: z.string().optional(),
});

adminRouter.post('/users/:id/suspend', validateBody(adminSetSuspensionSchema), async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const adminUsername = req.user!.username || 'admin';
  const targetUserId = req.params.id;

  try {
    const result = await setUserSuspension(adminUserId, adminUsername, targetUserId, req.body.isSuspended, req.body.reason);
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/users/${targetUserId}/suspend`);
  }
});

// Safe User deletion
const adminDeleteUserSchema = z.object({
  reason: z.string().optional(),
});

adminRouter.delete('/users/:id', validateBody(adminDeleteUserSchema), async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const adminUsername = req.user!.username || 'admin';
  const targetUserId = req.params.id;

  try {
    const result = await deleteUser(adminUserId, adminUsername, targetUserId, req.body.reason);
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `DELETE /api/admin/users/${targetUserId}`);
  }
});

adminRouter.get('/read-metrics', (req: Request, res: Response) => {
  res.json({
    metrics: getReadMetrics(),
    timestamp: new Date().toISOString(),
  });
});

adminRouter.get('/firestore-diagnostics', async (req: Request, res: Response) => {
  const isRefresh = req.query.refresh === 'true';
  const cacheKey = 'firestore:admin_diagnostics';
  const cached = getFromCache<any>(cacheKey);

  if (!isRefresh && cached) {
    res.json(cached);
    return;
  }

  if (!firestoreCircuitBreaker.canExecute()) {
    const usersCount = queryGet<{ count: number }>('SELECT COUNT(*) as count FROM users')?.count || 0;
    const clubsCount = queryGet<{ count: number }>('SELECT COUNT(*) as count FROM clubs')?.count || 96;
    const occCount = queryGet<{ count: number }>("SELECT COUNT(*) as count FROM club_memberships WHERE status = 'active'")?.count || 0;
    const fixCount = queryGet<{ count: number }>('SELECT COUNT(*) as count FROM fixtures')?.count || 0;
    const compCount = queryGet<{ count: number }>('SELECT COUNT(*) as count FROM competitions')?.count || 0;

    const fallbackResult = {
      projectId: 'sqlite-fallback',
      databaseId: '(default)',
      connected: false,
      authMode: 'LOCAL_SQLITE',
      readMetrics: getReadMetrics(),
      source: 'sqlite',
      degraded: true,
      stale: true,
      collections: {
        users: usersCount,
        clubs: clubsCount,
        club_occupancies: occCount,
        user_memberships: occCount,
        fixtures: fixCount,
        competitions: compCount,
      },
    };
    res.json(fallbackResult);
    return;
  }

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

    const result = {
      projectId: status.projectId,
      databaseId: status.databaseId,
      connected: true,
      authMode: status.authMode,
      readMetrics: getReadMetrics(),
      source: 'firestore',
      degraded: false,
      stale: false,
      collections: {
        users: usersCount?.data().count ?? 0,
        clubs: clubsCount?.data().count ?? 96,
        club_occupancies: occCount?.data().count ?? 0,
        user_memberships: memCount?.data().count ?? 0,
        fixtures: fixCount?.data().count ?? 0,
        competitions: compCount?.data().count ?? 0,
      },
    };

    setInCache(cacheKey, result, 600000); // 10 minutes cache
    res.json(result);
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    const usersCount = queryGet<{ count: number }>('SELECT COUNT(*) as count FROM users')?.count || 0;
    const clubsCount = queryGet<{ count: number }>('SELECT COUNT(*) as count FROM clubs')?.count || 96;
    const occCount = queryGet<{ count: number }>("SELECT COUNT(*) as count FROM club_memberships WHERE status = 'active'")?.count || 0;
    const fixCount = queryGet<{ count: number }>('SELECT COUNT(*) as count FROM fixtures')?.count || 0;
    const compCount = queryGet<{ count: number }>('SELECT COUNT(*) as count FROM competitions')?.count || 0;

    res.status(200).json({
      projectId: 'sqlite-fallback',
      databaseId: '(default)',
      connected: false,
      authMode: 'LOCAL_SQLITE',
      readMetrics: getReadMetrics(),
      source: 'sqlite',
      degraded: true,
      stale: true,
      collections: {
        users: usersCount,
        clubs: clubsCount,
        club_occupancies: occCount,
        user_memberships: occCount,
        fixtures: fixCount,
        competitions: compCount,
      },
    });
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
  if (!firestoreCircuitBreaker.canExecute()) {
    const rows = queryAll<any>('SELECT * FROM users ORDER BY created_at DESC');
    res.json({
      users: rows.map((r) => ({
        id: r.id,
        telegramId: r.telegram_id,
        username: r.username,
        firstName: r.first_name,
        lastName: r.last_name || '',
        photoUrl: r.photo_url || '',
        isAdmin: Boolean(r.is_admin),
        isSuspended: Boolean(r.is_suspended),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      source: 'sqlite',
      degraded: true,
      stale: true,
    });
    return;
  }

  try {
    const users = await getAllAdminUsers();
    res.json({ users, source: 'firestore', degraded: false, stale: false });
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    const rows = queryAll<any>('SELECT * FROM users ORDER BY created_at DESC');
    res.json({
      users: rows.map((r) => ({
        id: r.id,
        telegramId: r.telegram_id,
        username: r.username,
        firstName: r.first_name,
        lastName: r.last_name || '',
        photoUrl: r.photo_url || '',
        isAdmin: Boolean(r.is_admin),
        isSuspended: Boolean(r.is_suspended),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      source: 'sqlite',
      degraded: true,
      stale: true,
    });
  }
});

adminRouter.get('/disputes', async (req: Request, res: Response) => {
  const status = (req.query.status as string) || 'OPEN';
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

  if (!firestoreCircuitBreaker.canExecute()) {
    const disputes = getLocalDisputes(status, limit);
    res.json({ disputes, source: 'sqlite', degraded: true, stale: true });
    return;
  }

  try {
    const disputes = await getDisputes(status);
    res.json({ disputes, source: 'firestore', degraded: false, stale: false });
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    const disputes = getLocalDisputes(status, limit);
    res.json({ disputes, source: 'sqlite', degraded: true, stale: true });
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

  if (!firestoreCircuitBreaker.canExecute()) {
    const rows = queryAll<any>('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?', [limit]);
    res.json({
      logs: rows.map((r) => ({
        id: r.id,
        actorUserId: r.actor_user_id,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        oldValue: r.old_value ? JSON.parse(r.old_value) : null,
        newValue: r.new_value ? JSON.parse(r.new_value) : null,
        ipAddress: r.ip_address,
        actorUsername: r.actor_username,
        notes: r.notes,
        createdAt: r.created_at,
      })),
      source: 'sqlite',
      degraded: true,
      stale: true,
    });
    return;
  }

  try {
    const logs = await getAuditLogs(limit);
    res.json({ logs, source: 'firestore', degraded: false, stale: false });
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    const rows = queryAll<any>('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?', [limit]);
    res.json({
      logs: rows.map((r) => ({
        id: r.id,
        actorUserId: r.actor_user_id,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        oldValue: r.old_value ? JSON.parse(r.old_value) : null,
        newValue: r.new_value ? JSON.parse(r.new_value) : null,
        ipAddress: r.ip_address,
        actorUsername: r.actor_username,
        notes: r.notes,
        createdAt: r.created_at,
      })),
      source: 'sqlite',
      degraded: true,
      stale: true,
    });
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
    await invalidateClubReadModels(seasonId).catch(() => {});
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
    await invalidateClubReadModels(seasonId).catch(() => {});
    await invalidateUserMembershipReadModel(targetUserId, seasonId).catch(() => {});
    res.json(result);
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/clubs/${clubId}/assign`);
  }
});

// Results & Pending Workflow Endpoints
adminRouter.get('/results/pending', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

  if (!firestoreCircuitBreaker.canExecute()) {
    const result = getLocalPendingResults(seasonId, limit);
    res.json({ ...result, source: 'sqlite', degraded: true, stale: true });
    return;
  }

  try {
    const result = await getPendingResultsFirestore(seasonId);
    res.json({ ...result, source: 'firestore', degraded: false, stale: false });
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    const result = getLocalPendingResults(seasonId, limit);
    res.json({ ...result, source: 'sqlite', degraded: true, stale: true });
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
    const compId = (result as any)?.fixture?.competitionId || '';
    if (compId) {
      await invalidateFixtureReadModels(compId, 'season-2026-27').catch(() => {});
      await invalidateStandingsReadModels(compId, 'season-2026-27').catch(() => {});
    }
    await invalidateFixtureReadModels('', 'season-2026-27').catch(() => {});
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
    await invalidateFixtureReadModels('', 'season-2026-27').catch(() => {});
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
  const { overrideStatus, matchday, durationHours, seasonId } = req.body;
  if (!overrideStatus || !['AUTO', 'FORCE_OPEN', 'FORCE_LOCKED', 'PAUSED'].includes(overrideStatus)) {
    res.status(400).json({ error: 'Valid overrideStatus is required (AUTO, FORCE_OPEN, FORCE_LOCKED, PAUSED)', code: 'BAD_REQUEST' });
    return;
  }

  try {
    const result = await setCompetitionMatchdayOverrideFirestore(competitionId, overrideStatus, {
      matchday: typeof matchday === 'number' ? matchday : undefined,
      durationHours: typeof durationHours === 'number' ? durationHours : undefined,
      seasonId: typeof seasonId === 'string' ? seasonId : undefined,
      adminUserId: req.user?.id,
    });
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
  const { durationHours = 30, matchday, seasonId } = req.body;

  try {
    const result = await openCompetitionMatchdayNowFirestore(
      competitionId,
      durationHours,
      typeof matchday === 'number' ? matchday : undefined,
      typeof seasonId === 'string' ? seasonId : undefined
    );
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

adminRouter.post('/sync', async (_req: Request, res: Response) => {
  try {
    const result = await processPendingMutations();
    res.status(200).json({
      success: true,
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ----------------------------------------------------
// READ MODEL REBUILD & HEALTH ENDPOINTS
// ----------------------------------------------------

adminRouter.post('/read-model/rebuild', async (req: Request, res: Response) => {
  const seasonId = (req.body?.seasonId as string) || (req.query?.seasonId as string) || 'season-2026-27';
  try {
    const result = await rebuildAllReadModels(seasonId);
    res.json(result);
  } catch (err: any) {
    console.error('[ADMIN_READ_MODEL_REBUILD_ERROR]', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to rebuild read model snapshots',
      generatedAt: new Date().toISOString(),
    });
  }
});

adminRouter.get('/read-model/health', async (req: Request, res: Response) => {
  const seasonId = (req.query?.seasonId as string) || 'season-2026-27';
  try {
    const health = await getReadModelHealthStatus(seasonId);
    res.json(health);
  } catch (err: any) {
    console.error('[ADMIN_READ_MODEL_HEALTH_ERROR]', err);
    res.status(500).json({
      error: err.message || 'Failed to get read model health',
    });
  }
});

// ----------------------------------------------------
// 1. DOMESTIC CUP ADMINISTRATION ENDPOINTS
// ----------------------------------------------------

adminRouter.get('/cups', async (req: Request, res: Response) => {
  try {
    const cups = Object.values(DOMESTIC_CUPS);
    res.json({ cups });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.get('/cups/:cupId', async (req: Request, res: Response) => {
  const cupId = req.params.cupId;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';

  try {
    const details = await getDomesticCupDetails(cupId, seasonId);
    res.json(details);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminRouter.post('/cups/:cupId/bracket/preview', async (req: Request, res: Response) => {
  const cupId = req.params.cupId;
  const seasonId = (req.body.seasonId as string) || 'season-2026-27';

  try {
    const preview = await previewDomesticCupBracket(cupId, seasonId);
    res.json(preview);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminRouter.post('/cups/:cupId/bracket/generate', async (req: Request, res: Response) => {
  const cupId = req.params.cupId;
  const adminUserId = req.user!.id;
  const adminUsername = req.user?.username || 'admin';
  const confirmation = Boolean(req.body.confirmation);
  const seasonId = req.body.seasonId || 'season-2026-27';

  try {
    const result = await generateDomesticCupBracketSafe(cupId, {
      adminUserId,
      adminUsername,
      confirmation,
      seasonId,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminRouter.post('/cups/matches/:fixtureId/advance', async (req: Request, res: Response) => {
  const fixtureId = req.params.fixtureId;
  const adminUserId = req.user!.id;
  const adminUsername = req.user?.username || 'admin';

  try {
    const result = await advanceDomesticCupWinnerSafe(fixtureId, {
      adminUserId,
      adminUsername,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 2. UCL/UEL STANDINGS & QUALIFICATION PROJECTIONS
// ----------------------------------------------------

adminRouter.get('/european/standings', async (req: Request, res: Response) => {
  const competitionId = (req.query.competitionId as string) || 'comp-champions-league-2026';
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';

  try {
    const result = await getEuropeanStandings(competitionId, seasonId);
    res.json({
      competitionId,
      seasonId,
      standings: result.rows,
      source: result.source,
      degraded: result.degraded,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/european/standings/rebuild', async (req: Request, res: Response) => {
  const competitionId = req.body.competitionId || 'comp-champions-league-2026';
  const seasonId = req.body.seasonId || 'season-2026-27';

  try {
    const rows = await rebuildEuropeanStandings(competitionId, seasonId);
    res.json({
      success: true,
      competitionId,
      seasonId,
      totalTeams: rows.length,
      standings: rows,
      message: `Rebuilt 32-team standings for ${competitionId}.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.get('/european/qualification/preview', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const mode = (req.query.mode as 'provisional' | 'final') || 'provisional';

  try {
    const preview = await previewEuropeanQualificationSync(seasonId, mode);
    res.json(preview);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/european/qualification/apply', async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const adminUsername = req.user?.username || 'admin';
  const { previewToken, confirmation, seasonId } = req.body;

  if (!previewToken) {
    res.status(400).json({ error: 'previewToken is required' });
    return;
  }

  try {
    const result = await applyEuropeanQualificationSync({
      seasonId,
      previewToken,
      confirmation: Boolean(confirmation),
      adminUserId,
      adminUsername,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 3. ADMIN-SELECTED TELEGRAM BOT NOTIFICATIONS
// ----------------------------------------------------

adminRouter.get('/telegram-notifications/recipients', async (req: Request, res: Response) => {
  const audience = req.query.audience as string | undefined;
  const leagueId = req.query.leagueId as string | undefined;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';

  try {
    // STRICT DATA SAFETY RULE: telegramId is completely omitted in response!
    const recipients = await getSafeEligibleRecipients({ audience, leagueId }, seasonId);
    res.json({
      total: recipients.length,
      recipients,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/telegram-notifications/broadcast', async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const adminUsername = req.user?.username || 'admin';
  const { title, body, type, targetAudience, targetLeagueId, selectedUserIds, seasonId } = req.body;

  if (!title || !body) {
    res.status(400).json({ error: 'Title and message body are required' });
    return;
  }

  try {
    const record = await enqueueTelegramBroadcast({
      adminUserId,
      adminUsername,
      title,
      body,
      type: type || 'CUSTOM_ALERT',
      targetAudience: targetAudience || 'ALL_USERS',
      targetLeagueId,
      selectedUserIds,
      seasonId,
    });

    res.json({
      success: true,
      message: `Enqueued broadcast '${title}' for ${record.metrics.totalRecipients} recipients.`,
      broadcast: record,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminRouter.get('/telegram-notifications/broadcasts', async (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
  try {
    const broadcasts = await getBroadcastHistory(limit);
    res.json({ broadcasts });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.get('/telegram-notifications/broadcasts/:id', async (req: Request, res: Response) => {
  try {
    const broadcast = await getBroadcastDetails(req.params.id);
    if (!broadcast) {
      res.status(404).json({ error: 'Broadcast not found' });
      return;
    }
    res.json({ broadcast });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

adminRouter.post('/telegram-notifications/process-queue', async (req: Request, res: Response) => {
  try {
    const result = await processNotificationQueue(50);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});




