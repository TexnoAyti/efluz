// Staging-only club claim engine. Database uniqueness is the last line of
// defense against parallel reservations of the same club or second club
// by the same player in one league. No automatic rollback/reassignment.
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_:-]{1,120}$/.test(value);
export function validateClubClaim(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('INVALID_CLAIM');
  const {seasonId,clubId,requestId}=input;
  if(!validId(seasonId)||!validId(clubId)||
    typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(requestId))
    throw Error('INVALID_CLAIM_ID');
  if(Object.keys(input).some(k=>!['seasonId','clubId','requestId'].includes(k)))
    throw Error('UNKNOWN_CLAIM_FIELD');
  return {seasonId,clubId,requestId};
}
export async function claimClub(db,uid,input){
  if(!validId(uid))throw Error('AUTH_REQUIRED');
  const {seasonId,clubId,requestId}=validateClubClaim(input);
  const user=await db.get('SELECT id,telegram_id,is_banned FROM efl_users WHERE id=:user',
    {':user':uid});
  if(!user||user.is_banned)throw Error('CLUB_CLAIM_BANNED');
  const candidate=await db.get(`SELECT c.id,c.league_id AS leagueId,l.season_id AS seasonId,
    l.status AS leagueStatus,s.status AS seasonStatus
    FROM efl_clubs c JOIN efl_leagues l ON l.id=c.league_id
    JOIN efl_seasons s ON s.id=l.season_id WHERE c.id=:club AND s.id=:season`,
    {':club':clubId,':season':seasonId});
  if(!candidate||candidate.seasonId!==seasonId||candidate.leagueStatus!=='OPEN'||
    !['ACTIVE','UPCOMING'].includes(candidate.seasonStatus))
    throw Error('CLUB_CLAIM_CLOSED');
  const id='claim:'+seasonId+':'+clubId+':'+uid+':'+requestId;
  const params={':id':id,':season':seasonId,':club':clubId,':user':uid,
    ':telegram':user.telegram_id,':now':Date.now()};
  // Re-check all write conditions within the INSERT. Unique indexes on
  // (season,club) and (season,league,user), partial on status=ACTIVE, prevent
  // two-player races and multi-club selection in the same league.
  const inserted=await db.run(`INSERT INTO efl_club_occupancies
    (id,season_id,league_id,club_id,user_id,telegram_id,status,joined_at,updated_at)
    SELECT :id,l.season_id,l.id,c.id,u.id,u.telegram_id,'ACTIVE',:now,:now
    FROM efl_clubs c JOIN efl_leagues l ON l.id=c.league_id
    JOIN efl_seasons s ON s.id=l.season_id
    JOIN efl_users u ON u.id=:user AND u.telegram_id=:telegram
    WHERE c.id=:club AND s.id=:season AND l.status='OPEN'
      AND s.status IN ('ACTIVE','UPCOMING') AND u.is_banned=0
    ON CONFLICT DO NOTHING`,params);
  // Never assume an ignored INSERT means a successful claim; it could be
  // another owner, a closed window, or an existing club in the same league.
  const own=await db.get(`SELECT id,club_id AS clubId,league_id AS leagueId,
    user_id AS userId FROM efl_club_occupancies WHERE season_id=:season
    AND club_id=:club AND status='ACTIVE' LIMIT 1`,
    {':season':seasonId,':club':clubId});
  if(!own||own.userId!==uid||own.leagueId!==candidate.leagueId)throw Error('CLUB_CLAIM_CONFLICT');
  return {ok:true,clubId,seasonId,leagueId:own.leagueId,
    alreadyClaimed:!(inserted?.rowsAffected>0),source:'telegram-serverless'};
}
