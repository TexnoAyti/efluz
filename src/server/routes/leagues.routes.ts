import { Router, Request, Response } from 'express';
import { queryAll, queryGet } from '../db';
import { League } from '../../types';
import { getClubsByLeague } from '../services/clubService';

export const leaguesRouter = Router();

leaguesRouter.get('/', (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const rows = queryAll<any>(
    `SELECT l.*, COUNT(slc.club_id) as total_clubs
     FROM leagues l
     LEFT JOIN season_league_clubs slc ON l.id = slc.league_id AND slc.season_id = ? AND slc.is_active = 1
     GROUP BY l.id
     ORDER BY l.tier ASC, l.name ASC`,
    [seasonId]
  );
  const leagues: League[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    country: r.country,
    tier: r.tier,
    logoUrl: r.logo_url,
    totalClubs: Number(r.total_clubs) || 0,
    createdAt: r.created_at,
  }));
  res.json({ leagues });
});

const LEAGUE_ID_ALIASES: Record<string, string> = {
  'league-epl': 'league-premier-league',
  'league-laliga': 'league-la-liga',
  'league-seriea': 'league-serie-a',
  'league-ligue1': 'league-ligue-1',
};

function resolveLeagueId(id: string): string {
  return LEAGUE_ID_ALIASES[id] || id;
}

leaguesRouter.get('/:id', (req: Request, res: Response) => {
  const leagueId = resolveLeagueId(req.params.id);
  const row = queryGet<any>('SELECT * FROM leagues WHERE id = ?', [leagueId]);
  if (!row) {
    res.status(404).json({ error: 'League not found' });
    return;
  }
  const league: League = {
    id: row.id,
    name: row.name,
    country: row.country,
    tier: row.tier,
    logoUrl: row.logo_url,
    createdAt: row.created_at,
  };
  res.json({ league });
});

leaguesRouter.get('/:id/clubs', (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const leagueId = resolveLeagueId(req.params.id);
  const clubs = getClubsByLeague(leagueId, seasonId);
  console.log(`[LEAGUE CLUBS]`);
  console.log(`season=${seasonId}`);
  console.log(`league=${leagueId}`);
  console.log(`count=${clubs.length}`);
  res.json({ clubs });
});
