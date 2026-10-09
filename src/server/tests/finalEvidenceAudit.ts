import { initDatabase, queryAll, queryGet, queryRun, dbTransaction, getDb } from '../db';
import { seedDatabase } from '../db/seed';
import { generateCompetitionFixtures } from '../services/fixtureService';
import { generateRoundRobinSchedule, generateEuropean32LeaguePhaseSchedule } from '../tournament/fixtureEngine';
import { evaluateSeasonQualifications } from '../tournament/qualificationEngine';
import { generateUCLKnockoutBracket } from '../tournament/knockoutEngine';
import { calculateCompetitionStandings } from '../tournament/standingsEngine';
import { claimClubAtomic, getClubsByLeague } from '../services/clubService';
import { submitFixtureResult } from '../services/resultService';
import fs from 'fs';

async function runAudit() {
  await initDatabase();
  console.log('=== SECTION 1: DOMESTIC FIXTURES INSPECTION ===');
  const leagues = queryAll<any>('SELECT * FROM leagues');
  console.log(`Leagues in DB (${leagues.length}):`, leagues.map(l => l.name));

  for (const league of leagues) {
    const clubs = queryAll<any>('SELECT * FROM clubs WHERE league_id = ?', [league.id]);
    const comp = queryGet<any>('SELECT * FROM competitions WHERE league_id = ? AND type = "LEAGUE"', [league.id]);
    const fixtures = comp ? queryAll<any>('SELECT * FROM fixtures WHERE competition_id = ? ORDER BY matchday ASC LIMIT 10', [comp.id]) : [];
    const fixtureCount = comp ? queryGet<any>('SELECT COUNT(*) as cnt, MAX(matchday) as max_md FROM fixtures WHERE competition_id = ?', [comp.id]) : { cnt: 0, max_md: 0 };
    console.log(`\n--- LEAGUE: ${league.name} (${league.id}) ---`);
    console.log(`Club count: ${clubs.length}`);
    console.log(`Clubs: ${clubs.map(c => c.name).join(', ')}`);
    console.log(`Fixtures in DB: ${fixtureCount.cnt}, Max Matchday: ${fixtureCount.max_md}`);
    console.log(`First 5 fixtures:`);
    fixtures.slice(0, 5).forEach(f => {
      console.log(`  MD ${f.matchday}: ${f.home_club_id} vs ${f.away_club_id} (scheduled: ${f.scheduled_at}, status: ${f.status})`);
    });
  }

  console.log('\n=== SECTION 2: 24-TEAM UCL QUALIFICATION EVALUATION ===');
  const now = new Date().toISOString();
  queryRun('DELETE FROM competition_participants WHERE competition_id = "comp-champions-league-2026"');
  queryRun('DELETE FROM club_memberships WHERE season_id = "season-2026-27"');
  
  // Claim 2 clubs in Premier League, 1 in La Liga, leave others unowned
  queryRun('INSERT OR IGNORE INTO users (id, telegram_id, username, first_name, is_admin, created_at, updated_at) VALUES ("user-aud-1", "901", "manager_arsenal", "Alex", 0, ?, ?)', [now, now]);
  queryRun('INSERT OR IGNORE INTO users (id, telegram_id, username, first_name, is_admin, created_at, updated_at) VALUES ("user-aud-2", "902", "manager_liverpool", "Jurgen", 0, ?, ?)', [now, now]);
  queryRun('INSERT OR IGNORE INTO users (id, telegram_id, username, first_name, is_admin, created_at, updated_at) VALUES ("user-aud-3", "903", "manager_realmadrid", "Carlo", 0, ?, ?)', [now, now]);
  
  queryRun('INSERT INTO club_memberships (id, user_id, club_id, season_id, status, claimed_at) VALUES ("mem-aud-1", "user-aud-1", "club-arsenal", "season-2026-27", "active", ?)', [now]);
  queryRun('INSERT INTO club_memberships (id, user_id, club_id, season_id, status, claimed_at) VALUES ("mem-aud-2", "user-aud-2", "club-liverpool", "season-2026-27", "active", ?)', [now]);
  queryRun('INSERT INTO club_memberships (id, user_id, club_id, season_id, status, claimed_at) VALUES ("mem-aud-3", "user-aud-3", "club-real-madrid", "season-2026-27", "active", ?)', [now]);

  const qualRes = await evaluateSeasonQualifications('season-2026-27');
  console.log(`Evaluated ${qualRes.qualifications.length} total spots. Added ${qualRes.participantsAdded} participants.`);
  const uclSpots = qualRes.qualifications.filter(e => e.targetCompetitionId === 'comp-champions-league-2026');
  console.log(`UCL spots count: ${uclSpots.length} (Expected 32: PL 7, LL 7, SA 6, BL 6, L1 6)`);
  
  const plSpots = uclSpots.filter(e => e.sourceCompetitionId === 'comp-premier-league-2026');
  const llSpots = uclSpots.filter(e => e.sourceCompetitionId === 'comp-la-liga-2026');
  const saSpots = uclSpots.filter(e => e.sourceCompetitionId === 'comp-serie-a-2026');
  const blSpots = uclSpots.filter(e => e.sourceCompetitionId === 'comp-bundesliga-2026');
  const l1Spots = uclSpots.filter(e => e.sourceCompetitionId === 'comp-ligue-1-2026');
  console.log(`Distribution: PL=${plSpots.length}, LL=${llSpots.length}, SA=${saSpots.length}, BL=${blSpots.length}, L1=${l1Spots.length}`);

  const uclParticipants = queryAll<any>(
    `SELECT cp.*, c.name as club_name, u.username as owner_username 
     FROM competition_participants cp 
     JOIN clubs c ON cp.club_id = c.id
     LEFT JOIN users u ON cp.owner_user_id = u.id
     WHERE cp.competition_id = "comp-champions-league-2026"
     ORDER BY cp.source_competition_id, cp.source_position`
  );

  console.log('\n--- 32 UCL PARTICIPANTS FROM DATABASE SNAPSHOT ---');
  uclParticipants.forEach((p, idx) => {
    console.log(`${idx + 1}. [${p.source_competition_id}] Pos #${p.source_position} | Club: ${p.club_name} (${p.club_id}) | Owner: ${p.owner_username || 'NULL'} | Status: ${p.owner_user_id ? 'ACTIVE' : 'INACTIVE'}`);
  });

  console.log('\n=== SECTION 3: UCL 32-TEAM LEAGUE PHASE SCHEDULE GENERATION & AUDIT ===');
  const uclClubIds = uclParticipants.map(p => p.club_id);
  const uclSchedule = generateEuropean32LeaguePhaseSchedule(uclClubIds);
  console.log(`Total UCL League Phase Fixtures: ${uclSchedule.length} (Expected 128: 32 clubs * 8 matches / 2)`);

  let allClubsValid = true;
  for (const clubId of uclClubIds) {
    const clubFixtures = uclSchedule.filter(f => f.homeClubId === clubId || f.awayClubId === clubId);
    const homeMatches = clubSchedule(uclSchedule, clubId, true);
    const awayMatches = clubSchedule(uclSchedule, clubId, false);
    const opponents = new Set<string>();
    clubFixtures.forEach(f => {
      const opp = f.homeClubId === clubId ? f.awayClubId : f.homeClubId;
      opponents.add(opp);
    });

    if (clubFixtures.length !== 8 || homeMatches.length !== 4 || awayMatches.length !== 4 || opponents.size !== 8) {
      allClubsValid = false;
      console.log(`❌ INVALID for ${clubId}: Total=${clubFixtures.length}, H=${homeMatches.length}, A=${awayMatches.length}, Distinct Opp=${opponents.size}`);
    }
  }
  if (allClubsValid) {
    console.log('✅ ALL 32 CLUBS HAVE EXACTLY 8 MATCHES (4 HOME, 4 AWAY) AGAINST 8 DISTINCT OPPONENTS.');
  }

  // Print sample for Arsenal
  const arsenalFixtures = uclSchedule.filter(f => f.homeClubId === 'club-arsenal' || f.awayClubId === 'club-arsenal');
  console.log(`\nSample Schedule for Arsenal (${arsenalFixtures.length} matches):`);
  arsenalFixtures.forEach(f => {
    const isHome = f.homeClubId === 'club-arsenal';
    console.log(`  MD ${f.matchday}: ${isHome ? 'HOME vs ' + f.awayClubId : 'AWAY at ' + f.homeClubId}`);
  });

  console.log('\n=== SECTION 4: UCL KNOCKOUT SEEDING VERIFICATION ===');
  queryRun('DELETE FROM fixtures WHERE competition_id = "comp-champions-league-2026" AND matchday >= 9');
  const koRes = await generateUCLKnockoutBracket('comp-champions-league-2026', uclClubIds);
  console.log(`Knockout generated: ${koRes.generated} fixtures (Play-offs: ${koRes.playoffFixtures}, R16: ${koRes.r16Fixtures})`);

  const playoffFixtures = queryAll<any>('SELECT * FROM fixtures WHERE competition_id = "comp-champions-league-2026" AND matchday = 9');
  console.log('Play-off Pairings (Rank 9..24):');
  playoffFixtures.forEach((f, idx) => {
    console.log(`  Play-off ${idx + 1}: ${f.home_club_id} (Unseeded / Lower rank) vs ${f.away_club_id} (Seeded / Higher rank)`);
  });

  const r16Fixtures = queryAll<any>('SELECT * FROM fixtures WHERE competition_id = "comp-champions-league-2026" AND matchday = 10');
  console.log('Round of 16 Matchups (Top 8 Direct Qualifiers seeded):');
  r16Fixtures.forEach((f, idx) => {
    console.log(`  R16 Match ${idx + 1}: ${f.home_club_id} (Direct Qualifier) vs ${f.away_club_id} (TBD Playoff Winner)`);
  });

  console.log('\n=== SECTION 5: OWNERSHIP API VERIFICATION ===');
  const plClubs = await getClubsByLeague('league-premier-league', 'season-2026-27');
  const arsenal = plClubs.find(c => c.id === 'club-arsenal');
  console.log('Arsenal Club Object from API:', JSON.stringify(arsenal, null, 2));
}

function clubSchedule(matchups: any[], clubId: string, home: boolean) {
  return matchups.filter(m => home ? m.homeClubId === clubId : m.awayClubId === clubId);
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
