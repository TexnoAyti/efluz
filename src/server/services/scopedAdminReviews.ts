import type { User } from '../../types';
import { createHash } from 'node:crypto';
import { permittedAdminCompetitionIds } from '../../lib/adminPermissions';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { getLocalDisputes, getLocalSubmissions, trackFirestoreRead, recordFallbackUsage } from '../firebase/firestoreStore';
import { getCompetitionFixturesFromReadModel } from '../readModel/readModelStore';
import { readSharedAdminReview } from './adminReviewCache';

export async function getScopedAdminReviews(user: User, seasonId: string, includeArchive = false) {
  const competitionIds = new Set(permittedAdminCompetitionIds(user));
  const snapshots = await Promise.all([...competitionIds].map(competitionId => getCompetitionFixturesFromReadModel(competitionId, { seasonId })));
  const fixtures = snapshots.flatMap(snapshot => snapshot.fixtures).filter(fixture => fixture.seasonId === seasonId && competitionIds.has(fixture.competitionId));
  const signature = createHash('sha256').update(JSON.stringify([seasonId, [...competitionIds].sort(), includeArchive, fixtures.map(f => [f.id, f.status, f.homeScore, f.awayScore, (f as any).updatedAt]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))])).digest('hex');
  const reviews = await readSharedAdminReview('efluz:v1:admin:reviews:' + signature, async () => {
    const fixturesById = new Map(fixtures.map(fixture => [fixture.id, fixture]));
    const pending = fixtures.filter(fixture => ['PENDING_CONFIRMATION', 'DISPUTED'].includes(fixture.status));
    const submissionFixtureIds = (includeArchive ? fixtures : pending).map(fixture => fixture.id);
    let submissions: any[] = [], disputes: any[] = [];
    let degraded = snapshots.some(snapshot => snapshot.degraded);
    let usedLocalFallback = false;
    const fixturesStale = snapshots.some(snapshot => snapshot.stale);
    const localFallback = () => {
      usedLocalFallback = true;
      degraded = true;
      recordFallbackUsage();
      submissions = submissionFixtureIds.flatMap(fixtureId => getLocalSubmissions({ fixtureId, limit: 100 }));
      disputes = getLocalDisputes('OPEN', 10000).filter(dispute => fixturesById.has(dispute.fixtureId));
    };
    if (!firestoreCircuitBreaker.canExecute()) localFallback();
    else {
      try {
        const db = getFirestoreDb();
        const read = async (collection: string, ids: string[]) => {
          const rows: any[] = [];
          // Sequential bounded batches avoid per-fixture reads and large concurrency bursts.
          for (let index = 0; index < ids.length; index += 30) {
            let query = db.collection(collection).where('fixtureId', 'in', ids.slice(index, index + 30));
            if (collection === COLLECTIONS.DISPUTES) query = query.where('status', '==', 'OPEN');
            const snapshot = await query.get();
            trackFirestoreRead(collection, snapshot.empty ? 1 : snapshot.docs.length, 'getScopedAdminReviews');
            rows.push(...snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
          }
          return rows;
        };
        [submissions, disputes] = await Promise.all([
          read(COLLECTIONS.RESULT_SUBMISSIONS, submissionFixtureIds),
          read(COLLECTIONS.DISPUTES, fixtures.map(fixture => fixture.id)),
        ]);
        firestoreCircuitBreaker.recordSuccess();
      } catch (error) { firestoreCircuitBreaker.recordFailure(error); localFallback(); }
    }
    const safeSubmissions = submissions.filter(submission => fixturesById.has(submission.fixtureId)).map(submission => ({
      ...submission,
      submittedByUserId: submission.submittedByUserId || submission.userId,
      submitterUsername: submission.submitterUsername || submission.submittedByUserId || submission.userId,
      submitterName: submission.submitterName || submission.submittedByUserId || submission.userId,
    })).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || a.id.localeCompare(b.id));
    const byFixture = new Map<string, any[]>();
    for (const submission of safeSubmissions) byFixture.set(submission.fixtureId, [...(byFixture.get(submission.fixtureId) || []), submission]);
    const result = {
      pendingFixtures: pending.map(fixture => ({ ...fixture, submissions: byFixture.get(fixture.id) || [] })),
      disputes: disputes.filter(dispute => dispute.status === 'OPEN' && fixturesById.has(dispute.fixtureId)).map(dispute => ({ ...dispute, fixture: fixturesById.get(dispute.fixtureId) })),
      submissions: includeArchive ? safeSubmissions : [],
      degraded, stale: degraded || fixturesStale, source: usedLocalFallback ? 'sqlite' : 'redis+firestore',
    };
    return result;
  });
  // A fresh review cache must not hide a stale fixture snapshot.
  return { ...reviews, stale: reviews.stale || snapshots.some(snapshot => snapshot.stale), degraded: reviews.degraded || snapshots.some(snapshot => snapshot.degraded) };
}
