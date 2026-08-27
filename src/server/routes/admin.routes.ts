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
} from '../firebase/firestoreStore';
import { migrateSqliteToFirestore } from '../firebase/migrateSqliteToFirestore';
import { generateKnockoutBracket } from '../tournament/knockoutEngine';
import { evaluateSeasonQualifications } from '../tournament/qualificationEngine';
import { getFirebaseStatus, getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';

export const adminRouter = Router();

// Protect ALL admin routes with server-side requireAdmin
adminRouter.use(requireAdmin);

adminRouter.get('/firestore-diagnostics', async (req: Request, res: Response) => {
  try {
    const status = getFirebaseStatus();
    const db = getFirestoreDb();

    const [usersSnap, clubsSnap, occSnap, memSnap, fixSnap, compSnap] = await Promise.all([
      db.collection(COLLECTIONS.USERS).get(),
      db.collection(COLLECTIONS.CLUBS).get(),
      db.collection(COLLECTIONS.CLUB_OCCUPANCIES).get(),
      db.collection(COLLECTIONS.USER_MEMBERSHIPS).get(),
      db.collection(COLLECTIONS.FIXTURES).get(),
      db.collection(COLLECTIONS.COMPETITIONS).get(),
    ]);

    res.json({
      projectId: status.projectId,
      databaseId: status.databaseId,
      connected: true,
      authMode: status.authMode,
      collections: {
        users: usersSnap.size,
        clubs: clubsSnap.size,
        club_occupancies: occSnap.size,
        user_memberships: memSnap.size,
        fixtures: fixSnap.size,
        competitions: compSnap.size,
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
