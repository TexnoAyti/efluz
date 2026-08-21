import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import {
  getAllCompetitionsFirestore,
  getCompetitionByIdFirestore,
  calculateCompetitionStandingsFirestore,
  getFixturesFirestore,
  generateCompetitionFixturesFirestore,
} from '../firebase/firestoreStore';

export const competitionsRouter = Router();

competitionsRouter.get('/', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    const competitions = await getAllCompetitionsFirestore(seasonId);
    res.json({ competitions });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch competitions', message: err.message });
  }
});

competitionsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const competition = await getCompetitionByIdFirestore(req.params.id);
    if (!competition) {
      res.status(404).json({ error: 'Competition not found' });
      return;
    }
    res.json({ competition });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch competition', message: err.message });
  }
});

competitionsRouter.get('/:id/standings', async (req: Request, res: Response) => {
  try {
    const standings = await calculateCompetitionStandingsFirestore(req.params.id);
    res.json({ standings });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to calculate standings', message: err.message });
  }
});

competitionsRouter.get('/:id/fixtures', async (req: Request, res: Response) => {
  const matchday = req.query.matchday ? parseInt(req.query.matchday as string, 10) : undefined;
  const status = req.query.status as string | undefined;

  try {
    const fixtures = await getFixturesFirestore({
      competitionId: req.params.id,
      matchday,
      status,
    });
    res.json({ fixtures });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch fixtures', message: err.message });
  }
});

competitionsRouter.post('/:id/generate-fixtures', requireAdmin, async (req: Request, res: Response) => {
  try {
    const force = req.body?.force !== undefined ? Boolean(req.body.force) : true;
    const result = await generateCompetitionFixturesFirestore(req.params.id, { force });

    res.json({
      success: true,
      competitionId: req.params.id,
      fixturesGenerated: result.generated,
      matchdays: result.matchdays,
      message: `Persisted ${result.generated} fixtures in Firestore successfully across ${result.matchdays} matchdays.`,
    });
  } catch (err: any) {
    console.error('Fixture generation error:', err);
    res.status(500).json({
      error: 'FIXTURE_PERSISTENCE_FAILED',
      message: err.message || 'Failed to generate and persist fixtures in Firestore.',
    });
  }
});

competitionsRouter.post('/:id/reset-fixtures', requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await generateCompetitionFixturesFirestore(req.params.id, { force: true });
    res.json({
      success: true,
      competitionId: req.params.id,
      fixturesGenerated: result.generated,
      matchdays: result.matchdays,
      message: `Reset and persisted ${result.generated} fixtures in Firestore.`,
    });
  } catch (err: any) {
    res.status(500).json({
      error: 'FIXTURE_PERSISTENCE_FAILED',
      message: err.message || 'Failed to reset fixtures in Firestore.',
    });
  }
});
