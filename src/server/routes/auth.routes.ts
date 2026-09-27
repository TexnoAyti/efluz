import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validationMiddleware';
import { verifyTelegramWebAppData, getOrCreateTelegramUser, getOrCreateDevUser, createSessionToken, DEV_PROFILES } from '../auth/telegramAuth';
import { getOptionalCurrentClub, getCompetitionStandingsFromReadModel } from '../readModel/readModelStore';
import { refreshRecipientDirectoryIfStale } from '../services/recipientDirectoryRefreshService';
import { Club } from '../../types';

export const authRouter = Router();

const telegramAuthSchema = z.object({
  initData: z.string().min(1, 'initData is required'),
});

const devAuthSchema = z.object({
  devUserId: z.string().min(1, 'devUserId is required'),
});

const DOMESTIC_LEAGUE_COMPETITION_BY_LEAGUE: Record<string, string> = {
  'league-premier-league': 'comp-premier-league-2026',
  'league-la-liga': 'comp-la-liga-2026',
  'league-serie-a': 'comp-serie-a-2026',
  'league-bundesliga': 'comp-bundesliga-2026',
  'league-ligue-1': 'comp-ligue-1-2026',
};

function emptyStats() {
  return {
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
}

async function getClubStatsLive(currentClub?: Club | null, seasonId = 'season-2026-27') {
  const stats = emptyStats();
  if (!currentClub?.id) return stats;

  const competitionId = currentClub.leagueId
    ? DOMESTIC_LEAGUE_COMPETITION_BY_LEAGUE[currentClub.leagueId]
    : undefined;

  // Authentication is the source of the first Dashboard render. It must use the
  // same durable standings truth as /api/me and the Table view, not ephemeral
  // serverless SQLite. Otherwise a valid auth response seeds the UI with 0-0-0.
  if (competitionId) {
    try {
      const result = await getCompetitionStandingsFromReadModel(competitionId, seasonId);
      const row = result.standings.find((standing) => standing.clubId === currentClub.id);
      if (row) {
        stats.matchesPlayed = row.played || 0;
        stats.wins = row.won || 0;
        stats.draws = row.drawn || 0;
        stats.losses = row.lost || 0;
        stats.goalsScored = row.goalsFor || 0;
        stats.goalsConceded = row.goalsAgainst || 0;
        stats.points = row.points || 0;
        stats.leaguePosition = row.position || 0;
        return stats;
      }
    } catch (error: any) {
      console.warn('[AUTH_STATS] standings read-model unavailable:', error?.message || error);
    }
  }

  // Last-resort local fallback only. Keep it league-scoped so cup/European
  // results never contaminate the Home league card.
  try {
    const { queryAll } = require('../db');
    const conditions = [
      "status = 'CONFIRMED'",
      '(home_club_id = ? OR away_club_id = ?)',
      '(season_id = ? OR season_id IS NULL)',
    ];
    const params: any[] = [currentClub.id, currentClub.id, seasonId];
    if (competitionId) {
      conditions.push('competition_id = ?');
      params.push(competitionId);
    }
    const rows = queryAll(
      `SELECT home_club_id, away_club_id, home_score, away_score FROM fixtures WHERE ${conditions.join(' AND ')}`,
      params
    );
    for (const m of rows) {
      const isHome = m.home_club_id === currentClub.id;
      stats.matchesPlayed++;
      const myScore = isHome ? (m.home_score ?? 0) : (m.away_score ?? 0);
      const oppScore = isHome ? (m.away_score ?? 0) : (m.home_score ?? 0);
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
  } catch {}
  return stats;
}

async function refreshTelegramDirectoryAfterAuth(): Promise<void> {
  await refreshRecipientDirectoryIfStale('season-2026-27').catch((error: any) => {
    console.warn('[AUTH_RECIPIENT_DIRECTORY_REFRESH_FAILED]', error?.message || error);
  });
}

authRouter.post('/telegram', validateBody(telegramAuthSchema), async (req: Request, res: Response) => {
  const { initData } = req.body;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    if (process.env.ENABLE_DEV_AUTH === 'true' || process.env.NODE_ENV !== 'production') {
      try {
        const urlParams = new URLSearchParams(initData);
        const userRaw = urlParams.get('user');
        if (userRaw) {
          const user = await getOrCreateTelegramUser(JSON.parse(userRaw));
          await refreshTelegramDirectoryAfterAuth();
          const clubState = await getOptionalCurrentClub(user.id);
          const stats = await getClubStatsLive(clubState.currentClub);
          const token = createSessionToken(user);
          console.log(`[TELEGRAM AUTH - DEV SANDBOX] user=${user.username} (id: ${user.telegramId}), isAdmin=${user.isAdmin}`);
          res.json({ success: true, user, ...clubState, stats, token });
          return;
        }
      } catch {
        // continue
      }
    }
    res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is not configured on the server.' });
    return;
  }

  const verifyResult = verifyTelegramWebAppData(initData, botToken);
  if (!verifyResult.isValid || !verifyResult.user) {
    console.warn(`[TELEGRAM AUTH REJECTED] error="${verifyResult.error}"`);
    res.status(401).json({ error: 'Invalid Telegram WebApp authentication', details: verifyResult.error });
    return;
  }

  try {
    const user = await getOrCreateTelegramUser(verifyResult.user);
    await refreshTelegramDirectoryAfterAuth();
    const clubState = await getOptionalCurrentClub(user.id);
    const stats = await getClubStatsLive(clubState.currentClub);
    const token = createSessionToken(user);

    console.log(`[TELEGRAM AUTH]\ninitData received: YES\nparsed user id: ${verifyResult.user.id}\nusername: ${verifyResult.user.username || '(none)'}\nauth_date valid: ${verifyResult.authDate ? 'YES' : 'NO'}\nHMAC valid: YES\ninternal user: ${user.id}\nisAdmin: ${user.isAdmin ? 'YES' : 'NO'}`);

    res.json({ success: true, user, ...clubState, stats, token });
  } catch (err: any) {
    res.status(500).json({ error: 'Authentication failed', message: err.message });
  }
});

authRouter.post('/dev', validateBody(devAuthSchema), async (req: Request, res: Response) => {
  const isDev = process.env.ENABLE_DEV_AUTH === 'true' || process.env.NODE_ENV !== 'production';
  if (!isDev) {
    res.status(403).json({ error: 'Dev auth is disabled in production.' });
    return;
  }

  try {
    const user = await getOrCreateDevUser(req.body.devUserId);
    await refreshTelegramDirectoryAfterAuth();
    const clubState = await getOptionalCurrentClub(user.id);
    const stats = await getClubStatsLive(clubState.currentClub);
    const token = createSessionToken(user);
    res.json({ success: true, user, ...clubState, stats, token });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

authRouter.get('/dev-profiles', (req: Request, res: Response) => {
  const isDev = process.env.ENABLE_DEV_AUTH === 'true' || process.env.NODE_ENV !== 'production';
  if (!isDev) {
    res.status(403).json({ error: 'Dev auth is disabled in production.' });
    return;
  }
  res.json({ profiles: DEV_PROFILES });
});