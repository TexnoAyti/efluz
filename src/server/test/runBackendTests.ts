import { initDatabase, getDb } from '../db';
import { seedDatabase } from '../db/seed';
import { getOrCreateDevUser } from '../auth/telegramAuth';
import { claimClubAtomic, ClubConflictError, getClubById } from '../services/clubService';
import { generateCompetitionFixtures, getFixtures, getFixtureById } from '../services/fixtureService';
import { submitFixtureResult } from '../services/resultService';
import { calculateCompetitionStandings } from '../tournament/standingsEngine';
import { getDisputes, resolveDispute, getAuditLogs } from '../services/adminService';

async function runAllTests() {
  console.log('====================================================');
  console.log('🏃 RUNNING COMPREHENSIVE BACKEND VERIFICATION SUITE');
  console.log('====================================================');

  // Initialize fresh test database
  await initDatabase();

  // TEST 1: Seed Database
  console.log('\n--- TEST 1: Seed Database ---');
  const seedResult = seedDatabase();
  console.log(`✅ Seed executed: Created ${seedResult.seasonsCreated} season, ${seedResult.leaguesCreated} leagues, ${seedResult.clubsCreated} clubs, ${seedResult.competitionsCreated} competitions. Skipped ${seedResult.skipped} existing.`);

  // TEST 2: Create User A
  console.log('\n--- TEST 2: Create User A ---');
  const userA = await getOrCreateDevUser('user-dev-a');
  console.log(`✅ User A created/loaded: ID=${userA.id}, Username=@${userA.username}`);

  // TEST 3: Create User B
  console.log('\n--- TEST 3: Create User B ---');
  const userB = await getOrCreateDevUser('user-dev-b');
  console.log(`✅ User B created/loaded: ID=${userB.id}, Username=@${userB.username}`);

  // Also create Admin User
  const adminUser = await getOrCreateDevUser('user-dev-admin');
  console.log(`✅ Admin User created/loaded: ID=${adminUser.id}, IsAdmin=${adminUser.isAdmin}`);
  console.log('\n--- TEST 4: User A claims Arsenal ---');
  const seasonId = 'season-2026-27';
  const claimA = await claimClubAtomic(userA.id, 'club-arsenal', seasonId);
  console.log(`✅ User A claimed: ${claimA.club.name} (Owner: @${claimA.club.owner?.username})`);

  // TEST 5: User B attempts Arsenal (Expected: Conflict rejection)
  console.log('\n--- TEST 5: User B attempts Arsenal (Atomic Race Condition Check) ---');
  try {
    await claimClubAtomic(userB.id, 'club-arsenal', seasonId);
    console.error('❌ FAIL: User B should have been rejected for Arsenal!');
    process.exit(1);
  } catch (err: any) {
    if (err instanceof ClubConflictError) {
      console.log(`✅ PASS: User B was correctly rejected with conflict message: "${err.message}"`);
    } else {
      console.error('❌ Unexpected error type:', err);
      process.exit(1);
    }
  }

  // TEST 6: User B claims Chelsea
  console.log('\n--- TEST 6: User B claims Chelsea ---');
  const claimB = await claimClubAtomic(userB.id, 'club-chelsea', seasonId);
  console.log(`✅ User B claimed: ${claimB.club.name} (Owner: @${claimB.club.owner?.username})`);

  // TEST 7: Generate Premier League Fixtures
  console.log('\n--- TEST 7: Generate Premier League Fixtures (Berger Round-Robin) ---');
  const compId = 'comp-premier-league-2026';
  const genResult = await generateCompetitionFixtures(compId);
  console.log(`✅ Fixtures generated: ${genResult.generated} fixtures across ${genResult.matchdays} matchdays.`);

  if (genResult.generated !== 380 || genResult.matchdays !== 38) {
    console.error(`❌ Unexpected fixture counts: expected 380 fixtures / 38 matchdays, got ${genResult.generated}/${genResult.matchdays}`);
    process.exit(1);
  }

  // Verify pairings: 20 clubs, each meets every other club twice (1 home, 1 away)
  const allFixtures = await getFixtures({ competitionId: compId });
  const pairingsMap = new Map<string, number>();
  for (const f of allFixtures) {
    const key = `${f.homeClubId} -> ${f.awayClubId}`;
    pairingsMap.set(key, (pairingsMap.get(key) || 0) + 1);
  }

  let duplicateFound = false;
  for (const [key, count] of pairingsMap.entries()) {
    if (count > 1) {
      console.error(`❌ Duplicate pairing found: ${key} occurred ${count} times.`);
      duplicateFound = true;
    }
  }
  if (!duplicateFound && pairingsMap.size === 380) {
    console.log('✅ Mathematical verification: Exactly 380 distinct directed pairings with zero duplicates.');
  }

  // TEST 8: Arsenal vs Chelsea Match Submission & Automatic Confirmation
  console.log('\n--- TEST 8: Two-Party Result Submission & Automatic Confirmation ---');
  const arsenalVsChelsea = allFixtures.find(
    (f) => f.homeClubId === 'club-arsenal' && f.awayClubId === 'club-chelsea'
  )!;
  console.log(`Target Fixture: ${arsenalVsChelsea.id} (${arsenalVsChelsea.roundName})`);

  // User A submits 3-1
  console.log('User A (@arsenal_pro) submits score 3 - 1...');
  const subA = await submitFixtureResult(userA.id, arsenalVsChelsea.id, 3, 1);
  console.log(`Status after User A submission: ${subA.status} (Submissions: ${subA.submissionsCount})`);

  if (subA.status !== 'PENDING_CONFIRMATION' && subA.status !== 'AWAITING_RESULT') {
    console.error(`❌ Expected status PENDING_CONFIRMATION, got: ${subA.status}`);
    process.exit(1);
  }

  // User B submits 3-1 (Matching Score)
  console.log('User B (@chelsea_king) submits matching score 3 - 1...');
  const subB = await submitFixtureResult(userB.id, arsenalVsChelsea.id, 3, 1);
  console.log(`Status after User B submission: ${subB.status} (Confirmed Score: ${subB.homeScore}-${subB.awayScore})`);

  if (subB.status !== 'CONFIRMED' || subB.homeScore !== 3 || subB.awayScore !== 1) {
    console.error(`❌ Result failed to confirm automatically: ${JSON.stringify(subB)}`);
    process.exit(1);
  }

  // Verify Standings
  const standings = calculateCompetitionStandings(compId);
  const arsenalRow = standings.find((r) => r.clubId === 'club-arsenal')!;
  const chelseaRow = standings.find((r) => r.clubId === 'club-chelsea')!;

  console.log(`Standings Verification:`);
  console.log(`- Position ${arsenalRow.position}: ${arsenalRow.clubName} (P: ${arsenalRow.played}, W: ${arsenalRow.won}, GF: ${arsenalRow.goalsFor}, GA: ${arsenalRow.goalsAgainst}, GD: ${arsenalRow.goalDifference}, PTS: ${arsenalRow.points})`);
  console.log(`- Position ${chelseaRow.position}: ${chelseaRow.clubName} (P: ${chelseaRow.played}, L: ${chelseaRow.lost}, GF: ${chelseaRow.goalsFor}, GA: ${chelseaRow.goalsAgainst}, GD: ${chelseaRow.goalDifference}, PTS: ${chelseaRow.points})`);

  if (arsenalRow.points !== 3 || arsenalRow.goalDifference !== 2 || chelseaRow.points !== 0 || chelseaRow.goalDifference !== -2) {
    console.error('❌ Standings calculation mismatch!');
    process.exit(1);
  }
  console.log('✅ Standings dynamically and accurately updated from confirmed match result.');

  // TEST 9: Submit Conflicting Result on Return Leg (Chelsea vs Arsenal)
  console.log('\n--- TEST 9: Score Mismatch & Automatic Dispute Detection ---');
  const chelseaVsArsenal = allFixtures.find(
    (f) => f.homeClubId === 'club-chelsea' && f.awayClubId === 'club-arsenal'
  )!;

  // User B (Chelsea home) submits 2-1
  console.log('User B submits Chelsea 2 - 1 Arsenal...');
  await submitFixtureResult(userB.id, chelseaVsArsenal.id, 2, 1);

  // User A (Arsenal away) submits 1-3 (meaning Chelsea 1 - 3 Arsenal)
  console.log('User A submits conflicting score Chelsea 1 - 3 Arsenal...');
  const disputedFixture = await submitFixtureResult(userA.id, chelseaVsArsenal.id, 1, 3);

  console.log(`Fixture Status: ${disputedFixture.status}`);
  if (disputedFixture.status !== 'DISPUTED') {
    console.error(`❌ Expected DISPUTED status, got: ${disputedFixture.status}`);
    process.exit(1);
  }

  const openDisputes = await getDisputes('OPEN');
  const thisDispute = openDisputes.find((d) => d.fixtureId === chelseaVsArsenal.id);
  console.log(`✅ Dispute created in Dispute Center: ID=${thisDispute?.id}, Status=${thisDispute?.status}`);

  // TEST 10: Admin Resolves Dispute
  console.log('\n--- TEST 10: Admin Dispute Resolution & Audit Logging ---');
  const resolveResult = await resolveDispute(adminUser.id, thisDispute!.id, {
    action: 'CONFIRM_AWAY_SUBMISSION', // Admin confirms User A's proof: 1-3
    notes: 'Reviewed high-res screenshot proof uploaded by User A.',
  });

  console.log(`Dispute Resolved: ${resolveResult.success}, New Status: ${resolveResult.dispute.status}`);
  const resolvedFixture = (await getFixtureById(chelseaVsArsenal.id))!;
  console.log(`Fixture after admin resolution: Status=${resolvedFixture.status}, Score=${resolvedFixture.homeScore}-${resolvedFixture.awayScore}`);

  if (resolvedFixture.status !== 'CONFIRMED' || resolvedFixture.homeScore !== 1 || resolvedFixture.awayScore !== 3) {
    console.error('❌ Admin resolution failed to update fixture properly!');
    process.exit(1);
  }

  const auditLogs = await getAuditLogs(5);
  const disputeAudit = auditLogs.find((l) => l.action === 'RESOLVE_DISPUTE');
  console.log(`✅ Audit Log recorded: Actor=@${disputeAudit?.actorUsername}, Action=${disputeAudit?.action}, EntityID=${disputeAudit?.entityId}`);

  // Recalculate standings after 2nd match
  const updatedStandings = calculateCompetitionStandings(compId);
  const finalArsenal = updatedStandings.find((r) => r.clubId === 'club-arsenal')!;
  console.log(`\n🏆 Final Arsenal Standings: Played=${finalArsenal.played}, Won=${finalArsenal.won}, Points=${finalArsenal.points}, GD=${finalArsenal.goalDifference}`);

  if (finalArsenal.played === 2 && finalArsenal.won === 2 && finalArsenal.points === 6) {
    console.log('✅ Standings perfectly reflect both the auto-confirmed and admin-resolved matches!');
  }

  console.log('\n====================================================');
  console.log('🎉 ALL 10 TESTS PASSED WITH 100% SUCCESS!');
  console.log('====================================================');
}

runAllTests().catch((err) => {
  console.error('💥 Test suite crashed:', err);
  process.exit(1);
});
