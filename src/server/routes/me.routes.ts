import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import {
  getUserActiveClubFirestore,
  getFixturesFirestore,
  getUserNotificationsFirestore,
  markNotificationsReadFirestore,
  markSingleNotificationReadFirestore,
} from '../firebase/firestoreStore';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';

export const meRouter = Router();

meRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';

  try {
    const currentClub = await getUserActiveClubFirestore(user.id, seasonId);

    const stats = {
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
      const confirmedMatches = await getFixturesFirestore({
        clubId: currentClub.id,
        seasonId,
        status: 'CONFIRMED',
      });

      for (const m of confirmedMatches) {
        const isHome = m.homeClubId === currentClub.id;
        const isAway = m.awayClubId === currentClub.id;

        if (isHome || isAway) {
          stats.matchesPlayed++;
          const myScore = isHome ? (m.homeScore ?? 0) : (m.awayScore ?? 0);
          const oppScore = isHome ? (m.awayScore ?? 0) : (m.homeScore ?? 0);

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
    }

    res.json({
      authenticated: true,
      user,
      currentClub,
      stats,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/me');
  }
});

meRouter.get('/matches', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const status = req.query.status as string | undefined;

  try {
    const fixtures = await getFixturesFirestore({
      userId,
      seasonId,
      status,
    });

    res.json({ fixtures });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/me/matches');
  }
});

meRouter.get('/notifications', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const notifications = await getUserNotificationsFirestore(userId, 30);
    res.json({ notifications });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/me/notifications');
  }
});

meRouter.post('/notifications/read', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { notificationId } = req.body || {};
  try {
    if (notificationId && typeof notificationId === 'string') {
      await markSingleNotificationReadFirestore(userId, notificationId);
    } else {
      await markNotificationsReadFirestore(userId);
    }
    res.json({ success: true });
  } catch (err: any) {
    handleFirestoreError(res, err, 'POST /api/me/notifications/read');
  }
});
