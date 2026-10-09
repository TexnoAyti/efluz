import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { adminRouter } from '../routes/admin.routes';
import { controlCompetitionMatchday, getCompetitionMatchdayControl } from '../services/competitionMatchdayService';
import { assertMatchdayPlayableFirestore, checkFixturePlayability, getCompetitionMatchdayLocksFirestore, invalidateMatchdayLockCache, refreshFixtureMatchdayRules, isMatchdayPlayableKey } from '../firebase/firestoreStore';
import { resolveMatchdayGate } from '../../lib/matchdayState';

await initDatabase();
const db = getFirestoreDb(), seasonId = 'season-2026-27', id = 'comp-la-liga-2026';
const ref = db.collection(COLLECTIONS.COMPETITIONS).doc(id);
await ref.set({ id, seasonId, leagueId: 'league-la-liga', type: 'LEAGUE', currentMatchday: 2, totalMatchdays: 19, isMatchdayOpen: true });
const docs = [];
for (let md = 1; md <= 3; md++) {
  const fixture = { id: `control-${md}`, competitionId: id, seasonId, matchday: md, homeClubId: 'club-barcelona', awayClubId: 'club-real-madrid', status: md === 1 ? 'CONFIRMED' : 'SCHEDULED', ...(md === 1 ? { homeScore: 2, awayScore: 1 } : {}) };
  await db.collection(COLLECTIONS.FIXTURES).doc(fixture.id).set(fixture); docs.push(fixture);
}
await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc('control-proof').set({ fixtureId: 'control-1', proofUrl: 'https://example.com/proof.png', homeScore: 2, awayScore: 1 });
const original = (await db.collection(COLLECTIONS.FIXTURES).doc('control-1').get()).data();
const originalProof = (await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc('control-proof').get()).data();
const act = (action: 'SELECT' | 'OPEN' | 'LOCK' | 'EXTEND' | 'RESTART', matchday: number, durationHours = 30) => controlCompetitionMatchday(id, { action, matchday, durationHours, adminUserId: 'control-root' });

// Return backwards without erasing results or proof; the previous active round closes atomically.
await act('SELECT', 1);
assert.equal((await ref.get()).data()?.currentMatchday, 1);
await assert.rejects(() => assertMatchdayPlayableFirestore(seasonId, id, 2), /MATCHDAY_LOCKED/);
await assertMatchdayPlayableFirestore(seasonId, id, 1);
assert.deepEqual((await db.collection(COLLECTIONS.FIXTURES).doc('control-1').get()).data(), original);
assert.deepEqual((await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc('control-proof').get()).data(), originalProof);
assert.equal(checkFixturePlayability(id, seasonId, 1, 'CONFIRMED', 'club-barcelona', 'club-real-madrid').isPlayable, false);

// Independent opens do not move the active round or overwrite its gate.
await act('OPEN', 3, 2);
assert.equal((await ref.get()).data()?.currentMatchday, 1);
await assertMatchdayPlayableFirestore(seasonId, id, 3);
await act('LOCK', 3);
await assert.rejects(() => assertMatchdayPlayableFirestore(seasonId, id, 3), /MATCHDAY_LOCKED/);
await assertMatchdayPlayableFirestore(seasonId, id, 1);

await act('SELECT', 2, 4);
await assert.rejects(() => act('SELECT', 3), (e: any) => e.code === 'MATCHDAY_UNFINISHED' && e.blockers[0].id === 'control-2');
assert.equal((await ref.get()).data()?.currentMatchday, 2);
await act('SELECT', 1);
await assert.rejects(() => act('SELECT', 3), (e: any) => e.code === 'MATCHDAY_UNFINISHED');

// Extensions add to the existing deadline; restarting starts a fresh duration.
await act('OPEN', 2, 4);
let lockRef = db.collection(COLLECTIONS.MATCHDAY_LOCKS).doc(`${seasonId}:${id}:2`);
const deadline = Date.parse((await lockRef.get()).data()!.expiresAt);
await act('EXTEND', 2, 2);
assert.equal(Date.parse((await lockRef.get()).data()!.expiresAt), deadline + 2 * 3600000);
await act('RESTART', 2, 1);
assert.ok(Math.abs(Date.parse((await lockRef.get()).data()!.expiresAt) - Date.now() - 3600000) < 3000);
await act('LOCK', 2);
await assert.rejects(() => act('EXTEND', 2), (e: any) => e.code === 'MATCHDAY_LOCKED');

