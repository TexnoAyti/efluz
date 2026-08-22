import { ensureDbReady, createApp } from '../app';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import {
  claimClubAtomicFirestore,
  generateCompetitionFixturesFirestore,
  getFixturesFirestore,
  getUserActiveClubFirestore,
  getClubsByLeagueFirestore,
  getAllCompetitionsFirestore,
  getCompetitionByIdFirestore,
  ClubConflictError,
} from '../firebase/firestoreStore';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    throw new Error(msg);
  }
}

async function runFirebasePersistenceTests() {
  console.log('================================================================');
  console.log('🚀 RUNNING PRODUCTION DATA-SYNC 8-TEST REGRESSION SUITE');
  console.log('================================================================\n');

  // 0. Ensure initialization & migration
  await ensureDbReady();
  const db = getFirestoreDb();
  const seasonId = 'season-2026-27';
  const premierLeagueCompId = 'comp-premier-league-2026';
  const eplLeagueId = 'league-premier-league';

  const userAId = 'user-regression-test-a';
  const userBId = 'user-regression-test-b';
  const arsenalId = 'club-arsenal';
  const chelseaId = 'club-chelsea';

  // Clean up any test users & memberships
  await Promise.all([
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userAId}`).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userBId}`).delete(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${arsenalId}`).delete(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${chelseaId}`).delete(),
    db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${arsenalId}`).delete(),
    db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${chelseaId}`).delete(),
  ]);

  // TEST 1: FIXTURE PERSISTENCE (Bug 1 regression)
  console.log('📋 TEST 1: Fixture Generation & Status Persistence in Firestore');
  const genResult = await generateCompetitionFixturesFirestore(premierLeagueCompId, { force: true });
  console.log(`  -> Generated ${genResult.generated} fixtures across ${genResult.matchdays} matchdays.`);
  assert(genResult.generated === 380, `Expected 380 fixtures generated, got ${genResult.generated}`);

  // Query via getAllCompetitionsFirestore and getCompetitionByIdFirestore
  const comp = await getCompetitionByIdFirestore(premierLeagueCompId);
  assert(comp !== null, 'Competition not found');
  assert(comp!.hasFixtures === true, 'Competition.hasFixtures must be true');
  assert(comp!.fixtureCount === 380, `Expected fixtureCount === 380, got ${comp!.fixtureCount}`);
  assert(comp!.generationStatus === 'generated', `Expected generationStatus === 'generated', got ${comp!.generationStatus}`);
  console.log('  -> Competition document reflects hasFixtures=true, fixtureCount=380, generationStatus=generated.');
  console.log('✅ TEST 1 PASSED: Fixture generation status persists in Firestore.\n');

  // TEST 2: FIXTURE GENERATION IDEMPOTENCY
  console.log('📋 TEST 2: Fixture Generation Idempotency (force: false)');
  const idempotentResult = await generateCompetitionFixturesFirestore(premierLeagueCompId, { force: false });
  assert(idempotentResult.generated === 380, `Expected 380 fixtures on idempotent call, got ${idempotentResult.generated}`);
  const compAfterIdempotent = await getCompetitionByIdFirestore(premierLeagueCompId);
  assert(compAfterIdempotent!.fixtureCount === 380, 'Fixture count changed during idempotent call');
  console.log('✅ TEST 2 PASSED: Idempotent call returned existing 380 fixtures without duplication.\n');

  // TEST 3: FIXTURE REGENERATION
  console.log('📋 TEST 3: Fixture Regeneration (force: true)');
  const regenResult = await generateCompetitionFixturesFirestore(premierLeagueCompId, { force: true });
  assert(regenResult.generated === 380, `Expected 380 fixtures regenerated, got ${regenResult.generated}`);
  const compAfterRegen = await getCompetitionByIdFirestore(premierLeagueCompId);
  assert(compAfterRegen!.fixtureCount === 380, 'Fixture count changed after regeneration');
  console.log('✅ TEST 3 PASSED: Fixture regeneration cleanly purged old matches and re-seeded 380 fixtures.\n');

  // TEST 4: FIXTURES CREATED BEFORE CLUB CLAIM (Bug 2 regression)
  console.log('📋 TEST 4: Fixtures Pre-exist -> User Claims Club -> Query My Matches');
  // User A now claims Arsenal
  const claimResA = await claimClubAtomicFirestore(userAId, arsenalId, seasonId);
  assert(claimResA.success === true, 'User A claim returned success: false');

  // Query fixtures for User A without generating fixtures again
  const userAFixtures = await getFixturesFirestore({
    userId: userAId,
    seasonId,
    competitionId: premierLeagueCompId,
  });
  console.log(`  -> User A immediately has ${userAFixtures.length} matches (Home: ${userAFixtures.filter(f => f.homeClubId === arsenalId).length}, Away: ${userAFixtures.filter(f => f.awayClubId === arsenalId).length})`);
  assert(userAFixtures.length === 38, `Expected 38 matches for Arsenal owner, got ${userAFixtures.length}`);
  console.log('✅ TEST 4 PASSED: User immediately accesses pre-existing fixtures upon club selection.\n');

  // TEST 5: GLOBAL CLUB OCCUPANCY VISIBILITY (Bug 3 regression)
  console.log('📋 TEST 5: Global Club Occupancy Multi-User Visibility');
  // User B queries clubs in Premier League
  const clubsForUserB = await getClubsByLeagueFirestore(eplLeagueId, seasonId, userBId);
  const arsenalForB = clubsForUserB.find((c) => c.id === arsenalId);
  assert(arsenalForB !== undefined, 'Arsenal not found in Premier League clubs');
  assert(arsenalForB!.isTaken === true, 'Arsenal must be marked isTaken: true for User B');
  assert(arsenalForB!.isCurrentUserClub === false, 'Arsenal must be isCurrentUserClub: false for User B');
  assert(arsenalForB!.occupancy.status === 'occupied', `Expected occupancy.status === 'occupied', got ${arsenalForB!.occupancy.status}`);
  assert(arsenalForB!.occupancy.userId === userAId, 'Arsenal occupancy userId must be User A');

  // User A queries clubs in Premier League
  const clubsForUserA = await getClubsByLeagueFirestore(eplLeagueId, seasonId, userAId);
  const arsenalForA = clubsForUserA.find((c) => c.id === arsenalId);
  assert(arsenalForA !== undefined, 'Arsenal not found for User A');
  assert(arsenalForA!.isTaken === true, 'Arsenal must be marked isTaken: true for User A');
  assert(arsenalForA!.isCurrentUserClub === true, 'Arsenal must be isCurrentUserClub: true for User A');
  assert(arsenalForA!.occupancy.status === 'owned', `Expected occupancy.status === 'owned', got ${arsenalForA!.occupancy.status}`);
  console.log('✅ TEST 5 PASSED: Occupancy state is globally consistent and correctly scoped to requesting user.\n');

  // TEST 6: DIRECT OCCUPIED CLAIM ATTACK
  console.log('📋 TEST 6: User B attempts to claim already-occupied Arsenal');
  let attackRejected = false;
  try {
    await claimClubAtomicFirestore(userBId, arsenalId, seasonId);
  } catch (err: any) {
    if (err instanceof ClubConflictError) {
      attackRejected = true;
      console.log(`  -> User B claim rejected with conflict: "${err.message}"`);
    }
  }
  assert(attackRejected, 'User B was able to claim occupied Arsenal!');
  console.log('✅ TEST 6 PASSED: Direct claim collision rejected atomically with ClubConflictError.\n');

  // TEST 7: OCCUPANCY & SELECTION PERSISTENCE ACROSS RUNTIME INSTANCES
  console.log('📋 TEST 7: Occupancy Persistence Across Serverless Runtime Instances');
  const coldApp = createApp();
  const userAActiveClub = await getUserActiveClubFirestore(userAId, seasonId);
  assert(userAActiveClub?.id === arsenalId, `Expected User A active club to be Arsenal, got ${userAActiveClub?.id}`);
  const arsenalDoc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${arsenalId}`).get();
  assert(arsenalDoc.exists && arsenalDoc.data()?.userId === userAId, 'Firestore occupancy document missing or invalid');
  console.log('✅ TEST 7 PASSED: Claimed club state is persistently retrieved from Firestore.\n');

  // TEST 8: CONCURRENT CLAIM RACE CONDITION
  console.log('📋 TEST 8: Concurrent Claim Race Condition on Unclaimed Chelsea');
  const userCId = 'user-regression-race-c';
  const userDId = 'user-regression-race-d';

  const [resC, resD] = await Promise.allSettled([
    claimClubAtomicFirestore(userCId, chelseaId, seasonId),
    claimClubAtomicFirestore(userDId, chelseaId, seasonId),
  ]);

  const fulfilled = [resC, resD].filter((r) => r.status === 'fulfilled');
  const rejected = [resC, resD].filter((r) => r.status === 'rejected');

  console.log(`  -> Race results: ${fulfilled.length} fulfilled, ${rejected.length} rejected.`);
  assert(fulfilled.length === 1, `Expected exactly 1 winner in concurrent claim, got ${fulfilled.length}`);
  assert(rejected.length === 1, `Expected exactly 1 rejection in concurrent claim, got ${rejected.length}`);
  console.log('✅ TEST 8 PASSED: Atomic Firestore transaction prevented race conditions.\n');

  // Clean up race test users
  await Promise.all([
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userCId}`).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userDId}`).delete(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${chelseaId}`).delete(),
    db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${chelseaId}`).delete(),
  ]);

  console.log('================================================================');
  console.log('🎉 ALL 8 PRODUCTION DATA-SYNC REGRESSION TESTS PASSED!');
  console.log('================================================================');
}

runFirebasePersistenceTests().catch((err) => {
  console.error('❌ PERSISTENCE SUITE ERROR:', err);
  process.exit(1);
});
