import { Router, Request, Response, NextFunction } from 'express';
import {
  getAllLeaguesFirestore,
  getAllCompetitionsFirestore,
  getCompetitionByIdFirestore,
  calculateCompetitionStandingsFirestore,
  getFixturesFirestore,
} from '../firebase/firestoreStore';

export const readOptimizedRouter = Router();

// GET /api/leagues
readOptimizedRouter.get('/leagues', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const leagues = await getAllLeaguesFirestore();
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.json({ leagues });
  } catch (err: any) {
    next(err);
  }
});

// GET /api/competitions
readOptimizedRouter.get('/competitions', async (req: Request, res: Response, next: NextFunction) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    const competitions = await getAllCompetitionsFirestore(seasonId);
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.json({ competitions });
  } catch (err: any) {
    next(err);
  }
});

// GET /api/competitions/:id
readOptimizedRouter.get('/competitions/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const competition = await getCompetitionByIdFirestore(req.params.id);
    if (!competition) {
      return next();
    }
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=300');
    res.json({ competition });
  } catch (err: any) {
    next(err);
  }
});

// GET /api/competitions/:id/standings
readOptimizedRouter.get('/competitions/:id/standings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const standings = await calculateCompetitionStandingsFirestore(req.params.id);
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=300');
    res.json({ standings });
  } catch (err: any) {
    next(err);
  }
});

// GET /api/competitions/:id/fixtures
readOptimizedRouter.get('/competitions/:id/fixtures', async (req: Request, res: Response, next: NextFunction) => {
  const matchday = req.query.matchday ? parseInt(req.query.matchday as string, 10) : undefined;
  const status = req.query.status as string | undefined;
  try {
    const fixtures = await getFixturesFirestore({
      competitionId: req.params.id,
      matchday,
      status,
    });
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=180');
    res.json({ fixtures });
  } catch (err: any) {
    next(err);
  }
});
