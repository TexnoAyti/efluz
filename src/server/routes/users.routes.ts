import { Router, Request, Response } from 'express';
import {
  getUserByIdFirestore,
  getUserActiveClubFirestore,
  getFixturesFirestore,
} from '../firebase/firestoreStore';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';

export const usersRouter = Router();

usersRouter.get('/:id', async (req: Request, res: Response) => {
  const userId = req.params.id;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';

  try {
    const user = await getUserByIdFirestore(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
      return;
    }

    const currentClub = await getUserActiveClubFirestore(userId, seasonId);

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

    // Public user profile (sanitized)
    res.json({
      user: {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        photoUrl: user.photoUrl,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt,
      },
      currentClub,
      stats,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, `GET /api/users/${userId}`);
  }
});
