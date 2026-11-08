// Opponent-only, conditional confirmation. No result is confirmed merely by
// submitting a score. All eligibility checks are repeated inside the UPDATE.
const validId = x => typeof x === 'string' && /^[a-zA-Z0-9_:-]{1,160}$/.test(x);
export function validateConfirmation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('INVALID_CONFIRMATION');
  const {submissionId} = input;
  if (!validId(submissionId)) throw Error('INVALID_SUBMISSION_ID');
  if (Object.keys(input).some(k => k !== 'submissionId')) throw Error('UNKNOWN_CONFIRMATION_FIELD');
  return {submissionId};
}
export async function confirmFixtureResult(db,userId,input) {
  if (!validId(userId)) throw Error('AUTH_REQUIRED');
  const {submissionId} = validateConfirmation(input);
  const actor = await db.get('SELECT id,telegram_id,is_banned FROM efl_users WHERE id=:id',{':id':userId});
  if (!actor || actor.is_banned) throw Error('USER_BANNED_OR_MISSING');
  const proposal = await db.get(`SELECT p.id,p.fixture_id AS fixtureId,p.submitted_by_user_id AS submitterId,
    p.club_id AS submitterClubId,p.home_score AS homeScore,p.away_score AS awayScore,
    f.season_id AS seasonId,f.home_club_id AS homeClubId,
    f.away_club_id AS awayClubId,f.status
    FROM efl_result_submissions p JOIN efl_fixtures f ON f.id=p.fixture_id
    WHERE p.id=:submission`,{':submission':submissionId});
  if (!proposal) throw Error('SUBMISSION_NOT_FOUND');
  if (proposal.submitterId===userId) throw Error('SELF_CONFIRM_FORBIDDEN');
  const submittingHome = proposal.submitterClubId===proposal.homeClubId;
  const submittingAway = proposal.submitterClubId===proposal.awayClubId;
  if (!submittingHome && !submittingAway) throw Error('SUBMISSION_INVALID_OWNER');
  const oppositeClub = submittingHome ? proposal.awayClubId : proposal.homeClubId;
  if (!oppositeClub || !proposal.homeClubId || !proposal.awayClubId) throw Error('FIXTURE_INCOMPLETE');
  const owner = await db.get(`SELECT id FROM efl_club_occupancies
    WHERE season_id=:season AND club_id=:club AND user_id=:user
      AND telegram_id=:telegram AND status='ACTIVE' LIMIT 1`,
    {':season':proposal.seasonId,':club':oppositeClub,':user':userId,':telegram':actor.telegram_id});
  if (!owner) throw Error('CONFIRM_FORBIDDEN');
  // The proposal must still belong to the active owner of the *other* club.
  // A stale result submitted by a released/banned player is never approved.
  const submitter = await db.get(`SELECT o.id FROM efl_club_occupancies o
    JOIN efl_users u ON u.id=o.user_id AND u.telegram_id=o.telegram_id
    WHERE o.season_id=:season AND o.club_id=:club AND o.user_id=:user
      AND o.status='ACTIVE' AND u.is_banned=0 LIMIT 1`,{
    ':season':proposal.seasonId,':club':proposal.submitterClubId,
    ':user':proposal.submitterId
  });
  if (!submitter) throw Error('SUBMISSION_INVALID_OWNER');
  const params={':submission':submissionId,':fixture':proposal.fixtureId,':season':proposal.seasonId,
    ':user':userId,':telegram':actor.telegram_id,':club':oppositeClub,
    ':homeScore':proposal.homeScore,':awayScore':proposal.awayScore,':now':Date.now()};
  // Confirm only in the current matchday or an explicitly authorized fixture
  // score window. The opponent must be
  // the current owner at write time, and the submitter must not be the actor.
  await db.run(`UPDATE efl_fixtures
    SET home_score=:homeScore,away_score=:awayScore,status='CONFIRMED',
        confirmation_status='CONFIRMED',played_at=:now,updated_at=:now
    WHERE id=:fixture AND season_id=:season AND status='SCHEDULED'
      AND home_club_id IS NOT NULL AND away_club_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM efl_competitions c
        WHERE c.id=efl_fixtures.competition_id AND c.season_id=efl_fixtures.season_id
          AND ((c.is_matchday_open=1 AND c.current_matchday=efl_fixtures.round)
           OR EXISTS(SELECT 1 FROM efl_fixture_score_windows w
            WHERE w.fixture_id=efl_fixtures.id
             AND w.season_id=efl_fixtures.season_id
             AND w.competition_id=efl_fixtures.competition_id
             AND w.is_open=1 AND efl_fixtures.round<c.current_matchday)))
      AND EXISTS (SELECT 1 FROM efl_users u JOIN efl_club_occupancies o
        ON o.user_id=u.id AND o.telegram_id=u.telegram_id
        WHERE u.id=:user AND u.telegram_id=:telegram AND u.is_banned=0
          AND o.status='ACTIVE' AND o.season_id=efl_fixtures.season_id
          AND o.club_id=:club AND
          (o.club_id=efl_fixtures.home_club_id OR o.club_id=efl_fixtures.away_club_id))
      AND EXISTS (SELECT 1 FROM efl_result_submissions p
        JOIN efl_users submitter ON submitter.id=p.submitted_by_user_id
         AND submitter.is_banned=0
        JOIN efl_club_occupancies ownership
         ON ownership.user_id=submitter.id
         AND ownership.telegram_id=submitter.telegram_id
         AND ownership.season_id=efl_fixtures.season_id
         AND ownership.club_id=p.club_id AND ownership.status='ACTIVE'
        WHERE p.id=:submission AND p.fixture_id=efl_fixtures.id
          AND p.submitted_by_user_id<>:user AND p.club_id<>:club
          AND (p.club_id=efl_fixtures.home_club_id
               OR p.club_id=efl_fixtures.away_club_id)
          AND p.home_score=:homeScore AND p.away_score=:awayScore)
      AND NOT EXISTS (SELECT 1 FROM efl_result_submissions other
        WHERE other.fixture_id=efl_fixtures.id
          AND other.submitted_by_user_id=:user
          AND (other.home_score<>:homeScore OR other.away_score<>:awayScore))
      AND NOT EXISTS (SELECT 1 FROM efl_disputes d WHERE d.fixture_id=efl_fixtures.id
        AND d.status IN ('OPEN','PENDING','UNDER_REVIEW'))`,params);
  const after=await db.get(`SELECT id,status,home_score AS homeScore,away_score AS awayScore,
    confirmation_status AS confirmationStatus
    FROM efl_fixtures WHERE id=:fixture`,{':fixture':proposal.fixtureId});
  if (after?.status!=='CONFIRMED' || after.confirmationStatus!=='CONFIRMED' ||
      after.homeScore!==proposal.homeScore || after.awayScore!==proposal.awayScore)
    throw Error('CONFIRM_CONFLICT_OR_LOCKED');
  return {ok:true,fixtureId:proposal.fixtureId,submissionId,confirmed:true,
    homeScore:after.homeScore,awayScore:after.awayScore};
}
