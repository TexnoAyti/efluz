import { Router, Request, Response } from 'express';
import { getAllLeaguesFirestore, getClubsByLeagueFirestore } from '../firebase/firestoreStore';

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
    res.json({ leagues });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch leagues', message: err.message });
  }
});

leaguesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const leagueId = resolveLeagueId(req.params.id);
    const leagues = await getAllLeaguesFirestore();
    const league = leagues.find((l) => l.id === leagueId);
    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }
    res.json({ league });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch league', message: err.message });
  }
});

leaguesRouter.get('/:id/clubs', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const leagueId = resolveLeagueId(req.params.id);
  const currentUserId = req.user?.id;

  try {
    const clubs = await getClubsByLeagueFirestore(leagueId, seasonId, currentUserId);
    res.json({ clubs });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch league clubs', message: err.message });
  }
});
