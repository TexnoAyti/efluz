import type { Firestore } from 'firebase-admin/firestore';
import { COLLECTIONS } from '../firebase/collections';

export type DisputeResolutionInput = {
  action: 'CONFIRM_HOME_SUBMISSION' | 'CONFIRM_AWAY_SUBMISSION' | 'MANUAL_SCORE' | 'CANCEL_MATCH';
  manualHomeScore?: number; manualAwayScore?: number; notes?: string;
};
const validScore = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0;

/** All reads precede writes. A stale/duplicate resolution cannot overwrite another
 * admin's decision, and malformed or foreign submissions never become a score. */
export async function resolveDisputeAtomically(db: Firestore, actorId: string, disputeId: string, params: DisputeResolutionInput, onRead: (collection: string) => void = () => {}) {
  const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(disputeId);
  return db.runTransaction(async transaction => {
    const disputeDoc = await transaction.get(disputeRef);
    onRead(COLLECTIONS.DISPUTES);
    if (!disputeDoc.exists) throw new Error('DISPUTE_NOT_FOUND');
    const dispute: any = disputeDoc.data();
    if (!['OPEN', 'UNDER_REVIEW'].includes(dispute.status)) throw new Error('DISPUTE_ALREADY_RESOLVED');
    const fixtureRef = db.collection(COLLECTIONS.FIXTURES).doc(dispute.fixtureId);
    const fixtureDoc = await transaction.get(fixtureRef);
    onRead(COLLECTIONS.FIXTURES);
    if (!fixtureDoc.exists) throw new Error('DISPUTE_FIXTURE_NOT_FOUND');
    const fixture: any = fixtureDoc.data();
    if (fixture.status !== 'DISPUTED') throw new Error('DISPUTE_FIXTURE_CHANGED');
    let homeScore: number | null = null, awayScore: number | null = null;
    if (params.action === 'MANUAL_SCORE') {
      if (!validScore(params.manualHomeScore) || !validScore(params.manualAwayScore)) throw new Error('DISPUTE_MANUAL_SCORE_REQUIRED');
      homeScore = params.manualHomeScore; awayScore = params.manualAwayScore;
    } else if (params.action === 'CONFIRM_HOME_SUBMISSION' || params.action === 'CONFIRM_AWAY_SUBMISSION') {
      const home = params.action === 'CONFIRM_HOME_SUBMISSION';
      const submissionId = home ? dispute.homeSubmissionId : dispute.awaySubmissionId;
      if (typeof submissionId !== 'string' || !submissionId || submissionId.includes('/')) throw new Error('DISPUTE_SUBMISSION_MISSING');
      const submissionDoc = await transaction.get(db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc(submissionId));
      onRead(COLLECTIONS.RESULT_SUBMISSIONS);
      const submission = submissionDoc.data();
      if (!submissionDoc.exists || submission?.fixtureId !== dispute.fixtureId || submission?.clubId !== (home ? fixture.homeClubId : fixture.awayClubId)) throw new Error('DISPUTE_SUBMISSION_MISMATCH');
      if (!validScore(submission.homeScore) || !validScore(submission.awayScore)) throw new Error('DISPUTE_SUBMISSION_SCORE_INVALID');
      homeScore = submission.homeScore; awayScore = submission.awayScore;
    } else if (params.action !== 'CANCEL_MATCH') throw new Error('INVALID_DISPUTE_RESOLUTION');
    const now = new Date().toISOString();
    const confirmed = params.action !== 'CANCEL_MATCH';
    const patch = { status: confirmed ? 'CONFIRMED' : 'POSTPONED', homeScore, awayScore,
      winnerClubId: confirmed && homeScore !== awayScore ? (homeScore! > awayScore! ? fixture.homeClubId : fixture.awayClubId) : null,
      resultConfirmedAt: confirmed ? now : null, updatedAt: now };
    const resolution = { status: 'RESOLVED', resolvedByUserId: actorId, resolutionNotes: params.notes || null, resolvedAt: now };
    transaction.update(fixtureRef, patch);
    transaction.update(disputeRef, resolution);
    const auditId = `audit_resolve_dispute_${disputeId}`;
    transaction.set(db.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId), { id: auditId, actorUserId: actorId, action: 'RESOLVE_DISPUTE', entityType: 'dispute', entityId: disputeId, notes: params.notes || null, createdAt: now });
    return { success: true, dispute: { ...dispute, ...resolution, id: disputeId }, fixture: { ...fixture, ...patch, id: dispute.fixtureId }, reads: confirmed && params.action !== 'MANUAL_SCORE' ? 3 : 2 };
  });
}
