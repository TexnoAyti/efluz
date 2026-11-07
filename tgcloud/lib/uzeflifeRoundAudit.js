// Read-only UZEFLIFE round operations: audit the *existing* round format.
// Does not create a playoff, advance rounds, send messages or alter fixtures.
const telegram=id=>/^[1-9][0-9]{0,19}$/.test(String(id??''));
export async function readUzeflifeRoundAudit(db,telegramId,input={}){
 if(!telegram(telegramId))throw Error('AUTH_REQUIRED');
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(key=>!['limit','cursor'].includes(key)))
  throw Error('INVALID_UZEFLIFE_AUDIT');
 const limit=input.limit??40,cursor=input.cursor??0;
 if(!Number.isSafeInteger(limit)||limit<1||limit>80)throw Error('INVALID_UZEFLIFE_LIMIT');
 if(!Number.isSafeInteger(cursor)||cursor<0||cursor>1000000)throw Error('INVALID_UZEFLIFE_CURSOR');
 const staff=await db.get('SELECT id,is_admin AS admin,is_banned AS banned FROM efl_users WHERE telegram_id=:telegram',
  {':telegram':String(telegramId)});
 if(!staff?.admin||staff.banned)throw Error('UZEFLIFE_ADMIN_FORBIDDEN');
 const state=await db.get("SELECT current_round AS currentRound,status,name FROM efl_uzeflife_state WHERE id='uzeflife'");
 if(!state)return {ok:true,available:false,source:'telegram-serverless'};
 const round=state.currentRound;
 if(!Number.isSafeInteger(round)||round<0)throw Error('INVALID_UZEFLIFE_ROUND');
 const count=await db.get(`SELECT COUNT(*) AS total,
   COALESCE(SUM(CASE WHEN winner IS NOT NULL THEN 1 ELSE 0 END),0) AS completed,
   COALESCE(SUM(CASE WHEN winner IS NULL THEN 1 ELSE 0 END),0) AS unresolved,
   COALESCE(SUM(CASE WHEN winner IS NULL AND
      (trim(home)='' OR trim(away)='') THEN 1 ELSE 0 END),0) AS incompleteOpponents
   FROM efl_uzeflife_fixtures WHERE round=:round`,{':round':round});
 const stats={};
 for(const field of ['total','completed','unresolved','incompleteOpponents']){
  const n=Number(count?.[field]);
  if(!Number.isSafeInteger(n)||n<0)throw Error('INVALID_UZEFLIFE_AUDIT_COUNT');
  stats[field]=n;
 }
 if(stats.total!==stats.completed+stats.unresolved)throw Error('UZEFLIFE_AUDIT_INCONSISTENT');
 const rows=await db.all(`SELECT id,round,home,away,winner,
   home_score AS homeScore,away_score AS awayScore,
   penalty_home AS penaltyHome,penalty_away AS penaltyAway
   FROM efl_uzeflife_fixtures WHERE round=:round
   ORDER BY bracket ASC,id ASC LIMIT :limit OFFSET :cursor`,
   {':round':round,':limit':limit+1,':cursor':cursor});
 return {ok:true,available:true,round,status:state.status,
   stats,fixtures:rows.slice(0,limit),
   nextCursor:rows.length>limit?cursor+limit:null,
   format:'existing-rounds',readOnly:true,source:'telegram-serverless'};
}
