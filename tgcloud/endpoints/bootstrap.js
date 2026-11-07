import { db } from 'sdk';
import { currentUser } from '../lib/auth.js';

export default async function (_input, ctx) {
  const { telegramId, user } = await currentUser(ctx);
  const [activeSeason, ownerships, availableLeagues] = await Promise.all([
    db.get("SELECT id, name, status, settings FROM efl_seasons WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1"),
    db.all(`SELECT o.season_id AS seasonId, o.league_id AS leagueId, o.club_id AS clubId,
      c.name AS clubName, c.short_name AS clubShortName, c.logo_url AS clubLogoUrl,
      l.name AS leagueName, l.logo_url AS leagueLogoUrl FROM efl_club_occupancies o
      JOIN efl_clubs c ON c.id = o.club_id JOIN efl_leagues l ON l.id = o.league_id
      WHERE o.telegram_id = :telegramId AND o.status = 'ACTIVE' ORDER BY o.joined_at DESC`, { ':telegramId': telegramId }),
    db.all(`SELECT id, season_id AS seasonId, name, country, continent, logo_url AS logoUrl,
      capacity, status, current_round AS currentRound FROM efl_leagues ORDER BY season_id DESC, sort_order ASC`),
  ]);
  return { ok: true,
    user: user ? { id: user.id, telegramId, username: user.username, firstName: user.first_name, isAdmin: Boolean(user.is_admin) } : null,
    activeSeason, ownerships, leagues: availableLeagues, source: 'telegram-serverless' };
}
