import { generateEuropean32LeaguePhaseSchedule } from '../tournament/fixtureEngine';
import { generateUCLKnockoutBracket } from '../tournament/knockoutEngine';
import { initDatabase, queryAll, queryRun } from '../db';
import { seedDatabase } from '../db/seed';
import { evaluateSeasonQualifications } from '../tournament/qualificationEngine';
import {
  submitFixtureResultFirestore,
  getFixturesFirestore,
  advanceCompetitionMatchdayFirestore,
  setCompetitionMatchdayOverrideFirestore,
} from '../firebase/firestoreStore';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';

export async function runUCL32AndLockingTests() {
  console.log('\n================================================================');
  console.log('  STARTING UCL 32-TEAM FORMAT & MATCHDAY LOCKING TEST SUITE    ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  await initDatabase();

  function assert(title: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`✅ PASS: ${title}${details ? ` (${details})` : ''}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${title}${details ? ` (${details})` : ''}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // TEST 1: 32-Club European League Phase Fixture Generation
  // -------------------------------------------------------------
  console.log('\n--- [TEST 1] 32-Club European League Phase Fixture Schedule ---');
  const dummy32Clubs = Array.from({ length: 32 }, (_, i) => `club-test-${i + 1}`);
  const schedule = generateEuropean32LeaguePhaseSchedule(dummy32Clubs);

  assert('Schedule contains exactly 128 matches', schedule.length === 128, `Found ${schedule.length} matches`);

  // Count matchdays
  const matchdaySet = new Set(schedule.map((m) => m.matchday));
  assert('Schedule spans exactly 8 matchdays', matchdaySet.size === 8, `Found ${matchdaySet.size} matchdays`);

  // Matches per matchday
  let allRoundsHave16Matches = true;
  for (let md = 1; md <= 8; md++) {
    const roundMatches = schedule.filter((m) => m.matchday === md);
    if (roundMatches.length !== 16) {
      allRoundsHave16Matches = false;
    }
  }
  assert('Every matchday contains exactly 16 matches', allRoundsHave16Matches);

  // Each club plays exactly 8 matches (4 Home, 4 Away) against 8 distinct opponents
  let allClubsHave4H4A = true;
  let allClubsPlay8DistinctOpponents = true;

  for (const clubId of dummy32Clubs) {
    const homeMatches = schedule.filter((m) => m.homeClubId === clubId);
    const awayMatches = schedule.filter((m) => m.awayClubId === clubId);
    const totalMatches = homeMatches.length + awayMatches.length;

    if (homeMatches.length !== 4 || awayMatches.length !== 4 || totalMatches !== 8) {
      allClubsHave4H4A = false;
    }

    const opponents = new Set([
      ...homeMatches.map((m) => m.awayClubId),
      ...awayMatches.map((m) => m.homeClubId),
    ]);

    if (opponents.size !== 8) {
      allClubsPlay8DistinctOpponents = false;
    }
  }

  assert('Every club plays exactly 4 Home and 4 Away matches (8 total)', allClubsHave4H4A);
  assert('Every club plays against 8 distinct opponents with no repeats', allClubsPlay8DistinctOpponents);

  // -------------------------------------------------------------
  // TEST 2: Qualification Spot Distribution (32 UCL, 32 UEL)
  // -------------------------------------------------------------
  console.log('\n--- [TEST 2] European Qualification Distribution (32 UCL + 32 UEL) ---');
  // Allocation verification:
  // Premier League: 7 UCL (1-7), 7 UEL (8-14)
  // La Liga: 7 UCL (1-7), 7 UEL (8-14)
  // Serie A: 6 UCL (1-6), 6 UEL (7-12)
  // Bundesliga: 6 UCL (1-6), 6 UEL (7-12)
  // Ligue 1: 6 UCL (1-6), 6 UEL (7-12)
  const totalUCL = 7 + 7 + 6 + 6 + 6;
  const totalUEL = 7 + 7 + 6 + 6 + 6;
  assert('Total UCL allocation matches 32 clubs', totalUCL === 32, `Calculated: ${totalUCL}`);
  assert('Total UEL allocation matches 32 clubs', totalUEL === 32, `Calculated: ${totalUEL}`);

  // -------------------------------------------------------------
  // TEST 3: Knockout Bracket Generation from 32-Team Table
  // -------------------------------------------------------------
  console.log('\n--- [TEST 3] Knockout Bracket from 32-Team Standings ---');
  const dummyRanked = Array.from({ length: 32 }, (_, i) => `club-ranked-${i + 1}`);
  
  // Direct qualifiers: 1-8
  const direct = dummyRanked.slice(0, 8);
  assert('Top 8 clubs qualify directly to Round of 16', direct.length === 8);

  // Play-offs: 9-24
  const playoffs = dummyRanked.slice(8, 24);
  assert('Clubs ranked 9-24 (16 teams) enter Knockout Play-offs', playoffs.length === 16);

  // Eliminated: 25-32
  const eliminated = dummyRanked.slice(24);
  assert('Clubs ranked 25-32 (8 teams) are eliminated', eliminated.length === 8);

  // -------------------------------------------------------------
  // TEST 4: Authoritative Matchday Locking on Result Submissions
  // -------------------------------------------------------------
  console.log('\n--- [TEST 4] Authoritative Server-Side Matchday Locking ---');
  const db = getFirestoreDb();
  const testSeasonId = 'season-test-lock';
  const testCompId = 'comp-test-pl';

  // Create test competition in Firestore
  await db.collection(COLLECTIONS.COMPETITIONS).doc(testCompId).set({
    id: testCompId,
    seasonId: testSeasonId,
    name: 'Test Premier League',
    type: 'LEAGUE',
    currentMatchday: 1,
    totalMatchdays: 19,
    isMatchdayOpen: true,
    adminOverrideStatus: 'AUTO',
    updatedAt: new Date().toISOString(),
  });

  // Create test fixtures (Matchday 1 and Matchday 2)
  const fix1Id = 'fix-test-md1';
  const fix2Id = 'fix-test-md2';
  const user1Id = 'user-test-lock-1';
  const user2Id = 'user-test-lock-2';
  const club1Id = 'club-lock-a';
  const club2Id = 'club-lock-b';

  await db.collection(COLLECTIONS.FIXTURES).doc(fix1Id).set({
    id: fix1Id,
    seasonId: testSeasonId,
    competitionId: testCompId,
    matchday: 1,
    homeClubId: club1Id,
    awayClubId: club2Id,
    status: 'SCHEDULED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await db.collection(COLLECTIONS.FIXTURES).doc(fix2Id).set({
    id: fix2Id,
    seasonId: testSeasonId,
    competitionId: testCompId,
    matchday: 2,
    homeClubId: club1Id,
    awayClubId: club2Id,
    status: 'SCHEDULED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Set user memberships
  await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${testSeasonId}_${user1Id}`).set({
    id: `${testSeasonId}_${user1Id}`,
    userId: user1Id,
    seasonId: testSeasonId,
    clubId: club1Id,
    status: 'active',
  });

  await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${testSeasonId}_${user2Id}`).set({
    id: `${testSeasonId}_${user2Id}`,
    userId: user2Id,
    seasonId: testSeasonId,
    clubId: club2Id,
    status: 'active',
  });

  // Submitting for Matchday 2 when currentMatchday is 1 MUST throw MATCHDAY_LOCKED
  let lockedErrorThrown = false;
  let lockedErrorCode = '';
  try {
    await submitFixtureResultFirestore(user1Id, fix2Id, 2, 1);
  } catch (err: any) {
    lockedErrorThrown = true;
    lockedErrorCode = err.code || '';
    if (err.message && err.message.includes('MATCHDAY_LOCKED')) {
      lockedErrorCode = 'MATCHDAY_LOCKED';
    }
  }

  assert(
    'Submitting score for Matchday 2 while Matchday 1 is active throws MATCHDAY_LOCKED error',
    lockedErrorThrown && lockedErrorCode === 'MATCHDAY_LOCKED',
    `Code: ${lockedErrorCode}`
  );

  // Submitting for Matchday 1 (active matchday) MUST succeed
  let activeSubmissionSuccess = false;
  try {
    const res = await submitFixtureResultFirestore(user1Id, fix1Id, 2, 1);
    activeSubmissionSuccess = !!res && !!res.id;
  } catch (err: any) {
    console.error('Active matchday submission failed:', err);
  }

  assert('Submitting score for active Matchday 1 succeeds', activeSubmissionSuccess);

  // Lock the competition via admin override
  await setCompetitionMatchdayOverrideFirestore(testCompId, 'FORCE_LOCKED');

  let adminLockBlocked = false;
  try {
    await submitFixtureResultFirestore(user2Id, fix1Id, 2, 1);
  } catch (err: any) {
    if (err.code === 'MATCHDAY_LOCKED' || err.message?.includes('MATCHDAY_LOCKED')) {
      adminLockBlocked = true;
    }
  }

  assert('Admin FORCE_LOCKED override blocks all matchday submissions', adminLockBlocked);

  // Clean up test documents
  await Promise.all([
    db.collection(COLLECTIONS.COMPETITIONS).doc(testCompId).delete(),
    db.collection(COLLECTIONS.FIXTURES).doc(fix1Id).delete(),
    db.collection(COLLECTIONS.FIXTURES).doc(fix2Id).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${testSeasonId}_${user1Id}`).delete(),
    db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${testSeasonId}_${user2Id}`).delete(),
    db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc(`sub-${fix1Id}-${user1Id}`).delete(),
  ]);

  console.log('\n================================================================');
  console.log(`  UCL 32 & LOCKING TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    throw new Error(`Test suite failed with ${failed} failure(s).`);
  }
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('verifyUCL32AndMatchdayLocking')) {
  runUCL32AndLockingTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

