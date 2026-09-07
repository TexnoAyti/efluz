import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { queryAll, queryGet, queryRun } from '../db';
import { getUserNotificationsFirestore } from '../firebase/firestoreStore';

export const meResilientRouter = Router();
meResilientRouter.use(requireAuth);

function getLocalActiveClub(userId: string, seasonId: string): any | null {
  const row = queryGet<any>(
    `SELECT c.*, cm.user_id as claimed_by_user_id, u.username as manager_username
       FROM club_memberships cm
       JOIN clubs c ON c.id = cm.club_id
       LEFT JOIN users u ON u.id = cm.user_id
      WHERE cm.user_id = ? AND cm.season_id = ? AND cm.status = 'active'
      LIMIT 1`,
    [userId, seasonId]
  );

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    leagueId: row.league_id,
    country: row.country,
    logoUrl: row.logo_url,
    active: Boolean(row.active),
    createdAt: row.created_at,
    isTaken: true,
    isCurrentUserClub: true,
    claimedByUserId: row.claimed_by_user_id || userId,
    claimedByUsername: row.manager_username || null,
    managerUsername: row.manager_username || undefined,
    occupancy: {
      status: 'owned',
      userId: row.claimed_by_user_id || userId,
      username: row.manager_username || undefined,
    },
  };
}

