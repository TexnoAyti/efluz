import crypto from 'crypto';
import { ensureDbReady, createApp } from '../app';
import { getFirestoreDb, getFirebaseStatus } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import {
  claimClubAtomicFirestore,
  generateCompetitionFixturesFirestore,
  getFixturesFirestore,
  getUserActiveClubFirestore,
  getClubsByLeagueFirestore,
  getAllCompetitionsFirestore,
  getCompetitionByIdFirestore,
  getOrCreateTelegramUserFirestore,
  ClubConflictError,
} from '../firebase/firestoreStore';
import { assertTestEnvironmentSafe } from '../utils/testGuard';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${msg}`);
    throw new Error(msg);
  }
}

function createMockTelegramInitData(user: {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}, botToken = 'test-bot-token-12345') {
  const userJson = JSON.stringify(user);
  const authDate = Math.floor(Date.now() / 1000).toString();
  const params: Record<string, string> = {
    auth_date: authDate,
    query_id: 'AAHdF6IQAAAAAN0XohD1x8W9',
    user: userJson,
  };

  const keys = Object.keys(params).sort();
  const dataCheckString = keys.map((k) => `${k}=${params[k]}`).join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const urlParams = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    urlParams.set(k, v);
  }
  urlParams.set('hash', hash);
  return urlParams.toString();
}

async function runProduction12StepVerification() {
  assertTestEnvironmentSafe('firebasePersistenceTest');

  console.log('================================================================');
  console.log('🚀 MANDATORY 12-STEP PRODUCTION VERIFICATION TEST SUITE');
  console.log('================================================================\n');

  // STEP 1: Initialize backend with production Firestore configuration
  console.log('📋 STEP 1: Initialize backend with production Firestore configuration');
  await ensureDbReady();
  const db = getFirestoreDb();
  const status = getFirebaseStatus();
  console.log(`  -> Connected Firestore DB: ${status.databaseId || '(default)'}`);
  console.log(`  -> Project ID: ${status.projectId}`);
  console.log(`  -> Auth Mode: ${status.authMode}`);
  assert(db !== null, 'STEP 1: Firestore DB instance must be non-null');
  console.log('✅ STEP 1 PASSED: Backend initialized.\n');

  const seasonId = 'season-2026-27';
  const premierLeagueCompId = 'comp-premier-league-2026';
  const eplLeagueId = 'league-premier-league';

  const tgUserA = { id: 777001, first_name: 'Alex', username: 'alex_gunner' };
  const tgUserB = { id: 777002, first_name: 'Brian', username: 'brian_blue' };
  const userAId = `user-${tgUserA.id}`;
  const userBId = `user-${tgUserB.id}`;

  const arsenalId = 'club-arsenal';
  const chelseaId = 'club-chelsea';

  // Clean up test documents
  await Promise.all([
    db.collection(COLLECTIONS.USERS).doc(userAId).delete(),
    db.collection(COLLECTIONS.USERS).doc(userBId).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userAId}`).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userBId}`).delete(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${arsenalId}`).delete(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${chelseaId}`).delete(),
    db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${arsenalId}`).delete(),
    db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${chelseaId}`).delete(),
  ]);

  // STEP 2 & 3: Authenticate Telegram user & assert persisted in users/user-{telegramId}
  console.log('📋 STEP 2 & 3: Authenticate Telegram user -> Assert user exists in Firestore users/user-{telegramId}');
  const userA = await getOrCreateTelegramUserFirestore(tgUserA);
  assert(userA.id === userAId, `STEP 2: Expected user ID == ${userAId}, got ${userA.id}`);
  assert(userA.username === tgUserA.username, `STEP 2: Expected username == ${tgUserA.username}`);

  const userDocA = await db.collection(COLLECTIONS.USERS).doc(userAId).get();
  assert(userDocA.exists, `STEP 3: Document users/${userAId} does not exist in Firestore`);
  assert(userDocA.data()?.telegramId === String(tgUserA.id), 'STEP 3: Persisted telegramId does not match');
  console.log(`✅ STEP 2 & 3 PASSED: User A persisted in Firestore at users/${userAId}.\n`);

  // STEP 4 & 5: User A claims Arsenal -> Assert club_occupancies exists in Firestore
  console.log('📋 STEP 4 & 5: User A claims Arsenal -> Assert club_occupancies/season-2026-27_club-arsenal exists in Firestore');
  const claimResA = await claimClubAtomicFirestore(userAId, arsenalId, seasonId);
  assert(claimResA.success === true, 'STEP 4: User A claim returned success: false');

  const occDocA = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${arsenalId}`).get();
  assert(occDocA.exists, `STEP 5: club_occupancies/${seasonId}_${arsenalId} does not exist`);
  assert(occDocA.data()?.userId === userAId, `STEP 5: Expected occupancy userId == ${userAId}`);
  assert(occDocA.data()?.status === 'active', 'STEP 5: Expected occupancy status == active');
  console.log(`✅ STEP 4 & 5 PASSED: Occupancy document verified at club_occupancies/${seasonId}_${arsenalId}.\n`);

  // STEP 6: User B fetches EPL clubs -> Assert Arsenal is occupied
  console.log('📋 STEP 6: User B fetches EPL clubs -> Assert Arsenal is occupied');
  const userB = await getOrCreateTelegramUserFirestore(tgUserB);
  const clubsForUserB = await getClubsByLeagueFirestore(eplLeagueId, seasonId, userBId);
  const arsenalForB = clubsForUserB.find((c) => c.id === arsenalId);
  assert(arsenalForB !== undefined, 'STEP 6: Arsenal not found in EPL clubs');
  assert(arsenalForB!.isTaken === true, 'STEP 6: Arsenal must have isTaken: true for User B');
  assert(arsenalForB!.isCurrentUserClub === false, 'STEP 6: Arsenal must have isCurrentUserClub: false for User B');
  assert(arsenalForB!.occupancy.status === 'occupied', `STEP 6: Expected occupancy.status == 'occupied', got ${arsenalForB!.occupancy.status}`);
  assert(arsenalForB!.occupancy.userId === userAId, 'STEP 6: Arsenal occupancy userId must match User A');
  console.log('✅ STEP 6 PASSED: User B sees Arsenal as occupied by User A.\n');

  // STEP 7: User B tries to claim Arsenal -> Assert HTTP 409 / ClubConflictError
  console.log('📋 STEP 7: User B tries to claim occupied Arsenal -> Assert ClubConflictError');
  let conflictCaught = false;
  try {
    await claimClubAtomicFirestore(userBId, arsenalId, seasonId);
  } catch (err: any) {
    if (err instanceof ClubConflictError) {
      conflictCaught = true;
      console.log(`  -> Correctly rejected with code: ${err.code}, message: "${err.message}"`);
    }
  }
  assert(conflictCaught, 'STEP 7: User B claim on occupied Arsenal was NOT rejected!');
  console.log('✅ STEP 7 PASSED: Conflict correctly prevented with ClubConflictError.\n');

  // STEP 8: Admin generates fixtures for EPL -> Assert 380 fixtures in Firestore
  console.log('📋 STEP 8: Admin generates fixtures for EPL -> Assert 380 fixtures in Firestore');
  const genResult = await generateCompetitionFixturesFirestore(premierLeagueCompId, { force: true });
  assert(genResult.generated === 380, `STEP 8: Expected 380 generated fixtures, got ${genResult.generated}`);
  const fixturesSnap = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', premierLeagueCompId).get();
  assert(fixturesSnap.size === 380, `STEP 8: Firestore fixtures count expected 380, got ${fixturesSnap.size}`);
  console.log('✅ STEP 8 PASSED: 380 fixtures generated and verified in Firestore.\n');

  // STEP 9: User A fetches /api/me/matches -> Assert 38 matches returned from existing fixtures
  console.log('📋 STEP 9: User A fetches matches -> Assert 38 matches returned from existing fixtures');
  const userAMatches = await getFixturesFirestore({
    userId: userAId,
    seasonId,
    competitionId: premierLeagueCompId,
  });
  assert(userAMatches.length === 38, `STEP 9: Expected 38 matches for User A, got ${userAMatches.length}`);
  console.log(`✅ STEP 9 PASSED: User A received 38 matches from persistent schedule.\n`);

  // STEP 10: User B claims Chelsea
  console.log('📋 STEP 10: User B claims Chelsea');
  const claimResB = await claimClubAtomicFirestore(userBId, chelseaId, seasonId);
  assert(claimResB.success === true, 'STEP 10: User B claim returned success: false');
  const occDocB = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${chelseaId}`).get();
  assert(occDocB.exists && occDocB.data()?.userId === userBId, 'STEP 10: Chelsea occupancy missing');
  console.log('✅ STEP 10 PASSED: User B successfully claimed Chelsea.\n');

  // STEP 11: User B fetches matches -> Assert 38 matches returned WITHOUT generating new fixtures
  console.log('📋 STEP 11: User B fetches matches -> Assert 38 matches returned WITHOUT generating new fixtures');
  const userBMatches = await getFixturesFirestore({
    userId: userBId,
    seasonId,
    competitionId: premierLeagueCompId,
  });
  assert(userBMatches.length === 38, `STEP 11: Expected 38 matches for User B, got ${userBMatches.length}`);
  const totalFixturesAfterB = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', premierLeagueCompId).get();
  assert(totalFixturesAfterB.size === 380, `STEP 11: Total fixtures changed unexpectedly! Expected 380, got ${totalFixturesAfterB.size}`);
  console.log('✅ STEP 11 PASSED: User B matches resolved from existing schedule without altering total count (380).\n');

  // STEP 12: Fetch /api/competitions/comp-premier-league-2026 -> Assert fixtureCount == 380, generationStatus == 'generated'
  console.log('📋 STEP 12: Fetch competition -> Assert fixtureCount == 380, generationStatus == "generated"');
  const comp = await getCompetitionByIdFirestore(premierLeagueCompId);
  assert(comp !== null, 'STEP 12: Competition document not found');
  assert(comp!.fixtureCount === 380, `STEP 12: Expected fixtureCount === 380, got ${comp!.fixtureCount}`);
  assert(comp!.generationStatus === 'generated', `STEP 12: Expected generationStatus === "generated", got ${comp!.generationStatus}`);
  assert(comp!.hasFixtures === true, 'STEP 12: Expected hasFixtures === true');
  console.log(`✅ STEP 12 PASSED: Competition verified with fixtureCount=380, generationStatus="generated".\n`);

  // Cleanup test documents
  await Promise.all([
    db.collection(COLLECTIONS.USERS).doc(userAId).delete(),
    db.collection(COLLECTIONS.USERS).doc(userBId).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userAId}`).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userBId}`).delete(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${arsenalId}`).delete(),
    db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${chelseaId}`).delete(),
    db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${arsenalId}`).delete(),
    db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${chelseaId}`).delete(),
  ]);

  console.log('================================================================');
  console.log('🎉 ALL 12 PRODUCTION VERIFICATION STEPS PASSED WITH ZERO ERRORS!');
  console.log('================================================================');
}

runProduction12StepVerification().catch((err) => {
  console.error('❌ PERSISTENCE SUITE ERROR:', err);
  process.exit(1);
});
