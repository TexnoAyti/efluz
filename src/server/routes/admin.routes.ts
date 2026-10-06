import { createHash } from 'node:crypto';
import { readSharedAdminData } from '../services/adminReviewCache';
import { canUseDangerZone, isLeagueAdmin, permittedAdminLeagues } from '../../lib/adminPermissions';
import { matchesUserSearch } from '../../lib/userSearch';
import { getAdminUserDirectory, resolveAdminUserReference } from '../services/adminUserDirectory';
import { Router, Request, Response } from 'express';
import { adminNotificationsRouter } from './adminNotifications.routes';
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
  trackFirestoreAggregation,
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
  scheduleNotificationQueueDrain,
  getBroadcastHistory,
  getBroadcastDetails,
  retryFailedBroadcastRecipients,
  syncRecipientDirectory,
} from '../services/telegramNotificationQueue';
import { notifySmartMatchdayOpened } from '../services/smartNotificationService';
import { notifyOutstandingMatchdayOwners } from '../services/matchdayReminderService';
import { getFirebaseStatus, getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';
import {
  getSmartNotificationSettings,
  updateSmartNotificationSettings,
  DEFAULT_SMART_NOTIFICATION_EVENTS,
} from '../services/smartNotificationSettingsService';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { refreshRecipientDirectoryIfStale } from '../services/recipientDirectoryRefreshService';
import { advanceClubAdmission, CLUB_ADMISSION_LEAGUES, ClubAdmissionConflict, getClubAdmissionStatus } from '../services/clubAdmission';
import { queryAll, queryGet } from '../db/index';
import {
  rebuildAllReadModels,
  getReadModelHealthStatus,
  getAdminClubsFromReadModel,
  invalidateClubReadModels,
  invalidateFixtureReadModels,
  refreshChangedFixtureReadModel,
  invalidateStandingsReadModels,
  invalidateCompetitionReadModels,
  invalidateUserMembershipReadModel,
  ReadModelNotWarmedError,
} from '../readModel/readModelStore';

export const adminRouter = Router();

// Protect ALL admin routes with server-side requireAdmin
adminRouter.use('/notifications', adminNotificationsRouter);
adminRouter.use(requireAdmin);

adminRouter.get('/access', (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ adminPermissions: req.user!.adminPermissions || { scope: 'ALL', leagueIds: [] }, canUseDangerZone: canUseDangerZone(req.user) });
});
adminRouter.get('/scoped/users', async (req: Request, res: Response) => {
  const search = String(req.query.search || '').trim().slice(0, 80);
  if (search.length < 2) { res.json({ users: [] }); return; }
  try {
    const users = (await getAdminUserDirectory()).filter(user => matchesUserSearch(user, search)).slice(0, 20);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ users: users.map(user => ({ id: user.id, telegramId: user.telegramId, username: user.username, firstName: user.firstName, lastName: user.lastName, photoUrl: user.photoUrl, isSuspended: user.isSuspended })) });
  } catch (err: any) { handleFirestoreError(res, err, 'GET /api/admin/scoped/users'); }
});
adminRouter.get('/scoped/reviews', async (req: Request, res: Response) => {
  try {
    const { getScopedAdminReviews } = await import('../services/scopedAdminReviews');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await getScopedAdminReviews(req.user!, String(req.query.seasonId || 'season-2026-27'), req.query.includeArchive === '1'));
  } catch (err: any) { handleFirestoreError(res, err, 'GET /api/admin/scoped/reviews'); }
});

adminRouter.get('/scoped/overview', async (req: Request, res: Response) => {
  try {
    const { getLeagueAdminOverview } = await import('../services/leagueAdminScope');
    res.json(await getLeagueAdminOverview(req.user!, String(req.query.seasonId || 'season-2026-27')));
  } catch (err: any) { handleFirestoreError(res, err, 'GET /api/admin/scoped/overview'); }
});

