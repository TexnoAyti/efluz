import { queryAll, queryGet, queryRun, dbTransaction } from '../db';
import { Dispute, AuditLog, User } from '../../types';
import { getFixtureById } from './fixtureService';
import { createNotification } from './notificationService';
import { advanceKnockoutWinner } from '../tournament/knockoutEngine';

export function createAuditLog(
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  oldValue?: any,
  newValue?: any,
  ipAddress?: string
): void {
  const actor = queryGet<{ username: string }>('SELECT username FROM users WHERE id = ?', [actorUserId]);
  const actorUsername = actor?.username || 'admin';
  const id = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  queryRun(
    `INSERT INTO audit_logs (id, actor_user_id, actor_username, action, entity_type, entity_id, old_value_json, new_value_json, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      actorUserId,
      actorUsername,
      action,
      entityType,
      entityId,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
      ipAddress || null,
      now,
    ]
  );
}

export function getDisputes(status = 'OPEN'): Dispute[] {
  const rows = queryAll<any>(
    `SELECT d.*,
            f.competition_id, f.matchday, f.home_club_id, f.away_club_id, f.scheduled_at, f.status as fixture_status,
            hs.id as hs_id, hs.home_score as hs_home, hs.away_score as hs_away, hs.proof_url as hs_proof, hs.submitted_by_user_id as hs_user_id, hs.created_at as hs_created,
            asub.id as as_id, asub.home_score as as_home, asub.away_score as as_away, asub.proof_url as as_proof, asub.submitted_by_user_id as as_user_id, asub.created_at as as_created
     FROM disputes d
     JOIN fixtures f ON d.fixture_id = f.id
     LEFT JOIN result_submissions hs ON d.home_submission_id = hs.id
     LEFT JOIN result_submissions asub ON d.away_submission_id = asub.id
     WHERE d.status = ?
     ORDER BY d.created_at DESC`,
    [status]
  );

  return rows.map((r) => ({
    id: r.id,
    fixtureId: r.fixture_id,
    seasonId: r.season_id,
    status: r.status,
    resolvedByUserId: r.resolved_by_user_id || undefined,
    resolutionNotes: r.resolution_notes || undefined,
    resolvedAt: r.resolved_at || undefined,
    createdAt: r.created_at,
    fixture: getFixtureById(r.fixture_id) || undefined,
    homeSubmission: r.hs_id
      ? {
          id: r.hs_id,
          fixtureId: r.fixture_id,
          submittedByUserId: r.hs_user_id,
          clubId: r.home_club_id,
          homeScore: r.hs_home,
          awayScore: r.hs_away,
          proofUrl: r.hs_proof || undefined,
          createdAt: r.hs_created,
        }
      : undefined,
    awaySubmission: r.as_id
      ? {
          id: r.as_id,
          fixtureId: r.fixture_id,
          submittedByUserId: r.as_user_id,
          clubId: r.away_club_id,
          homeScore: r.as_home,
          awayScore: r.as_away,
          proofUrl: r.as_proof || undefined,
          createdAt: r.as_created,
        }
      : undefined,
  }));
}

export function resolveDispute(
  adminUserId: string,
  disputeId: string,
  params: {
    action: 'CONFIRM_HOME_SUBMISSION' | 'CONFIRM_AWAY_SUBMISSION' | 'MANUAL_SCORE' | 'CANCEL_MATCH';
    manualHomeScore?: number;
    manualAwayScore?: number;
    notes?: string;
  }
): { success: boolean; dispute: Dispute } {
  return dbTransaction(() => {
    const dispute = queryGet<any>('SELECT * FROM disputes WHERE id = ?', [disputeId]);
    if (!dispute) {
      throw new Error(`Dispute with ID '${disputeId}' not found.`);
    }

    const fixture = queryGet<any>('SELECT * FROM fixtures WHERE id = ?', [dispute.fixture_id]);
    if (!fixture) {
      throw new Error(`Fixture '${dispute.fixture_id}' not found.`);
    }

    const submissions = queryAll<any>('SELECT * FROM result_submissions WHERE fixture_id = ?', [dispute.fixture_id]);
    const homeSub = submissions.find((s) => s.club_id === fixture.home_club_id);
    const awaySub = submissions.find((s) => s.club_id === fixture.away_club_id);

    let finalHomeScore: number = 0;
    let finalAwayScore: number = 0;
    let finalStatus = 'CONFIRMED';
    let winnerClubId: string | null = null;
    const now = new Date().toISOString();

    if (params.action === 'CONFIRM_HOME_SUBMISSION') {
      if (!homeSub) throw new Error('Home submission not found.');
      finalHomeScore = homeSub.home_score;
      finalAwayScore = homeSub.away_score;
    } else if (params.action === 'CONFIRM_AWAY_SUBMISSION') {
      if (!awaySub) throw new Error('Away submission not found.');
      finalHomeScore = awaySub.home_score;
      finalAwayScore = awaySub.away_score;
    } else if (params.action === 'MANUAL_SCORE') {
      if (params.manualHomeScore === undefined || params.manualAwayScore === undefined) {
        throw new Error('Manual scores must be provided.');
      }
      finalHomeScore = params.manualHomeScore;
      finalAwayScore = params.manualAwayScore;
    } else if (params.action === 'CANCEL_MATCH') {
      finalStatus = 'CANCELLED';
    }

    if (finalStatus === 'CONFIRMED') {
      if (finalHomeScore > finalAwayScore) winnerClubId = fixture.home_club_id;
      else if (finalAwayScore > finalHomeScore) winnerClubId = fixture.away_club_id;
    }

    // Update fixture
    queryRun(
      `UPDATE fixtures SET
        status = ?,
        home_score = ?,
        away_score = ?,
        winner_club_id = ?,
        result_confirmed_at = ?,
        updated_at = ?
       WHERE id = ?`,
      [
        finalStatus,
        finalStatus === 'CONFIRMED' ? finalHomeScore : null,
        finalStatus === 'CONFIRMED' ? finalAwayScore : null,
        winnerClubId,
        finalStatus === 'CONFIRMED' ? now : null,
        now,
        fixture.id,
      ]
    );

    // Update dispute
    queryRun(
      `UPDATE disputes SET
        status = 'RESOLVED',
        resolved_by_user_id = ?,
        resolution_notes = ?,
        resolved_at = ?
       WHERE id = ?`,
      [adminUserId, params.notes || `Resolved via ${params.action}`, now, disputeId]
    );

    // Audit log
    createAuditLog(
      adminUserId,
      'RESOLVE_DISPUTE',
      'fixtures',
      fixture.id,
      { status: fixture.status, homeScore: fixture.home_score, awayScore: fixture.away_score },
      { status: finalStatus, homeScore: finalHomeScore, awayScore: finalAwayScore, action: params.action, notes: params.notes }
    );

    // Notify users
    const homeOwner = queryGet<{ user_id: string }>(
      'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
      [fixture.home_club_id, fixture.season_id]
    );
    const awayOwner = queryGet<{ user_id: string }>(
      'SELECT user_id FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = "active"',
      [fixture.away_club_id, fixture.season_id]
    );

    const message = `Admin resolved match dispute. Final Score: ${finalHomeScore} - ${finalAwayScore}. Status: ${finalStatus}.`;
    if (homeOwner) createNotification(homeOwner.user_id, 'DISPUTE_RESOLVED', 'Dispute Resolved by Admin', message);
    if (awayOwner) createNotification(awayOwner.user_id, 'DISPUTE_RESOLVED', 'Dispute Resolved by Admin', message);

    // If knockout match, advance winner
    if (finalStatus === 'CONFIRMED') {
      advanceKnockoutWinner(fixture.id);
    }

    return {
      success: true,
      dispute: getDisputes('RESOLVED').find((d) => d.id === disputeId) || ({} as any),
    };
  });
}

export function reopenFixture(
  adminUserId: string,
  fixtureId: string,
  notes?: string
): { success: boolean } {
  return dbTransaction(() => {
    const fixture = queryGet<any>('SELECT * FROM fixtures WHERE id = ?', [fixtureId]);
    if (!fixture) throw new Error(`Fixture '${fixtureId}' not found.`);

    const now = new Date().toISOString();

    // Reset fixture
    queryRun(
      `UPDATE fixtures SET
        status = 'SCHEDULED',
        home_score = NULL,
        away_score = NULL,
        winner_club_id = NULL,
        result_confirmed_at = NULL,
        updated_at = ?
       WHERE id = ?`,
      [now, fixtureId]
    );

    // Remove submissions
    queryRun('DELETE FROM result_submissions WHERE fixture_id = ?', [fixtureId]);
    // Cancel disputes
    queryRun('UPDATE disputes SET status = "CANCELLED", resolution_notes = "Fixture reopened by admin" WHERE fixture_id = ?', [fixtureId]);

    // Audit log
    createAuditLog(adminUserId, 'REOPEN_FIXTURE', 'fixtures', fixtureId, fixture, { status: 'SCHEDULED', notes });

    return { success: true };
  });
}

export function getAllAdminUsers(): User[] {
  const rows = queryAll<any>('SELECT * FROM users ORDER BY created_at DESC');
  return rows.map((r) => ({
    id: r.id,
    telegramId: r.telegram_id,
    username: r.username,
    firstName: r.first_name,
    lastName: r.last_name,
    photoUrl: r.photo_url,
    isAdmin: Boolean(r.is_admin),
    isSuspended: Boolean(r.is_suspended),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export function getAuditLogs(limit = 50): AuditLog[] {
  const rows = queryAll<any>('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?', [limit]);
  return rows.map((r) => ({
    id: r.id,
    actorUserId: r.actor_user_id,
    actorUsername: r.actor_username,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    oldValue: r.old_value_json,
    newValue: r.new_value_json,
    ipAddress: r.ip_address,
    createdAt: r.created_at,
  }));
}
