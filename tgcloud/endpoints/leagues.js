import { db, EndpointError } from 'sdk';
import { verifiedTelegramId } from '../lib/auth.js';

export default async function (input = {}, ctx) {
  verifiedTelegramId(ctx);
  const seasonId = typeof input.seasonId === 'string' ? input.seasonId.trim() : '';
  if (!seasonId || seasonId.length > 80) throw new EndpointError('Mavsum noto‘g‘ri.', { code: 'INVALID_SEASON' });
  const leagues = await db.all(`SELECT l.id, l.name, l.country, l.continent, l.logo_url AS logoUrl,
    l.capacity, l.status, l.current_round AS currentRound, COUNT(o.id) AS occupiedCount
    FROM efl_leagues l LEFT JOIN efl_club_occupancies o
    ON o.league_id = l.id AND o.season_id = l.season_id AND o.status = 'ACTIVE'
    WHERE l.season_id = :seasonId GROUP BY l.id ORDER BY l.sort_order ASC`, { ':seasonId': seasonId });
  return { ok: true, seasonId, leagues, source: 'telegram-serverless' };
}