adminRouter.get('/clubs/admission', async (req: Request, res: Response) => {
  const seasonId = String(req.query.seasonId || 'season-2026-27');
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ admission: await getClubAdmissionStatus(seasonId) });
  } catch (err: any) {
    if (err instanceof ReadModelNotWarmedError) {
      res.setHeader('X-Data-Degraded', 'true');
      res.json({ admission: null, unavailable: true });
      return;
    }
    handleFirestoreError(res, err, 'GET /api/admin/clubs/admission');
  }
});

adminRouter.post('/clubs/admission/advance', async (req: Request, res: Response) => {
  const seasonId = String(req.body?.seasonId || 'season-2026-27');
  const expectedStage = req.body?.expectedStage;
  if (!/^season-[a-z0-9-]+$/.test(seasonId) || !Number.isInteger(expectedStage) || expectedStage < -1 || expectedStage > CLUB_ADMISSION_LEAGUES.length) {
    res.status(400).json({ code: 'INVALID_ADMISSION_STAGE' });
    return;
  }
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ admission: await advanceClubAdmission(seasonId, expectedStage, req.user!.id) });
  } catch (err: any) {
    if (err instanceof ClubAdmissionConflict) {
      res.status(409).json({ code: err.code, message: err.message });
      return;
    }
    handleFirestoreError(res, err, 'POST /api/admin/clubs/admission/advance');
  }
});

const smartNotificationSettingsSchema = z.object({
  seasonId: z.string().min(1).optional(),
  enabled: z.boolean(),
  events: z.object({
    resultVerification: z.boolean(),
    resultConfirmed: z.boolean(),
    resultDisputed: z.boolean(),
    nextOpponent: z.boolean(),
    matchdayOpened: z.boolean(),
    cupProgress: z.boolean(),
    qualification: z.boolean(),
    europeanOutcome: z.boolean(),
  }),
});

adminRouter.get('/telegram/smart-settings', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    const settings = await getSmartNotificationSettings(seasonId);
    res.json({ settings, defaults: DEFAULT_SMART_NOTIFICATION_EVENTS, source: 'redis-or-defaults' });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'SMART_NOTIFICATION_SETTINGS_UNAVAILABLE' });
  }
});

adminRouter.put('/telegram/smart-settings', async (req: Request, res: Response) => {
  const parsed = smartNotificationSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_SMART_NOTIFICATION_SETTINGS', details: parsed.error.flatten() });
    return;
  }
  try {
    const settings = await updateSmartNotificationSettings({
      ...parsed.data,
      updatedBy: req.user!.id,
    });
    res.json({ success: true, settings });
  } catch (err: any) {
    res.status(503).json({ error: err?.message || 'SMART_NOTIFICATION_SETTINGS_SAVE_FAILED' });
  }
});

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

  try {
    const payload = await readSharedAdminData(`efluz:v1:admin:overview:${seasonId}`, async () => {
      if (!firestoreCircuitBreaker.canExecute()) return getFallbackAdminOverview(seasonId);
      const status = getFirebaseStatus();
      const db = getFirestoreDb();
  
      let countsUnavailable = false;
      const count = async (collection: string, query: any) => {
        try {
          const snap = await query.count().get();
          trackFirestoreAggregation(collection, Math.max(1, Math.ceil(snap.data().count / 1000)), 'adminOverview');
          return snap;
        } catch (error) { countsUnavailable = true; firestoreCircuitBreaker.recordFailure(error); return null; }
      };
      // Bounded queries with limits
      const [usersCountSnap, occCountSnap, competitions, disputes, auditLogs, pendingData] = await Promise.all([
        count(COLLECTIONS.USERS, db.collection(COLLECTIONS.USERS)),
        count(COLLECTIONS.CLUB_OCCUPANCIES, db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where('seasonId', '==', seasonId).where('status', '==', 'active')),
        getAllCompetitionsFirestore(seasonId).catch(() => { countsUnavailable = true; return []; }),
        getDisputes('OPEN').catch(() => { countsUnavailable = true; return []; }),
        getAuditLogs(10).catch(() => { countsUnavailable = true; return []; }),
        getPendingResultsFirestore(seasonId).catch(() => { countsUnavailable = true; return { pendingFixtures: [], total: 0 }; }),
      ]);
  
      const registeredUsers = usersCountSnap?.data().count ?? 0;
      const activeOccupancies = occCountSnap?.data().count ?? 0;
  
      const domesticLeagues = competitions.filter((c) => String(c.type) === 'LEAGUE' || String(c.type) === 'league');
      const domesticCups = competitions.filter((c) => String(c.type) === 'DOMESTIC_CUP' || String(c.type) === 'cup');
      const europeanComps = competitions.filter(
        (c) => ['EUROPEAN_LEAGUE_PHASE', 'champions_league', 'europa_league', 'conference_league'].includes(String(c.type))
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
        degraded: countsUnavailable || !firestoreCircuitBreaker.canExecute(),
        stale: countsUnavailable || !firestoreCircuitBreaker.canExecute(),
        generatedAt: new Date().toISOString(),
      };
  
      return payload;
    }, 60);
    res.json(payload);
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    const fallback = getFallbackAdminOverview(seasonId);
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
  idempotencyKey: z.string().optional(),
});

