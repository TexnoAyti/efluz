import { Router, Request, Response, NextFunction } from 'express';
import {
  getAllLeaguesFirestore,
  getAllCompetitionsFirestore,
  getCompetitionByIdFirestore,
  calculateCompetitionStandingsFirestore,
  getFixturesFirestore,
} from '../firebase/firestoreStore';
import { ReadModelNotWarmedError } from '../readModel/readModelStore';
import {
  filterTombstonedFixtures,
  rebuildStandingsSnapshotFromFixtures,
} from '../services/fixtureTombstoneService';

export const readOptimizedRouter = Router();

readOptimizedRouter.get('/leagues', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const leagues = await getAllLeaguesFirestore();
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.json({ leagues });
  } catch (err: any) {
    if (err instanceof ReadModelNotWarmedError || err?.errorCode === 'READ_MODEL_NOT_WARMED') {
      res.status(503).json({ errorCode: 'READ_MODEL_NOT_WARMED', message: 'Read model is not warmed and database is unreachable' });
      return;
    }
    next(err);
  }
});

readOptimizedRouter.get('/competitions', async (req: Request, res: Response, next: NextFunction) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    const competitions = await getAllCompetitionsFirestore(seasonId);
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.json({ competitions });
  } catch (err: any) {
    if (err instanceof ReadModelNotWarmedError || err?.errorCode === 'READ_MODEL_NOT_WARMED') {
      res.status(503).json({ errorCode: 'READ_MODEL_NOT_WARMED', message: 'Read model is not warmed and database is unreachable' });
      return;
    }
    next(err);
  }
});

readOptimizedRouter.get('/competitions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const competition = await getCompetitionByIdFirestore(req.params.id);
    if (!competition) return next();
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=300');
    res.json({ competition });
  } catch (err: any) {
    if (err instanceof ReadModelNotWarmedError || err?.errorCode === 'READ_MODEL_NOT_WARMED') {
      res.status(503).json({ errorCode: 'READ_MODEL_NOT_WARMED', message: 'Read model is not warmed and database is unreachable' });
      return;
    }
    next(err);
  }
});

readOptimizedRouter.get('/competitions/:id/standings', async (req: Request, res: Response, next: NextFunction) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    const [cachedStandings, rawFixtures] = await Promise.all([
      calculateCompetitionStandingsFirestore(req.params.id),
      getFixturesFirestore({ competitionId: req.params.id }),
    ]);
    const fixtures = await filterTombstonedFixtures(rawFixtures, seasonId);
    const recomputed = await rebuildStandingsSnapshotFromFixtures(req.params.id, seasonId, fixtures).catch(() => null);
    const standings = recomputed || cachedStandings;
    res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=10, stale-while-revalidate=15');
    res.json({ standings, fixtureTruthCount: fixtures.length });
  } catch (err: any) {
    if (err instanceof ReadModelNotWarmedError || err?.errorCode === 'READ_MODEL_NOT_WARMED') {
      res.status(503).json({ errorCode: 'READ_MODEL_NOT_WARMED', message: 'Read model is not warmed and database is unreachable' });
      return;
    }
    next(err);
  }
});

readOptimizedRouter.get('/competitions/:id/fixtures', async (req: Request, res: Response, next: NextFunction) => {
  const matchday = req.query.matchday ? parseInt(req.query.matchday as string, 10) : undefined;
  const status = req.query.status as string | undefined;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    const rawFixtures = await getFixturesFirestore({ competitionId: req.params.id, matchday, status });
    const fixtures = await filterTombstonedFixtures(rawFixtures, seasonId);
    res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=10, stale-while-revalidate=15');
    res.json({ fixtures });
  } catch (err: any) {
    if (err instanceof ReadModelNotWarmedError || err?.errorCode === 'READ_MODEL_NOT_WARMED') {
      res.status(503).json({ errorCode: 'READ_MODEL_NOT_WARMED', message: 'Read model is not warmed and database is unreachable' });
      return;
    }
    next(err);
  }
});
