// Shadow-only UZEFLIFE result finalization. This module is deliberately
// dependency-injected; the production mutation gate remains permanently off
// until the Telegram-hosted transaction and bracket advancement are verified.
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_:-]{1,160}$/.test(v);
const score=v=>Number.isSafeInteger(v)&&v>=0&&v<=99;
export function validateUzeflifeDecision(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!validId(input.fixtureId))
  throw Error('INVALID_UZEFLIFE_FIXTURE');
 if(Object.keys(input).some(k=>!['fixtureId','homeScore','awayScore','penaltyHome','penaltyAway'].includes(k)))
  throw Error('UNKNOWN_UZEFLIFE_DECISION_FIELD');
 if(!score(input.homeScore)||!score(input.awayScore))throw Error('INVALID_UZEFLIFE_SCORE');
 const hp=input.penaltyHome??null,ap=input.penaltyAway??null;
 if((hp===null)!==(ap===null)||hp!==null&&(!score(hp)||!score(ap)))
  throw Error('INVALID_UZEFLIFE_PENALTIES');
 if(input.homeScore===input.awayScore){
  if(hp===null||hp===ap)throw Error('UZEFLIFE_DRAW_NEEDS_WINNER');
 }else if(hp!==null)throw Error('UZEFLIFE_PENALTIES_NOT_APPLICABLE');
 return {fixtureId:input.fixtureId,homeScore:input.homeScore,
  awayScore:input.awayScore,penaltyHome:hp,penaltyAway:ap};
}
export async function finalizeUzeflifeResult(db,telegramId,input){
 if(!/^[1-9][0-9]{0,19}$/.test(String(telegramId??'')))throw Error('AUTH_REQUIRED');
 const decision=validateUzeflifeDecision(input);
 const admin=await db.get('SELECT id,is_admin AS isAdmin,is_banned AS isBanned FROM efl_users WHERE telegram_id=:telegram',
  {':telegram':String(telegramId)});
 if(!admin||!admin.isAdmin||admin.isBanned)throw Error('UZEFLIFE_ADMIN_FORBIDDEN');
 const state=await db.get("SELECT status,current_round AS currentRound FROM efl_uzeflife_state WHERE id='uzeflife'");
 if(!state||!['ACTIVE','IN_PROGRESS','RUNNING'].includes(String(state.status).toUpperCase()))
  throw Error('UZEFLIFE_NOT_ACTIVE');
 const match=await db.get(`SELECT id,round,home,away,winner,
   home_score AS homeScore,away_score AS awayScore,
   penalty_home AS penaltyHome,penalty_away AS penaltyAway
   FROM efl_uzeflife_fixtures WHERE id=:id`,{':id':decision.fixtureId});
 if(!match)throw Error('UZEFLIFE_MATCH_NOT_FOUND');
 if(match.round!==state.currentRound)throw Error('UZEFLIFE_ROUND_LOCKED');
 if(typeof match.home!=='string'||!match.home.trim()||
    typeof match.away!=='string'||!match.away.trim()||match.home===match.away)
  throw Error('UZEFLIFE_OPPONENTS_INCOMPLETE');
 const winner=(decision.homeScore===decision.awayScore
   ?decision.penaltyHome>decision.penaltyAway
   :decision.homeScore>decision.awayScore)?match.home:match.away;
 const identical=match.winner===winner&&match.homeScore===decision.homeScore&&
  match.awayScore===decision.awayScore&&(match.penaltyHome??null)===decision.penaltyHome&&
  (match.penaltyAway??null)===decision.penaltyAway;
 if(match.winner!==null&&match.winner!==undefined){
  if(!identical)throw Error('UZEFLIFE_RESULT_CONFLICT');
  return {ok:true,fixtureId:match.id,winner,replayed:true};
 }
 const params={':id':match.id,':round':state.currentRound,':home':match.home,
  ':away':match.away,':winner':winner,':homeScore':decision.homeScore,
  ':awayScore':decision.awayScore,':penaltyHome':decision.penaltyHome,
  ':penaltyAway':decision.penaltyAway,':telegram':String(telegramId)};
 await db.run(`UPDATE efl_uzeflife_fixtures SET
   winner=:winner,home_score=:homeScore,away_score=:awayScore,
   penalty_home=:penaltyHome,penalty_away=:penaltyAway
   WHERE id=:id AND round=:round AND home=:home AND away=:away
     AND winner IS NULL
     AND EXISTS(SELECT 1 FROM efl_uzeflife_state s WHERE s.id='uzeflife'
       AND UPPER(s.status) IN ('ACTIVE','IN_PROGRESS','RUNNING')
       AND s.current_round=:round)
     AND EXISTS(SELECT 1 FROM efl_users u WHERE u.telegram_id=:telegram
       AND u.is_admin=1 AND u.is_banned=0)`,params);
 const saved=await db.get(`SELECT winner,home_score AS homeScore,away_score AS awayScore,
   penalty_home AS penaltyHome,penalty_away AS penaltyAway
   FROM efl_uzeflife_fixtures WHERE id=:id`,{':id':match.id});
 if(!saved||saved.winner!==winner||saved.homeScore!==decision.homeScore||
  saved.awayScore!==decision.awayScore||(saved.penaltyHome??null)!==decision.penaltyHome||
  (saved.penaltyAway??null)!==decision.penaltyAway)
  throw Error('UZEFLIFE_WRITE_CONFLICT');
 // Bracket progression, notifications, evidence, and audit events are not
 // side effects here; they require a reviewed atomic outbox before go-live.
 return {ok:true,fixtureId:match.id,winner,replayed:false};
}