adminRouter.post('/fixtures/:id/result', validateBody(adminEditResultSchema), async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const adminUsername = req.user!.username || 'admin';
  const fixtureId = req.params.id;
  const headerIdempotencyKey = (req.headers['x-idempotency-key'] || req.headers['idempotency-key']) as string | undefined;
  const idempotencyKey = req.body.idempotencyKey || headerIdempotencyKey;

  try {
    const result = await editFixtureResult(adminUserId, adminUsername, fixtureId, {
      ...req.body,
      idempotencyKey,
    });
    // Atomically patch Admin + Match Day Fresh/LKG fixture snapshots. Do not
    // invalidate them again after a successful patch or stale LKG can win.
    await refreshChangedFixtureReadModel(fixtureId);
    res.json(result);
  } catch (err: any) {
    console.error('[ADMIN_RESULT_SAVE_FAILED]', JSON.stringify({ fixtureId, error: err?.message }));
    handleFirestoreError(res, err, `POST /api/admin/fixtures/${fixtureId}/result`);
  }
});

// Admin delete fixture result (reset score and status back to SCHEDULED)
const adminDeleteResultSchema = z.object({
  deleteSubmissions: z.boolean().optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

adminRouter.post('/fixtures/:id/delete-result', validateBody(adminDeleteResultSchema), async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const adminUsername = req.user!.username || 'admin';
  const fixtureId = req.params.id;
  const headerIdempotencyKey = (req.headers['x-idempotency-key'] || req.headers['idempotency-key']) as string | undefined;
  const idempotencyKey = req.body.idempotencyKey || headerIdempotencyKey;

  try {
    const result = await deleteFixtureResult(adminUserId, adminUsername, fixtureId, {
      ...req.body,
      idempotencyKey,
    });
    // Atomically patch Admin + Match Day Fresh/LKG fixture snapshots. Do not
    // invalidate them again after a successful patch or stale LKG can win.
    await refreshChangedFixtureReadModel(fixtureId);
    res.json(result);
  } catch (err: any) {
    console.error('[ADMIN_RESULT_SAVE_FAILED]', JSON.stringify({ fixtureId, error: err?.message, operation: 'ADMIN_DELETE_RESULT' }));
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
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || ''), 10) || 100));

  try {
    const signature = createHash('sha256').update(JSON.stringify([fixtureId || null, userId || null, limit])).digest('hex');
    const payload = await readSharedAdminData('efluz:v1:admin:submissions:' + signature, async () => {
      const submissions = await getResultSubmissions({ fixtureId, userId, limit });
      return { submissions, total: submissions.length, source: 'firestore', degraded: false, stale: false };
    });
    res.json(payload);
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
  adminPermissions: z.object({ scope: z.enum(['ALL', 'LEAGUES']), leagueIds: z.array(z.enum(['league-premier-league', 'league-la-liga', 'league-serie-a', 'league-bundesliga', 'league-ligue-1'])).max(5) }).optional(),
}).refine(value => !value.isAdmin || Boolean(value.adminPermissions && (value.adminPermissions.scope === 'ALL' || value.adminPermissions.leagueIds.length)), { message: 'Admin uchun ruxsat turini va kamida bitta ligani tanlang.' });

