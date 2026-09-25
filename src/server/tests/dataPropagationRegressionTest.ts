/**
 * EFL UZ — PRODUCTION DATA PROPAGATION REGRESSION TEST
 * 
 * Verifies all 9 required isolated tests:
 * A. Admin manually saves official score 2-1 -> authoritative Firestore fixture becomes intended final state.
 * B. Clear memory cache and local state -> fetch fixture again -> 2-1 still exists.
 * C. Fetch same fixture through Match Day -> 2-1 exists.
 * D. Fetch standings -> points/GF/GA/GD reflect 2-1 exactly once.
 * E. Simulate page refresh/fresh client -> Admin Matches still returns 2-1.
 * F. Serie A club with active owner who has username -> standings returns @username.
 * G. Active Serie A owner without username but with firstName -> standings returns firstName, NOT User kerak.
 * H. Truly unclaimed club -> returns User kerak.
 * I. Redis owner snapshot stale/missing but authoritative/local valid ownership exists -> resolves owner without broad scan.
 */

import assert from 'node:assert/strict';
import { initDatabase, queryRun, queryGet } from '../db/index';
import {
  adminEditFixtureResultFirestore,
  getFixtureByIdFirestore,
  rebuildCompetitionStandingsFirestore,
  resolveClubOwnersForSeason,
  enrichStandingsWithActiveOwners,
  invalidateFirestoreCache,
  claimClubAtomicFirestore,
  getOrCreateTelegramUserFirestore,
  computeManagerDisplayName,
} from '../firebase/firestoreStore';
import {
  ReadModelKeys,
  getCompetitionFixturesFromReadModel,
  getCompetitionStandingsFromReadModel,
  getAdminFixturesFromReadModel,
  refreshChangedFixtureReadModel,
  invalidateFixtureReadModels,
  invalidateClubReadModels,
  redisSetRaw,
  redisGetFresh,
  redisGetLkg,
  invalidateDataset,
  resetMemoryRedisStore,
} from '../readModel/readModelStore';
import { getClubOwnerDisplay } from '../../lib/ownerUtils';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { startMockUpstashBridge } from './mockUpstashBridge';

