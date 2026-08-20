import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { getDisputes, resolveDispute, reopenFixture, getAllAdminUsers, getAuditLogs } from '../services/adminService';
import { generateCompetitionFixtures, resetCompetitionFixtures } from '../services/fixtureService';
import { generateKnockoutBracket } from '../tournament/knockoutEngine';
import { evaluateSeasonQualifications } from '../tournament/qualificationEngine';
import { CompetitionEngine } from '../tournament/competitionEngine';
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

adminRouter.get('/users', (req: Request, res: Response) => {
  const users = getAllAdminUsers();
  res.json({ users });
});

adminRouter.get('/disputes', (req: Request, res: Response) => {
  const status = (req.query.status as string) || 'OPEN';
  const disputes = getDisputes(status);
  res.json({ disputes });
});

adminRouter.post('/disputes/:id/resolve', validateBody(resolveDisputeSchema), (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const disputeId = req.params.id;

  try {
    const result = resolveDispute(adminUserId, disputeId, req.body);
    res.json({
      success: true,
      message: 'Dispute resolved successfully.',
      dispute: result.dispute,
    });
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to resolve dispute', message: err.message });
  }
});

adminRouter.post('/fixtures/:id/reopen', validateBody(reopenFixtureSchema), (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const fixtureId = req.params.id;

  try {
    const result = reopenFixture(adminUserId, fixtureId, req.body.notes);
    res.json({
      success: true,
      message: 'Fixture has been reopened for submissions.',
      result,
    });
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to reopen fixture', message: err.message });
  }
});

adminRouter.get('/audit-logs', (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
  const logs = getAuditLogs(limit);
  res.json({ logs });
});

adminRouter.post('/fixtures/generate', (req: Request, res: Response) => {
  const { competitionId } = req.body;
  if (!competitionId) {
    res.status(400).json({ error: 'competitionId is required' });
    return;
  }

  try {
    const result = CompetitionEngine.generateSchedule(competitionId);
    res.json({
      success: true,
      message: `Generated competition schedule.`,
      result,
    });
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to generate schedule', message: err.message });
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

adminRouter.post('/fixtures/reset', (req: Request, res: Response) => {
  const { competitionId } = req.body;
  if (!competitionId) {
    res.status(400).json({ error: 'competitionId is required' });
    return;
  }

  try {
    const result = resetCompetitionFixtures(competitionId);
    res.json({
      success: true,
      message: `Reset and regenerated schedule for competition '${competitionId}'.`,
      result,
    });
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to reset schedule', message: err.message });
  }
});

adminRouter.post('/fixtures/regenerate-domestic', (req: Request, res: Response) => {
  const seasonId = req.body.seasonId || 'season-2026-27';
  try {
    const domesticComps = queryAll<{ id: string; name: string }>(
      'SELECT id, name FROM competitions WHERE season_id = ? AND type = "LEAGUE"',
      [seasonId]
    );

    const results = [];
    for (const comp of domesticComps) {
      const resData = resetCompetitionFixtures(comp.id);
      results.push({ competitionId: comp.id, name: comp.name, ...resData });
    }

    res.json({
      success: true,
      message: `Regenerated domestic league fixtures for season '${seasonId}'.`,
      results,
    });
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to regenerate domestic fixtures', message: err.message });
  }
});

