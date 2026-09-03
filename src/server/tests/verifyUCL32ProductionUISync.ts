import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import {
  getCompetitionByIdFirestore,
  getCompetitionParticipantsFirestore,
  getCompetitionStandingsFirestore,
  getFixturesFirestore,
} from '../firebase/firestoreStore';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED ASSERTION: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`✅ ${msg}`);
}

async function runProductionVerification() {
  console.log('\n======================================================');
  console.log('EFL UZ — PRODUCTION UCL/UEL 32-TEAM & DOMESTIC SYNC AUDIT');
  console.log('======================================================\n');

  // 1. UCL Audit
  console.log('--- CHECK 1: UEFA CHAMPIONS LEAGUE 32-TEAM AUDIT ---');
  const uclComp = await getCompetitionByIdFirestore('comp-champions-league-2026');
  assert(!!uclComp, 'UCL competition document exists in Firestore');
  assert(uclComp?.formatConfig?.leaguePhaseTeams === 32, `UCL formatConfig.leaguePhaseTeams is 32 (got ${uclComp?.formatConfig?.leaguePhaseTeams})`);
  assert(uclComp?.formatConfig?.matchesPerTeam === 8, `UCL formatConfig.matchesPerTeam is 8 (got ${uclComp?.formatConfig?.matchesPerTeam})`);
  assert(uclComp?.formatConfig?.directQualifiers === 8, 'UCL directQualifiers is 8 (Top 8 to RO16)');
  assert(uclComp?.formatConfig?.playoffTeams === 16, 'UCL playoffTeams is 16 (Rank 9-24 to Knockout Play-offs)');

  const uclParticipants = await getCompetitionParticipantsFirestore('comp-champions-league-2026');
  assert(uclParticipants.length === 32, `UCL participants count is exactly 32 (got ${uclParticipants.length})`);

  const uclStandings = await getCompetitionStandingsFirestore('comp-champions-league-2026');
  assert(uclStandings.length === 32, `UCL standings table contains exactly 32 clubs (got ${uclStandings.length})`);

  const uclFixtures = await getFixturesFirestore({ competitionId: 'comp-champions-league-2026' });
  assert(uclFixtures.length === 128, `UCL fixtures count is exactly 128 (got ${uclFixtures.length})`);
  const uclMatchdays = new Set(uclFixtures.map((f) => f.matchday));
  assert(uclMatchdays.size === 8, `UCL spans exactly 8 matchdays (got ${uclMatchdays.size})`);
  for (let md = 1; md <= 8; md++) {
    const count = uclFixtures.filter((f) => f.matchday === md).length;
    assert(count === 16, `UCL Matchday ${md} contains exactly 16 matches (32 clubs / 2) (got ${count})`);
  }

  // 2. UEL Audit
  console.log('\n--- CHECK 2: UEFA EUROPA LEAGUE 32-TEAM AUDIT ---');
  const uelComp = await getCompetitionByIdFirestore('comp-europa-league-2026');
  assert(!!uelComp, 'UEL competition document exists in Firestore');
  assert(uelComp?.formatConfig?.leaguePhaseTeams === 32, `UEL formatConfig.leaguePhaseTeams is 32 (got ${uelComp?.formatConfig?.leaguePhaseTeams})`);
  assert(uelComp?.formatConfig?.matchesPerTeam === 8, `UEL formatConfig.matchesPerTeam is 8 (got ${uelComp?.formatConfig?.matchesPerTeam})`);

  const uelParticipants = await getCompetitionParticipantsFirestore('comp-europa-league-2026');
  assert(uelParticipants.length === 32, `UEL participants count is exactly 32 (got ${uelParticipants.length})`);

  const uelStandings = await getCompetitionStandingsFirestore('comp-europa-league-2026');
  assert(uelStandings.length === 32, `UEL standings table contains exactly 32 clubs (got ${uelStandings.length})`);

  const uelFixtures = await getFixturesFirestore({ competitionId: 'comp-europa-league-2026' });
  assert(uelFixtures.length === 128, `UEL fixtures count is exactly 128 (got ${uelFixtures.length})`);
  const uelMatchdays = new Set(uelFixtures.map((f) => f.matchday));
  assert(uelMatchdays.size === 8, `UEL spans exactly 8 matchdays (got ${uelMatchdays.size})`);
  for (let md = 1; md <= 8; md++) {
    const count = uelFixtures.filter((f) => f.matchday === md).length;
    assert(count === 16, `UEL Matchday ${md} contains exactly 16 matches (got ${count})`);
  }

  // 3. Domestic Leagues Single Round-Robin Audit
  console.log('\n--- CHECK 3: DOMESTIC LEAGUES SINGLE ROUND-ROBIN AUDIT ---');
  const leagues = [
    { id: 'comp-premier-league-2026', name: 'Premier League', expectedTeams: 20, expectedRounds: 19 },
    { id: 'comp-la-liga-2026', name: 'La Liga', expectedTeams: 20, expectedRounds: 19 },
    { id: 'comp-serie-a-2026', name: 'Serie A', expectedTeams: 20, expectedRounds: 19 },
    { id: 'comp-bundesliga-2026', name: 'Bundesliga', expectedTeams: 18, expectedRounds: 17 },
    { id: 'comp-ligue-1-2026', name: 'Ligue 1', expectedTeams: 18, expectedRounds: 17 },
  ];

  for (const l of leagues) {
    const comp = await getCompetitionByIdFirestore(l.id);
    assert(!!comp, `${l.name} exists`);
    assert(comp?.formatConfig?.homeAndAway === false, `${l.name} is Single Round-Robin (homeAndAway: false)`);
    assert(comp?.formatConfig?.rounds === l.expectedRounds, `${l.name} rounds is ${l.expectedRounds} (got ${comp?.formatConfig?.rounds})`);
    assert(comp?.totalTeams === l.expectedTeams, `${l.name} totalTeams is ${l.expectedTeams} (got ${comp?.totalTeams})`);

    const standings = await getCompetitionStandingsFirestore(l.id);
    assert(standings.length === l.expectedTeams, `${l.name} standings has exactly ${l.expectedTeams} clubs (got ${standings.length})`);
  }

  // 4. Conference League Elimination Audit
  console.log('\n--- CHECK 4: NO CONFERENCE LEAGUE AUDIT ---');
  const db = getFirestoreDb();
  const ueclDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc('comp-conference-league-2026').get();
  assert(!ueclDoc.exists, 'Conference League document does not exist in Firestore');

  console.log('\n======================================================');
  console.log('✅ ALL PRODUCTION AUDIT CHECKS PASSED PERFECTLY!');
  console.log('======================================================\n');
}

runProductionVerification().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
