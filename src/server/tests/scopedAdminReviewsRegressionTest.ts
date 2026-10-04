import assert from 'node:assert/strict';
import express from 'express';
import { initDatabase, queryRun } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { adminRouter } from '../routes/admin.routes';
import { requireAdmin } from '../middleware/authMiddleware';
import { invalidateFirestoreCache } from '../firebase/firestoreStore';

await initDatabase();
const db = getFirestoreDb();
const seasonId = 'season-2026-27';
const manager = 'reviews-manager';
await db.collection('users').doc(manager).set({ id: manager, telegramId: '654', isAdmin: true, isSuspended: false, adminPermissions: { scope: 'LEAGUES', leagueIds: ['league-la-liga'] } });
const rows = [
  ['reviews-la', 'comp-la-liga-2026', 'PENDING_CONFIRMATION'],
  ['reviews-copa', 'comp-copa-del-rey-2026', 'DISPUTED'],
  ['reviews-pl', 'comp-premier-league-2026', 'DISPUTED'],
  ['reviews-fa', 'comp-fa-cup-2026', 'PENDING_CONFIRMATION'],
  ['reviews-complete', 'comp-la-liga-2026', 'CONFIRMED'],
  ['reviews-old-season', 'comp-la-liga-2026', 'DISPUTED'],
];
for (const [id, competitionId, status] of rows) {
  await db.collection('fixtures').doc(id).set({ id, competitionId, seasonId: id === 'reviews-old-season' ? 'season-2025-26' : seasonId, status, matchday: 1, homeClubId: 'club-barcelona', awayClubId: 'club-real-madrid', scheduledAt: '2026-10-04T00:00:00Z' });
  await db.collection('result_submissions').doc('sub-' + id).set({ fixtureId: id, submittedByUserId: 'review-player', clubId: 'club-barcelona', homeScore: 2, awayScore: 1, proofUrl: 'https://example.invalid/proof-' + id, createdAt: '2026-10-04T00:00:00Z' });
  await db.collection('disputes').doc('dispute-' + id).set({ fixtureId: id, status: id === 'reviews-complete' ? 'RESOLVED' : 'OPEN', seasonId, createdAt: '2026-10-04T00:00:00Z' });
}
await db.collection('disputes').doc('dispute-malformed').set({ status: 'OPEN' });
const app = express(); app.use(express.json());
app.use((req: any, _res, next) => { req.user = { id: manager, telegramId: '5209126900', isAdmin: true, adminPermissions: { scope: 'ALL', leagueIds: [] } }; next(); });
app.post('/api/admin/disputes/:id/resolve', requireAdmin, (_req, res) => res.json({ authorized: true }));
app.post('/api/admin/results/:id/approve', requireAdmin, (_req, res) => res.json({ authorized: true }));
app.post('/api/admin/results/:id/reject', requireAdmin, (_req, res) => res.json({ authorized: true }));
app.use('/api/admin', adminRouter);
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const get = (path = '/api/admin/scoped/reviews?seasonId=' + seasonId) => fetch(base + path);
const post = (path: string) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fixtureId: 'reviews-la', competitionId: 'comp-la-liga-2026' }) });
const assertScope = (data: any, ids: string[]) => {
  for (const fixture of data.pendingFixtures) { assert.ok(ids.includes(fixture.id)); assert.ok(fixture.submissions.every((submission: any) => submission.fixtureId === fixture.id)); }
  for (const dispute of data.disputes) assert.ok(ids.includes(dispute.fixtureId));
  for (const submission of data.submissions) assert.ok(ids.includes(submission.fixtureId));
};
try {
  const response = await get(); assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control')!, /private.*no-store/);
  const data = await response.json(); assertScope(data, ['reviews-la', 'reviews-copa']);
  assert.deepEqual(data.pendingFixtures.map((fixture: any) => fixture.id).sort(), ['reviews-copa', 'reviews-la']);
  assert.equal(data.pendingFixtures[0].submissions.length, 1);
  assert.equal(data.submissions.length, 0);
  const archive = await (await get('/api/admin/scoped/reviews?seasonId=' + seasonId + '&includeArchive=1')).json();
  assertScope(archive, ['reviews-la', 'reviews-copa', 'reviews-complete']); assert.equal(archive.submissions.length, 3);
  assert.equal(archive.disputes.some((dispute: any) => dispute.fixtureId === 'reviews-complete'), false);
  for (const id of ['reviews-la', 'reviews-copa', 'reviews-pl', 'reviews-fa']) {
    const expected = ['reviews-la', 'reviews-copa'].includes(id) ? 200 : 403;
    for (const action of ['approve', 'reject']) assert.equal((await post('/api/admin/results/' + id + '/' + action)).status, expected);
    assert.equal((await post('/api/admin/disputes/dispute-' + id + '/resolve')).status, expected);
  }
  assert.equal((await post('/api/admin/disputes/dispute-malformed/resolve')).status, 403);
  assert.equal((await post('/api/admin/disputes/nonexistent/resolve')).status, 403);
  for (const path of ['/api/admin/submissions', '/api/admin/disputes', '/api/admin/results/pending']) assert.equal((await get(path)).status, 403);
  await db.collection('users').doc(manager).update({ adminPermissions: { scope: 'LEAGUES', leagueIds: ['league-premier-league'] } });
  const changed = await (await get('/api/admin/scoped/reviews?seasonId=' + seasonId + '&includeArchive=1')).json();
  assertScope(changed, ['reviews-pl', 'reviews-fa']); assert.equal(changed.submissions.length, 2);
  assert.equal((await post('/api/admin/disputes/dispute-reviews-la/resolve')).status, 403);
  // Even fallback archive rows must pass the allowed-fixture filter.
  queryRun('PRAGMA foreign_keys = OFF');
  for (const id of ['reviews-pl', 'reviews-la']) {
    queryRun('INSERT OR REPLACE INTO result_submissions (id, fixture_id, submitted_by_user_id, club_id, home_score, away_score, proof_url, created_at) VALUES (?, ?, ?, ?, 3, 2, ?, ?)', ['local-' + id, id, 'local-player', 'club-barcelona', 'https://example.invalid/local-proof', '2026-10-04']);
    queryRun('INSERT OR REPLACE INTO disputes (id, fixture_id, season_id, status, created_at) VALUES (?, ?, ?, ?, ?)', ['local-dispute-' + id, id, seasonId, 'OPEN', '2026-10-04']);
  }
  const collection = db.collection.bind(db);
  (db as any).collection = (name: string) => ['result_submissions', 'disputes'].includes(name) ? { where: () => ({ get: async () => { throw new Error('Temporary review source outage'); } }) } : collection(name);
  try {
    invalidateFirestoreCache('firestore:scoped_admin_reviews:');
    const fallback = await (await get('/api/admin/scoped/reviews?seasonId=' + seasonId + '&includeArchive=1')).json();
    assert.equal(fallback.degraded, true); assertScope(fallback, ['reviews-pl', 'reviews-fa']);
    assert.equal(fallback.submissions.length, 1); assert.equal(fallback.disputes.length, 1);
  } finally { (db as any).collection = collection; }
  await db.collection('users').doc(manager).update({ adminPermissions: { scope: 'LEAGUES', leagueIds: [] } });
  assert.equal((await get()).status, 403);
  console.log('PASS scoped pending results, domestic cups, proof archive, disputes, authoritative review actions, forged IDs, old-season exclusion, immediate revocation and safe SQLite fallback');
} finally { invalidateFirestoreCache(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