adminRouter.post('/users/:id/role', validateBody(adminSetRoleSchema), async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const adminUsername = req.user!.username || 'admin';
  const targetUserId = req.params.id;

  try {
    const result = await setUserAdminRole(adminUserId, adminUsername, targetUserId, req.body.isAdmin, req.body.adminPermissions);
    res.json(result);
  } catch (err: any) {
    if (String(err.message).startsWith('PROTECTION_ERROR:')) {
      res.status(409).json({ error: 'ADMIN_PROTECTION', message: err.message });
      return;
    }
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

adminRouter.get('/read-metrics', async (req: Request, res: Response) => {
  const { getDurableReadCosts } = await import('../services/durableReadCosts');
  let durable;
  try { durable = await getDurableReadCosts(req.query.from as string | undefined, req.query.to as string | undefined); }
  catch { res.status(400).json({ error: 'INVALID_READ_COST_WINDOW', message: '1–24 soatlik, oxirgi 7 kun ichidagi vaqt oralig‘ini yozing.' }); return; }
  res.json({
    metrics: getReadMetrics(),
    durable,
    timestamp: new Date().toISOString(),
  });
});

adminRouter.get('/firestore-diagnostics', async (req: Request, res: Response) => {
  const { getDurableReadCosts } = await import('../services/durableReadCosts');
  const send = async (payload: any) => res.json({ ...payload, durableReadCosts: await getDurableReadCosts() });
  const isRefresh = req.query.refresh === 'true';
  const cacheKey = 'firestore:admin_diagnostics';
  const cached = getFromCache<any>(cacheKey);

  if (!isRefresh && cached) {
    await send(cached);
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
    await send(fallbackResult);
    return;
  }

  try {
    const status = getFirebaseStatus();
    const db = getFirestoreDb();
    const countCollection = async (collection: string) => {
      const value = await db.collection(collection).count().get().catch(() => null);
      if (value) trackFirestoreAggregation(collection, Math.max(1, Math.ceil(value.data().count / 1000)), 'firestoreDiagnostics');
      return value;
    };

    // Count aggregations avoid downloading documents; track the billed read units.
    const [usersCount, clubsCount, occCount, memCount, fixCount, compCount] = await Promise.all([
      countCollection(COLLECTIONS.USERS),
      countCollection(COLLECTIONS.CLUBS),
      countCollection(COLLECTIONS.CLUB_OCCUPANCIES),
      countCollection(COLLECTIONS.USER_MEMBERSHIPS),
      countCollection(COLLECTIONS.FIXTURES),
      countCollection(COLLECTIONS.COMPETITIONS),
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
    await send(result);
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    const usersCount = queryGet<{ count: number }>('SELECT COUNT(*) as count FROM users')?.count || 0;
    const clubsCount = queryGet<{ count: number }>('SELECT COUNT(*) as count FROM clubs')?.count || 96;
    const occCount = queryGet<{ count: number }>("SELECT COUNT(*) as count FROM club_memberships WHERE status = 'active'")?.count || 0;
    const fixCount = queryGet<{ count: number }>('SELECT COUNT(*) as count FROM fixtures')?.count || 0;
    const compCount = queryGet<{ count: number }>('SELECT COUNT(*) as count FROM competitions')?.count || 0;

    res.status(200);
    await send({
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

adminRouter.post('/fixtures/restore-missing-pairs', async (req: Request, res: Response) => {
  try {
    const { restoreMissingLeaguePairs } = await import('../services/missingLeaguePairRepair');
    res.json(await restoreMissingLeaguePairs(req.user!.id));
  } catch (err: any) { handleFirestoreError(res, err, 'POST /api/admin/fixtures/restore-missing-pairs'); }
});

adminRouter.get('/users/directory', async (_req: Request, res: Response) => {
  try { res.json({ users: await getAdminUserDirectory() }); }
  catch (err: any) { handleFirestoreError(res, err, 'GET /api/admin/users/directory'); }
});

adminRouter.get('/users', async (req: Request, res: Response) => {
  const page = req.query.page ? Math.max(1, parseInt(req.query.page as string, 10)) : 1;
  const limit = req.query.limit ? Math.min(Math.max(1, parseInt(req.query.limit as string, 10)), 100) : 100;
  const cursor = (req.query.cursor as string) || undefined;
  const role = (req.query.role as string) || 'ALL';
  const status = (req.query.status as string) || 'ALL';
  const search = (req.query.search as string) || '';

  try {
    const { getAdminUsersPagedFirestore } = await import('../firebase/firestoreStore');
    const result = await getAdminUsersPagedFirestore({
      page,
      limit,
      cursor,
      role,
      status,
      search,
    });
    res.json(result);
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    const rows = queryAll<any>('SELECT * FROM users ORDER BY created_at DESC LIMIT ?', [limit]);
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
      total: rows.length,
      page,
      limit,
      hasMore: false,
      source: 'sqlite_fallback',
      degraded: true,
      stale: true,
    });
  }
});

adminRouter.get('/disputes', async (req: Request, res: Response) => {
  const status = (req.query.status as string) || 'OPEN';
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || ''), 10) || 50));

  if (!firestoreCircuitBreaker.canExecute()) {
    const disputes = getLocalDisputes(status, limit);
    res.json({ disputes, source: 'sqlite', degraded: true, stale: true });
    return;
  }

  try {
    const payload = await readSharedAdminData(`efluz:v1:admin:disputes:${status}:${limit}`, async () => {
      const disputes = await getDisputes(status, limit);
      const degraded = !firestoreCircuitBreaker.canExecute();
      return { disputes, source: degraded ? 'sqlite' : 'firestore', degraded, stale: degraded };
    });
    res.json(payload);
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
      fixture: result.fixture,
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
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || ''), 10) || 50));

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
    const payload = await readSharedAdminData(`efluz:v1:admin:audit:${limit}`, async () => ({ logs: await getAuditLogs(limit), source: 'firestore', degraded: false, stale: false }));
    res.json(payload);
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
  const expectedOwnerUserId = req.body.expectedOwnerUserId;
  if (expectedOwnerUserId !== undefined && (typeof expectedOwnerUserId !== 'string' || !/^user-\d+$/.test(expectedOwnerUserId))) {
    res.status(400).json({ error: 'INVALID_EXPECTED_OWNER' }); return;
  }

  try {
    const result = await adminReleaseClubFirestore(adminUserId, clubId, seasonId, { expectedOwnerUserId });
    await invalidateClubReadModels(seasonId).catch(() => {});
    res.json(result);
  } catch (err: any) {
    if (err.code === 'CLUB_CONFLICT') {
      res.status(409).json({ error: err.code, message: err.message }); return;
    }
    handleFirestoreError(res, err, `POST /api/admin/clubs/${clubId}/release`);
  }
});

