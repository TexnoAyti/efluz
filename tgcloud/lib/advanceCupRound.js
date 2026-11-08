// Shadow-only atomic single-row round advancement for non-league competitions.
// Existing fixtures are used. No scores, pairings, winners, or league counters
// are fabricated. Production mutation gate is enforced by the endpoint.
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_:-]{1,160}$/.test(v);
const validTelegram=v=>/^[1-9][0-9]{0,19}$/.test(String(v??''));
export function validateAdvanceRound(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!['competitionId','expectedRound','nextRound'].includes(k))||
    !validId(input.competitionId)||!Number.isSafeInteger(input.expectedRound)||
    input.expectedRound<0||!Number.isSafeInteger(input.nextRound)||
    input.nextRound!==input.expectedRound+1)
  throw Error('INVALID_ADVANCE_ROUND');
 return {competitionId:input.competitionId,expectedRound:input.expectedRound,
  nextRound:input.nextRound};
}
export async function advanceCupRound(db,telegramId,input={}){
 if(!validTelegram(telegramId))throw Error('AUTH_REQUIRED');
 const request=validateAdvanceRound(input);
 const actor=await db.get(`SELECT id,is_admin AS admin,is_banned AS banned
   FROM efl_users WHERE telegram_id=:telegram`,{':telegram':String(telegramId)});
 if(!actor?.admin||actor.banned)throw Error('ROUND_ADVANCE_FORBIDDEN');
 const params={':competition':request.competitionId,
  ':round':request.expectedRound,':next':request.nextRound,
  ':telegram':String(telegramId)};
 const competition=await db.get(`SELECT id,season_id AS seasonId,
   league_id AS leagueId,type,status,current_matchday AS currentRound
   FROM efl_competitions WHERE id=:competition`,
   {':competition':request.competitionId});
 if(!competition)throw Error('ROUND_ADVANCE_NOT_FOUND');
 if(competition.leagueId||String(competition.type).toUpperCase()==='LEAGUE')
  throw Error('ROUND_ADVANCE_LEAGUE_REQUIRES_TRANSACTION');
 if(!['ACTIVE','RUNNING','IN_PROGRESS','PLAYING'].includes(String(competition.status).toUpperCase()))
  throw Error('ROUND_ADVANCE_NOT_ACTIVE');
 if(competition.currentRound===request.nextRound){
  // Idempotent retry is safe only when the requested next round really exists.
  const exists=await db.get(`SELECT 1 AS present FROM efl_fixtures
   WHERE competition_id=:competition AND round=:next AND season_id=:season LIMIT 1`,
   {':competition':request.competitionId,':next':request.nextRound,':season':competition.seasonId});
  if(!exists)throw Error('ROUND_ADVANCE_INVALID_REPLAY');
  return {ok:true,advanced:true,replayed:true,currentRound:request.nextRound};
 }
 if(competition.currentRound!==request.expectedRound)
  throw Error('ROUND_ADVANCE_STALE_ROUND');
 // The compare-and-swap is a single SQLite statement. Pending previous-round
 // fixtures are deliberately not required to be confirmed. Open disputes in the
 // previous round cannot be silently bypassed; review them first.
 await db.run(`UPDATE efl_competitions
 SET current_matchday=:next,is_matchday_open=1
 WHERE id=:competition AND current_matchday=:round AND league_id IS NULL
   AND UPPER(type)<>'LEAGUE'
   AND UPPER(status) IN ('ACTIVE','RUNNING','IN_PROGRESS','PLAYING')
   AND EXISTS(SELECT 1 FROM efl_users u WHERE u.telegram_id=:telegram
       AND u.is_admin=1 AND u.is_banned=0)
   AND EXISTS(SELECT 1 FROM efl_fixtures next
      WHERE next.competition_id=efl_competitions.id
       AND next.season_id=efl_competitions.season_id AND next.round=:next)
   AND NOT EXISTS(SELECT 1 FROM efl_disputes d
      JOIN efl_fixtures f ON f.id=d.fixture_id
      WHERE f.competition_id=efl_competitions.id
       AND f.season_id=efl_competitions.season_id AND f.round=:round
       AND d.status IN ('OPEN','PENDING','UNDER_REVIEW'))`,params);
 const saved=await db.get(`SELECT current_matchday AS currentRound
 FROM efl_competitions WHERE id=:competition`,{':competition':request.competitionId});
 if(saved?.currentRound!==request.nextRound)throw Error('ROUND_ADVANCE_CONFLICT_OR_DISPUTE');
 return {ok:true,advanced:true,replayed:false,currentRound:request.nextRound,
  oldFixturesPreserved:true,notificationsQueued:false};
}
