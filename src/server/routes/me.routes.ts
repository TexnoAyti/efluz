import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import {
  getUserActiveClubFirestore,
  getFixturesFirestore,
} from '../firebase/firestoreStore';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS, FirestoreFixtureDoc, FirestoreNotificationDoc } from '../firebase/collections';

export const meRouter = Router();

meRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';

  try {
    const currentClub = await getUserActiveClubFirestore(user.id, seasonId);

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
      const db = getFirestoreDb();
      const fixturesSnap = await db
        .collection(COLLECTIONS.FIXTURES)
        .where('seasonId', '==', seasonId)
        .where('status', '==', 'CONFIRMED')
        .get();

      for (const doc of fixturesSnap.docs) {
        const m = doc.data() as FirestoreFixtureDoc;
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
    res.status(500).json({ error: 'Failed to fetch user profile', message: err.message });
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
    res.status(500).json({ error: 'Failed to fetch user matches', message: err.message });
  }
});

meRouter.get('/notifications', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const db = getFirestoreDb();
    const snap = await db
      .collection(COLLECTIONS.NOTIFICATIONS)
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get();

    const notifications = snap.docs.map((d) => {
      const data = d.data() as FirestoreNotificationDoc;
      return {
        id: d.id,
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        isRead: data.isRead,
        createdAt: data.createdAt,
      };
    });

    res.json({ notifications });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch notifications', message: err.message });
  }
});

meRouter.post('/notifications/read', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const db = getFirestoreDb();
    const snap = await db
      .collection(COLLECTIONS.NOTIFICATIONS)
      .where('userId', '==', userId)
      .where('isRead', '==', false)
      .get();

    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((d) => batch.update(d.ref, { isRead: true }));
      await batch.commit();
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update notifications', message: err.message });
  }
});
