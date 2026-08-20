import { queryGet, queryAll, queryRun, dbTransaction } from '../db';
import { Fixture, MatchStatus } from '../../types';
import { getFixtureById } from './fixtureService';
import { createNotification } from './notificationService';
import { createAuditLog } from './adminService';
import { advanceKnockoutWinner } from '../tournament/knockoutEngine';

export class ResultSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResultSubmissionError';
  }
}

export function submitFixtureResult(
  userId: string,
  fixtureId: string,
  homeScore: number,
  awayScore: number,
  proofUrl?: string
): Fixture {
  return dbTransaction(() => {
    // 1. Validation of scores
    if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
      throw new ResultSubmissionError('Scores must be non-negative integers.');
    }

    // 2. Fetch fixture
    const fixture = queryGet<any>('SELECT * FROM fixtures WHERE id = ?', [fixtureId]);
    if (!fixture) {
      throw new ResultSubmissionError(`Fixture with ID '${fixtureId}' not found.`);
    }

    if (fixture.status === 'CONFIRMED') {
      throw new ResultSubmissionError('This match result is already CONFIRMED and cannot be modified.');
    }

    // 3. Verify user owns home or away club in this season
    const userMemberships = queryAll<{ club_id: string }>(
      'SELECT club_id FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = "active"',
      [userId, fixture.season_id]
    );

    const userClubIds = userMemberships.map((m) => m.club_id);
    const isHome = userClubIds.includes(fixture.home_club_id);
    const isAway = userClubIds.includes(fixture.away_club_id);

    if (!isHome && !isAway) {
      throw new ResultSubmissionError('You do not own either the home or away club in this fixture.');
    }

    const userClubId = isHome ? fixture.home_club_id : fixture.away_club_id;
    const opponentClubId = isHome ? fixture.away_club_id : fixture.home_club_id;

    // 4. Upsert result submission
    const existingSubmission = queryGet<{ id: string }>(
      'SELECT id FROM result_submissions WHERE fixture_id = ? AND submitted_by_user_id = ?',
      [fixtureId, userId]
    );

    const now = new Date().toISOString();

    if (existingSubmission) {
      queryRun(
        'UPDATE result_submissions SET home_score = ?, away_score = ?, proof_url = ?, created_at = ? WHERE id = ?',
        [homeScore, awayScore, proofUrl || null, now, existingSubmission.id]
      );
    } else {
      const submissionId = `sub-${fixtureId}-${userId}`;
      queryRun(
        'INSERT INTO result_submissions (id, fixture_id, submitted_by_user_id, club_id, home_score, away_score, proof_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [submissionId, fixtureId, userId, userClubId, homeScore, awayScore, proofUrl || null, now]
      );
    }

    // 5. Evaluate all submissions for this fixture
    const allSubmissions = queryAll<any>(
      'SELECT * FROM result_submissions WHERE fixture_id = ?',
      [fixtureId]
    );

    const opponentMembership = queryGet<{ user_id: string }>(
      'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
      [opponentClubId, fixture.season_id]
    );
    const opponentUserId = opponentMembership?.user_id;

    let newStatus: MatchStatus = 'AWAITING_RESULT';
    let confirmedHomeScore: number | null = null;
    let confirmedAwayScore: number | null = null;
    let winnerClubId: string | null = null;
    let confirmedAt: string | null = null;

    if (allSubmissions.length >= 2) {
      const [sub1, sub2] = allSubmissions;
      const scoresMatch = sub1.home_score === sub2.home_score && sub1.away_score === sub2.away_score;

      if (scoresMatch) {
        // MATCH! Automatically confirm result
        newStatus = 'CONFIRMED';
        confirmedHomeScore = sub1.home_score;
        confirmedAwayScore = sub1.away_score;
        confirmedAt = now;

        if (confirmedHomeScore > confirmedAwayScore) {
          winnerClubId = fixture.home_club_id;
        } else if (confirmedAwayScore > confirmedHomeScore) {
          winnerClubId = fixture.away_club_id;
        }

        // Close any dispute if existed
        queryRun(
          'UPDATE disputes SET status = "RESOLVED", resolution_notes = "Auto-resolved by identical submissions", resolved_at = ? WHERE fixture_id = ?',
          [now, fixtureId]
        );

        // Notify both users
        createNotification(
          userId,
          'RESULT_CONFIRMED',
          'Match Result Confirmed!',
          `Your match result (${confirmedHomeScore} - ${confirmedAwayScore}) has been verified and confirmed.`
        );
        if (opponentUserId) {
          createNotification(
            opponentUserId,
            'RESULT_CONFIRMED',
            'Match Result Confirmed!',
            `Your match result (${confirmedHomeScore} - ${confirmedAwayScore}) has been verified and confirmed.`
          );
        }
      } else {
        // MISMATCH! Trigger Dispute
        newStatus = 'DISPUTED';

        const disputeId = `disp-${fixtureId}`;
        const existingDispute = queryGet<{ id: string }>('SELECT id FROM disputes WHERE fixture_id = ?', [fixtureId]);

        const homeSub = allSubmissions.find((s) => s.club_id === fixture.home_club_id);
        const awaySub = allSubmissions.find((s) => s.club_id === fixture.away_club_id);

        if (!existingDispute) {
          queryRun(
            'INSERT INTO disputes (id, fixture_id, season_id, home_submission_id, away_submission_id, status, created_at) VALUES (?, ?, ?, ?, ?, "OPEN", ?)',
            [disputeId, fixtureId, fixture.season_id, homeSub?.id || sub1.id, awaySub?.id || sub2.id, now]
          );
        } else {
          queryRun(
            'UPDATE disputes SET home_submission_id = ?, away_submission_id = ?, status = "OPEN" WHERE id = ?',
            [homeSub?.id || sub1.id, awaySub?.id || sub2.id, existingDispute.id]
          );
        }

        // Notify users about dispute
        createNotification(
          userId,
          'RESULT_DISPUTED',
          'Score Mismatch / Disputed Match',
          `Your submitted score differs from your opponent's (${sub1.home_score}-${sub1.away_score} vs ${sub2.home_score}-${sub2.away_score}). An admin will review the proofs.`
        );
        if (opponentUserId) {
          createNotification(
            opponentUserId,
            'RESULT_DISPUTED',
            'Score Mismatch / Disputed Match',
            `Your submitted score differs from your opponent's (${sub1.home_score}-${sub1.away_score} vs ${sub2.home_score}-${sub2.away_score}). An admin will review the proofs.`
          );
        }
      }
    } else {
      // Only 1 user submitted so far
      newStatus = 'PENDING_CONFIRMATION';

      if (opponentUserId) {
        createNotification(
          opponentUserId,
          'RESULT_AWAITING_OPPONENT',
          'Opponent Submitted Match Score',
          `Your opponent has submitted a match result. Please submit your score to confirm the result.`
        );
      }
    }

    // 6. Update fixture record
    queryRun(
      `UPDATE fixtures SET
        status = ?,
        home_score = ?,
        away_score = ?,
        winner_club_id = ?,
        result_confirmed_at = ?,
        updated_at = ?
       WHERE id = ?`,
      [newStatus, confirmedHomeScore, confirmedAwayScore, winnerClubId, confirmedAt, now, fixtureId]
    );

    // 7. Audit log & knockout bracket progression
    if (newStatus === 'CONFIRMED') {
      createAuditLog(
        userId,
        'RESULT_CONFIRMED',
        'fixtures',
        fixtureId,
        { status: fixture.status },
        { status: 'CONFIRMED', homeScore: confirmedHomeScore, awayScore: confirmedAwayScore, winnerClubId }
      );
      advanceKnockoutWinner(fixtureId);
    } else if (newStatus === 'DISPUTED') {
      createAuditLog(
        userId,
        'RESULT_DISPUTED',
        'fixtures',
        fixtureId,
        { status: fixture.status },
        { status: 'DISPUTED', allSubmissions }
      );
    }

    return getFixtureById(fixtureId, userId)!;
  });
}
