import { Router, Request, Response } from 'express';
import { getAllLeaguesFirestore } from '../firebase/firestoreStore';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';
import { setOwnershipSensitiveHeaders } from '../middleware/ownershipCacheControl';
import { getLeagueClubsFromReadModel } from '../readModel/readModelStore';

export const leaguesRouter = Router();

const LEAGUE_ID_ALIASES: Record<string, string> = {
  'league-epl': 'league-premier-league',
  'league-laliga': 'league-la-liga',
  'league-seriea': 'league-serie-a',
  'league-ligue1': 'league-ligue-1',
};

function resolveLeagueId(id: string): string {
  return LEAGUE_ID_ALIASES[id] || id;
}

leaguesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const leagues = await getAllLeaguesFirestore();
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json({ leagues });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/leagues');
  }
});

leaguesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const leagueId = resolveLeagueId(req.params.id);
    const leagues = await getAllLeaguesFirestore();
    const league = leagues.find((l) => l.id === leagueId);
    if (!league) {
      res.status(404).json({ error: 'League not found', code: 'NOT_FOUND', message: `League '${leagueId}' not found.` });
      return;
    }
    res.json({ league });
  } catch (err: any) {
    handleFirestoreError(res, err, `GET /api/leagues/${req.params.id}`);
  }
});

leaguesRouter.get('/:id/clubs', async (req: Request, res: Response) => {
  setOwnershipSensitiveHeaders(res);
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const leagueId = resolveLeagueId(req.params.id);
  const currentUserId = req.user?.id;

  try {
    const result = await getLeagueClubsFromReadModel(leagueId, seasonId, currentUserId);
    res.json({
      clubs: result.clubs,
      source: result.source,
      stale: result.stale,
      degraded: result.degraded,
      snapshotAt: result.snapshotAt,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, `GET /api/leagues/${req.params.id}/clubs`);
  }
});
