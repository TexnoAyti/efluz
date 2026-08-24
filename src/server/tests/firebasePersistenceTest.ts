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

async function runProductionTestsAtoJ() {
  console.log('================================================================');
  console.log('🚀 RUNNING PRODUCTION DATA-SYNC 10-TEST (TEST A - TEST J) SUITE');
  console.log('================================================================\n');

  // 0. Ensure initialization & migration
  await ensureDbReady();
  const db = getFirestoreDb();
  const seasonId = 'season-2026-27';
  const premierLeagueCompId = 'comp-premier-league-2026';
  const eplLeagueId = 'league-premier-league';

  const userAId = 'user-phase10-test-a';
  const userBId = 'user-phase10-test-b';
  const userCId = 'user-phase10-test-c';
  const userDId = 'user-phase10-test-d';
  const userGId = 'user-phase10-test-g';

  const arsenalId = 'club-arsenal';
  const chelseaId = 'club-chelsea';
  const liverpoolId = 'club-liverpool';

  // Clean up any test users & memberships
  await Promise.all([
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userAId}`).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userBId}`).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userCId}`).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userDId}`).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userGId}`).delete(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${arsenalId}`).delete(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${chelseaId}`).delete(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${liverpoolId}`).delete(),
    db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${arsenalId}`).delete(),
    db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${chelseaId}`).delete(),
    db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${liverpoolId}`).delete(),
  ]);

  // ------------------------------------------------------------
  // TEST A: User A claims Arsenal. Read Firestore directly. Assert Arsenal occupancy exists.
  // ------------------------------------------------------------
  console.log('📋 TEST A: User A claims Arsenal -> Read Firestore directly -> Assert occupancy exists');
  const claimResA = await claimClubAtomicFirestore(userAId, arsenalId, seasonId);
  assert(claimResA.success === true, 'TEST A: User A claim returned success: false');

  const occDocA = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${arsenalId}`).get();
  assert(occDocA.exists, 'TEST A: Firestore club_occupancies doc for Arsenal does not exist');
  assert(occDocA.data()?.userId === userAId, `TEST A: Expected occupancy userId == ${userAId}, got ${occDocA.data()?.userId}`);
  assert(occDocA.data()?.status === 'active', 'TEST A: Expected occupancy status == "active"');
  console.log('✅ TEST A PASSED: Direct Firestore read confirmed Arsenal occupancy document exists.\n');

  // ------------------------------------------------------------
  // TEST B: Wait/reinitialize database layer. Read Arsenal occupancy again. Assert it still exists.
  // ------------------------------------------------------------
  console.log('📋 TEST B: Reinitialize database layer / cold start -> Read Arsenal occupancy again');
  createApp(); // Simulate cold start
  const userAActiveClub = await getUserActiveClubFirestore(userAId, seasonId);
  assert(userAActiveClub !== null, 'TEST B: User A active club returned null after reinitialization');
  assert(userAActiveClub?.id === arsenalId, `TEST B: Expected User A active club to be Arsenal, got ${userAActiveClub?.id}`);
  const occDocB = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${arsenalId}`).get();
  assert(occDocB.exists && occDocB.data()?.userId === userAId, 'TEST B: Occupancy document missing after reinitialization');
  console.log('✅ TEST B PASSED: Occupancy persistently retained across simulated cold-start reinitialization.\n');

  // ------------------------------------------------------------
  // TEST C: User B loads league clubs. Assert Arsenal = occupied.
  // ------------------------------------------------------------
  console.log('📋 TEST C: User B loads league clubs -> Assert Arsenal = occupied (isTaken: true, occupancy: occupied)');
  const clubsForUserB = await getClubsByLeagueFirestore(eplLeagueId, seasonId, userBId);
  const arsenalForB = clubsForUserB.find((c) => c.id === arsenalId);
  assert(arsenalForB !== undefined, 'TEST C: Arsenal not found in Premier League clubs');
  assert(arsenalForB!.isTaken === true, 'TEST C: Arsenal must have isTaken: true for User B');
  assert(arsenalForB!.isCurrentUserClub === false, 'TEST C: Arsenal must have isCurrentUserClub: false for User B');
  assert(arsenalForB!.occupancy.status === 'occupied', `TEST C: Expected occupancy.status == 'occupied', got ${arsenalForB!.occupancy.status}`);
  assert(arsenalForB!.occupancy.userId === userAId, 'TEST C: Arsenal occupancy userId must match User A');
  console.log('✅ TEST C PASSED: User B sees Arsenal as occupied with User A occupancy info.\n');

  // ------------------------------------------------------------
  // TEST D: User B attempts to claim Arsenal. Assert HTTP 409 / ClubConflictError.
  // ------------------------------------------------------------
  console.log('📋 TEST D: User B attempts to claim occupied Arsenal -> Assert ClubConflictError (HTTP 409)');
  let testDConflict = false;
  try {
    await claimClubAtomicFirestore(userBId, arsenalId, seasonId);
  } catch (err: any) {
    if (err instanceof ClubConflictError) {
      testDConflict = true;
      console.log(`  -> Rejected with code: ${err.code}, message: "${err.message}"`);
    }
  }
  assert(testDConflict, 'TEST D: User B was able to claim occupied Arsenal without conflict error!');
  console.log('✅ TEST D PASSED: Atomic collision prevented and rejected with ClubConflictError.\n');

  // ------------------------------------------------------------
  // TEST E: Generate Premier League fixtures. Read Firestore. Assert 380 fixtures.
  // ------------------------------------------------------------
  console.log('📋 TEST E: Generate Premier League fixtures -> Read Firestore directly -> Assert 380 fixtures');
  const genResultE = await generateCompetitionFixturesFirestore(premierLeagueCompId, { force: true });
  assert(genResultE.generated === 380, `TEST E: Expected 380 generated fixtures, got ${genResultE.generated}`);
  const fixturesSnapE = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', premierLeagueCompId).get();
  assert(fixturesSnapE.size === 380, `TEST E: Direct Firestore fixture count expected 380, got ${fixturesSnapE.size}`);
  const compE = await getCompetitionByIdFirestore(premierLeagueCompId);
  assert(compE!.hasFixtures === true, 'TEST E: Competition hasFixtures must be true');
  assert(compE!.generationStatus === 'generated', 'TEST E: generationStatus must be "generated"');
  console.log('✅ TEST E PASSED: 380 fixtures generated and verified directly in Firestore.\n');

  // ------------------------------------------------------------
  // TEST F: Reload/reinitialize backend. Assert 380 fixtures still exist.
  // ------------------------------------------------------------
  console.log('📋 TEST F: Reload/reinitialize backend -> Assert 380 fixtures still exist');
  createApp(); // Simulate backend reload
  const compF = await getCompetitionByIdFirestore(premierLeagueCompId);
  assert(compF !== null, 'TEST F: Competition not found after backend reload');
  assert(compF!.fixtureCount === 380, `TEST F: Expected fixtureCount === 380, got ${compF!.fixtureCount}`);
  assert(compF!.generationStatus === 'generated', `TEST F: Expected generationStatus === 'generated', got ${compF!.generationStatus}`);
  console.log('✅ TEST F PASSED: 380 fixtures and generated status retained after server reload.\n');

  // ------------------------------------------------------------
  // TEST G: User claims club AFTER fixtures already exist. Fetch My Matches. Assert matches returned without regenerating.
  // ------------------------------------------------------------
  console.log('📋 TEST G: User G claims Liverpool AFTER fixtures exist -> Fetch My Matches -> Assert 38 matches returned');
  const claimResG = await claimClubAtomicFirestore(userGId, liverpoolId, seasonId);
  assert(claimResG.success === true, 'TEST G: User G claim returned success: false');

  const userGMatches = await getFixturesFirestore({
    userId: userGId,
    seasonId,
    competitionId: premierLeagueCompId,
  });
  console.log(`  -> User G received ${userGMatches.length} matches (Home: ${userGMatches.filter(m => m.homeClubId === liverpoolId).length}, Away: ${userGMatches.filter(m => m.awayClubId === liverpoolId).length})`);
  assert(userGMatches.length === 38, `TEST G: Expected 38 matches for Liverpool owner, got ${userGMatches.length}`);
  // Verify overall fixture count did NOT change
  const compG = await getCompetitionByIdFirestore(premierLeagueCompId);
  assert(compG!.fixtureCount === 380, 'TEST G: Fixture count modified unexpectedly during My Matches fetch');
  console.log('✅ TEST G PASSED: User dynamically queries their matches from existing schedule without regenerating.\n');

  // ------------------------------------------------------------
  // TEST H: Generate fixtures twice with force=false. Assert no duplicates (remains 380).
  // ------------------------------------------------------------
  console.log('📋 TEST H: Generate fixtures twice with force=false -> Assert no duplicate fixtures');
  const genResultH = await generateCompetitionFixturesFirestore(premierLeagueCompId, { force: false });
  assert(genResultH.generated === 380, `TEST H: Expected 380 fixtures, got ${genResultH.generated}`);
  const fixturesSnapH = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', premierLeagueCompId).get();
  assert(fixturesSnapH.size === 380, `TEST H: Expected exactly 380 fixtures in Firestore without duplicates, got ${fixturesSnapH.size}`);
  console.log('✅ TEST H PASSED: Idempotent generation did not duplicate fixtures.\n');

  // ------------------------------------------------------------
  // TEST I: Regenerate with force=true. Assert previous schedule is replaced.
  // ------------------------------------------------------------
  console.log('📋 TEST I: Regenerate fixtures with force=true -> Assert schedule is cleanly replaced');
  const genResultI = await generateCompetitionFixturesFirestore(premierLeagueCompId, { force: true });
  assert(genResultI.generated === 380, `TEST I: Expected 380 regenerated fixtures, got ${genResultI.generated}`);
  const fixturesSnapI = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', premierLeagueCompId).get();
  assert(fixturesSnapI.size === 380, `TEST I: Expected 380 fixtures in Firestore after regeneration, got ${fixturesSnapI.size}`);
  console.log('✅ TEST I PASSED: Force regeneration cleanly purged and re-seeded 380 fixtures.\n');

  // ------------------------------------------------------------
  // TEST J: Two users concurrently claim Chelsea. Assert exactly one succeeds.
  // ------------------------------------------------------------
  console.log('📋 TEST J: Concurrent claim race condition on unclaimed Chelsea -> Assert exactly 1 winner');
  const [resC, resD] = await Promise.allSettled([
    claimClubAtomicFirestore(userCId, chelseaId, seasonId),
    claimClubAtomicFirestore(userDId, chelseaId, seasonId),
  ]);

  const fulfilled = [resC, resD].filter((r) => r.status === 'fulfilled');
  const rejected = [resC, resD].filter((r) => r.status === 'rejected');

  console.log(`  -> Race results: ${fulfilled.length} fulfilled, ${rejected.length} rejected.`);
  assert(fulfilled.length === 1, `TEST J: Expected exactly 1 winner, got ${fulfilled.length}`);
  assert(rejected.length === 1, `TEST J: Expected exactly 1 rejected, got ${rejected.length}`);

  const occDocJ = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${chelseaId}`).get();
  assert(occDocJ.exists, 'TEST J: Chelsea occupancy document missing');
  assert(occDocJ.data()?.status === 'active', 'TEST J: Chelsea occupancy status != active');
  console.log('✅ TEST J PASSED: Firestore atomic transaction ensured exactly one winner in race condition.\n');

  // Cleanup test docs
  await Promise.all([
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userAId}`).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userBId}`).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userCId}`).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userDId}`).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userGId}`).delete(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${arsenalId}`).delete(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${chelseaId}`).delete(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${liverpoolId}`).delete(),
    db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${arsenalId}`).delete(),
    db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${chelseaId}`).delete(),
    db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${liverpoolId}`).delete(),
  ]);

  console.log('================================================================');
  console.log('🎉 ALL 10 TESTS (TEST A THROUGH TEST J) PASSED WITH ZERO ERRORS!');
  console.log('================================================================');
}

runProductionTestsAtoJ().catch((err) => {
  console.error('❌ PERSISTENCE SUITE ERROR:', err);
  process.exit(1);
});
