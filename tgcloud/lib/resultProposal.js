// Pure validation and dependency-injected, conditional result proposal.
// An unapproved proposal NEVER changes the fixture's score or standings.
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_:-]{1,120}$/.test(value);
export function validateResultProposal(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('INVALID_PROPOSAL');
  const {fixtureId,homeScore,awayScore}=input;
  if(!validId(fixtureId))throw Error('INVALID_FIXTURE_ID');
  if(!Number.isSafeInteger(homeScore)||homeScore<0||homeScore>99||
     !Number.isSafeInteger(awayScore)||awayScore<0||awayScore>99)throw Error('INVALID_SCORE');
  if(Object.keys(input).some(k=>!['fixtureId','homeScore','awayScore'].includes(k)))
    throw Error('UNKNOWN_PROPOSAL_FIELD');
  return {fixtureId,homeScore,awayScore};
}
export async function proposeFixtureResult(db,uid,input){
  const proposal=validateResultProposal(input);
  if(!validId(uid))throw Error('AUTH_REQUIRED');
  const actor=await db.get('SELECT id,telegram_id,is_banned FROM efl_users WHERE id=:id',
    {':id':uid});
  if(!actor||actor.is_banned)throw Error('USER_BANNED_OR_MISSING');
  const fixture=await db.get(`SELECT f.id,f.season_id,f.round,f.status,
     f.home_club_id,f.away_club_id,f.competition_id,
     c.current_matchday,c.is_matchday_open
     FROM efl_fixtures f JOIN efl_competitions c
       ON c.id=f.competition_id AND c.season_id=f.season_id
     WHERE f.id=:fixture`,{':fixture':proposal.fixtureId});
  if(!fixture)throw Error('FIXTURE_UNAVAILABLE');
  if(fixture.status!=='SCHEDULED'||!fixture.is_matchday_open||
    fixture.round!==fixture.current_matchday||
    !fixture.home_club_id||!fixture.away_club_id||
    fixture.home_club_id===fixture.away_club_id)throw Error('MATCHDAY_LOCKED');
  const occupancy=await db.get(`SELECT club_id FROM efl_club_occupancies
    WHERE season_id=:season AND user_id=:user AND telegram_id=:telegram
    AND status='ACTIVE' AND club_id IN (:home,:away) LIMIT 1`,{
    ':season':fixture.season_id,':user':uid,':telegram':actor.telegram_id,
    ':home':fixture.home_club_id,':away':fixture.away_club_id
  });
  if(!occupancy)throw Error('FIXTURE_FORBIDDEN');
  const submissionId=proposal.fixtureId+':'+uid;
  const previous=await db.get(`SELECT id FROM efl_result_submissions
    WHERE id=:id AND submitted_by_user_id=:user`,{':id':submissionId,':user':uid});
  const params={':id':submissionId,':fixture':proposal.fixtureId,
    ':user':uid,':club':occupancy.club_id,':homeScore':proposal.homeScore,
    ':awayScore':proposal.awayScore,':now':Date.now(),':telegram':actor.telegram_id};
  // Eligibility is repeated inside the insert to avoid a stale read
  // authorizing writes after the matchday closes or the club is released.
  await db.run(`INSERT INTO efl_result_submissions
    (id,fixture_id,submitted_by_user_id,club_id,home_score,away_score,created_at)
    SELECT :id,:fixture,:user,:club,:homeScore,:awayScore,:now
    FROM efl_fixtures f JOIN efl_competitions c
      ON c.id=f.competition_id AND c.season_id=f.season_id
    JOIN efl_users u ON u.id=:user AND u.telegram_id=:telegram
    JOIN efl_club_occupancies o ON o.user_id=u.id AND o.telegram_id=u.telegram_id
      AND o.season_id=f.season_id AND o.club_id=:club AND o.status='ACTIVE'
    WHERE f.id=:fixture AND f.status='SCHEDULED' AND c.is_matchday_open=1
      AND f.round=c.current_matchday AND u.is_banned=0
      AND (o.club_id=f.home_club_id OR o.club_id=f.away_club_id)
      AND f.home_club_id IS NOT NULL AND f.away_club_id IS NOT NULL
    ON CONFLICT DO NOTHING`,params);
  const record=await db.get(`SELECT id,fixture_id,submitted_by_user_id,club_id,
    home_score,away_score FROM efl_result_submissions WHERE id=:id
      AND submitted_by_user_id=:user`,{':id':submissionId,':user':uid});
  if(!record){
    // If a concurrent lock/release made the insert ineligible it must fail.
    throw Error('PROPOSAL_CONFLICT_OR_LOCKED');
  }
  if(record.fixture_id!==proposal.fixtureId||record.club_id!==occupancy.club_id||
     record.home_score!==proposal.homeScore||record.away_score!==proposal.awayScore)
    throw Error('PROPOSAL_CONFLICT');
  return {ok:true,fixtureId:proposal.fixtureId,submissionId,
    alreadySubmitted:!!previous,pendingConfirmation:true};
}
