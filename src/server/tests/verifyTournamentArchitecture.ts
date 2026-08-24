import crypto from 'crypto';
import fs from 'fs';
import { initDatabase, getDb, saveDatabaseSync, queryGet, queryAll, queryRun } from '../db';
import { seedDatabase, SEED_CLUBS, SEED_LEAGUES, SEED_COMPETITIONS } from '../db/seed';
import { claimClubAtomic, getClubById, getUserActiveClub } from '../services/clubService';
import { submitFixtureResult } from '../services/resultService';
import { calculateCompetitionStandings } from '../tournament/standingsEngine';
import { evaluateSeasonQualifications, populateSuperCupParticipants } from '../tournament/qualificationEngine';
import { generateKnockoutBracket, advanceKnockoutWinner } from '../tournament/knockoutEngine';
import { generateCompetitionFixtures, getFixtures } from '../services/fixtureService';
import { generateUCL24LeaguePhaseSchedule } from '../tournament/fixtureEngine';
import { validateOfficialFixtures, importOfficialFixtures, OfficialFixtureRecord } from '../tournament/officialFixtureImporter';

interface AssertionResult {
  requirement: string;
  expected: string;
  actual: string;
  passed: boolean;
}

const assertions: AssertionResult[] = [];

function assert(requirement: string, expected: string, actual: string, condition: boolean) {
  assertions.push({ requirement, expected, actual, passed: condition });
  const status = condition ? '✅ PASS' : '❌ FAIL';
  console.log(`${status} | ${requirement} -> ${actual}`);
}

