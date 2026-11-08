// Private, owner-scoped fixture lookup. Supports imported legacy season IDs
// without a required artificial prefix. Never accepts arbitrary owner IDs.
export function validateMyFixturesQuery(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!['seasonId','limit','cursor'].includes(k)))
  throw Error('INVALID_FIXTURE_REQUEST');
 const seasonId=typeof input.seasonId==='string'?input.seasonId.trim():'';
 if(!/^[a-zA-Z0-9_:-]{1,100}$/.test(seasonId))throw Error('INVALID_SEASON');
 const limit=input.limit??50,cursor=input.cursor??0;
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('INVALID_LIMIT');
 if(!Number.isSafeInteger(cursor)||cursor<0||cursor>1000000)throw Error('INVALID_CURSOR');
 return {seasonId,limit,cursor};
}
export async function readMyFixtures(db,telegramId,input={}){
 if(!/^[1-9][0-9]{0,19}$/.test(String(telegramId??'')))throw Error('AUTH_REQUIRED');
 const {seasonId,limit,cursor}=validateMyFixturesQuery(input);
 const params={':telegram':String(telegramId),':season':seasonId,
   ':limit':limit+1,':offset':cursor};
 const rows=await db.all(`SELECT f.id,f.competition_id AS competitionId,f.league_id AS leagueId,
   f.season_id AS seasonId,f.round,f.home_club_id AS homeClubId,
   f.away_club_id AS awayClubId,f.home_score AS homeScore,
   f.away_score AS awayScore,f.status,f.confirmation_status AS confirmationStatus,
   f.scheduled_at AS scheduledAt,f.played_at AS playedAt
   FROM efl_fixtures f WHERE f.season_id=:season
   AND EXISTS (SELECT 1 FROM efl_club_occupancies o
     WHERE o.season_id=f.season_id AND o.telegram_id=:telegram
       AND o.status='ACTIVE'
       AND (o.club_id=f.home_club_id OR o.club_id=f.away_club_id))
   ORDER BY f.round ASC,f.id ASC LIMIT :limit OFFSET :offset`,params);
 return {ok:true,seasonId,fixtures:rows.slice(0,limit),
   nextCursor:rows.length>limit?cursor+limit:null,source:'telegram-serverless'};
}