adminRouter.post('/clubs/:id/assign', async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const clubId = req.params.id;
  const { targetUserId: targetReference, seasonId = 'season-2026-27' } = req.body;

  if (typeof targetReference !== 'string' || !targetReference.trim()) {
    res.status(400).json({ error: 'targetUserId is required', code: 'BAD_REQUEST', message: 'targetUserId is required' });
    return;
  }

  try {
    const targetUserId = await resolveAdminUserReference(targetReference);
    const result = await adminAssignClubFirestore(adminUserId, clubId, targetUserId, seasonId);
    await invalidateClubReadModels(seasonId).catch(() => {});
    await invalidateUserMembershipReadModel(targetUserId, seasonId).catch(() => {});
    res.json(result);
  } catch (err: any) {
    if (['USER_NOT_FOUND', 'AMBIGUOUS_USER_REFERENCE'].includes(err.message)) {
      res.status(err.message === 'USER_NOT_FOUND' ? 404 : 409).json({ error: err.message, message: err.message === 'USER_NOT_FOUND' ? 'Foydalanuvchi topilmadi' : 'Username bir nechta foydalanuvchiga mos keldi. ID orqali tanlang.' });
      return;
    }
    handleFirestoreError(res, err, `POST /api/admin/clubs/${clubId}/assign`);
  }
});

