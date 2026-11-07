import {db,EndpointError} from 'sdk';
import {verifiedTelegramId} from '../lib/auth.js';

// All authenticated users may read the public competition catalog.
// This does not mutate rounds, cup brackets or participants.
export default async function(input={},ctx) {
  verifiedTelegramId(ctx);
  const seasonId=typeof input.seasonId==='string'?input.seasonId.trim():'';
  if(!/^[a-zA-Z0-9_:-]{1,100}$/.test(seasonId))
    throw new EndpointError('Mavsum noto‘g‘ri.',{code:'INVALID_SEASON'});
  const limit=input.limit===undefined?100:input.limit;
  if(!Number.isSafeInteger(limit)||limit<1||limit>200)
    throw new EndpointError('Limit noto‘g‘ri.',{code:'INVALID_LIMIT'});
  const competitions=await db.all(`SELECT id,season_id AS seasonId,
    league_id AS leagueId,name,type,schedule_mode AS scheduleMode,status,
    format_config AS formatConfig,current_matchday AS currentMatchday,
    is_matchday_open AS isMatchdayOpen
    FROM efl_competitions WHERE season_id=:season
    ORDER BY type,name,id LIMIT :limit`,
    {':season':seasonId,':limit':limit});
  return {ok:true,seasonId,competitions,source:'telegram-serverless'};
}
