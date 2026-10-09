/**
 * Regression & Verification Test Suite for Domestic Cup Knockout Brackets.
 *
 * Requirements:
 * - Tests must use local fallback/emulator only and execute zero production writes.
 * - Proves no generated Firestore fixture contains "TBD" or another synthetic club ID.
 * - Verifies future knockout slots use null club IDs with sourceFixtureId/sourceWinnerSlot metadata.
 * - Verifies correct winner advancement mapping for both 18-team and 20-team cups.
 * - Verifies existing fixtures and confirmed results are never deleted, reset or overwritten.
 */

// Force local in-memory fallback BEFORE any Firebase imports to guarantee zero production writes
process.env.FIREBASE_FORCE_LOCAL_FALLBACK = 'true';
process.env.NODE_ENV = 'test';

import { getFirestoreDb, initializeFirebaseAdmin } from '../firebase/admin';
import { COLLECTIONS, FirestoreFixtureDoc } from '../firebase/collections';
import { initDatabase, queryRun, queryAll, queryGet } from '../db';
import { seedDatabase } from '../db/seed';
import {
  generateDomesticCupBracketSafe,
  advanceDomesticCupWinnerSafe,
  getDomesticCupDetails,
  previewDomesticCupBracket,
} from '../tournament/domesticCupService';
import { getFixtureByIdFirestore } from '../firebase/firestoreStore';
import { assertTestEnvironmentSafe, isTestSafe, isConnectedToProductionFirestore } from '../utils/testGuard';

interface AssertionResult {
  description: string;
  expected: string;
  actual: string;
  passed: boolean;
}

const assertions: AssertionResult[] = [];