function normalizeFixture(row: any, userId: string) {
  const homeOwner = queryGet<any>(
    `SELECT cm.user_id, u.username, u.first_name, u.last_name
       FROM club_memberships cm
       LEFT JOIN users u ON u.id = cm.user_id
      WHERE cm.season_id = ? AND cm.club_id = ? AND cm.status = 'active'
      LIMIT 1`,
    [row.season_id, row.home_club_id]
  );
  const awayOwner = queryGet<any>(
    `SELECT cm.user_id, u.username, u.first_name, u.last_name
       FROM club_memberships cm
       LEFT JOIN users u ON u.id = cm.user_id
      WHERE cm.season_id = ? AND cm.club_id = ? AND cm.status = 'active'
      LIMIT 1`,
    [row.season_id, row.away_club_id]
  );
  const submission = queryGet<any>(
    `SELECT * FROM result_submissions WHERE fixture_id = ? AND submitted_by_user_id = ? LIMIT 1`,
    [row.id, userId]
  );
  const opponentSubmission = queryGet<any>(
    `SELECT * FROM result_submissions WHERE fixture_id = ? AND submitted_by_user_id <> ? ORDER BY created_at ASC LIMIT 1`,
    [row.id, userId]
  );
  const matchday = queryGet<any>('SELECT value_json FROM system_settings WHERE key = ?', [`matchday:${row.competition_id}`]);

  let state: any = { currentMatchday: 1, durationHours: 30, nextOpenAt: null, overrideStatus: 'AUTO' };
  if (matchday?.value_json) {
    try {
      state = { ...state, ...JSON.parse(matchday.value_json) };
    } catch {}
  }

  const homeClub = {
    id: row.home_club_id,
    name: row.home_name,
    shortName: row.home_short,
    country: row.home_country,
    leagueId: row.home_league,
    logoUrl: row.home_logo,
    active: true,
    isTaken: Boolean(homeOwner),
    isCurrentUserClub: homeOwner?.user_id === userId,
    claimedByUserId: homeOwner?.user_id || null,
    claimedByUsername: homeOwner?.username || null,
    createdAt: '',
  };
  const awayClub = {
    id: row.away_club_id,
    name: row.away_name,
    shortName: row.away_short,
    country: row.away_country,
    leagueId: row.away_league,
    logoUrl: row.away_logo,
    active: true,
    isTaken: Boolean(awayOwner),
    isCurrentUserClub: awayOwner?.user_id === userId,
    claimedByUserId: awayOwner?.user_id || null,
    claimedByUsername: awayOwner?.username || null,
    createdAt: '',
  };

  const isPlayableMatchday = state.overrideStatus === 'FORCE_OPEN' || (state.overrideStatus !== 'FORCE_LOCKED' && state.overrideStatus !== 'PAUSED' && Number(state.currentMatchday || 1) === Number(row.matchday));

  return {
    id: row.id,
    seasonId: row.season_id,
    competitionId: row.competition_id,
    competitionName: row.competition_id,
    matchday: Number(row.matchday),
    roundName: row.round_name || undefined,
    homeClubId: row.home_club_id,
    awayClubId: row.away_club_id,
    homeClub,
    awayClub,
    homeOwnerId: homeOwner?.user_id || null,
    awayOwnerId: awayOwner?.user_id || null,
    homeUser: homeOwner ? { id: homeOwner.user_id, username: homeOwner.username || '', displayName: `${homeOwner.first_name || ''} ${homeOwner.last_name || ''}`.trim() || homeOwner.username || homeOwner.user_id } : null,
    awayUser: awayOwner ? { id: awayOwner.user_id, username: awayOwner.username || '', displayName: `${awayOwner.first_name || ''} ${awayOwner.last_name || ''}`.trim() || awayOwner.username || awayOwner.user_id } : null,
    activeMatchday: Number(state.currentMatchday || 1),
    isPlayable: isPlayableMatchday && !['CONFIRMED', 'CANCELLED', 'POSTPONED'].includes(String(row.status)),
    userSubmission: submission ? { ...submission, userId: submission.submitted_by_user_id, submittedByUserId: submission.submitted_by_user_id, homeScore: submission.home_score, awayScore: submission.away_score, proofUrl: submission.proof_url } : undefined,
    opponentSubmission: opponentSubmission ? { ...opponentSubmission, userId: opponentSubmission.submitted_by_user_id, submittedByUserId: opponentSubmission.submitted_by_user_id, homeScore: opponentSubmission.home_score, awayScore: opponentSubmission.away_score, proofUrl: opponentSubmission.proof_url } : undefined,
    scheduledAt: row.scheduled_at,
    status: row.status,
    homeScore: row.home_score ?? undefined,
    awayScore: row.away_score ?? undefined,
    winnerClubId: row.winner_club_id ?? undefined,
    resultConfirmedAt: row.result_confirmed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getLocalMatches(userId: string, seasonId: string, status?: string): any[] {
  let sql = `
    SELECT f.*,
           hc.name AS home_name, hc.short_name AS home_short, hc.country AS home_country, hc.league_id AS home_league, hc.logo_url AS home_logo,
           ac.name AS away_name, ac.short_name AS away_short, ac.country AS away_country, ac.league_id AS away_league, ac.logo_url AS away_logo
      FROM fixtures f
      JOIN club_memberships cm ON (cm.club_id = f.home_club_id OR cm.club_id = f.away_club_id)
                               AND cm.season_id = f.season_id
                               AND cm.user_id = ?
                               AND cm.status = 'active'
      JOIN clubs hc ON hc.id = f.home_club_id
      JOIN clubs ac ON ac.id = f.away_club_id
     WHERE f.season_id = ?`;
  const params: any[] = [userId, seasonId];

  if (status) {
    sql += ' AND f.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY f.matchday ASC, f.scheduled_at ASC';

  return queryAll<any>(sql, params).map((row) => normalizeFixture(row, userId));
}

meResilientRouter.get('/', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const user = req.user!;
  const currentClub = getLocalActiveClub(user.id, seasonId);
  const confirmedMatches = currentClub ? getLocalMatches(user.id, seasonId, 'CONFIRMED') : [];

  const stats = {
    matchesPlayed: confirmedMatches.length,
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
    for (const match of confirmedMatches) {
      const isHome = match.homeClubId === currentClub.id;
      const myScore = isHome ? Number(match.homeScore || 0) : Number(match.awayScore || 0);
      const oppScore = isHome ? Number(match.awayScore || 0) : Number(match.homeScore || 0);
      stats.goalsScored += myScore;
      stats.goalsConceded += oppScore;
      if (myScore > oppScore) {
        stats.wins += 1;
        stats.points += 3;
      } else if (myScore === oppScore) {
        stats.draws += 1;
        stats.points += 1;
      } else {
        stats.losses += 1;
      }
    }
  }

  res.json({ authenticated: true, user, currentClub, stats, source: 'SQLITE' });
});

meResilientRouter.get('/matches', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  res.json({ fixtures: getLocalMatches(req.user!.id, seasonId, status), source: 'SQLITE' });
});

meResilientRouter.get('/notifications', async (req: Request, res: Response) => {
  try {
    const notifications = await getUserNotificationsFirestore(req.user!.id, 30);
    res.json({ notifications });
  } catch {
    const rows = queryAll<any>('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30', [req.user!.id]);
    res.json({
      notifications: rows.map((r) => ({ id: r.id, userId: r.user_id, type: r.type, title: r.title, message: r.message, isRead: Boolean(r.is_read), createdAt: r.created_at })),
      source: 'SQLITE',
    });
  }
});

meResilientRouter.post('/notifications/read', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const notificationId = typeof req.body?.notificationId === 'string' ? req.body.notificationId : null;
  try {
    if (notificationId) {
      queryRun('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id = ?', [userId, notificationId]);
    } else {
      queryRun('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [userId]);
    }
    res.json({ success: true, source: 'SQLITE', syncStatus: 'PENDING_FIRESTORE_SYNC' });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Could not mark notifications read' });
  }
});
