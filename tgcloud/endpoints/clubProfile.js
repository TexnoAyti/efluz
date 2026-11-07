import { db, EndpointError } from 'sdk';
import { verifiedTelegramId } from '../lib/auth.js';

export default async function (input = {}, ctx) {
  const telegramId = verifiedTelegramId(ctx);
  const seasonId = typeof input.seasonId === 'string' ? input.seasonId.trim() : '';
  if (!seasonId || seasonId.length > 80) throw new EndpointError('Mavsum noto‘g‘ri.', { code: 'INVALID_SEASON' });
  const profile = await db.get(`SELECT o.season_id AS seasonId, o.league_id AS leagueId,
    o.club_id AS clubId, c.name AS clubName, c.short_name AS clubShortName, c.logo_url AS clubLogoUrl,
    c.stadium, l.name AS leagueName, l.logo_url AS leagueLogoUrl, l.current_round AS currentRound
    FROM efl_club_occupancies o JOIN efl_clubs c ON c.id = o.club_id JOIN efl_leagues l ON l.id = o.league_id
    WHERE o.telegram_id = :telegramId AND o.season_id = :seasonId AND o.status = 'ACTIVE' LIMIT 1`,
    { ':telegramId': telegramId, ':seasonId': seasonId });
  if (!profile) return { ok: true, profile: null, seasonId };
  const fixtures = await db.all(`SELECT id, round, home_club_id AS homeClubId, away_club_id AS awayClubId,
    home_score AS homeScore, away_score AS awayScore, status, confirmation_status AS confirmationStatus,
    scheduled_at AS scheduledAt FROM efl_fixtures WHERE season_id = :seasonId
    AND (home_telegram_id = :telegramId OR away_telegram_id = :telegramId) ORDER BY round ASC LIMIT 50`,
    { ':telegramId': telegramId, ':seasonId': seasonId });
  return { ok: true, profile, fixtures, seasonId };
}
