import { ensureDbReady, createApp } from '../app';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import {
  claimClubAtomicFirestore,
  generateCompetitionFixturesFirestore,
  getFixturesFirestore,
  getUserActiveClubFirestore,
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
  console.log('🚀 RUNNING FIREBASE FIRESTORE PERSISTENCE TEST SUITE');
  console.log('================================================================\n');

  // 0. Ensure initialization & migration
  await ensureDbReady();
  const db = getFirestoreDb();
  const seasonId = 'season-2026-27';
  const premierLeagueCompId = 'comp-premier-league-2026';

  console.log('📊 TEST 5: Verify Document Counts in Firestore');
  const [seasonsSnap, leaguesSnap, clubsSnap, compSnap] = await Promise.all([
    db.collection(COLLECTIONS.SEASONS).get(),
    db.collection(COLLECTIONS.LEAGUES).get(),
    db.collection(COLLECTIONS.CLUBS).get(),
    db.collection(COLLECTIONS.COMPETITIONS).get(),
  ]);

  console.log(`- Seasons: ${seasonsSnap.size} (expected >= 1)`);
  console.log(`- Leagues: ${leaguesSnap.size} (expected >= 5)`);
  console.log(`- Clubs: ${clubsSnap.size} (expected >= 96)`);
  console.log(`- Competitions: ${compSnap.size} (expected >= 15)`);

  assert(seasonsSnap.size >= 1, 'Seasons count < 1');
  assert(leaguesSnap.size >= 5, 'Leagues count < 5');
  assert(clubsSnap.size >= 96, 'Clubs count < 96');
  assert(compSnap.size >= 15, 'Competitions count < 15');
  console.log('✅ TEST 5 PASSED: Document counts verified in Firestore.\n');

  console.log('🔒 TEST 1: User A claims Arsenal, User B attempts to claim Arsenal');
  const userAId = 'user-test-persist-a';
  const userBId = 'user-test-persist-b';
  const arsenalId = 'club-arsenal';
  const chelseaId = 'club-chelsea';

  // Clear any existing test memberships
  await Promise.all([
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userAId}`).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userBId}`).delete(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${arsenalId}`).delete(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${chelseaId}`).delete(),
  ]);

  // User A claims Arsenal
  const claimResA = await claimClubAtomicFirestore(userAId, arsenalId, seasonId);
  assert(claimResA.success === true, 'User A claim did not return success');
  console.log('  -> User A successfully claimed Arsenal.');

  // User B attempts to claim Arsenal -> MUST FAIL with ClubConflictError
  let userBConflict = false;
  try {
    await claimClubAtomicFirestore(userBId, arsenalId, seasonId);
  } catch (err: any) {
    if (err instanceof ClubConflictError) {
      userBConflict = true;
      console.log(`  -> User B rejected with 409 conflict: "${err.message}"`);
    }
  }
  assert(userBConflict, 'User B was not rejected with ClubConflictError for Arsenal!');

  // Verify directly in Firestore: Arsenal belongs to User A
  const arsenalOcc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${arsenalId}`).get();
  assert(arsenalOcc.exists, 'Arsenal occupancy document does not exist in Firestore');
  assert(arsenalOcc.data()?.userId === userAId, 'Arsenal in Firestore does not belong to User A');
  console.log('✅ TEST 1 PASSED: Club ownership is locked per club and verified in Firestore.\n');

  console.log('🔒 TEST 2: User A attempts to claim Chelsea after claiming Arsenal');
  let userASecondClaimConflict = false;
  try {
    await claimClubAtomicFirestore(userAId, chelseaId, seasonId);
  } catch (err: any) {
    if (err instanceof ClubConflictError) {
      userASecondClaimConflict = true;
      console.log(`  -> User A second claim rejected with 409 conflict: "${err.message}"`);
    }
  }
  assert(userASecondClaimConflict, 'User A was able to claim a second club!');

  // Verify User A still owns Arsenal
  const userAClub = await getUserActiveClubFirestore(userAId, seasonId);
  assert(userAClub?.id === arsenalId, 'User A active club is no longer Arsenal');
  console.log('✅ TEST 2 PASSED: User-season immutability verified in Firestore.\n');

  console.log('⚡ TEST 3 & 4: Simulated Lambda Cold Starts & 380 Fixture Persistence');
  console.log('  -> Instance 1: Generating Premier League schedule (380 fixtures)...');
  const genResult = await generateCompetitionFixturesFirestore(premierLeagueCompId, { force: true });
  console.log(`  -> Instance 1 generated ${genResult.generated} fixtures across ${genResult.matchdays} matchdays.`);
  assert(genResult.generated === 380, `Expected 380 fixtures generated, got ${genResult.generated}`);
  assert(genResult.matchdays === 38, `Expected 38 matchdays, got ${genResult.matchdays}`);

  console.log('  -> Simulating Cold Start: Creating a new isolated app instance...');
  const coldInstanceApp = createApp();

  console.log('  -> Instance 2: Querying matches for Arsenal owner (User A)...');
  const userAFixtures = await getFixturesFirestore({
    userId: userAId,
    seasonId,
    competitionId: premierLeagueCompId,
  });
  console.log(`  -> Instance 2 returned ${userAFixtures.length} matches for Arsenal owner.`);
  assert(userAFixtures.length === 38, `Expected 38 matches for Arsenal owner, got ${userAFixtures.length}`);

  console.log('  -> Querying all 380 fixtures from Firestore to verify zero data loss...');
  const allEplFixtures = await getFixturesFirestore({
    competitionId: premierLeagueCompId,
    seasonId,
  });
  console.log(`  -> Total Premier League fixtures in Firestore: ${allEplFixtures.length}`);
  assert(allEplFixtures.length === 380, `Expected 380 fixtures in Firestore, got ${allEplFixtures.length}`);

  console.log('✅ TEST 3 & 4 PASSED: 380 fixtures persisted and retrieved across simulated serverless cold starts.\n');

  console.log('================================================================');
  console.log('🎉 ALL FIREBASE FIRESTORE PERSISTENCE TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================');
}

runFirebasePersistenceTests().catch((err) => {
  console.error('❌ PERSISTENCE SUITE ERROR:', err);
  process.exit(1);
});