// Browser, synchronous state and actual submission guard agree on expiry/conflicting flags.
assert.equal(resolveMatchdayGate({ overrideStatus: 'FORCE_OPEN', isLocked: true }), false);
const expired = { ...(await lockRef.get()).data(), overrideStatus: 'FORCE_OPEN', isLocked: false, isOpen: true, expiresAt: new Date(Date.now() - 1000).toISOString() };
await lockRef.set(expired);
invalidateMatchdayLockCache(seasonId, id, 2);
assert.equal(checkFixturePlayability(id, seasonId, 2, 'SCHEDULED', 'club-barcelona', 'club-real-madrid', null, expired as any).isPlayable, false);
await assert.rejects(() => assertMatchdayPlayableFirestore(seasonId, id, 2), /MATCHDAY_LOCKED/);
assert.equal(isMatchdayPlayableKey(seasonId, id, 2), false);

// Stale pages and persistence errors do not partially change active round/locks.
const stale = (await getCompetitionMatchdayControl(id)).updatedAt;
await act('LOCK', 1);
await assert.rejects(() => controlCompetitionMatchday(id, { action: 'OPEN', matchday: 1, expectedUpdatedAt: stale }), (e: any) => e.code === 'MATCHDAY_CHANGED');
const before = (await ref.get()).data();
const transaction = db.runTransaction;
db.runTransaction = async () => { throw new Error('SIMULATED_COMMIT_FAILURE'); };
try { await assert.rejects(() => act('SELECT', 2), /SIMULATED_COMMIT_FAILURE/); } finally { db.runTransaction = transaction; }
assert.deepEqual((await ref.get()).data(), before);
await assert.rejects(() => act('OPEN', 0), (e: any) => e.code === 'BAD_MATCHDAY');
await assert.rejects(() => act('OPEN', 20), (e: any) => e.code === 'BAD_MATCHDAY');
await assert.rejects(() => act('OPEN', 1, -1), (e: any) => e.code === 'BAD_DURATION');
await assert.rejects(() => act('OPEN', 1, Number.NaN), (e: any) => e.code === 'BAD_DURATION');

// Durable state still works after clearing lock memory; cached fixtures are recomputed.
await act('RESTART', 2, 1);
invalidateMatchdayLockCache(seasonId, id);
const locks = await getCompetitionMatchdayLocksFirestore(seasonId, id);
assert.equal(locks[2].isOpen, true);
assert.equal((await refreshFixtureMatchdayRules([{ ...docs[1], isPlayable: false } as any], seasonId))[0].isPlayable, true);

const concurrent = await Promise.allSettled([act('OPEN', 2), act('LOCK', 2)]);
assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
assert.equal(concurrent.filter(r => r.status === 'rejected').length, 1);
assert.equal((concurrent.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.code, 'MATCHDAY_CHANGED');

// Use real routes + authoritative authorization in an isolated local server.
for (const [userId, isAdmin, permissions] of [['control-root', true, { scope: 'ALL', leagueIds: [] }], ['control-league', true, { scope: 'LEAGUES', leagueIds: ['league-la-liga'] }], ['control-player', false, null]] as const) {
  await db.collection(COLLECTIONS.USERS).doc(userId).set({ id: userId, isAdmin, isSuspended: false, adminPermissions: permissions });
}
const app = express(); app.use(express.json());
app.use((req, _res, next) => { req.user = { id: String(req.headers['x-test-user']), isAdmin: true } as any; next(); });
app.use('/api/admin', adminRouter);
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const request = (competitionId: string, method = 'GET', user = 'control-league', body?: object) => fetch(`${base}/api/admin/competitions/${competitionId}/matchday/control`, { method, headers: { 'content-type': 'application/json', 'x-test-user': user }, ...(body ? { body: JSON.stringify(body) } : {}) });
try {
  assert.equal((await request(id)).status, 200);
  assert.equal((await request('comp-premier-league-2026')).status, 403);
  assert.equal((await request('comp-premier-league-2026', 'POST', 'control-league', { action: 'LOCK', matchday: 1 })).status, 403);
  assert.equal((await request(id, 'GET', 'control-player')).status, 403);
  assert.equal((await request(id, 'POST', 'control-league', { action: 'LOCK', matchday: 2 })).status, 200);
  assert.equal((await request(id, 'POST', 'control-league', { action: 'OPEN', matchday: 2.5 })).status, 400);
} finally { server.close(); }
console.log('PASS matchday control: backwards/select, independent gates, unfinished/skipped-round blockers, expiry, extend/restart, durable refresh, atomic failure, unchanged results/proof and real scoped HTTP authorization.');
