import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';

// Private, owner-scoped fixtures. Do not trust user IDs or club IDs from input.
export default async function(input={},ctx){
  const telegramId=verifiedTelegramId(ctx);
  const seasonId=typeof input.seasonId==='string'?input.seasonId.trim():'';
  if(!/^season-[a-zA-Z0-9-]{1,90}$/.test(seasonId))
    throw new EndpointError('Mavsum noto‘g‘ri.',{code:'INVALID_SEASON'});
  const limit=input.limit===undefined?50:input.limit;
  const cursor=input.cursor===undefined?0:input.cursor;
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)
    throw new EndpointError('Limit noto‘g‘ri.',{code:'INVALID_LIMIT'});
  if(!Number.isSafeInteger(cursor)||cursor<0||cursor>1000000)
    throw new EndpointError('Kursor noto‘g‘ri.',{code:'INVALID_CURSOR'});
  const params={':telegram':telegramId,':season':seasonId,':limit':limit+1,':offset':cursor};
  const rows=await db.all(`SELECT f.id,f.competition_id AS competitionId,f.league_id AS leagueId,
    f.season_id AS seasonId,f.round,f.home_club_id AS homeClubId,
    f.away_club_id AS awayClubId,f.home_score AS homeScore,
    f.away_score AS awayScore,f.status,f.confirmation_status AS confirmationStatus,
    f.scheduled_at AS scheduledAt,f.played_at AS playedAt
    FROM efl_fixtures f WHERE f.season_id=:season
    AND EXISTS (
      SELECT 1 FROM efl_club_occupancies o
      WHERE o.season_id=f.season_id AND o.telegram_id=:telegram
      AND o.status='ACTIVE' AND (o.club_id=f.home_club_id OR o.club_id=f.away_club_id)
    )
    ORDER BY f.round ASC,f.id ASC LIMIT :limit OFFSET :offset`,params);
  return {ok:true,seasonId,fixtures:rows.slice(0,limit),
    nextCursor:rows.length>limit?cursor+limit:null,source:'telegram-serverless'};
}
