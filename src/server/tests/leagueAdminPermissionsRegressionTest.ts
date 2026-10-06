import { ReadModelKeys, redisSetRaw } from '../readModel/readModelStore';
import assert from 'node:assert/strict';
import express from 'express';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { adminRouter } from '../routes/admin.routes';
import { adminConsistencyRouter } from '../routes/consistencyGuard.routes';
import { adminMatchControlRouter } from '../routes/adminMatchControl.routes';
import { requireAdmin } from '../middleware/authMiddleware';
import { getAuthoritativeUserForAuthorization, getOrCreateTelegramUserFirestore } from '../firebase/firestoreStore';
import { createSessionToken, verifySessionToken } from '../auth/sessionToken';
import { getAdminUserDirectory } from '../services/adminUserDirectory';

await initDatabase();
const db = getFirestoreDb();
for (const [id, isAdmin] of [['scope-root', true], ['user-5209126900', true], ['user-555001', false], ['scope-player', false]] as const) {
  await db.collection('users').doc(id).set({ id, telegramId: id === 'user-5209126900' ? '5209126900' : id === 'user-555001' ? '555001' : id, username: id, firstName: 'Test', isAdmin, isSuspended: false });
}
const la = 'comp-la-liga-2026', pl = 'comp-premier-league-2026';
await db.collection('clubs').doc('club-barcelona').set({ id: 'club-barcelona', name: 'Barcelona', leagueId: 'league-la-liga', isActive: true });
await db.collection('clubs').doc('club-arsenal').set({ id: 'club-arsenal', name: 'Arsenal', leagueId: 'league-premier-league', isActive: true });
for (const [id, competitionId] of [['scope-la-fixture', la], ['scope-pl-fixture', pl]]) await db.collection('fixtures').doc(id).set({ id, competitionId, seasonId: 'season-2026-27', matchday: 1, homeClubId: 'club-barcelona', awayClubId: 'club-arsenal', status: 'SCHEDULED' });
await db.collection('competitions').doc(la).set({ id: la, seasonId: 'season-2026-27', name: 'La Liga', leagueId: 'league-la-liga', type: 'LEAGUE', currentMatchday: 1 });
await db.collection('competitions').doc(pl).set({ id: pl, seasonId: 'season-2026-27', name: 'Premier League', leagueId: 'league-premier-league', type: 'LEAGUE', currentMatchday: 1 });