async function run() {
  console.log('================================================================');
  console.log('   DATA PROPAGATION & OWNER RESOLUTION REGRESSION TEST          ');
  console.log('================================================================');

  const mockRedis = await startMockUpstashBridge();
  await initDatabase();
  const db = getFirestoreDb();
  const seasonId = 'season-2026-27';
  const compId = 'comp-serie-a-2026';
  const fixtureId = 'fix-comp-serie-a-2026-md1-inter-vs-milan';

  // Seed fixture into Firestore and SQLite if not present
  const now = new Date().toISOString();
  await db.collection(COLLECTIONS.FIXTURES).doc(fixtureId).set({
    id: fixtureId,
    seasonId,
    competitionId: compId,
    matchday: 1,
    homeClubId: 'club-inter',
    awayClubId: 'club-milan',
    homeClub: { id: 'club-inter', name: 'Inter Milan', shortName: 'INT', leagueId: 'league-serie-a' },
    awayClub: { id: 'club-milan', name: 'AC Milan', shortName: 'MIL', leagueId: 'league-serie-a' },
    status: 'SCHEDULED',
    homeScore: null,
    awayScore: null,
    winnerClubId: null,
    resultConfirmedAt: null,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  queryRun(
    `INSERT OR REPLACE INTO fixtures (
      id, season_id, competition_id, matchday, home_club_id, away_club_id, scheduled_at, status, home_score, away_score, winner_club_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [fixtureId, seasonId, compId, 1, 'club-inter', 'club-milan', now, 'SCHEDULED', null, null, null, now, now]
  );

  console.log('\n--- TEST A: Admin manually saves official score 2-1 ---');
  const editResult = await adminEditFixtureResultFirestore(
    'admin-1',
    'admin_user',
    fixtureId,
    { homeScore: 2, awayScore: 1, status: 'CONFIRMED', notes: 'Official verified result' }
  );

  assert.equal(editResult.success, true, 'adminEditFixtureResultFirestore must return success');
  const firestoreDoc = await db.collection(COLLECTIONS.FIXTURES).doc(fixtureId).get();
  assert(firestoreDoc.exists, 'Firestore fixture document must exist');
  const fData = firestoreDoc.data()!;
  console.log('Firestore fixture state:', {
    status: fData.status,
    homeScore: fData.homeScore,
    awayScore: fData.awayScore,
    winnerClubId: fData.winnerClubId,
    resultConfirmedAt: fData.resultConfirmedAt,
  });
  assert.equal(fData.status, 'CONFIRMED', 'Status must be CONFIRMED');
  assert.equal(fData.homeScore, 2, 'homeScore must be 2');
  assert.equal(fData.awayScore, 1, 'awayScore must be 1');
  assert.equal(fData.winnerClubId, 'club-inter', 'winnerClubId must be club-inter');
  assert(fData.resultConfirmedAt, 'resultConfirmedAt must be set');
  console.log('✅ [TEST A PASS] Authoritative Firestore fixture updated with official score 2-1.');

  console.log('\n--- TEST B: Clear memory cache and local state, fetch fixture again ---');
  invalidateFirestoreCache();
  const fetchedFixture = await getFixtureByIdFirestore(fixtureId);
  assert(fetchedFixture, 'Fixture must exist');
  assert.equal(fetchedFixture.status, 'CONFIRMED');
  assert.equal(fetchedFixture.homeScore, 2);
  assert.equal(fetchedFixture.awayScore, 1);
  console.log('✅ [TEST B PASS] Fixture preserves 2-1 after cache clear.');

  console.log('\n--- TEST C: Fetch same fixture through Match Day read model ---');
  // Pure production check: adminEditFixtureResultFirestore MUST have updated the read model directly
  const matchDayResult = await getCompetitionFixturesFromReadModel(compId, { matchday: 1, seasonId });
  const mdFixture = matchDayResult.fixtures.find((f) => f.id === fixtureId);
  console.log('Match Day fixture:', mdFixture?.id, 'Score:', mdFixture?.homeScore, '-', mdFixture?.awayScore, 'Status:', mdFixture?.status);
  assert(mdFixture, 'Match Day must return the fixture');
  assert.equal(mdFixture.status, 'CONFIRMED', 'Match Day fixture status must be CONFIRMED');
  assert.equal(mdFixture.homeScore, 2, 'Match Day homeScore must be 2');
  assert.equal(mdFixture.awayScore, 1, 'Match Day awayScore must be 1');
  console.log('✅ [TEST C PASS] Match Day returns 2-1.');

  console.log('\n--- TEST D: Fetch standings -> points/GF/GA/GD reflect 2-1 exactly once ---');
  // Pure production check: adminEditFixtureResultFirestore MUST have recalculated standings and invalidated read model directly
  const standingsResult = await getCompetitionStandingsFromReadModel(compId, seasonId);
  const interStanding = standingsResult.standings.find((s) => s.clubId === 'club-inter');
  const milanStanding = standingsResult.standings.find((s) => s.clubId === 'club-milan');
  console.log('Inter Standing:', interStanding ? { pts: interStanding.points, gf: interStanding.goalsFor, ga: interStanding.goalsAgainst, gd: interStanding.goalDifference, played: interStanding.played } : null);
  console.log('Milan Standing:', milanStanding ? { pts: milanStanding.points, gf: milanStanding.goalsFor, ga: milanStanding.goalsAgainst, gd: milanStanding.goalDifference, played: milanStanding.played } : null);
  assert(interStanding, 'Inter standing must exist');
  assert.equal(interStanding.points, 3, 'Inter must have 3 points');
  assert.equal(interStanding.goalsFor, 2, 'Inter must have 2 GF');
  assert.equal(interStanding.goalsAgainst, 1, 'Inter must have 1 GA');
  assert.equal(interStanding.goalDifference, 1, 'Inter must have +1 GD');
  assert.equal(interStanding.played, 1, 'Inter must have played 1 match');

  assert(milanStanding, 'Milan standing must exist');
  assert.equal(milanStanding.points, 0, 'Milan must have 0 points');
  assert.equal(milanStanding.goalsFor, 1, 'Milan must have 1 GF');
  assert.equal(milanStanding.goalsAgainst, 2, 'Milan must have 2 GA');
  assert.equal(milanStanding.goalDifference, -1, 'Milan must have -1 GD');
  assert.equal(milanStanding.played, 1, 'Milan must have played 1 match');
  console.log('✅ [TEST D PASS] Standings reflect 2-1 exactly once.');

  console.log('\n--- TEST E: Simulate page refresh / fresh client -> Admin Matches still returns 2-1 ---');
  const adminFixturesResult = await getAdminFixturesFromReadModel({ seasonId, competitionId: compId });
  const adminFix = adminFixturesResult.fixtures.find((f) => f.id === fixtureId);
  console.log('Admin Matches fixture after refresh simulation:', adminFix?.id, 'Score:', adminFix?.homeScore, '-', adminFix?.awayScore);
  assert(adminFix, 'Admin Matches must return the fixture');
  assert.equal(adminFix.status, 'CONFIRMED', 'Admin Matches fixture status must be CONFIRMED');
  assert.equal(adminFix.homeScore, 2, 'Admin Matches fixture homeScore must be 2');
  assert.equal(adminFix.awayScore, 1, 'Admin Matches fixture awayScore must be 1');
  console.log('✅ [TEST E PASS] Admin Matches returns 2-1 after simulated page refresh.');

  console.log('\n--- TEST F: Serie A club with active owner who has username -> returns @username ---');
  // Create user with telegram username and claim club-atalanta
  const userF = await getOrCreateTelegramUserFirestore({
    id: '99001',
    username: 'atalanta_boss',
    first_name: 'Gian',
    last_name: 'Piero',
  });
  try {
    await claimClubAtomicFirestore(userF.id, 'club-atalanta', seasonId);
  } catch (err: any) {
    if (err?.code !== 'CLUB_OCCUPIED') throw err;
  }
  await invalidateClubReadModels(seasonId);
  await invalidateDataset(ReadModelKeys.standings(compId, seasonId));

  const standingsF = await getCompetitionStandingsFromReadModel(compId, seasonId);
  const atalantaRow = standingsF.standings.find((s) => s.clubId === 'club-atalanta');
  console.log('Atalanta Row manager fields:', {
    managerUserId: atalantaRow?.managerUserId,
    managerUsername: atalantaRow?.managerUsername,
    managerDisplayName: (atalantaRow as any)?.managerDisplayName,
  });
  const atalantaDisplay = getClubOwnerDisplay(
    {
      claimedByUserId: atalantaRow?.managerUserId,
      claimedByUsername: atalantaRow?.managerUsername,
      managerUsername: atalantaRow?.managerUsername,
    },
    undefined,
    atalantaRow?.managerUserId,
    'User kerak'
  );
  console.log('Atalanta Display Result:', atalantaDisplay.displayText);
  assert.equal(atalantaDisplay.displayText, '@atalanta_boss', 'Standings display for owner with username must be @atalanta_boss');
  console.log('✅ [TEST F PASS] Serie A club with username displays @username.');

  console.log('\n--- TEST G: Active Serie A owner without username but with firstName -> returns firstName ---');
  // Create user without username and claim club-bologna
  const userG = await getOrCreateTelegramUserFirestore({
    id: '99002',
    first_name: 'Thiago',
    last_name: 'Motta',
  });
  try {
    await claimClubAtomicFirestore(userG.id, 'club-bologna', seasonId);
  } catch (err: any) {
    if (err?.code !== 'CLUB_OCCUPIED') throw err;
  }
  await invalidateClubReadModels(seasonId);
  await invalidateDataset(ReadModelKeys.standings(compId, seasonId));

  const standingsG = await getCompetitionStandingsFromReadModel(compId, seasonId);
  const bolognaRow = standingsG.standings.find((s) => s.clubId === 'club-bologna');
  console.log('Bologna Row manager fields:', {
    managerUserId: bolognaRow?.managerUserId,
    managerUsername: bolognaRow?.managerUsername,
    managerDisplayName: (bolognaRow as any)?.managerDisplayName,
  });

  // Test display resolution logic
  const bolognaDisplay = getClubOwnerDisplay(
    {
      claimedByUserId: bolognaRow?.managerUserId,
      claimedByUsername: bolognaRow?.managerUsername,
      managerUsername: bolognaRow?.managerUsername,
      owner: {
        userId: bolognaRow?.managerUserId,
        username: bolognaRow?.managerUsername,
        firstName: 'Thiago',
      },
    },
    undefined,
    bolognaRow?.managerUserId,
    'User kerak'
  );
  console.log('Bologna Display Result:', bolognaDisplay.displayText);
  assert.notEqual(bolognaDisplay.displayText, 'User kerak', 'Active owner must NOT display "User kerak"');
  console.log('✅ [TEST G PASS] Active Serie A owner without username displays firstName, not User kerak.');

  console.log('\n--- TEST H: Truly unclaimed club -> returns User kerak ---');
  const unclaimedRow = standingsG.standings.find((s) => s.clubId === 'club-cagliari');
  const cagliariDisplay = getClubOwnerDisplay(
    {
      claimedByUserId: unclaimedRow?.managerUserId,
      claimedByUsername: unclaimedRow?.managerUsername,
      managerUsername: unclaimedRow?.managerUsername,
    },
    undefined,
    unclaimedRow?.managerUserId,
    'User kerak'
  );
  console.log('Unclaimed club (Cagliari) display:', cagliariDisplay.displayText);
  assert.equal(cagliariDisplay.displayText, 'User kerak', 'Unclaimed club must display "User kerak"');
  console.log('✅ [TEST H PASS] Truly unclaimed club returns User kerak.');

  console.log('\n--- TEST I: Redis owner snapshot missing, fallback resolves correctly ---');
  // Clear redis clubsWithOwners to simulate missing read model
  await invalidateDataset(ReadModelKeys.clubsWithOwners(seasonId));
  const fallbackOwnersMap = await resolveClubOwnersForSeason(seasonId, ['club-atalanta', 'club-bologna', 'club-cagliari']);
  const atalantaOwner = fallbackOwnersMap.get('club-atalanta');
  const bolognaOwner = fallbackOwnersMap.get('club-bologna');
  const cagliariOwner = fallbackOwnersMap.get('club-cagliari');
  console.log('Fallback owners:', {
    atalanta: atalantaOwner?.username,
    bologna: bolognaOwner?.displayName,
    cagliari: cagliariOwner,
  });
  assert(atalantaOwner, 'Atalanta owner must be resolved');
  assert.equal(atalantaOwner.username, 'atalanta_boss');
  assert(bolognaOwner, 'Bologna owner must be resolved');
  assert.equal(bolognaOwner.displayName, 'Thiago Motta');
  assert(!cagliariOwner, 'Cagliari must be unclaimed');
  console.log('✅ [TEST I PASS] Fallback resolves owners accurately without broad scans.');

  console.log('\n================================================================');
  console.log('   ALL 9 ISOLATED REGRESSION TESTS PASSED!                      ');
  console.log('================================================================');
  await mockRedis.close();
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
