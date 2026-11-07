import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';

// Read-only, paginated fixture feed. No score changes or ownership side effects.
export default async function(input={},ctx) {
  verifiedTelegramId(ctx);
  const seasonId=typeof input.seasonId==='string'?input.seasonId.trim():'';
  if(!/^[\w:-]{1,100}$/.test(seasonId)) throw new EndpointError('Mavsum noto‘g‘ri.',{code:'INVALID_SEASON'});
  const limit=input.limit===undefined?40:input.limit;
  const cursor=input.cursor===undefined?0:input.cursor;
  if(!Number.isSafeInteger(limit)||limit<1||limit>100) throw new EndpointError('Limit noto‘g‘ri.',{code:'INVALID_LIMIT'});
  if(!Number.isSafeInteger(cursor)||cursor<0) throw new EndpointError('Kursor noto‘g‘ri.',{code:'INVALID_CURSOR'});
  const leagueId=input.leagueId;
  if(leagueId!==undefined&&(typeof leagueId!=='string'||!/^[\w:-]{1,100}$/.test(leagueId)))
    throw new EndpointError('Liga noto‘g‘ri.',{code:'INVALID_LEAGUE'});
  const clauses=['season_id=:season'];
  const params={':season':seasonId,':limit':limit+1,':offset':cursor};
  if(leagueId!==undefined){clauses.push('league_id=:league');params[':league']=leagueId;}
  const records=await db.all(`SELECT id,season_id AS seasonId,competition_id AS competitionId,
    league_id AS leagueId,round,home_club_id AS homeClubId,away_club_id AS awayClubId,
    home_score AS homeScore,away_score AS awayScore,status,
    confirmation_status AS confirmationStatus,scheduled_at AS scheduledAt,played_at AS playedAt
    FROM efl_fixtures WHERE ${clauses.join(' AND ')}
    ORDER BY round ASC,id ASC LIMIT :limit OFFSET :offset`,params);
  const hasMore=records.length>limit;
  return {ok:true,seasonId,fixtures:records.slice(0,limit),nextCursor:hasMore?cursor+limit:null,
    source:'telegram-serverless'};
}
