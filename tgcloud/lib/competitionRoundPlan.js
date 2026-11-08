// Admin-only preview of existing league/cup fixture rounds.
// This is NOT a scheduler, does not invent fixtures and never advances rounds.
// Unresolved previous fixtures are reported instead of silently becoming 0:0.
const validId=s=>typeof s==='string'&&/^[A-Za-z0-9_:-]{1,160}$/.test(s);
const validTelegram=s=>/^[1-9][0-9]{0,19}$/.test(String(s??''));
const safeCount=(value,field)=>{
 const n=Number(value??0);
 if(!Number.isSafeInteger(n)||n<0)throw Error('INVALID_ROUND_PLAN_'+field);
 return n;
};
export function validateCompetitionRoundPlan(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))
  throw Error('INVALID_ROUND_PLAN_REQUEST');
 if(Object.keys(input).some(k=>k!=='competitionId')||!validId(input.competitionId))
  throw Error('INVALID_ROUND_PLAN_COMPETITION');
 return {competitionId:input.competitionId};
}
export async function readCompetitionRoundPlan(db,telegramId,input={}){
 if(!validTelegram(telegramId))throw Error('AUTH_REQUIRED');
 const {competitionId}=validateCompetitionRoundPlan(input);
 const actor=await db.get(`SELECT id,is_admin AS isAdmin,is_banned AS isBanned
   FROM efl_users WHERE telegram_id=:telegram`,{':telegram':String(telegramId)});
 if(!actor?.isAdmin||actor.isBanned)throw Error('ROUND_PLAN_FORBIDDEN');
 const competition=await db.get(`SELECT id,season_id AS seasonId,league_id AS leagueId,
    name,type,status,current_matchday AS currentRound,
    is_matchday_open AS isRoundOpen,schedule_mode AS scheduleMode
    FROM efl_competitions WHERE id=:competition`,{':competition':competitionId});
 if(!competition)throw Error('ROUND_PLAN_COMPETITION_NOT_FOUND');
 const current=competition.currentRound;
 if(!Number.isSafeInteger(current)||current<0)throw Error('INVALID_ROUND_PLAN_CURRENT');
 const params={':competition':competitionId,':season':competition.seasonId,':round':current};
 const totals=await db.get(`SELECT COUNT(*) AS total,
   COALESCE(SUM(CASE WHEN status='CONFIRMED' THEN 1 ELSE 0 END),0) AS confirmed,
   COALESCE(SUM(CASE WHEN status<>'CONFIRMED' THEN 1 ELSE 0 END),0) AS unresolved,
   COALESCE(SUM(CASE WHEN home_club_id IS NULL OR away_club_id IS NULL
     THEN 1 ELSE 0 END),0) AS incompletePairs
   FROM efl_fixtures WHERE competition_id=:competition
    AND season_id=:season AND round=:round`,params);
 const disputes=await db.get(`SELECT COUNT(*) AS open
   FROM efl_disputes d JOIN efl_fixtures f ON f.id=d.fixture_id
   WHERE f.competition_id=:competition AND f.season_id=:season
    AND f.round=:round AND d.status IN ('OPEN','PENDING','UNDER_REVIEW')`,params);
 const upcoming=await db.get(`SELECT MIN(round) AS nextRound, COUNT(*) AS futureFixtures
   FROM efl_fixtures WHERE competition_id=:competition AND season_id=:season
    AND round>:round`,params);
 const nextRound=upcoming?.nextRound??null;
 if(nextRound!==null&&(!Number.isSafeInteger(nextRound)||nextRound<=current))
  throw Error('INVALID_ROUND_PLAN_NEXT');
 const league=competition.leagueId
  ?await db.get(`SELECT current_round AS currentRound
     FROM efl_leagues WHERE id=:league AND season_id=:season`,
    {':league':competition.leagueId,':season':competition.seasonId})
  :null;
 const summary={
  total:safeCount(totals?.total,'TOTAL'),
  confirmed:safeCount(totals?.confirmed,'CONFIRMED'),
  unresolved:safeCount(totals?.unresolved,'UNRESOLVED'),
  incompletePairs:safeCount(totals?.incompletePairs,'PAIRS'),
  openDisputes:safeCount(disputes?.open,'DISPUTES')
 };
 if(summary.confirmed+summary.unresolved!==summary.total)
  throw Error('ROUND_PLAN_INCONSISTENT');
 const reasons=[];
 if(nextRound===null)reasons.push('NO_EXISTING_NEXT_ROUND');
 if(nextRound!==null&&nextRound!==current+1)reasons.push('NEXT_ROUND_GAP');
 if(!['ACTIVE','RUNNING','IN_PROGRESS','PLAYING'].includes(String(competition.status).toUpperCase()))
  reasons.push('COMPETITION_NOT_ACTIVE');
 if(summary.openDisputes)reasons.push('OPEN_DISPUTES');
 if(summary.unresolved)reasons.push('UNRESOLVED_PREVIOUS_FIXTURES');
 if(competition.leagueId&&!league)reasons.push('LEAGUE_NOT_FOUND');
 if(league&&league.currentRound!==current)reasons.push('LEAGUE_ROUND_MISMATCH');
 // Report unresolved matches for admin review, but never require they be
 // completed to construct the next round; advancement policy is decided later.
 return {ok:true,readOnly:true,source:'telegram-serverless',competition:{
   id:competition.id,name:competition.name,type:competition.type,status:competition.status,
   currentRound:current,roundOpen:!!competition.isRoundOpen,
   scheduleMode:competition.scheduleMode},
  current:summary,
  next:{round:nextRound,existingFixtures:safeCount(upcoming?.futureFixtures,'FUTURE')},
  leagueRound:league?.currentRound??null,
  // Unfinished previous fixtures are informational, not a manual-advance blocker.
  // This preview does not enable any mutation endpoint or Telegram delivery.
  canAdvanceManually:reasons.every(reason=>reason==='UNRESOLVED_PREVIOUS_FIXTURES'),
  requiresExplicitReview:reasons.length>0,
  reasons,
  canAdvanceAutomatically:false,
  note:'Existing rounds only; no fixtures, scores or notifications are changed.'};
}
