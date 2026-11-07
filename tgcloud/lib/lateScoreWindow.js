// Explicit administrator-controlled fixture result windows for unfinished
// historical rounds. Shadow-only: writes are gated at the endpoint.
// This never creates a fixture, changes a score, or alters matchday counters.
const validId=x=>typeof x==='string'&&/^[a-zA-Z0-9_:-]{1,160}$/.test(x);
const validTelegram=x=>/^[1-9][0-9]{0,19}$/.test(String(x??''));
export function validateLateScoreWindow(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!['fixtureId','open'].includes(k))||
    !validId(input.fixtureId)||typeof input.open!=='boolean')
  throw Error('INVALID_LATE_SCORE_WINDOW');
 return {fixtureId:input.fixtureId,open:input.open};
}
export async function setLateScoreWindow(db,telegramId,input={}){
 if(!validTelegram(telegramId))throw Error('AUTH_REQUIRED');
 const request=validateLateScoreWindow(input);
 const admin=await db.get(`SELECT id,is_admin AS admin,is_banned AS banned
   FROM efl_users WHERE telegram_id=:telegram`,{':telegram':String(telegramId)});
 if(!admin?.admin||admin.banned)throw Error('LATE_SCORE_WINDOW_FORBIDDEN');
 const fixture=await db.get(`SELECT f.id,f.season_id AS seasonId,
  f.competition_id AS competitionId,f.round,f.status,
  c.current_matchday AS currentRound
  FROM efl_fixtures f JOIN efl_competitions c
   ON c.id=f.competition_id AND c.season_id=f.season_id
  WHERE f.id=:fixture`,{':fixture':request.fixtureId});
 if(!fixture)throw Error('LATE_SCORE_FIXTURE_NOT_FOUND');
 if(!Number.isSafeInteger(fixture.round)||!Number.isSafeInteger(fixture.currentRound)||
    fixture.round>=fixture.currentRound)
  throw Error('LATE_SCORE_NOT_HISTORICAL');
 if(request.open&&fixture.status!=='SCHEDULED')throw Error('LATE_SCORE_ALREADY_FINAL');
 const params={':fixture':fixture.id,':season':fixture.seasonId,
  ':competition':fixture.competitionId,':open':request.open?1:0,
  ':telegram':String(telegramId),':now':Date.now()};
 // The eligibility and role check are repeated inside the write.
 // Explicitly closed windows are retained, never deleted by this operation.
 await db.run(`INSERT INTO efl_fixture_score_windows
   (fixture_id,season_id,competition_id,is_open,authorized_by,updated_at)
  SELECT :fixture,:season,:competition,:open,u.id,:now
   FROM efl_users u JOIN efl_fixtures f ON f.id=:fixture
    JOIN efl_competitions c ON c.id=f.competition_id AND c.season_id=f.season_id
   WHERE u.telegram_id=:telegram AND u.is_admin=1 AND u.is_banned=0
    AND f.season_id=:season AND f.competition_id=:competition
    AND f.round<c.current_matchday
    AND (:open=0 OR f.status='SCHEDULED')
  ON CONFLICT(fixture_id) DO UPDATE SET
    is_open=excluded.is_open,authorized_by=excluded.authorized_by,
    updated_at=excluded.updated_at
  WHERE efl_fixture_score_windows.season_id=excluded.season_id
    AND efl_fixture_score_windows.competition_id=excluded.competition_id`,params);
 const saved=await db.get(`SELECT w.is_open AS isOpen,w.season_id AS seasonId,
    w.competition_id AS competitionId
   FROM efl_fixture_score_windows w WHERE w.fixture_id=:fixture`,
   {':fixture':fixture.id});
 if(!saved||Boolean(saved.isOpen)!==request.open||
    saved.seasonId!==fixture.seasonId||saved.competitionId!==fixture.competitionId)
  throw Error('LATE_SCORE_WINDOW_CONFLICT');
 return {ok:true,fixtureId:fixture.id,open:request.open,
  currentRound:fixture.currentRound,fixtureRound:fixture.round,
  notificationQueued:false,source:'telegram-serverless'};
}
