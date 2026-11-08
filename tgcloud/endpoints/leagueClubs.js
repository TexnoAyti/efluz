// Authenticated read-only league club browser for EFLUZ Mini App.
// This feed never exposes owner identities or permits a club claim.
import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';

const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_:-]{1,120}$/.test(value);
export default async function(input={},ctx) {
  const telegramId=verifiedTelegramId(ctx);
  const seasonId=input.seasonId,leagueId=input.leagueId;
  if(!validId(seasonId)||!validId(leagueId))
    throw new EndpointError('Liga yoki mavsum noto‘g‘ri.',{code:'INVALID_SCOPE'});
  const league=await db.get('SELECT id FROM efl_leagues WHERE id=:id AND season_id=:season',
    {':id':leagueId,':season':seasonId});
  if(!league)throw new EndpointError('Liga topilmadi.',{code:'LEAGUE_NOT_FOUND'});
  const clubs=await db.all(`SELECT c.id,c.name,c.short_name AS shortName,
      c.country,c.league_id AS leagueId,c.logo_url AS logoUrl,
      c.stadium,c.created_at AS createdAt,
      CASE WHEN o.id IS NULL THEN 0 ELSE 1 END AS isTaken,
      CASE WHEN o.telegram_id=:telegramId THEN 1 ELSE 0 END AS isCurrentUserClub
    FROM efl_clubs c LEFT JOIN efl_club_occupancies o
      ON o.club_id=c.id AND o.league_id=c.league_id
       AND o.season_id=:seasonId AND o.status='ACTIVE'
    WHERE c.league_id=:leagueId
    ORDER BY c.sort_order ASC,c.id ASC LIMIT 100`,
    {':telegramId':telegramId,':seasonId':seasonId,':leagueId':leagueId});
  return {ok:true,leagueId,seasonId,clubs:clubs.map(c=>({
    ...c,isTaken:Boolean(c.isTaken),isCurrentUserClub:Boolean(c.isCurrentUserClub),
    active:true,logoUrl:c.logoUrl||''
  })),source:'telegram-serverless'};
}