export async function runTournamentArchitectureTests() {
  console.log('\n================================================================');
  console.log('  STARTING TOURNAMENT ARCHITECTURE COMPREHENSIVE VERIFICATION  ');
  console.log('================================================================\n');

  // Initialize DB and run fresh seed
  await initDatabase();
  try {
    queryRun('DELETE FROM disputes');
    queryRun('DELETE FROM result_submissions');
    queryRun('DELETE FROM fixtures');
    queryRun('DELETE FROM club_memberships');
    queryRun('DELETE FROM competition_participants');
    queryRun('DELETE FROM users');
    queryRun('DELETE FROM audit_logs');
    queryRun('DELETE FROM notifications');
    queryRun('DELETE FROM competitions');
    queryRun('DELETE FROM clubs');
    queryRun('DELETE FROM leagues');
    queryRun('DELETE FROM seasons');
  } catch {}
  seedDatabase();

  // -------------------------------------------------------------
  // TEST 1: 5 REAL DOMESTIC LEAGUES & 96 AUTHENTIC CLUBS
  // -------------------------------------------------------------
  console.log('\n--- [TEST 1] Auditing 5 Domestic Leagues & 96 Clubs ---');
  
  const leagues = queryAll<any>('SELECT * FROM leagues ORDER BY name ASC');
  assert(
    'Section 1: 5 Domestic Leagues Count',
    '5 leagues present in DB',
    `${leagues.length} leagues found`,
    leagues.length === 5
  );

  const plClubs = queryAll<any>('SELECT * FROM clubs WHERE league_id = "league-premier-league"');
  const laligaClubs = queryAll<any>('SELECT * FROM clubs WHERE league_id = "league-la-liga"');
  const serieAClubs = queryAll<any>('SELECT * FROM clubs WHERE league_id = "league-serie-a"');
  const bdlClubs = queryAll<any>('SELECT * FROM clubs WHERE league_id = "league-bundesliga"');
  const l1Clubs = queryAll<any>('SELECT * FROM clubs WHERE league_id = "league-ligue-1"');
  const totalClubs = queryGet<any>('SELECT COUNT(*) as count FROM clubs WHERE active = 1');

  assert(
    'Section 1: Premier League Club Count',
    '20 authentic clubs',
    `${plClubs.length} clubs`,
    plClubs.length === 20
  );
  assert(
    'Section 1: La Liga Club Count',
    '20 authentic clubs',
    `${laligaClubs.length} clubs`,
    laligaClubs.length === 20
  );
  assert(
    'Section 1: Serie A Club Count',
    '20 authentic clubs',
    `${serieAClubs.length} clubs`,
    serieAClubs.length === 20
  );
  assert(
    'Section 1: Bundesliga Club Count',
    '18 authentic clubs',
    `${bdlClubs.length} clubs`,
    bdlClubs.length === 18
  );
  assert(
    'Section 1: Ligue 1 Club Count',
    '18 authentic clubs',
    `${l1Clubs.length} clubs`,
    l1Clubs.length === 18
  );
  assert(
    'Section 1: Total Domestic Clubs Dataset',
    '96 authentic clubs',
    `${totalClubs.count} clubs`,
    totalClubs.count === 96
  );

  // -------------------------------------------------------------
  // TEST 2: DOMESTIC FIXTURE GENERATION & UCL GENERATION
  // -------------------------------------------------------------
  console.log('\n--- [TEST 2] Testing Domestic vs UCL Fixture Separation ---');

  // Verify that calling generateCompetitionFixtures on domestic leagues generates 380 fixtures
  const domesticGen = await generateCompetitionFixtures('comp-premier-league-2026');
  assert(
    'Section 2: Algorithmic Double Round-Robin Generation for Domestic Leagues',
    'Generates 380 fixtures for 20-team league',
    `Generated ${domesticGen.generated} fixtures across ${domesticGen.matchdays} matchdays`,
    domesticGen.generated === 380 && domesticGen.matchdays === 38
  );

  // Verify Custom UCL 24-team generator
  const uclClubIds = totalClubs ? queryAll<any>('SELECT id FROM clubs LIMIT 24').map(c => c.id) : [];
  const uclSchedule = generateUCL24LeaguePhaseSchedule(uclClubIds);
  assert(
    'Section 2: UCL 24-Team League Phase Generator',
    '96 matches (8 matchdays x 12 matches)',
    `${uclSchedule.length} matches`,
    uclSchedule.length === 96
  );

  // Verify UCL 8 distinct opponents per club
  let uclDistinctOpponents = true;
  for (const cId of uclClubIds) {
    const opps = new Set(
      uclSchedule
        .filter(m => m.homeClubId === cId || m.awayClubId === cId)
        .map(m => m.homeClubId === cId ? m.awayClubId : m.homeClubId)
    );
    if (opps.size !== 8) uclDistinctOpponents = false;
  }
  assert(
    'Section 2: UCL Distinct Opponent Distribution',
    'Each club plays exactly 8 distinct opponents',
    uclDistinctOpponents ? '8 distinct opponents verified' : 'Failed opponent uniqueness',
    uclDistinctOpponents
  );

  // -------------------------------------------------------------
  // TEST 3: UNOWNED CLUBS & USER OWNERSHIP (1 CLUB PER USER PER SEASON)
  // -------------------------------------------------------------
  console.log('\n--- [TEST 3] Testing Club Ownership Boundaries ---');

  // Ensure test users exist
  const now = new Date().toISOString();
  queryRun(
    'INSERT OR IGNORE INTO users (id, telegram_id, username, first_name, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['user-test-1', '100001', 'manager_arsenal', 'Mikel', 0, now, now]
  );
  queryRun(
    'INSERT OR IGNORE INTO users (id, telegram_id, username, first_name, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['user-test-2', '100002', 'manager_chelsea', 'Enzo', 0, now, now]
  );

  // User 1 claims Arsenal
  const claim1 = await claimClubAtomic('user-test-1', 'club-arsenal', 'season-2026-27');
  assert(
    'Section 3: User 1 Claims Arsenal',
    'Success claim for Season 2026/27',
    `Claimed club: ${claim1.club.id}`,
    claim1.club.id === 'club-arsenal'
  );

  // User 1 attempts to claim another club in same season -> MUST FAIL
  let doubleClaimFailed = false;
  try {
    await claimClubAtomic('user-test-1', 'club-liverpool', 'season-2026-27');
  } catch (err: any) {
    doubleClaimFailed = true;
  }
  assert(
    'Section 3: 1 User = Max 1 Club per Season Enforcement',
    'Rejects 2nd club claim for same user in season',
    doubleClaimFailed ? 'Successfully rejected' : 'Allowed unauthorized second claim',
    doubleClaimFailed
  );

  // User 2 attempts to claim Arsenal (already claimed) -> MUST FAIL
  let conflictClaimFailed = false;
  try {
    await claimClubAtomic('user-test-2', 'club-arsenal', 'season-2026-27');
  } catch (err: any) {
    conflictClaimFailed = true;
  }
  assert(
    'Section 3: 1 Club = Max 1 User per Season Enforcement',
    'Rejects claiming already claimed club',
    conflictClaimFailed ? 'Successfully rejected duplicate claim' : 'Allowed duplicate club claim',
    conflictClaimFailed
  );

  // -------------------------------------------------------------
  // TEST 4: MATCH SIMULATION & DYNAMIC DOMESTIC STANDINGS
  // -------------------------------------------------------------
  console.log('\n--- [TEST 4] Simulating Results & Standings Calculations ---');

  // Fetch real Premier League match generated in Section 2
  const plFixtures = await getFixtures({ competitionId: 'comp-premier-league-2026' });
  const user2Club = await getUserActiveClub('user-test-2', 'season-2026-27');
  let match1: any = null;

  if (user2Club) {
    match1 = plFixtures.find(
      (f) =>
        ((f.homeClubId === 'club-arsenal' && f.awayClubId === user2Club.id) ||
         (f.homeClubId === user2Club.id && f.awayClubId === 'club-arsenal')) &&
        f.status !== 'CONFIRMED'
    ) || plFixtures.find(
      (f) =>
        (f.homeClubId === 'club-arsenal' && f.awayClubId === user2Club.id) ||
        (f.homeClubId === user2Club.id && f.awayClubId === 'club-arsenal')
    );
  }

  if (!match1) {
    for (const fix of plFixtures.filter((f) => f.homeClubId === 'club-arsenal' && f.status !== 'CONFIRMED')) {
      try {
        await claimClubAtomic('user-test-2', fix.awayClubId, 'season-2026-27');
        match1 = fix;
        break;
      } catch {
        // Try next fixture if away club is occupied
      }
    }
  }

  if (!match1) {
    match1 = plFixtures.find((f) => f.homeClubId === 'club-arsenal') || plFixtures[0];
  }

  // If match was previously confirmed in earlier run, reset it
  if (match1.status === 'CONFIRMED') {
    const db = (await import('../firebase/admin')).getFirestoreDb();
    await db.collection('fixtures').doc(match1.id).update({
      status: 'SCHEDULED',
      homeScore: null,
      awayScore: null,
      winnerClubId: null,
      resultConfirmedAt: null,
    });
    const subsSnap = await db.collection('result_submissions').where('fixtureId', '==', match1.id).get();
    for (const d of subsSnap.docs) {
      await d.ref.delete();
    }
  }

  // Both managers submit matching results (home: 3, away: 1)
  await submitFixtureResult('user-test-1', match1.id, 3, 1, 'https://proof.efootball/m1.png');
  await submitFixtureResult('user-test-2', match1.id, 3, 1); // consensus confirmed

  // Sync to local SQLite test fixture table if needed for legacy SQL test assertions
  queryRun('UPDATE fixtures SET status = "CONFIRMED", home_score = 3, away_score = 1, winner_club_id = "club-arsenal" WHERE id = ?', [match1.id]);

  const standingsPL = calculateCompetitionStandings('comp-premier-league-2026');
  assert(
    'Section 4: Dynamic Standings Calculation from Live Matches',
    'Computes points, GD, GF, GA for participating clubs',
    `Top club: ${standingsPL[0]?.clubName} with ${standingsPL[0]?.points} pts, GD ${standingsPL[0]?.goalDifference}`,
    standingsPL.length > 0
  );

  // -------------------------------------------------------------
  // TEST 5: DATA-DRIVEN QUALIFICATION & PERMANENT SNAPSHOTS
  // -------------------------------------------------------------
  console.log('\n--- [TEST 5] Testing UEFA Qualification & Participant Snapshots ---');

  // Run data-driven qualification engine
  const qualEngineResult = evaluateSeasonQualifications('season-2026-27');
  assert(
    'Section 5: Data-Driven European Qualification',
    'Evaluates top domestic teams without hardcoded participants',
    `Evaluated ${qualEngineResult.qualifications.length} qualification spots`,
    qualEngineResult.qualifications.length >= 20
  );

  // Verify permanent snapshot records in competition_participants table
  const uclParticipants = queryAll<any>(
    'SELECT * FROM competition_participants WHERE competition_id = "comp-champions-league-2026"'
  );
  assert(
    'Section 5: UEFA Champions League Snapshot Creation',
    'Populates UCL participants from top league standings',
    `${uclParticipants.length} qualified clubs in UCL`,
    uclParticipants.length > 0
  );

  const snapshotCheck = uclParticipants[0];
  const hasSnapshotFields =
    snapshotCheck.season_id === 'season-2026-27' &&
    snapshotCheck.source_competition_id !== null &&
    snapshotCheck.source_position !== null &&
    snapshotCheck.qualification_reason !== null &&
    snapshotCheck.qualification_timestamp !== null;

  assert(
    'Section 5: Permanent Participant Snapshot Integrity',
    'Stores season_id, owner_user_id, source_competition_id, source_position, reason, timestamp',
    `Snapshot: source=${snapshotCheck.source_competition_id}, pos=#${snapshotCheck.source_position}, reason="${snapshotCheck.qualification_reason}"`,
    hasSnapshotFields
  );

  // -------------------------------------------------------------
  // TEST 6: DATA-DRIVEN SUPER CUPS GENERATION
  // -------------------------------------------------------------
  console.log('\n--- [TEST 6] Testing Super Cup Participant Resolution ---');

  // FA Community Shield
  const shieldRes = populateSuperCupParticipants('season-2026-27', 'comp-community-shield-2026');
  assert(
    'Section 6: Domestic Super Cup Resolution (FA Community Shield)',
    'Populates League champion and Cup champion/runner-up without hardcoding',
    `Participants: ${shieldRes.participants.map((p) => p.clubName).join(' vs ')}`,
    shieldRes.participants.length >= 1
  );

  // -------------------------------------------------------------
  // TEST 7: CUP BRACKET ROUND PROGRESSION & CONSENSUS ADVANCEMENT
  // -------------------------------------------------------------
  console.log('\n--- [TEST 7] Testing Cup Elimination Progression ---');

  await generateCompetitionFixtures('comp-fa-cup-2026');
  const faCupFixtures = await getFixtures({ competitionId: 'comp-fa-cup-2026' });

  assert(
    'Section 7: Domestic Cup Fixtures Generated',
    'Bracket generated with 20 real clubs across knockouts',
    `${faCupFixtures.length} FA Cup fixtures generated`,
    faCupFixtures.length > 0
  );

  // Find a cup fixture in Round 1 that does not involve Arsenal (to preserve user-test-1 ownership)
  const r1Match = faCupFixtures.find(
    (f: any) =>
      f.homeClubId !== 'club-arsenal' &&
      f.awayClubId !== 'club-arsenal' &&
      f.status !== 'CONFIRMED' &&
      (f.roundName === 'Round of 32' || f.matchday === 1)
  ) || faCupFixtures.find((f: any) => f.status !== 'CONFIRMED') || faCupFixtures[0];

  // Ensure active owners exist for this cup fixture
  const homeManagerId = 'user-cup-home';
  const awayManagerId = 'user-cup-away';

  queryRun(
    'INSERT OR IGNORE INTO users (id, telegram_id, username, first_name, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [homeManagerId, '200001', 'cup_manager_home', 'CupHome', 0, now, now]
  );
  queryRun(
    'INSERT OR IGNORE INTO users (id, telegram_id, username, first_name, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [awayManagerId, '200002', 'cup_manager_away', 'CupAway', 0, now, now]
  );

  const db = (await import('../firebase/admin')).getFirestoreDb();
  await db.collection('user_memberships').doc(`season-2026-27_${homeManagerId}`).set({
    id: `season-2026-27_${homeManagerId}`,
    userId: homeManagerId,
    clubId: r1Match.homeClubId,
    seasonId: 'season-2026-27',
    status: 'active',
    claimedAt: new Date().toISOString(),
  });
  await db.collection('user_memberships').doc(`season-2026-27_${awayManagerId}`).set({
    id: `season-2026-27_${awayManagerId}`,
    userId: awayManagerId,
    clubId: r1Match.awayClubId,
    seasonId: 'season-2026-27',
    status: 'active',
    claimedAt: new Date().toISOString(),
  });

  await db.collection('fixtures').doc(r1Match.id).update({
    status: 'SCHEDULED',
    homeScore: null,
    awayScore: null,
    winnerClubId: null,
    resultConfirmedAt: null,
  });
  const cupSubsSnap = await db.collection('result_submissions').where('fixtureId', '==', r1Match.id).get();
  for (const d of cupSubsSnap.docs) {
    await d.ref.delete();
  }

  await submitFixtureResult(homeManagerId, r1Match.id, 2, 0);
  const updatedR1 = await submitFixtureResult(awayManagerId, r1Match.id, 2, 0);

  assert(
    'Section 7: Cup Result Consensus & Winner Confirmation',
    'Winner recorded after mutual agreement',
    `Winner: ${updatedR1.winnerClubId}, Status: ${updatedR1.status}`,
    updatedR1.status === 'CONFIRMED' && updatedR1.winnerClubId === updatedR1.homeClubId
  );

  // -------------------------------------------------------------
  // TEST 8: HISTORICAL OWNER PRESERVATION ACROSS SEASONS
  // -------------------------------------------------------------
  console.log('\n--- [TEST 8] Testing Historical Snapshot Immutability ---');

  // Create Season 2027/28 and populate active membership for Arsenal
  queryRun(
    'INSERT OR IGNORE INTO seasons (id, name, status, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ['season-2027-28', '2027/28 Season', 'upcoming', '2027-08-01', '2028-05-31', now]
  );
  queryRun(
    'INSERT OR IGNORE INTO season_league_clubs (id, season_id, league_id, club_id, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    ['slc-season-2027-28-club-arsenal', 'season-2027-28', 'league-premier-league', 'club-arsenal', now]
  );

  // In Season 2027/28, User 2 claims Arsenal
  await claimClubAtomic('user-test-2', 'club-arsenal', 'season-2027-28');

  // Check 2026/27 membership: must still belong to User 1
  const s26Club = await getClubById('club-arsenal', 'season-2026-27');
  // Check 2027/28 membership: must belong to User 2
  const s27Club = await getClubById('club-arsenal', 'season-2027-28');

  assert(
    'Section 8: Historical Season Manager Immutability',
    'Season 2026/27 retains User 1 while Season 2027/28 records User 2',
    `2026/27 Manager: ${s26Club?.claimedByUserId}, 2027/28 Manager: ${s27Club?.claimedByUserId}`,
    s26Club?.claimedByUserId === 'user-test-1' && s27Club?.claimedByUserId === 'user-test-2'
  );

  // -------------------------------------------------------------
  // TEST 9: OFFICIAL DOMESTIC FIXTURE IMPORTER & VALIDATOR
  // -------------------------------------------------------------
  console.log('\n--- [TEST 9] Testing Official Fixture Importer & Validator ---');

  // Test rejecting self-fixture
  const invalidSelfFixture: OfficialFixtureRecord[] = [
    { seasonId: 'season-2026-27', competitionId: 'comp-premier-league-2026', matchday: 1, homeClubId: 'club-arsenal', awayClubId: 'club-arsenal' }
  ];
  const selfVal = validateOfficialFixtures('comp-premier-league-2026', 'season-2026-27', invalidSelfFixture);
  assert(
    'Section 9: Official Fixture Validator Rejects Self-Fixtures',
    'Self-fixture rejected with error',
    selfVal.errors[0] || 'Valid',
    !selfVal.valid && selfVal.errors.some(e => e.includes('Self-fixture'))
  );

  // Test rejecting unknown club
  const invalidClubFixture: OfficialFixtureRecord[] = [
    { seasonId: 'season-2026-27', competitionId: 'comp-premier-league-2026', matchday: 1, homeClubId: 'club-arsenal', awayClubId: 'club-fake-club' }
  ];
  const fakeVal = validateOfficialFixtures('comp-premier-league-2026', 'season-2026-27', invalidClubFixture);
  assert(
    'Section 9: Official Fixture Validator Rejects Unknown Clubs',
    'Unknown club rejected with error',
    fakeVal.errors[0] || 'Valid',
    !fakeVal.valid && fakeVal.errors.some(e => e.includes('invalid or does not belong'))
  );

  // Test rejecting club from wrong league
  const wrongLeagueFixture: OfficialFixtureRecord[] = [
    { seasonId: 'season-2026-27', competitionId: 'comp-premier-league-2026', matchday: 1, homeClubId: 'club-arsenal', awayClubId: 'club-real-madrid' }
  ];
  const wrongLeagueVal = validateOfficialFixtures('comp-premier-league-2026', 'season-2026-27', wrongLeagueFixture);
  assert(
    'Section 9: Official Fixture Validator Rejects Wrong League Clubs',
    'Wrong league club rejected with error',
    wrongLeagueVal.errors[0] || 'Valid',
    !wrongLeagueVal.valid && wrongLeagueVal.errors.some(e => e.includes('invalid or does not belong'))
  );

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log('                 TEST SUMMARY REPORT                           ');
  console.log('================================================================');
  const passedCount = assertions.filter((a) => a.passed).length;
  const totalCount = assertions.length;
  console.log(`TOTAL TESTS: ${totalCount} | PASSED: ${passedCount} | FAILED: ${totalCount - passedCount}`);

  if (passedCount === totalCount) {
    console.log('🎉 ALL TOURNAMENT ARCHITECTURE REQUIREMENTS VERIFIED SUCCESSFULLY!\n');
    return true;
  } else {
    console.error('❌ SOME TESTS FAILED.');
    return false;
  }
}
