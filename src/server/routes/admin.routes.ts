import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { getDisputes, resolveDispute, reopenFixture, getAllAdminUsers, getAuditLogs } from '../services/adminService';
import {
  generateCompetitionFixturesFirestore,
  reopenFixtureFirestore,
  resolveDisputeFirestore,
} from '../firebase/firestoreStore';
import { migrateSqliteToFirestore } from '../firebase/migrateSqliteToFirestore';
import { generateKnockoutBracket } from '../tournament/knockoutEngine';
import { evaluateSeasonQualifications } from '../tournament/qualificationEngine';
import { queryAll } from '../db';

export const adminRouter = Router();

// Protect ALL admin routes with server-side requireAdmin
adminRouter.use(requireAdmin);

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
    res.status(500).json({ error: 'Migration failed', message: err.message });
  }
});

adminRouter.get('/users', async (req: Request, res: Response) => {
  try {
    const users = await getAllAdminUsers();
    res.json({ users });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch users', message: err.message });
  }
});

adminRouter.get('/disputes', async (req: Request, res: Response) => {
  const status = (req.query.status as string) || 'OPEN';
  try {
    const disputes = await getDisputes(status);
    res.json({ disputes });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch disputes', message: err.message });
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
    res.status(400).json({ error: 'Failed to resolve dispute', message: err.message });
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
    res.status(400).json({ error: 'Failed to reopen fixture', message: err.message });
  }
});

adminRouter.get('/audit-logs', async (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  try {
    const logs = await getAuditLogs(limit);
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch audit logs', message: err.message });
  }
});

adminRouter.post('/fixtures/generate', async (req: Request, res: Response) => {
  const { competitionId, force } = req.body;
  if (!competitionId) {
    res.status(400).json({ error: 'competitionId is required' });
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
    res.status(500).json({ error: 'FIXTURE_PERSISTENCE_FAILED', message: err.message });
  }
});

adminRouter.post('/knockouts/generate', (req: Request, res: Response) => {
  const { competitionId } = req.body;
  if (!competitionId) {
    res.status(400).json({ error: 'competitionId is required' });
    return;
  }

  try {
    const result = generateKnockoutBracket(competitionId);
    res.json({
      success: true,
      message: `Generated ${result.generated} knockout matches across ${result.rounds} rounds.`,
      result,
    });
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to generate knockout bracket', message: err.message });
  }
});

adminRouter.post('/qualifications/evaluate', (req: Request, res: Response) => {
  const seasonId = req.body.seasonId || 'season-2026-27';

  try {
    const result = evaluateSeasonQualifications(seasonId);
    res.json({
      success: true,
      message: `Evaluated European qualifications: ${result.qualifications.length} spots assigned, ${result.participantsAdded} participants registered.`,
      result,
    });
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to evaluate qualifications', message: err.message });
  }
});

adminRouter.post('/fixtures/reset', async (req: Request, res: Response) => {
  const { competitionId } = req.body;
  if (!competitionId) {
    res.status(400).json({ error: 'competitionId is required' });
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
    res.status(500).json({ error: 'FIXTURE_PERSISTENCE_FAILED', message: err.message });
  }
});
