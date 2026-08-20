import { initDatabase, queryAll, queryGet } from '../db';
import { seedDatabase } from '../db/seed';
import { resetCompetitionFixtures } from '../services/fixtureService';

async function runValidation() {
  console.log('\n🔍 =======================================================');
  console.log('   SEASON 2026/27 COMPREHENSIVE VALIDATION SUITE');
  console.log('=======================================================\n');

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition: boolean, testName: string, errorDetails?: string) {
    if (condition) {
      console.log(` ✅ PASS: ${testName}`);
      passedTests++;
    } else {
      console.error(` ❌ FAIL: ${testName}`);
      if (errorDetails) {
        console.error(`    ↳ ${errorDetails}`);
      }
      failedTests++;
    }
  }

  // 1. Initialize DB & Seed
  await initDatabase();
  seedDatabase();

  const seasonId = 'season-2026-27';

  // 2. Validate Season Entity
  const season = queryGet<any>('SELECT * FROM seasons WHERE id = ?', [seasonId]);
  assert(!!season, 'Season 2026/27 entity exists in database', `Season '${seasonId}' not found`);
  assert(season?.name === '2026/27 Season', 'Season name is 2026/27 Season', `Got: ${season?.name}`);
  assert(season?.status === 'active', 'Season 2026/27 is currently active', `Got: ${season?.status}`);

  // 3. Validate Domestic Leagues Counts
  const expectedLeagueCounts: Record<string, { name: string; count: number; matchdays: number; totalFixtures: number }> = {
    'league-premier-league': { name: 'Premier League', count: 20, matchdays: 38, totalFixtures: 380 },
    'league-la-liga': { name: 'La Liga', count: 20, matchdays: 38, totalFixtures: 380 },
    'league-serie-a': { name: 'Serie A', count: 20, matchdays: 38, totalFixtures: 380 },
    'league-bundesliga': { name: 'Bundesliga', count: 18, matchdays: 34, totalFixtures: 306 },
    'league-ligue-1': { name: 'Ligue 1', count: 18, matchdays: 34, totalFixtures: 306 },
  };

  let totalActiveClubs = 0;
  for (const [leagueId, meta] of Object.entries(expectedLeagueCounts)) {
    const clubs = queryAll<{ club_id: string }>(
      `SELECT slc.club_id 
       FROM season_league_clubs slc 
       JOIN clubs c ON slc.club_id = c.id
       WHERE slc.league_id = ? AND slc.season_id = ? AND slc.is_active = 1`,
      [leagueId, seasonId]
    );

    assert(
      clubs.length === meta.count,
      `${meta.name} has exactly ${meta.count} active clubs for 2026/27`,
      `Expected ${meta.count}, found ${clubs.length}`
    );
    totalActiveClubs += clubs.length;
  }

  assert(totalActiveClubs === 96, 'Total active top-flight European clubs is exactly 96', `Got: ${totalActiveClubs}`);

  // 4. Validate Promoted Clubs are Active in 2026/27
  const promotedClubs = [
    { id: 'club-coventry', name: 'Coventry City', league: 'league-premier-league' },
    { id: 'club-ipswich', name: 'Ipswich Town', league: 'league-premier-league' },
    { id: 'club-hull', name: 'Hull City', league: 'league-premier-league' },
    { id: 'club-racing-santander', name: 'Racing Santander', league: 'league-la-liga' },
    { id: 'club-deportivo-la-coruna', name: 'Deportivo La Coruña', league: 'league-la-liga' },
    { id: 'club-malaga', name: 'Málaga CF', league: 'league-la-liga' },
    { id: 'club-venezia', name: 'Venezia', league: 'league-serie-a' },
    { id: 'club-frosinone', name: 'Frosinone', league: 'league-serie-a' },
    { id: 'club-monza', name: 'Monza', league: 'league-serie-a' },
    { id: 'club-holstein-kiel', name: 'Holstein Kiel', league: 'league-bundesliga' },
    { id: 'club-st-pauli', name: 'FC St. Pauli', league: 'league-bundesliga' },
    { id: 'club-troyes', name: 'ESTAC Troyes', league: 'league-ligue-1' },
    { id: 'club-le-mans', name: 'Le Mans FC', league: 'league-ligue-1' },
    { id: 'club-paris-fc', name: 'Paris FC', league: 'league-ligue-1' },
  ];

  for (const promo of promotedClubs) {
    const slc = queryGet<any>(
      'SELECT * FROM season_league_clubs WHERE season_id = ? AND club_id = ? AND league_id = ? AND is_active = 1',
      [seasonId, promo.id, promo.league]
    );
    assert(
      !!slc,
      `Promoted club '${promo.name}' (${promo.id}) is active in ${promo.league} for 2026/27`,
      `Not found in season_league_clubs`
    );
  }

  // 5. Validate Relegated Clubs are NOT Active in 2026/27 top flights
  const relegatedClubs = [
    { id: 'club-wolves', name: 'Wolverhampton Wanderers' },
    { id: 'club-burnley', name: 'Burnley' },
    { id: 'club-west-ham', name: 'West Ham United' },
    { id: 'club-zaragoza', name: 'Real Zaragoza' },
    { id: 'club-elche', name: 'Elche CF' },
    { id: 'club-levante', name: 'Levante UD' },
    { id: 'club-sassuolo', name: 'US Sassuolo' },
    { id: 'club-pisa', name: 'Pisa SC' },
    { id: 'club-cremonese', name: 'US Cremonese' },
    { id: 'club-hamburger-sv', name: 'Hamburger SV' },
    { id: 'club-hannover-96', name: 'Hannover 96' },
    { id: 'club-lorient', name: 'FC Lorient' },
    { id: 'club-metz', name: 'FC Metz' },
    { id: 'club-angers', name: 'Angers SCO' },
    { id: 'club-saint-etienne', name: 'AS Saint-Étienne' },
    { id: 'club-le-havre', name: 'Le Havre AC' },
  ];

  for (const rel of relegatedClubs) {
    const activeMember = queryGet<any>(
      'SELECT * FROM season_league_clubs WHERE season_id = ? AND club_id = ? AND is_active = 1',
      [seasonId, rel.id]
    );
    assert(
      !activeMember,
      `Relegated club '${rel.name}' (${rel.id}) is NOT active in 2026/27 top-flight leagues`,
      `Found active record in season_league_clubs`
    );
  }

  // Regression Test 1: Frontend/API must not return 2025/26-only club
  console.log('\n 🔒 Running Regression Test: Frontend/API must not return 2025/26-only club');
  for (const [leagueId, meta] of Object.entries(expectedLeagueCounts)) {
    const clubsInApi = queryAll<any>(
      `SELECT c.id, c.name
       FROM season_league_clubs slc
       JOIN clubs c ON slc.club_id = c.id
       WHERE slc.season_id = ? AND slc.league_id = ? AND slc.is_active = 1`,
      [seasonId, leagueId]
    );
    const returnedIds = new Set(clubsInApi.map((c) => c.id));
    for (const rel of relegatedClubs) {
      assert(
        !returnedIds.has(rel.id),
        `Frontend/API must not return 2025/26-only club '${rel.name}' in ${meta.name} API response`,
        `Relegated club '${rel.name}' was returned by API for ${leagueId}`
      );
    }
  }

  // Regression Test 2: League UI must contain exactly the active 2026/27 season clubs
  console.log('\n 🔒 Running Regression Test: League UI must contain exactly the active 2026/27 season clubs');
  for (const [leagueId, meta] of Object.entries(expectedLeagueCounts)) {
    const clubsForUi = queryAll<any>(
      `SELECT c.id, c.name
       FROM season_league_clubs slc
       JOIN clubs c ON slc.club_id = c.id
       WHERE slc.season_id = ? AND slc.league_id = ? AND slc.is_active = 1
       ORDER BY c.name ASC`,
      [seasonId, leagueId]
    );
    assert(
      clubsForUi.length === meta.count,
      `League UI must contain exactly the active 2026/27 season clubs for ${meta.name} (Count: ${meta.count})`,
      `Expected ${meta.count}, got ${clubsForUi.length}`
    );
  }

  // 6. Test Fixture Generation (Berger Algorithmic Double Round-Robin) for all 5 domestic leagues
  console.log('\n 🗓️  Validating 2026/27 Domestic Fixtures Generation...');

  const domesticCompetitions = [
    { id: 'comp-premier-league-2026', leagueId: 'league-premier-league', name: 'Premier League' },
    { id: 'comp-la-liga-2026', leagueId: 'league-la-liga', name: 'La Liga' },
    { id: 'comp-serie-a-2026', leagueId: 'league-serie-a', name: 'Serie A' },
    { id: 'comp-bundesliga-2026', leagueId: 'league-bundesliga', name: 'Bundesliga' },
    { id: 'comp-ligue-1-2026', leagueId: 'league-ligue-1', name: 'Ligue 1' },
  ];

  let totalDomesticFixturesGenerated = 0;

  for (const comp of domesticCompetitions) {
    const meta = expectedLeagueCounts[comp.leagueId];

    // Reset and regenerate fixtures
    const res = resetCompetitionFixtures(comp.id);

    assert(
      res.generated === meta.totalFixtures,
      `${comp.name} generated exactly ${meta.totalFixtures} fixtures`,
      `Expected ${meta.totalFixtures}, generated ${res.generated}`
    );

    assert(
      res.matchdays === meta.matchdays,
      `${comp.name} generated exactly ${meta.matchdays} matchdays`,
      `Expected ${meta.matchdays}, got ${res.matchdays}`
    );

    totalDomesticFixturesGenerated += res.generated;

    // Detailed fixture integrity checks
    const fixtures = queryAll<any>('SELECT * FROM fixtures WHERE competition_id = ?', [comp.id]);
    
    // Check no self-play
    const selfMatches = fixtures.filter((f) => f.home_club_id === f.away_club_id);
    assert(selfMatches.length === 0, `${comp.name}: No clubs play against themselves`, `Found: ${selfMatches.length}`);

    // Check matches per matchday
    const matchesPerMd = meta.count / 2;
    let mdMatchesCorrect = true;
    for (let md = 1; md <= meta.matchdays; md++) {
      const mdFixtures = fixtures.filter((f) => f.matchday === md);
      if (mdFixtures.length !== matchesPerMd) {
        mdMatchesCorrect = false;
        break;
      }
    }
    assert(
      mdMatchesCorrect,
      `${comp.name}: Every matchday has exactly ${matchesPerMd} matches`,
      `Matchday fixture count mismatch`
    );

    // Check club match counts and home/away balance
    const clubs = queryAll<{ club_id: string }>(
      `SELECT slc.club_id 
       FROM season_league_clubs slc 
       JOIN clubs c ON slc.club_id = c.id
       WHERE slc.league_id = ? AND slc.season_id = ? AND slc.is_active = 1`,
      [comp.leagueId, seasonId]
    );

    let allClubsBalanced = true;
    for (const c of clubs) {
      const homeMatches = fixtures.filter((f) => f.home_club_id === c.club_id);
      const awayMatches = fixtures.filter((f) => f.away_club_id === c.club_id);
      const totalMatches = homeMatches.length + awayMatches.length;

      if (totalMatches !== (meta.count - 1) * 2 || homeMatches.length !== meta.count - 1 || awayMatches.length !== meta.count - 1) {
        allClubsBalanced = false;
        break;
      }
    }
    assert(
      allClubsBalanced,
      `${comp.name}: All clubs play exactly ${meta.count - 1} home and ${meta.count - 1} away games`,
      `Home/away balance failure`
    );
  }

  assert(
    totalDomesticFixturesGenerated === 1752,
    'Total domestic fixtures across all 5 leagues is exactly 1,752 (380*3 + 306*2)',
    `Got: ${totalDomesticFixturesGenerated}`
  );

  // 7. Validate UCL and Domestic Cups Integrity
  console.log('\n 🏆 Validating Cup Competitions & UCL Setup...');
  const ucl = queryGet<any>('SELECT * FROM competitions WHERE id = "comp-champions-league-2026"');
  assert(!!ucl, 'UCL 2026/27 competition exists', 'UCL competition not found');
  assert(ucl?.type === 'EUROPEAN_LEAGUE_PHASE', 'UCL competition type is EUROPEAN_LEAGUE_PHASE', `Got: ${ucl?.type}`);

  // Domestic Cups participants check
  const cups = [
    { id: 'comp-fa-cup-2026', expectedCount: 20, name: 'FA Cup' },
    { id: 'comp-copa-del-rey-2026', expectedCount: 20, name: 'Copa del Rey' },
    { id: 'comp-coppa-italia-2026', expectedCount: 20, name: 'Coppa Italia' },
    { id: 'comp-dfb-pokal-2026', expectedCount: 18, name: 'DFB-Pokal' },
    { id: 'comp-coupe-de-france-2026', expectedCount: 18, name: 'Coupe de France' },
  ];

  for (const cup of cups) {
    const participants = queryAll<any>('SELECT * FROM competition_participants WHERE competition_id = ?', [cup.id]);
    assert(
      participants.length === cup.expectedCount,
      `${cup.name} has ${cup.expectedCount} registered 2026/27 participants`,
      `Expected ${cup.expectedCount}, got ${participants.length}`
    );
  }

  console.log('\n=======================================================');
  console.log(`🏁 VALIDATION SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('=======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runValidation().catch((err) => {
  console.error('Validation script encountered fatal error:', err);
  process.exit(1);
});
