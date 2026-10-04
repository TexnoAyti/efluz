import type { User } from '../../types';
import { permittedAdminCompetitionIds } from '../../lib/adminPermissions';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { getFixturesFirestore, getLocalDisputes, getLocalSubmissions, trackFirestoreRead, recordFallbackUsage, getFromCache, setInCache } from '../firebase/firestoreStore';

export async function getScopedAdminReviews(user: User, seasonId: string, includeArchive = false) {
  const competitionIds = new Set(permittedAdminCompetitionIds(user));
  const cacheKey = `firestore:scoped_admin_reviews:${seasonId}:${[...competitionIds].sort().join(',')}:${includeArchive ? 'archive' : 'pending'}`;
  const cached = getFromCache<ScopedAdminReviews>(cacheKey);
  if (cached) return cached;
  const fixtures = (await Promise.all([...competitionIds].map(competitionId => getFixturesFirestore({ seasonId, competitionId }))))
    .flat().filter(fixture => fixture.seasonId === seasonId && competitionIds.has(fixture.competitionId));
  const fixturesById = new Map(fixtures.map(fixture => [fixture.id, fixture]));
  const pending = fixtures.filter(fixture => ['PENDING_CONFIRMATION', 'DISPUTED'].includes(fixture.status));
  const submissionFixtureIds = (includeArchive ? fixtures : pending).map(fixture => fixture.id);
  let submissions: any[] = [], disputes: any[] = [];
  let degraded = false;
  const localFallback = () => {
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
          const snapshot = await db.collection(collection).where('fixtureId', 'in', ids.slice(index, index + 30)).get();
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
    degraded, stale: degraded, source: degraded ? 'sqlite' : 'firestore',
  };
  if (!degraded) setInCache(cacheKey, result, 10000);
  return result;
}

type ScopedAdminReviews = { pendingFixtures: any[]; disputes: any[]; submissions: any[]; degraded: boolean; stale: boolean; source: string };