// Results & Pending Workflow Endpoints
adminRouter.get('/results/pending', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || ''), 10) || 50));

  if (!firestoreCircuitBreaker.canExecute()) {
    const result = getLocalPendingResults(seasonId, limit);
    res.json({ ...result, source: 'sqlite', degraded: true, stale: true });
    return;
  }

  try {
    const payload = await readSharedAdminData(`efluz:v1:admin:pending:${seasonId}`, async () => {
      const result = await getPendingResultsFirestore(seasonId);
      const degraded = !firestoreCircuitBreaker.canExecute();
      return { ...result, source: degraded ? 'sqlite' : 'firestore', degraded, stale: degraded };
    });
    res.json(payload);
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
    await refreshChangedFixtureReadModel(fixtureId).catch(() => invalidateFixtureReadModels(compId, 'season-2026-27')).catch(() => {});
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
    await refreshChangedFixtureReadModel(fixtureId).catch(() => invalidateFixtureReadModels('', 'season-2026-27')).catch(() => {});
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
adminRouter.get('/competitions/:id/matchday/control', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const { getCompetitionMatchdayControl } = await import('../services/competitionMatchdayService');
    res.json(await getCompetitionMatchdayControl(req.params.id));
  } catch (err: any) { res.status(err.statusCode || 503).json({ code: err.code || 'MATCHDAY_UNAVAILABLE', message: err.message }); }
});
adminRouter.post('/competitions/:id/matchday/control', async (req: Request, res: Response) => {
  try {
    const { controlCompetitionMatchday } = await import('../services/competitionMatchdayService');
    const { action, matchday, durationHours, expectedUpdatedAt } = req.body;
    const result = await controlCompetitionMatchday(req.params.id, { action, matchday, durationHours, expectedUpdatedAt, adminUserId: req.user!.id });
    let smartNotificationsQueued = 0;
    if (action === 'SELECT' || action === 'OPEN' || action === 'RESTART') {
      try {
        const doc = await getFirestoreDb().collection(COLLECTIONS.COMPETITIONS).doc(req.params.id).get();
        smartNotificationsQueued = await notifySmartMatchdayOpened({ competitionId: req.params.id, seasonId: doc.data()?.seasonId || 'season-2026-27', matchday, deadlineAt: result.nextMatchdayOpenAt });
      } catch (error: any) { console.warn('[SMART_NOTIFY] Matchday control notification failed:', error?.message || error); }
    }
    res.json({ ...result, smartNotificationsQueued });
  } catch (err: any) { res.status(err.statusCode || 503).json({ code: err.code || 'MATCHDAY_UNAVAILABLE', message: err.message, blockers: err.blockers || [] }); }
});
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
    let smartNotificationsQueued = 0;
    if (overrideStatus === 'FORCE_OPEN') {
      try {
        const resolvedMatchday = Number((result as any)?.matchday ?? matchday ?? (result as any)?.currentMatchday ?? 0);
        if (resolvedMatchday > 0) {
          smartNotificationsQueued = await notifySmartMatchdayOpened({
            competitionId,
            seasonId: typeof seasonId === 'string' ? seasonId : 'season-2026-27',
            matchday: resolvedMatchday,
            deadlineAt: (result as any)?.nextMatchdayOpenAt || null,
          });
        }
      } catch (notificationError: any) {
        console.warn('[SMART_NOTIFY] FORCE_OPEN notification failed:', notificationError?.message || notificationError);
      }
    }
    res.json({ ...result, smartNotificationsQueued });
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/competitions/${competitionId}/matchday/override`);
  }
});

adminRouter.post('/competitions/:id/matchday/advance', async (req: Request, res: Response) => {
  const competitionId = req.params.id;
  const { durationHours, seasonId } = req.body;

  try {
    const result = await advanceCompetitionMatchdayFirestore(competitionId, { durationHours, seasonId });
    let smartNotificationsQueued = 0;
    try {
      const resolvedMatchday = Number((result as any)?.currentMatchday || 0);
      if (resolvedMatchday > 0) {
        smartNotificationsQueued = await notifySmartMatchdayOpened({
          competitionId,
          seasonId: typeof seasonId === 'string' ? seasonId : 'season-2026-27',
          matchday: resolvedMatchday,
          deadlineAt: (result as any)?.nextMatchdayOpenAt || null,
        });
      }
    } catch (notificationError: any) {
      console.warn('[SMART_NOTIFY] Matchday advance notification failed:', notificationError?.message || notificationError);
    }
    res.json({ ...result, smartNotificationsQueued });
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
    let smartNotificationsQueued = 0;
    try {
      smartNotificationsQueued = await notifySmartMatchdayOpened({
        competitionId,
        seasonId: typeof seasonId === 'string' ? seasonId : 'season-2026-27',
        matchday: Number(result.matchday),
        deadlineAt: result.nextMatchdayOpenAt || null,
      });
    } catch (notificationError: any) {
      console.warn('[SMART_NOTIFY] Matchday open notification failed:', notificationError?.message || notificationError);
    }
    res.json({ ...result, smartNotificationsQueued });
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

adminRouter.post('/competitions/:id/matchday/remind', async (req: Request, res: Response) => {
  const competitionId = req.params.id;
  const seasonId = typeof req.body?.seasonId === 'string' ? req.body.seasonId : 'season-2026-27';
  const matchday = Number(req.body?.matchday || 0);
  const deadlineAt = typeof req.body?.deadlineAt === 'string' ? req.body.deadlineAt : null;
  if (!Number.isInteger(matchday) || matchday <= 0) {
    res.status(400).json({ error: 'A positive integer matchday is required.', code: 'BAD_REQUEST' });
    return;
  }
  try {
    const result = await notifyOutstandingMatchdayOwners({ competitionId, seasonId, matchday, deadlineAt });
    res.json({ success: true, ...result });
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/competitions/${competitionId}/matchday/remind`);
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
    const allowedCupIds = new Set(permittedAdminLeagues(req.user!).map(league => league.cupCompetitionId));
    const cups = Object.values(DOMESTIC_CUPS).filter(cup => !isLeagueAdmin(req.user!) || allowedCupIds.has(cup.id));
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
    const statusCode = err.statusCode || err.status || 400;
    res.status(statusCode).json({
      error: err.message,
      code: err.code || (statusCode === 409 ? 'CONFLICT' : 'BAD_REQUEST'),
    });
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
    await refreshRecipientDirectoryIfStale(seasonId);
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

