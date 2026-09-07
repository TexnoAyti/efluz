import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import { queryGet } from '../db';
import {
  getAllCompetitionsFirestore,
  getCompetitionByIdFirestore,
  getCompetitionParticipantsFirestore,
  rebuildCompetitionStandingsFirestore,
  getFixturesFirestore,
  generateCompetitionFixturesFirestore,
} from '../firebase/firestoreStore';
import { getResilientCompetitionStandings } from '../services/standingsReadService';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';
import { assertNonDestructiveFixtureGeneration } from '../firebase/fixtureGenerationSafety';

export const competitionsRouter = Router();

competitionsRouter.get('/', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    const competitions = await getAllCompetitionsFirestore(seasonId);
    res.json({ competitions });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/competitions');
  }
});

competitionsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const competition = await getCompetitionByIdFirestore(req.params.id);
    if (!competition) {
      res.status(404).json({ error: 'Competition not found', code: 'NOT_FOUND', message: `Competition '${req.params.id}' not found` });
      return;
    }
    res.json({ competition });
  } catch (err: any) {
    handleFirestoreError(res, err, `GET /api/competitions/${req.params.id}`);
  }
});

competitionsRouter.get('/:id/participants', async (req: Request, res: Response) => {
  try {
    const participants = await getCompetitionParticipantsFirestore(req.params.id);
    res.json({ participants });
  } catch (err: any) {
    handleFirestoreError(res, err, `GET /api/competitions/${req.params.id}/participants`);
  }
});

competitionsRouter.get('/:id/standings', async (req: Request, res: Response) => {
  try {
    const standings = await getResilientCompetitionStandings(req.params.id);
    res.json({ standings });
  } catch (err: any) {
    handleFirestoreError(res, err, `GET /api/competitions/${req.params.id}/standings`);
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
    handleFirestoreError(res, err, `GET /api/competitions/${req.params.id}/fixtures`);
  }
});

competitionsRouter.post('/:id/generate-fixtures', requireAdmin, async (req: Request, res: Response) => {
  const competitionId = req.params.id;
  assertNonDestructiveFixtureGeneration({ force: req.body?.force });
  const existingCount = Number(queryGet<any>('SELECT COUNT(*) AS count FROM fixtures WHERE competition_id = ?', [competitionId])?.count ?? 0);
  if (existingCount > 0) {
    res.status(409).json({
      error: 'Fixtures already exist; generation is non-destructive and will not replace them.',
      code: 'FIXTURES_ALREADY_EXIST',
      competitionId,
      existingFixtures: existingCount,
    });
    return;
  }

  try {
    // Force is deliberately ignored for first-time generation: there is nothing to reset.
    const result = await generateCompetitionFixturesFirestore(competitionId, { force: false });
    res.json({
      success: true,
      competitionId,
      fixturesGenerated: result.generated,
      matchdays: result.matchdays,
      message: `Persisted ${result.generated} fixtures in Firestore successfully across ${result.matchdays} matchdays.`,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/competitions/${competitionId}/generate-fixtures`);
  }
});

competitionsRouter.post('/:id/reset-fixtures', requireAdmin, async (req: Request, res: Response) => {
  const competitionId = req.params.id;
  const existingCount = Number(queryGet<any>('SELECT COUNT(*) AS count FROM fixtures WHERE competition_id = ?', [competitionId])?.count ?? 0);

  res.status(409).json({
    error: 'Destructive fixture reset is disabled in production.',
    code: 'NON_DESTRUCTIVE_FIXTURE_POLICY',
    competitionId,
    existingFixtures: existingCount,
    message: existingCount > 0
      ? 'Existing fixture IDs, results, and history are protected. Use targeted admin corrections instead of regeneration.'
      : 'No destructive reset is permitted; first-time generation should use /generate-fixtures.',
  });
});

competitionsRouter.post('/:id/rebuild-standings', requireAdmin, async (req: Request, res: Response) => {
  try {
    const standings = await rebuildCompetitionStandingsFirestore(req.params.id);
    res.json({
      success: true,
      competitionId: req.params.id,
      standings,
      totalClubs: standings.length,
      message: `Rebuilt and persisted materialized standings for competition '${req.params.id}' successfully.`,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/competitions/${req.params.id}/rebuild-standings`);
  }
});
