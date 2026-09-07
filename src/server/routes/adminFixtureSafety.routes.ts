import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import { queryGet } from '../db';
import { generateCompetitionFixturesFirestore } from '../firebase/firestoreStore';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';

/**
 * Production safety gate for admin fixture generation.
 * Existing fixture IDs are immutable; reset/regenerate endpoints cannot delete
 * or recreate an existing schedule.
 */
export const adminFixtureSafetyRouter = Router();
adminFixtureSafetyRouter.use(requireAdmin);

adminFixtureSafetyRouter.post('/fixtures/generate', async (req: Request, res: Response) => {
  const competitionId = req.body?.competitionId as string | undefined;
  if (!competitionId) {
    res.status(400).json({ error: 'competitionId is required', code: 'BAD_REQUEST' });
    return;
  }

  const existingCount = Number(queryGet<any>(
    'SELECT COUNT(*) AS count FROM fixtures WHERE competition_id = ?',
    [competitionId]
  )?.count ?? 0);

  if (existingCount > 0) {
    res.status(409).json({
      error: 'Fixtures already exist; production fixture generation will not replace them.',
      code: 'FIXTURES_ALREADY_EXIST',
      competitionId,
      existingFixtures: existingCount,
    });
    return;
  }

  try {
    const result = await generateCompetitionFixturesFirestore(competitionId, { force: false });
    res.json({
      success: true,
      competitionId,
      fixturesGenerated: result.generated,
      matchdays: result.matchdays,
      message: `Generated ${result.generated} fixtures across ${result.matchdays} matchdays without destructive replacement.`,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/admin/fixtures/generate`);
  }
});

adminFixtureSafetyRouter.post('/fixtures/reset', async (req: Request, res: Response) => {
  const competitionId = req.body?.competitionId as string | undefined;
  const existingCount = competitionId
    ? Number(queryGet<any>('SELECT COUNT(*) AS count FROM fixtures WHERE competition_id = ?', [competitionId])?.count ?? 0)
    : 0;

  res.status(409).json({
    error: 'Destructive fixture reset is permanently disabled in production.',
    code: 'NON_DESTRUCTIVE_FIXTURE_POLICY',
    competitionId,
    existingFixtures: existingCount,
  });
});
