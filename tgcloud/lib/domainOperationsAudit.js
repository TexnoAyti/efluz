// Read-only, authenticated cross-domain operational audit for isolated staging.
// No individual user records, private rosters or source archive are returned.
const telegramIdValid=id=>/^[1-9][0-9]{0,19}$/.test(String(id??''));
const integer=(value,name)=>{
 const number=Number(value??0);
 if(!Number.isSafeInteger(number)||number<0)throw Error('INVALID_DOMAIN_AUDIT_'+name);
 return number;
};
export async function readDomainOperationsAudit(db,telegramId,input={}){
 if(!telegramIdValid(telegramId))throw Error('AUTH_REQUIRED');
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)
  throw Error('INVALID_DOMAIN_AUDIT_REQUEST');
 const admin=await db.get(`SELECT id,is_admin AS isAdmin,is_banned AS isBanned
   FROM efl_users WHERE telegram_id=:telegram`,{':telegram':String(telegramId)});
 if(!admin?.isAdmin||admin.isBanned)throw Error('DOMAIN_AUDIT_FORBIDDEN');
 const season=await db.get(`SELECT id,name FROM efl_seasons
   WHERE is_active=1 ORDER BY created_at DESC,id DESC LIMIT 1`);
 const seasonId=season?.id??null;
 const params={':season':seasonId};
 const league=await db.get(`SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN status IN ('OPEN','ACTIVE','RUNNING','IN_PROGRESS') THEN 1 ELSE 0 END),0) AS open
    FROM efl_leagues WHERE season_id=:season`,params);
 const fixture=await db.get(`SELECT
    COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN f.status='CONFIRMED' THEN 1 ELSE 0 END),0) AS confirmed,
    COALESCE(SUM(CASE WHEN f.status<>'CONFIRMED' THEN 1 ELSE 0 END),0) AS unresolved
    FROM efl_fixtures f
    WHERE f.season_id=:season`,params);
 const cups=await db.get(`SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN status NOT IN ('COMPLETED','FINISHED','DONE','CANCELLED')
      THEN 1 ELSE 0 END),0) AS unfinished
    FROM efl_competitions WHERE season_id=:season AND UPPER(type) NOT IN ('LEAGUE')`,params);
 const disputes=await db.get(`SELECT COUNT(*) AS unresolved
    FROM efl_disputes WHERE season_id=:season
     AND status IN ('OPEN','PENDING','UNDER_REVIEW')`,params);
 const teams=await db.get(`SELECT COUNT(*) AS total,
    COALESCE(SUM(unresolved_member_count),0) AS unresolvedMembers
    FROM efl_teams_catalog`);
 const teamRequests=await db.get(`SELECT COUNT(*) AS pending
    FROM efl_team_join_requests WHERE status='PENDING'`);
 const uzeflife=await db.get(`SELECT current_round AS currentRound,
   participants_count AS participants, matches_count AS matches,status
   FROM efl_uzeflife_state WHERE id='uzeflife'`);
 const uzeflifeFixtures=await db.get(`SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN winner IS NOT NULL THEN 1 ELSE 0 END),0) AS finished,
    COALESCE(SUM(CASE WHEN winner IS NULL THEN 1 ELSE 0 END),0) AS unresolved
    FROM efl_uzeflife_fixtures
    WHERE round=(SELECT current_round FROM efl_uzeflife_state WHERE id='uzeflife')`);
 const inbox=await db.get(`SELECT COUNT(*) AS total,
    COALESCE(SUM(CASE WHEN is_read=0 THEN 1 ELSE 0 END),0) AS unread
    FROM efl_notifications`);
 const result={
  ok:true,readOnly:true,source:'telegram-serverless',
  season:season?{name:String(season.name).slice(0,120)}:null,
  leagues:{total:integer(league?.total,'LEAGUES'),open:integer(league?.open,'OPEN_LEAGUES')},
  fixtures:{total:integer(fixture?.total,'FIXTURES'),confirmed:integer(fixture?.confirmed,'CONFIRMED'),
   unresolved:integer(fixture?.unresolved,'UNRESOLVED_FIXTURES')},
  cups:{total:integer(cups?.total,'CUPS'),unfinished:integer(cups?.unfinished,'UNFINISHED_CUPS')},
  disputes:{unresolved:integer(disputes?.unresolved,'DISPUTES')},
  teams:{total:integer(teams?.total,'TEAMS'),unresolvedMembers:integer(teams?.unresolvedMembers,'TEAM_MEMBERS'),
   pendingRequests:integer(teamRequests?.pending,'TEAM_REQUESTS')},
  uzeflife:{available:!!uzeflife,status:uzeflife?String(uzeflife.status).slice(0,32):null,
   currentRound:integer(uzeflife?.currentRound,'UZEFLIFE_ROUND'),
   participants:integer(uzeflife?.participants,'UZEFLIFE_PARTICIPANTS'),
   matches:integer(uzeflife?.matches,'UZEFLIFE_MATCHES'),
   currentRoundTotal:integer(uzeflifeFixtures?.total,'UZEFLIFE_ROUND_TOTAL'),
   currentRoundFinished:integer(uzeflifeFixtures?.finished,'UZEFLIFE_FINISHED'),
   currentRoundUnresolved:integer(uzeflifeFixtures?.unresolved,'UZEFLIFE_UNRESOLVED')},
  notifications:{total:integer(inbox?.total,'NOTIFICATIONS'),unread:integer(inbox?.unread,'UNREAD')}
 };
 if(result.fixtures.total!==result.fixtures.confirmed+result.fixtures.unresolved||
    result.uzeflife.currentRoundTotal!==
    result.uzeflife.currentRoundFinished+result.uzeflife.currentRoundUnresolved)
  throw Error('DOMAIN_AUDIT_INCONSISTENT_COUNTS');
 return result;
}