// Publish the test fixture snapshot: overview/reviews must not scan Firestore fixtures.
const fixtureDocs = await db.collection('fixtures').get();
const snapshotFixtures = fixtureDocs.docs.map(doc => ({ ...doc.data(), id: doc.id } as any)).filter(row => row.seasonId === 'season-2026-27');
for (const competitionId of new Set(snapshotFixtures.map(row => row.competitionId))) {
  await redisSetRaw(ReadModelKeys.competitionFixtures(competitionId, 'season-2026-27'), { data: snapshotFixtures.filter(row => row.competitionId === competitionId) });
}
const app = express(); app.use(express.json());
app.use((req: any, _res, next) => { req.user = { id: String(req.headers['x-test-user'] || 'user-555001'), telegramId: '555001', username: 'LeagueManager', isAdmin: true, adminPermissions: { scope: 'ALL', leagueIds: [] } }; next(); });
// A probe after the real authoritative middleware isolates authorization from mutations.
app.post('/api/admin/fixtures/:id/deadline', requireAdmin, (_req, res) => res.json({ authorized: true }));
app.post('/api/admin/competitions/:id/matchday/override', requireAdmin, (_req, res) => res.json({ authorized: true }));
app.post('/api/competitions/:id/reset-fixtures', requireAdmin, (_req, res) => res.json({ authorized: true }));
app.use('/api/admin', adminConsistencyRouter, adminMatchControlRouter, adminRouter);
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
async function request(path: string, method = 'GET', body?: any, actor = 'user-555001') {
  return fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-test-user': actor }, body: body === undefined ? undefined : JSON.stringify(body) });
}
try {
  const grant = await request('/api/admin/users/user-555001/role', 'POST', { isAdmin: true, adminPermissions: { scope: 'LEAGUES', leagueIds: ['league-la-liga'] } }, 'user-5209126900');
  assert.equal(grant.status, 200, JSON.stringify(await grant.json()));
  assert.deepEqual((await getAuthoritativeUserForAuthorization('user-555001'))!.adminPermissions, { scope: 'LEAGUES', leagueIds: ['league-la-liga'] });
  assert.deepEqual((await getAdminUserDirectory(true)).find(user => user.id === 'user-555001')!.adminPermissions?.leagueIds, ['league-la-liga']);
  const login = await getOrCreateTelegramUserFirestore({ id: '555001', first_name: 'Test', username: 'LeagueManager' });
  assert.equal(login.adminPermissions?.scope, 'LEAGUES');
  process.env.SESSION_SECRET = 'isolated-scope-session-secret-1234567890';
  assert.deepEqual(verifySessionToken(createSessionToken(login)).claims?.adminPermissions, login.adminPermissions);
  assert.equal((await request('/api/admin/fixtures/scope-la-fixture/deadline', 'POST', {})).status, 200);
  assert.equal((await request('/api/admin/fixtures/scope-pl-fixture/deadline', 'POST', { competitionId: la })).status, 403);
  assert.equal((await request(`/api/admin/competitions/${la}/matchday/override`, 'POST', {})).status, 200);
  assert.equal((await request(`/api/admin/competitions/${pl}/matchday/override`, 'POST', { competitionId: la })).status, 403);
  assert.equal((await request(`/api/competitions/${pl}/reset-fixtures`, 'POST', {})).status, 403);
  for (const [path, method, body] of [
    ['/api/admin/overview', 'GET'], ['/api/admin/users/directory', 'GET'], ['/api/admin/notifications/messages', 'GET'],
    ['/api/admin/users/scope-player/role', 'POST', { isAdmin: true }], ['/api/admin/users/scope-root/suspend', 'POST', { isSuspended: true }],
    ['/api/admin/fixtures/reset', 'POST', {}], ['/api/admin/fixtures/restore-missing-pairs', 'POST', {}],
    ['/api/admin/read-model/rebuild', 'POST', {}], ['/api/admin/telegram-notifications/broadcast', 'POST', {}],
    ['/api/admin/clubs/club-arsenal/release', 'POST', {}], ['/api/admin/fixtures/scope-pl-fixture', 'DELETE', { reason: 'forged' }],
  ] as const) assert.equal((await request(path, method, body)).status, 403, path);
  const identities = await request('/api/admin/scoped/users?search=@scope-root');
  assert.equal(identities.status, 200);
  const identityUsers = (await identities.json()).users;
  assert.equal(identityUsers.length, 1);
  assert.equal(identityUsers[0].id, 'scope-root');
  assert.equal('adminPermissions' in identityUsers[0], false);
  assert.equal('isAdmin' in identityUsers[0], false);
  assert.equal((await (await request('/api/admin/scoped/users?search=x')).json()).users.length, 0);
  const overviewResponse = await request('/api/admin/scoped/overview');
  assert.equal(overviewResponse.status, 200);
  const overview = await overviewResponse.json();
  assert.ok(overview.clubs.every((club: any) => club.leagueId === 'league-la-liga'));
  assert.ok(overview.fixtures.every((fixture: any) => [la, 'comp-copa-del-rey-2026'].includes(fixture.competitionId)));
  assert.ok(overview.competitions.every((competition: any) => [la, 'comp-copa-del-rey-2026'].includes(competition.id)));
  assert.ok(overview.fixtures.some((fixture: any) => fixture.id === 'scope-la-fixture'));
  await db.collection('user_memberships').doc('season-2026-27_scope-player').set({ status: 'active', clubId: 'club-arsenal' });
  assert.equal((await request('/api/admin/clubs/club-barcelona/assign', 'POST', { targetUserId: 'scope-player' })).status, 403);
  assert.equal((await db.collection('user_memberships').doc('season-2026-27_scope-player').get()).data()!.clubId, 'club-arsenal');
  await db.collection('user_memberships').doc('season-2026-27_scope-player').delete();
  assert.equal((await request('/api/admin/clubs/club-barcelona/assign', 'POST', { targetUserId: '@scope-player' })).status, 200);
  // Revocation takes effect immediately even with a forged/stale ALL claim.
  await db.collection('users').doc('user-555001').update({ adminPermissions: { scope: 'LEAGUES', leagueIds: ['league-premier-league'] } });
  assert.equal((await request('/api/admin/fixtures/scope-la-fixture/deadline', 'POST', {})).status, 403);
  assert.equal((await request('/api/admin/fixtures/scope-pl-fixture/deadline', 'POST', {})).status, 200);
  await db.collection('users').doc('user-555001').update({ adminPermissions: { scope: 'LEAGUES', leagueIds: [] } });
  assert.equal((await request('/api/admin/scoped/overview')).status, 403);
  assert.equal((await request('/api/admin/users/scope-player/role', 'POST', { isAdmin: true, adminPermissions: { scope: 'LEAGUES', leagueIds: [] } }, 'user-5209126900')).status, 400);
  await db.collection('users').doc('scope-root').update({ isAdmin: false });
  const lastRoot = await request('/api/admin/users/user-5209126900/role', 'POST', { isAdmin: true, adminPermissions: { scope: 'LEAGUES', leagueIds: ['league-la-liga'] } }, 'user-5209126900');
  assert.ok(lastRoot.status >= 400);
  assert.equal((await getAuthoritativeUserForAuthorization('user-5209126900'))!.adminPermissions, undefined);
  process.env.ADMIN_TELEGRAM_IDS = '555001';
  const collection = db.collection.bind(db);
  (db as any).collection = (name: string) => name === 'users' ? { doc: () => ({ get: async () => { throw Object.assign(new Error('RESOURCE_EXHAUSTED quota exceeded'), { code: 8 }); } }) } : collection(name);
  try {
    const quota = await fetch(base + '/api/admin/access', { headers: { 'x-test-user': 'user-555001', authorization: 'Bearer ' + createSessionToken(login) } });
    assert.equal(quota.status, 503, 'Scoped signed session cannot use bootstrap quota fallback');
  } finally { (db as any).collection = collection; }
  console.log('PASS persisted league grants, re-login, scoped data, actual club assignment, authoritative fixture/competition checks, cross-league transfer protection, default-denied global routes, immediate revocation and last full-admin preservation');
} finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
