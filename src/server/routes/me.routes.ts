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
import { setOwnershipSensitiveHeaders } from '../middleware/ownershipCacheControl';
import {
  getOptionalCurrentClub,
  getCompetitionStandingsFromReadModel,
} from '../readModel/readModelStore';

export const meRouter = Router();
export const meResilientRouter = meRouter;

const DOMESTIC_LEAGUE_COMPETITION_BY_LEAGUE: Record<string, string> = {
  'league-premier-league': 'comp-premier-league-2026',
  'league-la-liga': 'comp-la-liga-2026',
  'league-serie-a': 'comp-serie-a-2026',
  'league-bundesliga': 'comp-bundesliga-2026',
  'league-ligue-1': 'comp-ligue-1-2026',
};

// Ensure all personalized /api/me responses are never cached publicly
meRouter.use((req: Request, res: Response, next) => {
  setOwnershipSensitiveHeaders(res);
  next();
});

meRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  const user = req.user!;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';

  try {
    const clubState = await getOptionalCurrentClub(user.id, seasonId);
    const { currentClub } = clubState;

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
      const leagueCompetitionId = currentClub.leagueId
        ? DOMESTIC_LEAGUE_COMPETITION_BY_LEAGUE[currentClub.leagueId]
        : undefined;
      let statsResolvedFromStandings = false;

      // Dashboard league stats must use the same durable standings snapshot as the Table view.
      // This keeps POS / PTS / W-D-L / GD consistent and avoids recomputing mixed-competition stats.
      if (leagueCompetitionId) {
        try {
          const standingsResult = await getCompetitionStandingsFromReadModel(leagueCompetitionId, seasonId);
          const row = standingsResult.standings.find((standing) => standing.clubId === currentClub.id);
          if (row) {
            stats.matchesPlayed = row.played || 0;
            stats.wins = row.won || 0;
            stats.draws = row.drawn || 0;
            stats.losses = row.lost || 0;
            stats.goalsScored = row.goalsFor || 0;
            stats.goalsConceded = row.goalsAgainst || 0;
            stats.points = row.points || 0;
            stats.leaguePosition = row.position || 0;
            statsResolvedFromStandings = true;
          }
        } catch (standingsErr: any) {
          console.warn('[ME_STATS] Standings read-model fallback:', standingsErr?.message || standingsErr);
        }
      }

      // Resilient fallback if the standings read model is temporarily unavailable.
      // Restrict this calculation to the club's domestic league so dashboard numbers
      // cannot accidentally include cup or European fixtures.
      if (!statsResolvedFromStandings) {
        let confirmedMatches: any[] = [];
        try {
          const { queryAll } = require('../db');
          const conditions = [
            "status = 'CONFIRMED'",
            '(home_club_id = ? OR away_club_id = ?)',
            '(season_id = ? OR season_id IS NULL)',
          ];
          const params: any[] = [currentClub.id, currentClub.id, seasonId];
          if (leagueCompetitionId) {
            conditions.push('competition_id = ?');
            params.push(leagueCompetitionId);
          }
          const rows = queryAll(
            `SELECT * FROM fixtures WHERE ${conditions.join(' AND ')}`,
            params
          );
          if (rows && rows.length > 0) {
            confirmedMatches = rows.map((r: any) => ({
              id: r.id,
              homeClubId: r.home_club_id,
              awayClubId: r.away_club_id,
              homeScore: r.home_score,
              awayScore: r.away_score,
              status: r.status,
              seasonId: r.season_id,
            }));
          }
        } catch {}

        if (confirmedMatches.length === 0) {
          try {
            confirmedMatches = await getFixturesFirestore({
              clubId: currentClub.id,
              seasonId,
              competitionId: leagueCompetitionId,
              status: 'CONFIRMED',
            });
          } catch {}
        }

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
    }

    res.json({
      authenticated: true,
      user,
      ...clubState,
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
