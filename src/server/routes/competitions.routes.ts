import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import {
  getAllCompetitionsFirestore,
  getCompetitionByIdFirestore,
  getCompetitionParticipantsFirestore,
  calculateCompetitionStandingsFirestore,
  rebuildCompetitionStandingsFirestore,
  getFixturesFirestore,
  generateCompetitionFixturesFirestore,
  getCompetitionMatchdayLocksFirestore,
} from '../firebase/firestoreStore';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';
import {
  getCompetitionsFromReadModel,
  getCompetitionStandingsFromReadModel,
  getCompetitionFixturesFromReadModel,
} from '../readModel/readModelStore';

export const competitionsRouter = Router();

competitionsRouter.get('/', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    const result = await getCompetitionsFromReadModel(seasonId);
    res.json({
      competitions: result.competitions,
      source: result.source,
      stale: result.stale,
      degraded: result.degraded,
      snapshotAt: result.snapshotAt,
    });
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
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    const result = await getCompetitionStandingsFromReadModel(req.params.id, seasonId);
    res.json({
      standings: result.standings,
      source: result.source,
      stale: result.stale,
      degraded: result.degraded,
      snapshotAt: result.snapshotAt,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, `GET /api/competitions/${req.params.id}/standings`);
  }
});

competitionsRouter.get('/:id/fixtures', async (req: Request, res: Response) => {
  const matchday = req.query.matchday ? parseInt(req.query.matchday as string, 10) : undefined;
  const status = req.query.status as string | undefined;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';

  try {
    const result = await getCompetitionFixturesFromReadModel(req.params.id, {
      matchday,
      status,
      seasonId,
    });
    res.json({
      fixtures: result.fixtures,
      source: result.source,
      stale: result.stale,
      degraded: result.degraded,
      snapshotAt: result.snapshotAt,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, `GET /api/competitions/${req.params.id}/fixtures`);
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
    handleFirestoreError(res, err, `POST /api/competitions/${req.params.id}/generate-fixtures`);
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
    handleFirestoreError(res, err, `POST /api/competitions/${req.params.id}/reset-fixtures`);
  }
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

competitionsRouter.get('/:id/locks', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    const locks = await getCompetitionMatchdayLocksFirestore(seasonId, req.params.id);
    res.json({ locks });
  } catch (err: any) {
    handleFirestoreError(res, err, `GET /api/competitions/${req.params.id}/locks`);
  }
});
