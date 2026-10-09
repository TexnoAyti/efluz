import assert from 'node:assert/strict';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { getAdminFixturesFromReadModel, getAdminClubsFromReadModel, clearProcessMemoryCache, resetMemoryRedisStore } from '../readModel/readModelStore';
import { getAdminUserDirectory } from '../services/adminUserDirectory';

await initDatabase();
const db = getFirestoreDb();
const seasonId = 'season-admin-cold-test';
await db.collection(COLLECTIONS.FIXTURES).doc('cold-game').set({
  seasonId, competitionId: 'comp-premier-league-2026', homeClubId: 'club-arsenal', awayClubId: 'club-chelsea',
  matchday: 1, status: 'SCHEDULED', createdAt: '2026-10-09T00:00:00Z',
});
await db.collection(COLLECTIONS.USERS).doc('cold-user').set({ telegramId: '123', username: 'cold', isAdmin: true });
for (const [clubId, username] of [['club-arsenal', 'owner_arsenal'], ['club-chelsea', 'owner_chelsea']]) {
  await db.collection(COLLECTIONS.USERS).doc(username).set({ username });
  await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`).set({ seasonId, clubId, userId: username, status: 'active' });
}
process.env.K_SERVICE = 'hosted-regression';
process.env.DATABASE_PROVIDER = 'supabase';
const first = await getAdminFixturesFromReadModel({ seasonId, limit: 1 });
assert.equal(first.total, 1);
assert.equal(first.fixtures[0].id, 'cold-game');
assert.equal(first.degraded, false, 'PostgreSQL cold start must not serve SQLite fallback');
clearProcessMemoryCache(); resetMemoryRedisStore();
const second = await getAdminFixturesFromReadModel({ seasonId });
assert.equal(second.total, 1);
assert.equal(second.degraded, false);
assert.ok((await getAdminUserDirectory()).some(user => user.id === 'cold-user'));
const clubs = await getAdminClubsFromReadModel(seasonId);
assert.equal(clubs.total, 96);
assert.equal(clubs.clubs.find(club => club.id === 'club-arsenal')?.ownerUsername, 'owner_arsenal');
assert.equal(clubs.clubs.find(club => club.id === 'club-chelsea')?.ownerUsername, 'owner_chelsea');
console.log('PASS hosted PostgreSQL admin cold-start fixtures, durable restart, user directory, and clubs');