adminRouter.post('/telegram-notifications/recipients/refresh', async (req: Request, res: Response) => {
  try { res.json({ count: await syncRecipientDirectory(req.body.seasonId || 'season-2026-27') }); }
  catch { res.status(503).json({ error: 'RECIPIENT_DIRECTORY_UNAVAILABLE' }); }
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
    await refreshRecipientDirectoryIfStale(seasonId || 'season-2026-27');
    const record = await enqueueTelegramBroadcast({
      adminUserId,
      adminUsername,
      title,
      body,
      type: type || 'CUSTOM_ALERT',
      targetAudience: targetAudience || 'SELECTED_RECIPIENTS',
      targetLeagueId,
      selectedUserIds,
      seasonId,
      requestId: req.body.requestId,
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

adminRouter.post('/telegram-notifications/broadcasts/:broadcastId/retry-failed', async (req: Request, res: Response) => {
  try {
    const result = await retryFailedBroadcastRecipients(
      req.params.broadcastId,
      typeof req.body?.userId === 'string' ? req.body.userId : undefined
    );
    res.json({ success: true, ...result });
  } catch (err: any) {
    const status = ['BROADCAST_NOT_FOUND', 'FAILED_RECIPIENT_NOT_FOUND'].includes(err?.message) ? 404 : 500;
    res.status(status).json({ error: err?.message || 'RETRY_FAILED' });
  }
});

adminRouter.get('/telegram-notifications/broadcasts', async (req: Request, res: Response) => {
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || ''), 10) || 20));
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
    const result = await processNotificationQueue(25);
    scheduleNotificationQueueDrain();
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