function assert(description: string, condition: boolean, expected = 'true', actual = String(condition)) {
  assertions.push({ description, expected, actual, passed: condition });
  const icon = condition ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} | ${description}`);
  if (!condition) {
    console.error(`       Expected: ${expected}`);
    console.error(`       Actual:   ${actual}`);
  }
}

export async function runDomesticCupTbdRegressionTest() {
  console.log('\n================================================================');
  console.log('  STARTING DOMESTIC CUP TBD & ADVANCEMENT REGRESSION TEST SUITE  ');
  console.log('================================================================\n');

  // 1. Verify environment isolation
  assertTestEnvironmentSafe('domesticCupTbdRegressionTest');
  assert('Local fallback is strictly enabled', process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true');
  assert('Test safety guard confirms safe environment', isTestSafe());
  assert('Disconnected from production Firestore (zero prod writes)', !isConnectedToProductionFirestore());

  // Initialize SQLite in-memory DB and seed
  await initDatabase();
  seedDatabase();

  const db = getFirestoreDb();
  const seasonId = 'season-2026-27';

  // Helper to clear test fixtures in memory Firestore and SQLite
  async function clearFixturesForComp(compId: string) {
    const snap = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', compId).get();
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    try {
      queryRun('DELETE FROM fixtures WHERE competition_id = ?', [compId]);
    } catch {}
  }

  // ====================================================================
  // TEST 1: 20-TEAM CUP BRACKET GENERATION (FA Cup - comp-fa-cup-2026)
  // ====================================================================
  console.log('\n--- Test 1: 20-Team Cup (FA Cup) Bracket Generation ---');
  const faCupId = 'comp-fa-cup-2026';
  await clearFixturesForComp(faCupId);

  const faGenResult = await generateDomesticCupBracketSafe(faCupId, {
    adminUserId: 'admin-test-safe',
    adminUsername: 'admin',
    confirmation: true,
    seasonId,
  });

  assert('FA Cup bracket generated successfully', faGenResult.success);
  assert('FA Cup has 19 total fixtures (4 R1 + 8 R2 + 4 R3 + 2 R4 + 1 R5)', faGenResult.generated === 19, '19', String(faGenResult.generated));
  assert('FA Cup has 5 total rounds', faGenResult.rounds === 5, '5', String(faGenResult.rounds));

  // Fetch all generated fixtures from Firestore
  const faSnap = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', faCupId).get();
  const faDocs = faSnap.docs.map((d) => d.data() as FirestoreFixtureDoc);

  assert('Firestore contains exactly 19 fixtures for FA Cup', faDocs.length === 19, '19', String(faDocs.length));

  // Check that NO fixture contains "TBD", "tbd", or synthetic IDs
  let containsTbdString = false;
  let containsSyntheticId = false;
  let nullKnockoutSlotsCount = 0;

  for (const f of faDocs) {
    if (f.homeClubId === 'TBD' || f.homeClubId === 'tbd' || f.awayClubId === 'TBD' || f.awayClubId === 'tbd') {
      containsTbdString = true;
      console.error(`VIOLATION: Fixture ${f.id} contains 'TBD' string: home=${f.homeClubId}, away=${f.awayClubId}`);
    }
    if ((f.homeClubId && f.homeClubId.includes('synthetic')) || (f.awayClubId && f.awayClubId.includes('synthetic'))) {
      containsSyntheticId = true;
    }
    if (f.homeClubId === null) nullKnockoutSlotsCount++;
    if (f.awayClubId === null) nullKnockoutSlotsCount++;
  }

  assert('Zero Firestore fixtures contain "TBD" as homeClubId or awayClubId', !containsTbdString);
  assert('Zero Firestore fixtures contain synthetic club IDs', !containsSyntheticId);
  assert('Future knockout slots correctly use null for undetermined club IDs', nullKnockoutSlotsCount > 0, '>0', String(nullKnockoutSlotsCount));

  // Check R1 fixtures (4 matches, 8 teams)
  const faR1 = faDocs.filter((f) => f.matchday === 1);
  assert('Round 1 has 4 preliminary matches', faR1.length === 4, '4', String(faR1.length));
  for (const m of faR1) {
    assert(`R1 fixture ${m.id} has non-null home club ID`, m.homeClubId !== null && typeof m.homeClubId === 'string');
    assert(`R1 fixture ${m.id} has non-null away club ID`, m.awayClubId !== null && typeof m.awayClubId === 'string');
    assert(`R1 fixture ${m.id} does not have TBD`, m.homeClubId !== 'TBD' && m.awayClubId !== 'TBD');
  }

  // Check R2 fixtures (8 matches: 4 pure byes + 4 play-in winner matches)
  const faR2 = faDocs.filter((f) => f.matchday === 2);
  assert('Round 2 has 8 matches', faR2.length === 8, '8', String(faR2.length));
  for (let i = 0; i < 4; i++) {
    const pureByeMatch = faR2.find((f) => f.id === `fix-${faCupId}-r2-m${i}`);
    assert(`R2 match ${i} is pure bye with seeded home club`, pureByeMatch?.homeClubId !== null && pureByeMatch?.homeClubId !== 'TBD');
    assert(`R2 match ${i} is pure bye with seeded away club`, pureByeMatch?.awayClubId !== null && pureByeMatch?.awayClubId !== 'TBD');
  }
  for (let i = 4; i < 8; i++) {
    const playInR2Match = faR2.find((f) => f.id === `fix-${faCupId}-r2-m${i}`);
    const r1Idx = i - 4;
    assert(`R2 match ${i} has seeded bye team in home slot`, playInR2Match?.homeClubId !== null && playInR2Match?.homeClubId !== 'TBD');
    assert(`R2 match ${i} has null away slot (waiting for R1-M${r1Idx})`, playInR2Match?.awayClubId === null);
    assert(
      `R2 match ${i} has sourceFixtureId pointing to fix-${faCupId}-r1-m${r1Idx}`,
      playInR2Match?.sourceFixtureId === `fix-${faCupId}-r1-m${r1Idx}` ||
        playInR2Match?.awaySourceFixtureId === `fix-${faCupId}-r1-m${r1Idx}`
    );
    assert(
      `R2 match ${i} has sourceWinnerSlot set to away`,
      playInR2Match?.sourceWinnerSlot === 'away' || playInR2Match?.awaySourceWinnerSlot === 'away'
    );
  }

  // Check Subsequent rounds (R3 QF, R4 SF, R5 Final)
  const faR3 = faDocs.filter((f) => f.matchday === 3);
  assert('Round 3 (Quarter-Finals) has 4 matches', faR3.length === 4, '4', String(faR3.length));
  for (let m = 0; m < 4; m++) {
    const qf = faR3.find((f) => f.id === `fix-${faCupId}-r3-m${m}`);
    assert(`QF match ${m} has null homeClubId`, qf?.homeClubId === null);
    assert(`QF match ${m} has null awayClubId`, qf?.awayClubId === null);
    assert(`QF match ${m} has homeSourceFixtureId fix-${faCupId}-r2-m${m * 2}`, qf?.homeSourceFixtureId === `fix-${faCupId}-r2-m${m * 2}`);
    assert(`QF match ${m} has awaySourceFixtureId fix-${faCupId}-r2-m${m * 2 + 1}`, qf?.awaySourceFixtureId === `fix-${faCupId}-r2-m${m * 2 + 1}`);
  }

  const faFinal = faDocs.find((f) => f.id === `fix-${faCupId}-r5-m0`);
  assert('Final match has null homeClubId', faFinal?.homeClubId === null);
  assert('Final match has null awayClubId', faFinal?.awayClubId === null);
  assert('Final match has homeSourceFixtureId fix-${faCupId}-r4-m0', faFinal?.homeSourceFixtureId === `fix-${faCupId}-r4-m0`);
  assert('Final match has awaySourceFixtureId fix-${faCupId}-r4-m1', faFinal?.awaySourceFixtureId === `fix-${faCupId}-r4-m1`);

  // ====================================================================
  // TEST 2: 18-TEAM CUP BRACKET GENERATION (DFB-Pokal - comp-dfb-pokal-2026)
  // ====================================================================
  console.log('\n--- Test 2: 18-Team Cup (DFB-Pokal) Bracket Generation ---');
  const dfbId = 'comp-dfb-pokal-2026';
  await clearFixturesForComp(dfbId);

  const dfbGenResult = await generateDomesticCupBracketSafe(dfbId, {
    adminUserId: 'admin-test-safe',
    adminUsername: 'admin',
    confirmation: true,
    seasonId,
  });

  assert('DFB-Pokal bracket generated successfully', dfbGenResult.success);
  assert('DFB-Pokal has 17 total fixtures (2 R1 + 8 R2 + 4 R3 + 2 R4 + 1 R5)', dfbGenResult.generated === 17, '17', String(dfbGenResult.generated));
  assert('DFB-Pokal has 5 total rounds', dfbGenResult.rounds === 5, '5', String(dfbGenResult.rounds));

  const dfbSnap = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', dfbId).get();
  const dfbDocs = dfbSnap.docs.map((d) => d.data() as FirestoreFixtureDoc);

  assert('Firestore contains exactly 17 fixtures for DFB-Pokal', dfbDocs.length === 17, '17', String(dfbDocs.length));

  let dfbContainsTbd = false;
  for (const f of dfbDocs) {
    if (f.homeClubId === 'TBD' || f.homeClubId === 'tbd' || f.awayClubId === 'TBD' || f.awayClubId === 'tbd') {
      dfbContainsTbd = true;
    }
  }
  assert('Zero Firestore fixtures contain "TBD" for 18-team DFB-Pokal', !dfbContainsTbd);

  // Check 18-team Round 1 (2 matches)
  const dfbR1 = dfbDocs.filter((f) => f.matchday === 1);
  assert('Round 1 has exactly 2 preliminary matches for 18 teams', dfbR1.length === 2, '2', String(dfbR1.length));

  // Check 18-team Round 2 (8 matches: 6 pure byes + 2 play-in winner matches)
  const dfbR2 = dfbDocs.filter((f) => f.matchday === 2);
  assert('Round 2 has 8 matches for 18 teams', dfbR2.length === 8, '8', String(dfbR2.length));
  for (let i = 0; i < 6; i++) {
    const pureByeMatch = dfbR2.find((f) => f.id === `fix-${dfbId}-r2-m${i}`);
    assert(`18-team R2 match ${i} is pure bye with both slots filled`, pureByeMatch?.homeClubId !== null && pureByeMatch?.awayClubId !== null);
  }
  for (let i = 6; i < 8; i++) {
    const playInMatch = dfbR2.find((f) => f.id === `fix-${dfbId}-r2-m${i}`);
    const r1Idx = i - 6;
    assert(`18-team R2 match ${i} has seeded bye team in home slot`, playInMatch?.homeClubId !== null);
    assert(`18-team R2 match ${i} has null away slot (waiting for R1-M${r1Idx})`, playInMatch?.awayClubId === null);
    assert(`18-team R2 match ${i} sourceFixtureId points to fix-${dfbId}-r1-m${r1Idx}`, playInMatch?.awaySourceFixtureId === `fix-${dfbId}-r1-m${r1Idx}` || playInMatch?.sourceFixtureId === `fix-${dfbId}-r1-m${r1Idx}`);
  }

  // ====================================================================
  // TEST 3: WINNER ADVANCEMENT MAPPING FOR 20-TEAM CUP
  // ====================================================================
  console.log('\n--- Test 3: Winner Advancement Mapping (20-Team FA Cup) ---');
  // Complete R1 match 0
  const r1m0Ref = db.collection(COLLECTIONS.FIXTURES).doc(`fix-${faCupId}-r1-m0`);
  const r1m0Snap = await r1m0Ref.get();
  const r1m0Data = r1m0Snap.data() as FirestoreFixtureDoc;
  const winnerClub = r1m0Data.homeClubId!;

  await r1m0Ref.update({
    status: 'CONFIRMED',
    homeScore: 3,
    awayScore: 1,
    winnerClubId: winnerClub,
    resultConfirmedAt: new Date().toISOString(),
  });

  const advanceResult = await advanceDomesticCupWinnerSafe(`fix-${faCupId}-r1-m0`, {
    adminUserId: 'admin-test-safe',
    adminUsername: 'admin',
  });

  assert('advanceDomesticCupWinnerSafe reported success', advanceResult.success);
  assert('Winner was advanced', advanceResult.advanced);
  // For 20-team cup: pureByeMatches = 4, so R1-M0 advances to R2-M4 away slot
  assert('Target fixture is fix-${faCupId}-r2-m4', advanceResult.targetFixtureId === `fix-${faCupId}-r2-m4`, `fix-${faCupId}-r2-m4`, advanceResult.targetFixtureId || '');

  const r2m4Snap = await db.collection(COLLECTIONS.FIXTURES).doc(`fix-${faCupId}-r2-m4`).get();
  const r2m4Data = r2m4Snap.data() as FirestoreFixtureDoc;
  assert('R2-M4 away slot is now the winner club', r2m4Data.awayClubId === winnerClub, winnerClub, r2m4Data.awayClubId || '');
  assert('R2-M4 status remains SCHEDULED', r2m4Data.status === 'SCHEDULED');
  assert('R2-M4 home club was not overwritten', r2m4Data.homeClubId !== null && r2m4Data.homeClubId !== winnerClub);

  // Advance R2 match 4 winner to QF (R3-M2 away slot)
  await db.collection(COLLECTIONS.FIXTURES).doc(`fix-${faCupId}-r2-m4`).update({
    status: 'CONFIRMED',
    homeScore: 0,
    awayScore: 2,
    winnerClubId: winnerClub,
    resultConfirmedAt: new Date().toISOString(),
  });

  const advanceR2Result = await advanceDomesticCupWinnerSafe(`fix-${faCupId}-r2-m4`, {
    adminUserId: 'admin-test-safe',
    adminUsername: 'admin',
  });

  assert('R2-M4 advances to QF', advanceR2Result.advanced);
  // idx = 4, Math.floor(4/2) = 2, so fix-comp-fa-cup-2026-r3-m2, isHomeSlot = true (4%2 == 0)
  assert('Target is fix-${faCupId}-r3-m2', advanceR2Result.targetFixtureId === `fix-${faCupId}-r3-m2`);
  const r3m2Snap = await db.collection(COLLECTIONS.FIXTURES).doc(`fix-${faCupId}-r3-m2`).get();
  const r3m2Data = r3m2Snap.data() as FirestoreFixtureDoc;
  assert('R3-M2 home slot populated with winner', r3m2Data.homeClubId === winnerClub);
  assert('R3-M2 away slot remains null', r3m2Data.awayClubId === null);

  // ====================================================================
  // TEST 4: WINNER ADVANCEMENT MAPPING FOR 18-TEAM CUP (DFB-Pokal)
  // ====================================================================
  console.log('\n--- Test 4: Winner Advancement Mapping (18-Team DFB-Pokal) ---');
  // Complete R1 match 1
  const dfbR1m1Ref = db.collection(COLLECTIONS.FIXTURES).doc(`fix-${dfbId}-r1-m1`);
  const dfbR1m1Snap = await dfbR1m1Ref.get();
  const dfbR1m1Data = dfbR1m1Snap.data() as FirestoreFixtureDoc;
  const dfbWinnerClub = dfbR1m1Data.awayClubId!;

  await dfbR1m1Ref.update({
    status: 'CONFIRMED',
    homeScore: 1,
    awayScore: 2,
    winnerClubId: dfbWinnerClub,
    resultConfirmedAt: new Date().toISOString(),
  });

  const dfbAdvanceResult = await advanceDomesticCupWinnerSafe(`fix-${dfbId}-r1-m1`, {
    adminUserId: 'admin-test-safe',
    adminUsername: 'admin',
  });

  assert('DFB-Pokal winner advanced successfully', dfbAdvanceResult.advanced);
  // For 18-team cup: pureByeMatches = 6, so R1-M1 advances to R2-M7 (6 + 1 = 7) away slot!
  assert('18-team R1-M1 advances to fix-${dfbId}-r2-m7', dfbAdvanceResult.targetFixtureId === `fix-${dfbId}-r2-m7`, `fix-${dfbId}-r2-m7`, dfbAdvanceResult.targetFixtureId || '');

  const dfbR2m7Snap = await db.collection(COLLECTIONS.FIXTURES).doc(`fix-${dfbId}-r2-m7`).get();
  const dfbR2m7Data = dfbR2m7Snap.data() as FirestoreFixtureDoc;
  assert('DFB R2-M7 away slot populated with winner', dfbR2m7Data.awayClubId === dfbWinnerClub);
  assert('DFB R2-M7 home club was preserved', dfbR2m7Data.homeClubId !== null && dfbR2m7Data.homeClubId !== dfbWinnerClub);

  // ====================================================================
  // TEST 5: STRICT DATA SAFETY - CONFIRMED RESULTS NEVER OVERWRITTEN
  // ====================================================================
  console.log('\n--- Test 5: Strict Data Safety (Confirmed Results & Existing Fixtures Protected) ---');
  // Attempt to advance into an already CONFIRMED fixture
  await db.collection(COLLECTIONS.FIXTURES).doc(`fix-${dfbId}-r2-m7`).update({
    status: 'CONFIRMED',
    homeScore: 2,
    awayScore: 0,
    winnerClubId: dfbR2m7Data.homeClubId,
    resultConfirmedAt: new Date().toISOString(),
  });

  const beforeRepeat = (await db.collection(COLLECTIONS.FIXTURES).doc(`fix-${dfbId}-r2-m7`).get()).data();
  const repeated = await advanceDomesticCupWinnerSafe(`fix-${dfbId}-r1-m1`, { adminUserId: 'admin-test-safe', adminUsername: 'admin' });
  assert('Same winner into confirmed fixture returns no-op', repeated.isNoop === true);
  const afterRepeat = (await db.collection(COLLECTIONS.FIXTURES).doc(`fix-${dfbId}-r2-m7`).get()).data();
  assert('Confirmed scores and metadata unchanged by repeat', JSON.stringify(beforeRepeat) === JSON.stringify(afterRepeat));
  await db.collection(COLLECTIONS.FIXTURES).doc(`fix-${dfbId}-r2-m7`).update({ awayClubId: 'club-other' });
  let locked = false;
  try { await advanceDomesticCupWinnerSafe(`fix-${dfbId}-r1-m1`, { adminUserId: 'admin-test-safe' }); }
  catch (error: any) { locked = error.code === 'TARGET_MATCH_LOCKED'; }
  assert('Changing a confirmed fixture remains blocked', locked);

  // Attempt to re-generate bracket when fixtures already exist
  let reGenErrorThrown = false;
  try {
    await generateDomesticCupBracketSafe(dfbId, {
      adminUserId: 'admin-test-safe',
      adminUsername: 'admin',
      confirmation: true,
      seasonId,
    });
  } catch (err: any) {
    reGenErrorThrown = true;
    assert('Regeneration blocked message explains fixtures already exist', err.message.includes('already has'));
  }
  assert('generateDomesticCupBracketSafe strictly blocks overwriting existing fixtures', reGenErrorThrown);

  // Verify previewDomesticCupBracket shows canGenerate === false and explains reason
  const previewExisting = await previewDomesticCupBracket(dfbId, seasonId);
  assert('Preview reports canGenerate is false when fixtures exist', !previewExisting.canGenerate);
  assert('Preview provides blockReason', Boolean(previewExisting.blockReason));

  // ====================================================================
  // TEST 6: READ MODEL AND GETFIXTUREBYID RESOLUTION
  // ====================================================================
  console.log('\n--- Test 6: Read Model and API Resolution ---');
  // Test getFixtureByIdFirestore on a fixture with null slots
  const finalFixDoc = await getFixtureByIdFirestore(`fix-${faCupId}-r5-m0`, seasonId);
  assert('getFixtureByIdFirestore returns fixture', finalFixDoc !== null);
  assert('getFixtureByIdFirestore returns null homeClubId (not TBD)', finalFixDoc?.homeClubId === null);
  assert('getFixtureByIdFirestore returns null awayClubId (not TBD)', finalFixDoc?.awayClubId === null);
  assert('getFixtureByIdFirestore returns null homeClub (not TBD object)', finalFixDoc?.homeClub === null);
  assert('getFixtureByIdFirestore returns null awayClub (not TBD object)', finalFixDoc?.awayClub === null);

  // Test getDomesticCupDetails
  const cupDetails = await getDomesticCupDetails(faCupId, seasonId);
  assert('getDomesticCupDetails returns rounds', cupDetails.rounds.length === 5);
  for (const round of cupDetails.rounds) {
    for (const node of round.matches) {
      assert(
        `Node ${node.id} homeClubId is not TBD string`,
        node.homeClubId !== 'TBD' && node.homeClubId !== 'tbd'
      );
      assert(
        `Node ${node.id} awayClubId is not TBD string`,
        node.awayClubId !== 'TBD' && node.awayClubId !== 'tbd'
      );
    }
  }

  // Summary
  const passedCount = assertions.filter((a) => a.passed).length;
  const failedCount = assertions.filter((a) => !a.passed).length;
  console.log('\n================================================================');
  console.log(`  DOMESTIC CUP REGRESSION TEST RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('================================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

// Auto-run if executed directly
if (process.argv[1]?.includes('domesticCupTbdRegressionTest')) {
  runDomesticCupTbdRegressionTest()
    .then(() => {
      console.log('✅ Domestic Cup TBD regression test completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Domestic Cup TBD regression test failed:', err);
      process.exit(1);
    });
}
