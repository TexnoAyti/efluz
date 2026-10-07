import { Router, Request, Response } from 'express';
import { getPlayerSeasonInsights, getSeasonInsights } from '../services/seasonInsightsService';
import { getUserActiveClubFromReadModel } from '../readModel/readModelStore';
import { getPlayerTrophyCabinet } from '../services/playerTrophyService';

export const seasonInsightsRouter = Router();

seasonInsightsRouter.get('/player/:userId/trophies', async (req: Request, res: Response) => {
  const userId = String(req.params.userId || '').trim();
  const seasonId = String(req.query.seasonId || 'season-2026-27');
  if (!userId || userId.length > 128 || !/^season-\d{4}-\d{2}$/.test(seasonId)) {
    res.status(400).json({ error: 'INVALID_TROPHY_REQUEST' }); return;
  }
  try {
    const cabinet = await getPlayerTrophyCabinet(userId, seasonId);
    res.setHeader('Cache-Control', 'no-store');
    res.json(cabinet);
  } catch (error: unknown) {
    console.warn('[PLAYER_TROPHIES_UNAVAILABLE]', error instanceof Error ? error.message : String(error));
    res.status(503).json({ error: 'PLAYER_TROPHIES_UNAVAILABLE' });
  }
});

seasonInsightsRouter.get('/season', async (req: Request, res: Response) => {
  const seasonId = String(req.query.seasonId || 'season-2026-27');
  try {
    const result = await getSeasonInsights(seasonId);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...result, generatedAt: new Date().toISOString() });
  } catch (error: any) {
    console.error('[SEASON_INSIGHTS_FAILED]', error?.message || error);
    res.status(503).json({ error: 'SEASON_INSIGHTS_UNAVAILABLE', message: error?.message || 'Season insights are temporarily unavailable.' });
  }
});

seasonInsightsRouter.get('/player/:userId', async (req: Request, res: Response) => {
  const seasonId = String(req.query.seasonId || 'season-2026-27');
  const userId = String(req.params.userId || '').trim();
  if (!userId) {
    res.status(400).json({ error: 'USER_ID_REQUIRED' });
    return;
  }

  try {
    let fallbackClubIds: string[] = [];
    try {
      const currentClub = await getUserActiveClubFromReadModel(userId, seasonId);
      if (currentClub?.id) fallbackClubIds = [currentClub.id];
    } catch {
      // Insights can still be derived from owner-neutral snapshots/SQLite.
    }
    const result = await getPlayerSeasonInsights(userId, seasonId, fallbackClubIds);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...result, generatedAt: new Date().toISOString() });
  } catch (error: any) {
    console.error('[PLAYER_INSIGHTS_FAILED]', JSON.stringify({ userId, seasonId, error: error?.message || String(error) }));
    res.status(503).json({ error: 'PLAYER_INSIGHTS_UNAVAILABLE', message: error?.message || 'Player insights are temporarily unavailable.' });
  }
});
