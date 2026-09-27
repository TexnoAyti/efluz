import assert from 'node:assert/strict';
import { initDatabase, queryAll } from '../db';
import { seedDatabase } from '../db/seed';
import { getFirestoreDb } from '../firebase/admin';
import { adminReleaseClubFirestore, claimClubAtomicFirestore, getFixturesFirestore, submitFixtureResultFirestore } from '../firebase/firestoreStore';
import { checkClubClaimLimit } from '../services/premiumClubRule';
import { revokePremiumEntitlement } from '../services/premiumService';
import { getPremiumClubBadgeIds } from '../services/premiumBadgeService';
import { startMockUpstashBridge } from './mockUpstashBridge';

async function run() {
  assert.equal(checkClubClaimLimit([{ id: 'a', leagueId: 'one' }], { id: 'b', leagueId: 'two' }, false), 'LIMIT_REACHED');
  assert.equal(checkClubClaimLimit([{ id: 'a', leagueId: 'one' }], { id: 'b', leagueId: 'one' }, true), 'SAME_LEAGUE');
  assert.equal(checkClubClaimLimit([{ id: 'a', leagueId: 'one' }], { id: 'b', leagueId: 'two' }, true), 'ALLOWED');
  assert.equal(checkClubClaimLimit([{ id: 'a', leagueId: 'one' }, { id: 'b', leagueId: 'two' }], { id: 'c', leagueId: 'three' }, true), 'LIMIT_REACHED');

  await initDatabase();
  seedDatabase();
  const db = getFirestoreDb();
  const seasonId = 'season-2026-27';
  const userId = 'user-premium-claim-test';
  await claimClubAtomicFirestore(userId, 'club-arsenal', seasonId, { authoritativeOnly: true });
  await assert.rejects(
    () => claimClubAtomicFirestore(userId, 'club-real-madrid', seasonId, { authoritativeOnly: true }),
    (error: any) => error.code === 'CLUB_SELECTION_LOCKED',
  );
  await db.collection('premium_entitlements').doc(`${seasonId}__${userId}`).set({ userId, seasonId, status: 'ACTIVE' });
  await assert.rejects(
    () => claimClubAtomicFirestore(userId, 'club-chelsea', seasonId, { authoritativeOnly: true }),
    (error: any) => error.code === 'CLUB_LEAGUE_LIMIT',
  );
  await claimClubAtomicFirestore(userId, 'club-real-madrid', seasonId, { authoritativeOnly: true });
  await assert.rejects(
    () => claimClubAtomicFirestore(userId, 'club-psg', seasonId, { authoritativeOnly: true }),
    (error: any) => error.code === 'CLUB_SELECTION_LOCKED',
  );

  const membership = await db.collection('user_memberships').doc(`${seasonId}_${userId}`).get();
  assert.equal(membership.data()?.clubId, 'club-arsenal');
  assert.equal(membership.data()?.secondaryClubId, 'club-real-madrid');
  const fixtureId = 'fix-premium-second-club';
  await db.collection('fixtures').doc(fixtureId).set({
    id: fixtureId, seasonId, competitionId: 'comp-la-liga-2026', matchday: 0,
    homeClubId: 'club-real-madrid', awayClubId: 'club-barcelona', status: 'SCHEDULED',
    homeScore: null, awayScore: null, createdAt: new Date().toISOString(),
  });
  const redis = await startMockUpstashBridge();
  try {
    const badgeClubs = await getPremiumClubBadgeIds(seasonId);
    assert.ok(badgeClubs.includes('club-arsenal') && badgeClubs.includes('club-real-madrid'));
    assert.ok(!badgeClubs.includes('club-chelsea'));
    const myFixtures = await getFixturesFirestore({ userId, seasonId });
    assert.ok(myFixtures.some((fixture) => fixture.id === fixtureId), 'secondary club fixtures appear in My Matches');
  } finally {
    await redis.close();
  }
  await db.collection('users').doc(userId).set({ id: userId });
  await assert.rejects(
    () => revokePremiumEntitlement({ userId, seasonId, actorUserId: 'admin-test' }),
    /PREMIUM_SECOND_CLUB_OWNED/,
  );
  const rows = queryAll<{ club_id: string }>(
    "SELECT club_id FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = 'active' ORDER BY club_id",
    [userId, seasonId],
  );
  assert.deepEqual(rows.map((row) => row.club_id), ['club-arsenal', 'club-real-madrid']);

  await submitFixtureResultFirestore(userId, fixtureId, 2, 1);
  const submission = await db.collection('result_submissions').doc(`sub-${fixtureId}-${userId}`).get();
  assert.equal(submission.data()?.clubId, 'club-real-madrid');

  await adminReleaseClubFirestore('admin-test', 'club-real-madrid', seasonId, { authoritativeOnly: true });
  const afterSecondaryRelease = await db.collection('user_memberships').doc(`${seasonId}_${userId}`).get();
  assert.equal(afterSecondaryRelease.data()?.status, 'active');
  assert.equal(afterSecondaryRelease.data()?.clubId, 'club-arsenal');
  assert.equal(afterSecondaryRelease.data()?.secondaryClubId, null);
  await claimClubAtomicFirestore(userId, 'club-psg', seasonId, { authoritativeOnly: true });
  await adminReleaseClubFirestore('admin-test', 'club-arsenal', seasonId, { authoritativeOnly: true });
  const afterPrimaryRelease = await db.collection('user_memberships').doc(`${seasonId}_${userId}`).get();
  assert.equal(afterPrimaryRelease.data()?.status, 'active');
  assert.equal(afterPrimaryRelease.data()?.clubId, 'club-psg');
  assert.equal(afterPrimaryRelease.data()?.secondaryClubId, null);
  console.log('Premium second club regression: PASS');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
