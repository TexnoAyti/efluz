// Shadow-only atomic league advancement. Unlike cups, league progression
// updates TWO tables: efl_leagues and efl_competitions. The caller MUST supply
// a transaction provider verified to keep both writes on the same connection.
// Deliberately no Telegram endpoint until hosted SDK transaction support is proven.
import {validateAdvanceRound} from './advanceCupRound.js';
const validTelegram=id=>/^[1-9][0-9]{0,19}$/.test(String(id??''));
const activeStatuses=['ACTIVE','RUNNING','IN_PROGRESS','PLAYING'];
export async function advanceLeagueRound(db,telegramId,input={},withTransaction){
 if(!validTelegram(telegramId))throw Error('AUTH_REQUIRED');
 const req=validateAdvanceRound(input);
 // Never attempt a partial update using ordinary, independently committed db.run.
 if(typeof withTransaction!=='function')
  throw Error('LEAGUE_TRANSACTION_REQUIRED');
 return await withTransaction(async tx=>{
  if(!tx||typeof tx.get!=='function'||typeof tx.run!=='function')
   throw Error('LEAGUE_TRANSACTION_REQUIRED');
  const params={':competition':req.competitionId,':round':req.expectedRound,
   ':next':req.nextRound,':telegram':String(telegramId)};
  const actor=await tx.get(`SELECT id,is_admin AS admin,is_banned AS banned
    FROM efl_users WHERE telegram_id=:telegram`,{':telegram':String(telegramId)});
  if(!actor?.admin||actor.banned)throw Error('LEAGUE_ADVANCE_FORBIDDEN');
  const comp=await tx.get(`SELECT id,season_id AS seasonId,
    league_id AS leagueId,type,status,current_matchday AS round
    FROM efl_competitions WHERE id=:competition`,
   {':competition':req.competitionId});
  if(!comp||!comp.leagueId||String(comp.type).toUpperCase()!=='LEAGUE')
   throw Error('LEAGUE_COMPETITION_NOT_FOUND');
  if(!activeStatuses.includes(String(comp.status).toUpperCase()))
   throw Error('LEAGUE_NOT_ACTIVE');
  const league=await tx.get(`SELECT id,current_round AS round,status
    FROM efl_leagues WHERE id=:league AND season_id=:season`,
    {':league':comp.leagueId,':season':comp.seasonId});
  if(!league)throw Error('LEAGUE_NOT_FOUND');
  if(comp.round===req.nextRound&&league.round===req.nextRound){
   const future=await tx.get(`SELECT 1 AS existsRound FROM efl_fixtures
    WHERE competition_id=:competition AND season_id=:season AND round=:next LIMIT 1`,
    {':competition':comp.id,':season':comp.seasonId,':next':req.nextRound});
   if(!future)throw Error('LEAGUE_ADVANCE_INVALID_REPLAY');
   return {ok:true,replayed:true,currentRound:req.nextRound,oldFixturesPreserved:true};
  }
  if(comp.round!==req.expectedRound||league.round!==req.expectedRound)
   throw Error('LEAGUE_ROUND_MISMATCH');
  if(!activeStatuses.includes(String(league.status).toUpperCase()))
   throw Error('LEAGUE_NOT_ACTIVE');
  params[':league']=league.id;
  params[':season']=comp.seasonId;
  params[':now']=Date.now();
  // First update the league row with all mutable safety checks. If the
  // competition update is rejected, the transaction provider MUST roll back.
  await tx.run(`UPDATE efl_leagues SET current_round=:next,updated_at=:now
    WHERE id=:league AND season_id=:season AND current_round=:round
     AND UPPER(status) IN ('ACTIVE','RUNNING','IN_PROGRESS','PLAYING')
     AND EXISTS(SELECT 1 FROM efl_users u WHERE u.telegram_id=:telegram
      AND u.is_admin=1 AND u.is_banned=0)
     AND EXISTS(SELECT 1 FROM efl_competitions c
      WHERE c.id=:competition AND c.league_id=efl_leagues.id
       AND c.season_id=efl_leagues.season_id AND c.current_matchday=:round
       AND UPPER(c.type)='LEAGUE'
       AND UPPER(c.status) IN ('ACTIVE','RUNNING','IN_PROGRESS','PLAYING'))
     AND EXISTS(SELECT 1 FROM efl_fixtures f
      WHERE f.competition_id=:competition AND f.season_id=:season
       AND f.round=:next)
     AND NOT EXISTS(SELECT 1 FROM efl_disputes d
       JOIN efl_fixtures f ON f.id=d.fixture_id
       WHERE f.competition_id=:competition AND f.season_id=:season
        AND f.round=:round AND d.status IN ('OPEN','PENDING','UNDER_REVIEW'))`,params);
  await tx.run(`UPDATE efl_competitions
    SET current_matchday=:next,is_matchday_open=1,updated_at=:now
    WHERE id=:competition AND season_id=:season AND league_id=:league
     AND UPPER(type)='LEAGUE' AND current_matchday=:round
     AND UPPER(status) IN ('ACTIVE','RUNNING','IN_PROGRESS','PLAYING')
     AND EXISTS(SELECT 1 FROM efl_leagues l
      WHERE l.id=:league AND l.season_id=:season AND l.current_round=:next
       AND UPPER(l.status) IN ('ACTIVE','RUNNING','IN_PROGRESS','PLAYING'))
     AND EXISTS(SELECT 1 FROM efl_users u WHERE u.telegram_id=:telegram
      AND u.is_admin=1 AND u.is_banned=0)
     AND EXISTS(SELECT 1 FROM efl_fixtures f
      WHERE f.competition_id=:competition AND f.season_id=:season
       AND f.round=:next)
     AND NOT EXISTS(SELECT 1 FROM efl_disputes d
       JOIN efl_fixtures f ON f.id=d.fixture_id
       WHERE f.competition_id=:competition AND f.season_id=:season
        AND f.round=:round AND d.status IN ('OPEN','PENDING','UNDER_REVIEW'))`,params);
  const saved=await tx.get(`SELECT c.current_matchday AS competitionRound,
    l.current_round AS leagueRound
    FROM efl_competitions c JOIN efl_leagues l
     ON l.id=c.league_id AND l.season_id=c.season_id
    WHERE c.id=:competition AND c.season_id=:season`,
    {':competition':comp.id,':season':comp.seasonId});
  if(saved?.competitionRound!==req.nextRound||saved?.leagueRound!==req.nextRound)
   throw Error('LEAGUE_ADVANCE_CONFLICT');
  return {ok:true,replayed:false,currentRound:req.nextRound,
    oldFixturesPreserved:true,notificationsQueued:false};
 });
}
