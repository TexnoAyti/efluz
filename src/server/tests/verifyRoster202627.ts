import { initDatabase, queryAll, queryGet } from '../db';
import { seedDatabase, repairSeason202627Roster } from '../db/seed';

async function main() {
  console.log('\n=============================================================');
  console.log('       OFFICIAL 2026/27 DOMESTIC LEAGUE ROSTER VERIFIER       ');
  console.log('=============================================================\n');

  // Initialize DB and ensure safe repair is executed
  await initDatabase();
  seedDatabase();
  repairSeason202627Roster();

  const seasonId = 'season-2026-27';

  // 1. Fetch active clubs for season 2026/27 grouped by league
  const leagueConfigs = [
    { id: 'league-premier-league', name: 'Premier League', expected: 20 },
    { id: 'league-la-liga', name: 'La Liga', expected: 20 },
    { id: 'league-serie-a', name: 'Serie A', expected: 20 },
    { id: 'league-bundesliga', name: 'Bundesliga', expected: 18 },
    { id: 'league-ligue-1', name: 'Ligue 1', expected: 18 },
  ];

  console.log('--- LEAGUE ROSTER COUNTS ---');
  let totalCount = 0;
  const leagueRosters: Record<string, any[]> = {};

  for (const l of leagueConfigs) {
    const clubs = queryAll<any>(
      `SELECT c.id, c.name, c.short_name, c.country, slc.league_id, slc.is_active
       FROM season_league_clubs slc
       JOIN clubs c ON slc.club_id = c.id
       WHERE slc.league_id = ? AND slc.season_id = ? AND slc.is_active = 1
       ORDER BY c.name ASC`,
      [l.id, seasonId]
    );

    leagueRosters[l.id] = clubs;
    totalCount += clubs.length;
    console.log(`${l.name}: ${clubs.length} (Expected: ${l.expected})`);
  }
  console.log(`Total: ${totalCount} (Expected: 96)\n`);

  console.log('--- DETAILED 2026/27 CLUBS LIST BY LEAGUE ---');
  for (const l of leagueConfigs) {
    console.log(`\n=== ${l.name.toUpperCase()} (${leagueRosters[l.id].length} Clubs) ===`);
    leagueRosters[l.id].forEach((c, idx) => {
      console.log(`  ${String(idx + 1).padStart(2, ' ')}. [${c.id}] ${c.name} (${c.short_name}) - ${c.country}`);
    });
  }

  // 2. Comprehensive Verifications
  console.log('\n--- VERIFICATION CHECKS ---');

  // Check 1: 0 incorrect relegated clubs
  const relegatedChecklist = [
    // Premier League
    { id: 'club-wolves', name: 'Wolverhampton Wanderers' },
    { id: 'club-burnley', name: 'Burnley' },
    { id: 'club-west-ham', name: 'West Ham United' },
    // La Liga
    { id: 'club-zaragoza', name: 'Real Zaragoza' },
    { id: 'club-elche', name: 'Elche CF' },
    { id: 'club-levante', name: 'Levante UD' },
    // Serie A
    { id: 'club-sassuolo', name: 'US Sassuolo' },
    { id: 'club-pisa', name: 'Pisa SC' },
    { id: 'club-cremonese', name: 'US Cremonese' },
    // Bundesliga
    { id: 'club-hamburger-sv', name: 'Hamburger SV' },
    { id: 'club-hannover-96', name: 'Hannover 96' },
    // Ligue 1
    { id: 'club-lorient', name: 'FC Lorient' },
    { id: 'club-metz', name: 'FC Metz' },
    { id: 'club-angers', name: 'Angers SCO' },
    { id: 'club-saint-etienne', name: 'AS Saint-Étienne' },
    { id: 'club-le-havre', name: 'Le Havre AC' },
  ];

  let incorrectRelegatedFound = 0;
  for (const rel of relegatedChecklist) {
    const activeEntry = queryGet(
      'SELECT * FROM season_league_clubs WHERE season_id = ? AND club_id = ? AND is_active = 1',
      [seasonId, rel.id]
    );
    if (activeEntry) {
      console.error(`  ❌ Relegated/Invalid club '${rel.name}' (${rel.id}) is active in 2026/27!`);
      incorrectRelegatedFound++;
    }
  }
  console.log(`- Incorrect relegated clubs: ${incorrectRelegatedFound} (Target: 0)`);

  // Check 2: 0 missing promoted clubs
  const promotedChecklist = [
    // Premier League
    { id: 'club-coventry', name: 'Coventry City', league: 'league-premier-league' },
    { id: 'club-ipswich', name: 'Ipswich Town', league: 'league-premier-league' },
    { id: 'club-hull', name: 'Hull City', league: 'league-premier-league' },
    // La Liga
    { id: 'club-racing-santander', name: 'Racing Santander', league: 'league-la-liga' },
    { id: 'club-deportivo-la-coruna', name: 'Deportivo La Coruña', league: 'league-la-liga' },
    { id: 'club-malaga', name: 'Málaga CF', league: 'league-la-liga' },
    // Serie A
    { id: 'club-venezia', name: 'Venezia', league: 'league-serie-a' },
    { id: 'club-frosinone', name: 'Frosinone', league: 'league-serie-a' },
    { id: 'club-monza', name: 'Monza', league: 'league-serie-a' },
    // Bundesliga
    { id: 'club-holstein-kiel', name: 'Holstein Kiel', league: 'league-bundesliga' },
    { id: 'club-st-pauli', name: 'FC St. Pauli', league: 'league-bundesliga' },
    // Ligue 1
    { id: 'club-troyes', name: 'ESTAC Troyes', league: 'league-ligue-1' },
    { id: 'club-le-mans', name: 'Le Mans FC', league: 'league-ligue-1' },
    { id: 'club-paris-fc', name: 'Paris FC', league: 'league-ligue-1' },
  ];

  let missingPromotedFound = 0;
  for (const promo of promotedChecklist) {
    const activeEntry = queryGet(
      'SELECT * FROM season_league_clubs WHERE season_id = ? AND club_id = ? AND league_id = ? AND is_active = 1',
      [seasonId, promo.id, promo.league]
    );
    if (!activeEntry) {
      console.error(`  ❌ Missing promoted club '${promo.name}' (${promo.id}) in ${promo.league}!`);
      missingPromotedFound++;
    }
  }
  console.log(`- Missing promoted clubs: ${missingPromotedFound} (Target: 0)`);

  // Check 3: 0 duplicate clubs in 2026/27
  const allActiveClubs = queryAll<{ club_id: string }>(
    'SELECT club_id FROM season_league_clubs WHERE season_id = ? AND is_active = 1',
    [seasonId]
  );
  const seenClubIds = new Set<string>();
  let duplicatesFound = 0;
  for (const item of allActiveClubs) {
    if (seenClubIds.has(item.club_id)) {
      console.error(`  ❌ Duplicate active club detected: ${item.club_id}`);
      duplicatesFound++;
    }
    seenClubIds.add(item.club_id);
  }
  console.log(`- Duplicate clubs: ${duplicatesFound} (Target: 0)`);

  // Check 4: 0 inactive clubs in fixtures
  const inactiveClubsInFixtures = queryAll<any>(
    `SELECT f.id, f.home_club_id, f.away_club_id, f.competition_id
     FROM fixtures f
     WHERE f.season_id = ? AND (
       f.home_club_id NOT IN (SELECT club_id FROM season_league_clubs WHERE season_id = ? AND is_active = 1)
       OR f.away_club_id NOT IN (SELECT club_id FROM season_league_clubs WHERE season_id = ? AND is_active = 1)
     )`,
    [seasonId, seasonId, seasonId]
  );
  console.log(`- Inactive clubs in fixtures: ${inactiveClubsInFixtures.length} (Target: 0)`);

  // Check 5: 0 fixtures involving clubs outside the season roster
  const activeIds = Array.from(seenClubIds);
  const invalidRosterFixtures = queryAll<any>(
    `SELECT f.id, f.home_club_id, f.away_club_id
     FROM fixtures f
     WHERE f.season_id = ? AND (
       f.home_club_id = f.away_club_id
       OR f.home_club_id NOT IN (${activeIds.map(() => '?').join(',')})
       OR f.away_club_id NOT IN (${activeIds.map(() => '?').join(',')})
     )`,
    [seasonId, ...activeIds, ...activeIds]
  );
  console.log(`- Fixtures involving clubs outside season roster: ${invalidRosterFixtures.length} (Target: 0)`);

  const allPassed =
    totalCount === 96 &&
    incorrectRelegatedFound === 0 &&
    missingPromotedFound === 0 &&
    duplicatesFound === 0 &&
    inactiveClubsInFixtures.length === 0 &&
    invalidRosterFixtures.length === 0;

  if (allPassed) {
    console.log('\n=============================================================');
    console.log('  ALL 2026/27 ROSTER & FIXTURE CHECKS PASSED PERFECTLY (0 ERRORS) ');
    console.log('=============================================================\n');
    process.exit(0);
  } else {
    console.error('\n❌ SOME ROSTER VERIFICATION CHECKS FAILED');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error during roster verification:', err);
  process.exit(1);
});
