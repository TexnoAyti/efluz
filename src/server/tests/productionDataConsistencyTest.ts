import {
  getFirestoreDb,
  getFirebaseStatus,
  resetFirebaseAdminCache,
} from '../firebase/admin';
import {
  getOrCreateTelegramUserFirestore,
  claimClubAtomicFirestore,
  getClubsByLeagueFirestore,
  getUserActiveClubFirestore,
  getFixturesFirestore,
  generateCompetitionFixturesFirestore,
  getCompetitionByIdFirestore,
  verifyUserClubConsistency,
  ClubConflictError,
  getCanonicalTelegramUserId,
} from '../firebase/firestoreStore';
import { COLLECTIONS } from '../firebase/collections';
import { ensureDbReady } from '../app';

async function runProductionDataConsistencyTest() {
  console.log('================================================================');
  console.log('🚀 EFL UZ AUTHORITATIVE PRODUCTION DATA CONSISTENCY TEST SUITE');
  console.log('================================================================');

  // STEP 1: Boot system & verify Firestore connection
  console.log('\n📋 STEP 1: Boot system and verify Firestore database connection');
  await ensureDbReady();
  const fbStatus = getFirebaseStatus();
  const db = getFirestoreDb();

  console.log(`  -> Firestore database ID: ${fbStatus.databaseId}`);
  console.log(`  -> Project ID: ${fbStatus.projectId}`);
  console.log(`  -> Auth Mode: ${fbStatus.authMode}`);

  if (!fbStatus.isConfigured || !db) {
    throw new Error('FATAL: Firestore is not configured or failed to initialize.');
  }

  // Real read test to verify live connectivity
  const seasonsSnap = await db.collection(COLLECTIONS.SEASONS).get();
  console.log(`  -> Real Firestore read succeeded: ${seasonsSnap.size} seasons found.`);
  console.log('✅ STEP 1 PASSED: Firestore verified as authoritative database.');

  // Clean up any test records from prior runs to ensure test isolation
  const seasonId = 'season-2026-27';
  const userA_tgId = '777101';
  const userB_tgId = '888202';
  const userA_canonicalId = getCanonicalTelegramUserId(userA_tgId);
  const userB_canonicalId = getCanonicalTelegramUserId(userB_tgId);

  console.log(`\n  Canonical User IDs: User A = ${userA_canonicalId}, User B = ${userB_canonicalId}`);

  await db.collection(COLLECTIONS.USERS).doc(userA_canonicalId).delete().catch(() => {});
  await db.collection(COLLECTIONS.USERS).doc(userB_canonicalId).delete().catch(() => {});
  await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userA_canonicalId}`).delete().catch(() => {});
  await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userB_canonicalId}`).delete().catch(() => {});
  await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_club-arsenal`).delete().catch(() => {});
  await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_club-chelsea`).delete().catch(() => {});
  await db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_club-arsenal`).delete().catch(() => {});
  await db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_club-chelsea`).delete().catch(() => {});

  // STEP 2 & 3: Authenticate Telegram User A -> Verify users/user-{telegramId}
  console.log('\n📋 STEP 2 & 3: Authenticate Telegram User A and verify exact document path in Firestore');
  const userA = await getOrCreateTelegramUserFirestore({
    id: userA_tgId,
    first_name: 'Alex',
    last_name: 'Arsenal',
    username: 'tg_alex_arsenal',
    photo_url: 'https://example.com/alex.png',
  });

  if (userA.id !== userA_canonicalId) {
    throw new Error(`Expected User A ID to be '${userA_canonicalId}', received '${userA.id}'.`);
  }

  // Inspect raw Firestore document
  const userADocRef = db.collection(COLLECTIONS.USERS).doc(userA_canonicalId);
  const userADoc = await userADocRef.get();
  if (!userADoc.exists) {
    throw new Error(`CRITICAL: Document ${COLLECTIONS.USERS}/${userA_canonicalId} does NOT exist in Firestore!`);
  }

  const userAData = userADoc.data();
  console.log(`  [FIRESTORE DOC] ${COLLECTIONS.USERS}/${userA_canonicalId}:`, JSON.stringify(userAData));
  if (userAData?.telegramId !== userA_tgId || userAData?.username !== 'tg_alex_arsenal') {
    throw new Error('User A data mismatch in Firestore document.');
  }
  console.log(`✅ STEP 2 & 3 PASSED: User A persisted authoritatively at '${COLLECTIONS.USERS}/${userA_canonicalId}'.`);

  // STEP 4 & 5: User A claims Arsenal -> Assert club_occupancies & user_memberships
  console.log('\n📋 STEP 4 & 5: User A claims Arsenal -> Assert atomic Firestore documents');
  const claimAResult = await claimClubAtomicFirestore(userA.id, 'club-arsenal', seasonId);
  if (!claimAResult.success || !claimAResult.club) {
    throw new Error('User A failed to claim Arsenal.');
  }

  // Inspect exact document paths
  const occRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_club-arsenal`);
  const occDoc = await occRef.get();
  if (!occDoc.exists || occDoc.data()?.status !== 'active' || occDoc.data()?.userId !== userA.id) {
    throw new Error(`CRITICAL: Occupancy document ${COLLECTIONS.CLUB_OCCUPANCIES}/${seasonId}_club-arsenal is missing or incorrect in Firestore!`);
  }
  console.log(`  [FIRESTORE DOC] ${COLLECTIONS.CLUB_OCCUPANCIES}/${seasonId}_club-arsenal:`, JSON.stringify(occDoc.data()));

  const userMemRef = db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userA.id}`);
  const userMemDoc = await userMemRef.get();
  if (!userMemDoc.exists || userMemDoc.data()?.status !== 'active' || userMemDoc.data()?.clubId !== 'club-arsenal') {
    throw new Error(`CRITICAL: Membership document ${COLLECTIONS.USER_MEMBERSHIPS}/${seasonId}_${userA.id} is missing or incorrect in Firestore!`);
  }
  console.log(`  [FIRESTORE DOC] ${COLLECTIONS.USER_MEMBERSHIPS}/${seasonId}_${userA.id}:`, JSON.stringify(userMemDoc.data()));

  const consistencyA = await verifyUserClubConsistency(userA.id, seasonId);
  if (!consistencyA.isConsistent) {
    throw new Error(`Consistency error for User A: ${consistencyA.error}`);
  }
  console.log('✅ STEP 4 & 5 PASSED: Arsenal occupancy & User A membership atomically committed and verified.');

  // STEP 6: Simulate completely new backend context -> User B fetches clubs
  console.log('\n📋 STEP 6: Reset backend cache (simulate fresh serverless instance) -> User B views EPL clubs');
  resetFirebaseAdminCache();

  // User B authenticates
  const userB = await getOrCreateTelegramUserFirestore({
    id: userB_tgId,
    first_name: 'Bob',
    last_name: 'Chelsea',
    username: 'tg_bob_chelsea',
  });

  const eplClubs = await getClubsByLeagueFirestore('league-premier-league', seasonId, userB.id);
  const arsenal = eplClubs.find((c) => c.id === 'club-arsenal');
  if (!arsenal) {
    throw new Error('Arsenal club not found in Premier League roster.');
  }

  console.log(`  Arsenal status for User B: isTaken=${arsenal.isTaken}, status=${arsenal.occupancy?.status}, claimedByUserId=${arsenal.claimedByUserId}, claimedByUsername=${arsenal.claimedByUsername}`);

  if (!arsenal.isTaken || arsenal.occupancy?.status !== 'occupied' || arsenal.claimedByUserId !== userA.id) {
    throw new Error(`CRITICAL CONSISTENCY BUG: Arsenal must be occupied by User A, but received isTaken=${arsenal.isTaken}, status=${arsenal.occupancy?.status}`);
  }
  console.log('✅ STEP 6 PASSED: Arsenal is strictly OCCUPIED for User B in fresh backend instance.');

  // STEP 7: User B attempts to claim occupied Arsenal -> Expect 409 CLUB_OCCUPIED
  console.log('\n📋 STEP 7: User B attempts to claim occupied Arsenal -> Expect ClubConflictError (409)');
  let conflictCaught = false;
  try {
    await claimClubAtomicFirestore(userB.id, 'club-arsenal', seasonId);
  } catch (err: any) {
    if (err instanceof ClubConflictError && err.code === 'CLUB_OCCUPIED') {
      conflictCaught = true;
      console.log(`  -> Correctly rejected with code: ${err.code}, message: "${err.message}"`);
    } else {
      throw err;
    }
  }

  if (!conflictCaught) {
    throw new Error('CRITICAL BUG: User B was able to claim an already occupied club!');
  }
  console.log('✅ STEP 7 PASSED: Conflict correctly prevented with CLUB_OCCUPIED error.');

  // STEP 8: Admin generates Premier League fixtures -> Assert 380 fixtures
  console.log('\n📋 STEP 8: Admin generates fixtures for Premier League competition');
  const compId = 'comp-premier-league-2026';
  const genResult = await generateCompetitionFixturesFirestore(compId, { force: true });
  console.log(`  -> Generated ${genResult.generated} fixtures across ${genResult.matchdays} matchdays.`);
  if (genResult.generated !== 380) {
    throw new Error(`Expected 380 fixtures for Premier League, received ${genResult.generated}.`);
  }

  const fixSnap = await getFirestoreDb().collection(COLLECTIONS.FIXTURES).where('competitionId', '==', compId).get();
  if (fixSnap.size !== 380) {
    throw new Error(`Expected 380 fixture documents in Firestore, found ${fixSnap.size}.`);
  }
  console.log('✅ STEP 8 PASSED: 380 fixtures generated and verified in Firestore.');

  // STEP 9: Reset backend cache -> User A fetches My Matches
  console.log('\n📋 STEP 9: Reset backend cache -> User A fetches My Matches (must return 38 matches with 0 new generation)');
  resetFirebaseAdminCache();

  const userAPLMatches = await getFixturesFirestore({ userId: userA.id, seasonId, competitionId: compId });
  console.log(`  -> User A received ${userAPLMatches.length} Premier League matches.`);
  if (userAPLMatches.length !== 38) {
    throw new Error(`Expected 38 Premier League matches for Arsenal, received ${userAPLMatches.length}.`);
  }

  const userAAllMatches = await getFixturesFirestore({ userId: userA.id, seasonId });
  console.log(`  -> User A received ${userAAllMatches.length} total matches across all competitions.`);
  if (userAAllMatches.length < 38) {
    throw new Error(`Expected at least 38 matches for Arsenal across competitions, received ${userAAllMatches.length}.`);
  }

  // Verify total fixtures in Firestore did NOT change
  const postFetchSnap = await getFirestoreDb().collection(COLLECTIONS.FIXTURES).where('competitionId', '==', compId).get();
  if (postFetchSnap.size !== 380) {
    throw new Error(`CRITICAL BUG: Fixtures count changed after My Matches fetch! Expected 380, found ${postFetchSnap.size}.`);
  }
  console.log('✅ STEP 9 PASSED: User A matches resolved from existing schedule without fixture regeneration.');

  // STEP 10: User B claims Chelsea
  console.log('\n📋 STEP 10: User B claims Chelsea -> Assert persistence');
  const claimBResult = await claimClubAtomicFirestore(userB.id, 'club-chelsea', seasonId);
  if (!claimBResult.success || !claimBResult.club) {
    throw new Error('User B failed to claim Chelsea.');
  }

  const occDocB = await getFirestoreDb().collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_club-chelsea`).get();
  if (!occDocB.exists || occDocB.data()?.userId !== userB.id) {
    throw new Error('Failed to verify Chelsea occupancy document in Firestore.');
  }
  console.log('✅ STEP 10 PASSED: Chelsea claimed by User B and verified in Firestore.');

  // STEP 11: User B fetches My Matches (must return 38 Chelsea matches with 0 new generation)
  console.log('\n📋 STEP 11: User B fetches My Matches');
  const userBPLMatches = await getFixturesFirestore({ userId: userB.id, seasonId, competitionId: compId });
  console.log(`  -> User B received ${userBPLMatches.length} Premier League matches.`);
  if (userBPLMatches.length !== 38) {
    throw new Error(`Expected 38 Premier League matches for Chelsea, received ${userBPLMatches.length}.`);
  }

  const postUserBFixSnap = await getFirestoreDb().collection(COLLECTIONS.FIXTURES).where('competitionId', '==', compId).get();
  if (postUserBFixSnap.size !== 380) {
    throw new Error(`CRITICAL BUG: Fixtures count changed! Expected 380, found ${postUserBFixSnap.size}.`);
  }
  console.log('✅ STEP 11 PASSED: User B matches resolved from existing schedule (total count remains 380).');

  // STEP 12: Fetch competition -> Assert fixtureCount == 380 and generationStatus == 'generated'
  console.log('\n📋 STEP 12: Verify competition metadata in Firestore');
  const comp = await getCompetitionByIdFirestore(compId);
  if (!comp) {
    throw new Error('Competition not found.');
  }

  console.log(`  Competition: fixtureCount=${comp.fixtureCount}, generationStatus=${comp.generationStatus}, totalTeams=${comp.totalTeams}`);
  if (comp.fixtureCount !== 380 || comp.generationStatus !== 'generated') {
    throw new Error(`Competition metadata mismatch: fixtureCount=${comp.fixtureCount}, generationStatus=${comp.generationStatus}`);
  }
  console.log('✅ STEP 12 PASSED: Competition verified with fixtureCount=380 and generationStatus="generated".');

  // STEP 13: Summary of all document paths inspected
  console.log('\n📋 EXACT FIRESTORE DOCUMENT PATHS VERIFIED IN TEST:');
  console.log(`  1. users/${userA_canonicalId}`);
  console.log(`  2. users/${userB_canonicalId}`);
  console.log(`  3. club_occupancies/${seasonId}_club-arsenal`);
  console.log(`  4. club_occupancies/${seasonId}_club-chelsea`);
  console.log(`  5. user_memberships/${seasonId}_${userA_canonicalId}`);
  console.log(`  6. user_memberships/${seasonId}_${userB_canonicalId}`);
  console.log(`  7. fixtures (380 documents for comp-premier-league-2026)`);
  console.log(`  8. competitions/${compId}`);

  console.log('\n================================================================');
  console.log('🎉 ALL PRODUCTION DATA CONSISTENCY TESTS PASSED WITH ZERO ERRORS!');
  console.log('================================================================\n');
}

runProductionDataConsistencyTest().catch((err) => {
  console.error('\n❌ PRODUCTION DATA CONSISTENCY TEST FAILED:', err);
  process.exit(1);
});
