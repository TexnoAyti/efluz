// Admin-only, season-scoped read model. This endpoint NEVER edits a fixture.
// Every paginated call checks the signed Telegram identity against the
// database, and no raw Telegram/user identities are returned in club lists.
const validSeason=value=>typeof value==='string'&&/^season-20\d{2}-\d{2}$/.test(value);
export function validateScopedAdminQuery(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!['seasonId','cursor','limit'].includes(k)))
    throw Error('INVALID_ADMIN_SCOPE_REQUEST');
  const {seasonId}=input;
  if(!validSeason(seasonId))throw Error('INVALID_ADMIN_SEASON');
  const cursor=input.cursor??0,limit=input.limit??100;
  if(!Number.isSafeInteger(cursor)||cursor<0||cursor>50000)
    throw Error('INVALID_ADMIN_CURSOR');
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)
    throw Error('INVALID_ADMIN_LIMIT');
  return {seasonId,cursor,limit};
}
export async function readAdminScopedOverview(db,telegramId,input={}){
  if(typeof telegramId!=='string'||!/^[1-9][0-9]{0,19}$/.test(telegramId))
    throw Error('AUTH_REQUIRED');
  const {seasonId,cursor,limit}=validateScopedAdminQuery(input);
  const user=await db.get(`SELECT id,is_admin AS isAdmin,is_banned AS isBanned
    FROM efl_users WHERE telegram_id=:telegram LIMIT 1`,
    {':telegram':telegramId});
  if(!user||!user.isAdmin||user.isBanned)throw Error('ADMIN_FORBIDDEN');
  const params={':season':seasonId};
  const season=await db.get('SELECT id FROM efl_seasons WHERE id=:season',params);
  if(!season)throw Error('ADMIN_SEASON_NOT_FOUND');
  // Never leak partial roster/catalogs. Explicit limits must not silently
  // truncate a tournament or allow a 2027/28 league to appear in 2026/27.
  const [leagues,competitions,clubs,fixtures]=await Promise.all([
    db.all(`SELECT id,name,season_id AS seasonId,country,continent,
       logo_url AS logoUrl,current_round AS currentRound
       FROM efl_leagues WHERE season_id=:season
       ORDER BY sort_order,id LIMIT 101`,params),
    db.all(`SELECT id,season_id AS seasonId,league_id AS leagueId,
       name,type,status,schedule_mode AS scheduleMode,
       format_config AS formatConfig,current_matchday AS currentMatchday,
       is_matchday_open AS isMatchdayOpen
       FROM efl_competitions WHERE season_id=:season ORDER BY id LIMIT 201`,params),
    db.all(`SELECT c.id,c.league_id AS leagueId,c.name,
       c.short_name AS shortName,c.country,c.logo_url AS logoUrl,
       c.stadium,c.created_at AS createdAt
       FROM efl_clubs c JOIN efl_leagues l ON l.id=c.league_id
       WHERE l.season_id=:season ORDER BY l.sort_order,c.sort_order,c.id LIMIT 1001`,params),
    db.all(`SELECT id,season_id AS seasonId,competition_id AS competitionId,
       league_id AS leagueId,round,home_club_id AS homeClubId,
       away_club_id AS awayClubId,home_score AS homeScore,
       away_score AS awayScore,status,
       confirmation_status AS confirmationStatus,
       scheduled_at AS scheduledAt,played_at AS playedAt
       FROM efl_fixtures WHERE season_id=:season
       ORDER BY id LIMIT :limit OFFSET :offset`,
       {...params,':limit':limit+1,':offset':cursor})
  ]);
  if(leagues.length>100||competitions.length>200||clubs.length>1000)
    throw Error('ADMIN_CATALOG_PAGINATION_REQUIRED');
  const hasMore=fixtures.length>limit;
  return {ok:true,seasonId,
    leagues,competitions,clubs,fixtures:fixtures.slice(0,limit),
    nextCursor:hasMore?cursor+limit:null,
    source:'telegram-serverless'};
}
