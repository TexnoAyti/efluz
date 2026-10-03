import assert from 'node:assert/strict';
import { getFirestoreDb } from '../firebase/admin';
import { initDatabase } from '../db';
import { getAdminUserDirectory, resolveAdminUserReference } from '../services/adminUserDirectory';
import { matchesUserSearch } from '../../lib/userSearch';
import { restoreMissingLeaguePairs, MISSING_LEAGUE_PAIRS } from '../services/missingLeaguePairRepair';
import { addFixtureTombstone, getFixtureTombstones } from '../services/fixtureTombstoneService';

await initDatabase();
const db = getFirestoreDb();
for (let index = 0; index < 125; index++) {
  const id = `directory-user-${String(index).padStart(3, '0')}`;
  await db.collection('users').doc(id).set({ id, username: `Player${index}`, telegramId: String(700000 + index), firstName: 'Test', lastName: 'Manager' });
}
assert.equal((await getAdminUserDirectory()).length, 125);
assert.equal(await resolveAdminUserReference(' @pLaYeR124 '), 'directory-user-124');
assert.equal(await resolveAdminUserReference('700124'), 'directory-user-124');
assert.equal(await resolveAdminUserReference('directory-user-124'), 'directory-user-124');
const user = (await getAdminUserDirectory()).find(user => user.id === 'directory-user-124')!;
assert.ok(matchesUserSearch(user, ' @PLAYER124 '));
assert.ok(matchesUserSearch(user, 'test manager'));
assert.ok(matchesUserSearch(user, '700124'));
assert.equal(matchesUserSearch(user, '@unknown'), false);
await assert.rejects(resolveAdminUserReference('@unknown'), /USER_NOT_FOUND/);
await db.collection('users').doc('directory-user-124').update({ privateInternalField: 'must-not-be-returned' });
assert.equal('privateInternalField' in (await getAdminUserDirectory(true)).find(user => user.id === 'directory-user-124')!, false);
await db.collection('users').doc('ambiguous').set({ username: 'player124' });
await assert.rejects(resolveAdminUserReference('@player124'), /AMBIGUOUS_USER_REFERENCE/);
console.log('PASS username/@username/case/space/name/ID search and complete 125-user directory; ambiguity rejects');

const pair = MISSING_LEAGUE_PAIRS[0];
const id = 'fix-comp-serie-a-2026-md18-venezia-vs-bologna';
const original = { id, seasonId: 'season-2026-27', competitionId: pair.competitionId, matchday: 18,
  homeClubId: 'club-venezia', awayClubId: 'club-bologna', status: 'CONFIRMED', homeScore: 3, awayScore: 1 };
await db.collection('audit_logs').doc(`audit_ADMIN_DELETE_FIXTURE_fixture_${id}`).set({ action: 'ADMIN_DELETE_FIXTURE', entityId: id, oldValueJson: JSON.stringify(original) });
await addFixtureTombstone({ fixtureId: id, seasonId: original.seasonId, deletedAt: new Date().toISOString() });
await addFixtureTombstone({ fixtureId: 'unrelated-delete', seasonId: original.seasonId, deletedAt: new Date().toISOString() });
const first = await restoreMissingLeaguePairs('test-admin');
assert.equal(first.results[0].status, 'restored');
assert.equal(first.results[1].status, 'error');
assert.deepEqual((await db.collection('fixtures').doc(id).get()).data(), original);
assert.deepEqual((await getFixtureTombstones()).map(row => row.fixtureId), ['unrelated-delete']);
await db.collection('fixtures').doc(id).update({ homeScore: 4 });
const second = await restoreMissingLeaguePairs('test-admin');
assert.equal(second.results[0].status, 'already_present');
assert.equal((await db.collection('fixtures').doc(id).get()).data()!.homeScore, 4);
const bundesliga = await db.collection('fixtures').where('competitionId', '==', MISSING_LEAGUE_PAIRS[1].competitionId).get();
assert.equal(bundesliga.docs.length, 0);
console.log('PASS original orientation/result restoration; unrelated tombstone preserved; retry preserves edits; missing audit never fabricates fixture');

// Exercise the actual protected routes and assignment, using isolated accounts only.
const { default: express } = await import('express');
const { adminRouter } = await import('../routes/admin.routes');
await db.collection('users').doc('directory-admin').set({ id: 'directory-admin', username: 'directoryAdmin', telegramId: '900001', isAdmin: true, isSuspended: false });
await db.collection('users').doc('directory-player').set({ id: 'directory-player', username: 'AssignmentPlayer', telegramId: '900002', isAdmin: false, isSuspended: false });
const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] };
  next();
});
app.use('/api/admin', adminRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}/api/admin`;
try {
  assert.equal((await fetch(`${base}/users/directory`)).status, 401);
  assert.equal((await fetch(`${base}/fixtures/restore-missing-pairs`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${base}/fixtures/restore-missing-pairs`, { method: 'POST', headers: { 'x-test-user': 'directory-player' } })).status, 403);
  const response = await fetch(`${base}/clubs/club-arsenal/assign`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': 'directory-admin' }, body: JSON.stringify({ targetUserId: ' @assignmentPLAYER ' }) });
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  const occupancy = await db.collection('club_occupancies').doc('season-2026-27_club-arsenal').get();
  assert.equal(occupancy.data()!.userId, 'directory-player');
  console.log('PASS authenticated HTTP club assignment accepts @username; anonymous/non-admin repair and directory access denied');
} finally {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
