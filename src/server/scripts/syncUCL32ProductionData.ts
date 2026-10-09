import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { evaluateSeasonQualifications } from '../tournament/qualificationEngine';
import {
  generateCompetitionFixturesFirestore,
  rebuildCompetitionStandingsFirestore,
  getCompetitionParticipantsFirestore,
  getCompetitionStandingsFirestore,
  getFixturesFirestore,
} from '../firebase/firestoreStore';
import { queryAll, queryRun, initDatabase } from '../db';

async function runSync() {
  console.log('--- STARTING UCL/UEL 32-TEAM PRODUCTION DATA SYNC ---');
  await initDatabase();
  const db = getFirestoreDb();

  const formatConfig32 = {
    leaguePhaseTeams: 32,
    matchesPerTeam: 8,
    directQualifiers: 8,
    playoffTeams: 16,
    knockoutTeams: 16,
  };

  // 1. Update competition formatConfig in Firestore and SQLite
  console.log('Step 1: Updating formatConfig for UCL and UEL to 32 teams...');
  await db.collection(COLLECTIONS.COMPETITIONS).doc('comp-champions-league-2026').set(
    {
      formatConfig: formatConfig32,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  await db.collection(COLLECTIONS.COMPETITIONS).doc('comp-europa-league-2026').set(
    {
      formatConfig: formatConfig32,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );

  queryRun('UPDATE competitions SET format_config_json = ? WHERE id = ?', [
    JSON.stringify(formatConfig32),
    'comp-champions-league-2026',
  ]);
  queryRun('UPDATE competitions SET format_config_json = ? WHERE id = ?', [
    JSON.stringify(formatConfig32),
    'comp-europa-league-2026',
  ]);

  // Remove any Conference League references if present
  try {
    await db.collection(COLLECTIONS.COMPETITIONS).doc('comp-conference-league-2026').delete();
    queryRun('DELETE FROM competitions WHERE id = ?', ['comp-conference-league-2026']);
  } catch {}

  // Update domestic league format configs
  const domesticConfigs: Record<string, { totalClubs: number; rounds: number }> = {
    'comp-premier-league-2026': { totalClubs: 20, rounds: 19 },
    'comp-la-liga-2026': { totalClubs: 20, rounds: 19 },
    'comp-serie-a-2026': { totalClubs: 20, rounds: 19 },
    'comp-bundesliga-2026': { totalClubs: 18, rounds: 17 },
    'comp-ligue-1-2026': { totalClubs: 18, rounds: 17 },
  };

  for (const [compId, cfg] of Object.entries(domesticConfigs)) {
    const fConfig = {
      type: 'LEAGUE',
      totalClubs: cfg.totalClubs,
      rounds: cfg.rounds,
      homeAndAway: false,
    };
    await db.collection(COLLECTIONS.COMPETITIONS).doc(compId).set(
      { formatConfig: fConfig, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    queryRun('UPDATE competitions SET format_config_json = ? WHERE id = ?', [
      JSON.stringify(fConfig),
      compId,
    ]);
  }

  // 2. Evaluate season qualifications to cleanly assign the 32 UCL and 32 UEL clubs
  console.log('Step 2: Evaluating qualifications for season-2026-27...');
  const qualResult = await evaluateSeasonQualifications('season-2026-27');
  console.log(`Evaluated qualifications: added ${qualResult.participantsAdded} participants, total qualified: ${qualResult.qualifications.length}`);

  // 3. Verify participants count in Firestore
  const uclParts = await getCompetitionParticipantsFirestore('comp-champions-league-2026');
  const uelParts = await getCompetitionParticipantsFirestore('comp-europa-league-2026');
  console.log(`UCL participants in Firestore: ${uclParts.length}`);
  console.log(`UEL participants in Firestore: ${uelParts.length}`);

  if (uclParts.length !== 32) {
    throw new Error(`UCL participants count is ${uclParts.length}, expected 32!`);
  }
  if (uelParts.length !== 32) {
    throw new Error(`UEL participants count is ${uelParts.length}, expected 32!`);
  }

  // 4. Rebuild standings for UCL and UEL
  console.log('Step 3: Rebuilding standings for UCL and UEL...');
  const uclStandings = await rebuildCompetitionStandingsFirestore('comp-champions-league-2026');
  const uelStandings = await rebuildCompetitionStandingsFirestore('comp-europa-league-2026');
  console.log(`UCL standings rows: ${uclStandings.length}`);
  console.log(`UEL standings rows: ${uelStandings.length}`);

  if (uclStandings.length !== 32) {
    throw new Error(`UCL standings count is ${uclStandings.length}, expected 32!`);
  }
  if (uelStandings.length !== 32) {
    throw new Error(`UEL standings count is ${uelStandings.length}, expected 32!`);
  }

  // 5. Generate 32-team League Phase Fixtures for UCL and UEL
  console.log('Step 4: Generating 32-team League Phase Fixtures for UCL & UEL...');
  const uclFixGen = await generateCompetitionFixturesFirestore('comp-champions-league-2026', { force: true });
  console.log(`UCL generated: ${uclFixGen.generated} fixtures across ${uclFixGen.matchdays} matchdays`);

  const uelFixGen = await generateCompetitionFixturesFirestore('comp-europa-league-2026', { force: true });
  console.log(`UEL generated: ${uelFixGen.generated} fixtures across ${uelFixGen.matchdays} matchdays`);

  if (uclFixGen.generated !== 128 || uclFixGen.matchdays !== 8) {
    throw new Error(`UCL fixtures count is ${uclFixGen.generated} across ${uclFixGen.matchdays} matchdays, expected 128 / 8!`);
  }
  if (uelFixGen.generated !== 128 || uelFixGen.matchdays !== 8) {
    throw new Error(`UEL fixtures count is ${uelFixGen.generated} across ${uelFixGen.matchdays} matchdays, expected 128 / 8!`);
  }

  console.log('--- ALL DATA SYNCED SUCCESSFULLY! ---');
}

runSync().catch((err) => {
  console.error('Data sync failed:', err);
  process.exit(1);
});
