import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { getUserActiveClub } from '../services/clubService';
import { getFixtures } from '../services/fixtureService';
import { getUserNotifications, markNotificationsAsRead } from '../services/notificationService';
import { queryGet, queryAll } from '../db';

export const meRouter = Router();

meRouter.get('/', requireAuth, (req: Request, res: Response) => {
  const user = req.user!;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const currentClub = getUserActiveClub(user.id, seasonId);

  let stats = {
    matchesPlayed: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsScored: 0,
    goalsConceded: 0,
    points: 0,
    trophies: 0,
    leaguePosition: 0,
  };

  if (currentClub) {
    // Calculate user's matches
    const confirmedMatches = queryAll<any>(
      `SELECT f.* FROM fixtures f
       WHERE (f.home_club_id = ? OR f.away_club_id = ?) AND f.status = 'CONFIRMED' AND f.season_id = ?`,
      [currentClub.id, currentClub.id, seasonId]
    );

    for (const m of confirmedMatches) {
      stats.matchesPlayed++;
      const isHome = m.home_club_id === currentClub.id;
      const myScore = isHome ? m.home_score : m.away_score;
      const oppScore = isHome ? m.away_score : m.home_score;

      stats.goalsScored += myScore;
      stats.goalsConceded += oppScore;

      if (myScore > oppScore) {
        stats.wins++;
        stats.points += 3;
      } else if (myScore === oppScore) {
        stats.draws++;
        stats.points += 1;
      } else {
        stats.losses++;
      }
    }
  }

  res.json({
    authenticated: true,
    user,
    currentClub,
    stats,
  });
});

meRouter.get('/matches', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const status = req.query.status as string | undefined;

  const fixtures = getFixtures({
    userId,
    seasonId,
    status,
  });

  res.json({ fixtures });
});

meRouter.get('/notifications', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;
  const notifications = getUserNotifications(userId, 30);
  res.json({ notifications });
});

meRouter.post('/notifications/read', requireAuth, (req: Request, res: Response) => {
  const userId = req.user!.id;
  markNotificationsAsRead(userId);
  res.json({ success: true });
});
