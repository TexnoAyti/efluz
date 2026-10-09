import assert from 'node:assert/strict';
import express from 'express';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { requireAdmin } from '../middleware/authMiddleware';
import { ADMIN_LEAGUES, canUseDangerZone } from '../../lib/adminPermissions';
import { adminRouter } from '../routes/admin.routes';

await initDatabase();
const db = getFirestoreDb();
const owner = 'user-5209126900';
for (const [id, telegramId, permissions] of [[owner, '5209126900', { scope: 'ALL', leagueIds: [] }], ['other-admin', '123', { scope: 'ALL', leagueIds: [] }], ['league-admin', '456', { scope: 'LEAGUES', leagueIds: ['league-la-liga'] }]]) {
  await db.collection('users').doc(String(id)).set({ id, telegramId, isAdmin: true, isSuspended: false, adminPermissions: permissions });
}
for (const league of ADMIN_LEAGUES) await db.collection('fixtures').doc(league.cupCompetitionId).set({ id: league.cupCompetitionId, competitionId: league.cupCompetitionId, seasonId: 'season-2026-27' });
const app = express(); app.use(express.json());
// Forged owner claims must be replaced by authoritative identity and permissions.
app.use((req: any, _res, next) => { req.user = { id: String(req.headers['x-test-user'] || 'other-admin'), telegramId: '5209126900', isAdmin: true, adminPermissions: { scope: 'ALL', leagueIds: [] } }; next(); });
const danger: Array<[string, string]> = [
  ['DELETE', '/api/admin/fixtures/test'], ['DELETE', '/api/admin/users/test'], ['DELETE', '/api/admin/submissions/test'],
  ['POST', '/api/admin/users/test/role'], ['POST', '/api/admin/fixtures/reset'], ['POST', '/api/admin/fixtures/generate'],
  ['POST', '/api/competitions/test/reset-fixtures'], ['POST', '/api/competitions/test/generate-fixtures'],
  ['POST', '/api/admin/cups/comp-copa-del-rey-2026/bracket/generate'], ['POST', '/api/admin/knockouts/generate'],
  ['POST', '/api/admin/migrate-to-firestore'], ['POST', '/api/admin/fixtures/restore-missing-pairs'],
  ['POST', '/api/admin/season-ops/rollover'], ['POST', '/api/admin/season-ops/archive'], ['POST', '/api/admin/european/qualification/apply'],
  ['POST', '/api/admin/users/user-5209126900/suspend'],
];
for (const [method, path] of danger) (app as any)[method.toLowerCase()](path, requireAdmin, (_req: any, res: any) => res.json({ authorized: true }));
// Authorization probes do not mutate tournament data.
app.use('/api/admin/cups/:cupId', requireAdmin, (_req, res) => res.json({ authorized: true }));
app.get('/api/admin/submissions', requireAdmin, (_req, res) => res.json({ authorized: true }));
app.post('/api/admin/fixtures/:id/result', requireAdmin, (_req, res) => res.json({ authorized: true }));
app.use('/api/admin', adminRouter);
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const request = (path: string, method = 'GET', actor = 'league-admin') => fetch(base + path, { method, headers: { 'x-test-user': actor, 'content-type': 'application/json' }, body: ['GET','HEAD'].includes(method) ? undefined : JSON.stringify({ competitionId: 'comp-copa-del-rey-2026' }) });
try {
  for (const [method, path] of danger) {
    assert.equal((await request(path, method, 'other-admin')).status, 403, path);
    assert.equal((await request(path, method)).status, 403, path);
    assert.equal((await request(path, method, owner)).status, 200, path);
    assert.equal((await request(path.toUpperCase() + '/', method, 'other-admin')).status, 403, 'case/trailing slash: ' + path);
  }
  for (const league of ADMIN_LEAGUES) {
    await db.collection('users').doc('league-admin').update({ adminPermissions: { scope: 'LEAGUES', leagueIds: [league.id] } });
    for (const candidate of ADMIN_LEAGUES) {
      const expected = candidate.id === league.id ? 200 : 403;
      for (const [method, suffix] of [['GET',''], ['GET','/health'], ['POST','/round'], ['POST','/round/advance'], ['POST','/reconcile'], ['POST','/bracket/preview']] as const) {
        assert.equal((await request('/api/admin/cups/' + candidate.cupCompetitionId + suffix, method)).status, expected);
      }
      assert.equal((await request(`/api/admin/cups/${league.cupCompetitionId}/bracket/fixture/${candidate.cupCompetitionId}`, 'PATCH')).status, expected, 'actual fixture scope');
      assert.equal((await request(`/api/admin/fixtures/${candidate.cupCompetitionId}/result`, 'POST')).status, expected);
      assert.equal((await request('/api/admin/submissions?fixtureId=' + candidate.cupCompetitionId)).status, expected);
    }
    assert.equal((await request('/api/admin/submissions')).status, 403);
    assert.equal((await request('/api/admin/cups/comp-champions-league-2026')).status, 403);
  }
  assert.equal((await (await request('/api/admin/access', 'GET', owner)).json()).canUseDangerZone, true);
  assert.equal((await (await request('/api/admin/access', 'GET', 'other-admin')).json()).canUseDangerZone, false);
  await db.collection('users').doc(owner).update({ isSuspended: true });
  assert.equal((await request('/api/admin/fixtures/test', 'DELETE', owner)).status, 403);
  assert.equal(canUseDangerZone({ id: 'imposter', telegramId: '5209126900', isAdmin: true, isSuspended: false }), false);
  console.log('PASS owner-only danger routes, legacy aliases, forged claims, revoked owner, all five league/cup grants, actual fixture scope and authoritative access flags');
} finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
