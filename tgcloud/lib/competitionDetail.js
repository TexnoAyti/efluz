// Public read-only tournament details: no owner identities or private data.
// Supports league and cup competitions using the same normalized schema.
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_:-]{1,120}$/.test(value);
export function validateCompetitionDetail(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||!validId(input.seasonId)||
    !validId(input.competitionId))throw Error('INVALID_COMPETITION');
  const limit=input.limit===undefined?100:input.limit;
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('INVALID_LIMIT');
  if(Object.keys(input).some(k=>!['seasonId','competitionId','limit'].includes(k)))
    throw Error('UNKNOWN_DETAIL_FIELD');
  return {seasonId:input.seasonId,competitionId:input.competitionId,limit};
}
export async function readCompetitionDetail(db,input){
  const {seasonId,competitionId,limit}=validateCompetitionDetail(input);
  const scope={':season':seasonId,':competition':competitionId};
  const paginated={...scope,':limit':limit};
  const competition=await db.get(`SELECT id,season_id AS seasonId,league_id AS leagueId,
    name,type,status,schedule_mode AS scheduleMode,
    current_matchday AS currentMatchday,is_matchday_open AS isMatchdayOpen
    FROM efl_competitions WHERE id=:competition AND season_id=:season`,scope);
  if(!competition)throw Error('COMPETITION_UNAVAILABLE');
  const [participants,fixtures]=await Promise.all([
    db.all(`SELECT p.id,c.id AS clubId,c.name AS clubName,
      c.short_name AS shortName,c.logo_url AS logoUrl,p.seed_number AS seedNumber
      FROM efl_competition_participants p JOIN efl_clubs c ON c.id=p.club_id
      WHERE p.competition_id=:competition AND p.season_id=:season
      ORDER BY p.seed_number ASC,p.id ASC LIMIT :limit`,paginated),
    db.all(`SELECT id,round,status,home_club_id AS homeClubId,
      away_club_id AS awayClubId,home_score AS homeScore,away_score AS awayScore
      FROM efl_fixtures WHERE competition_id=:competition AND season_id=:season
      ORDER BY round ASC,id ASC LIMIT :limit`,paginated)
  ]);
  return {ok:true,competition,participants,fixtures,limit,source:'telegram-serverless'};
}
