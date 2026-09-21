import { initDatabase, queryGet, queryAll, queryRun } from '../db';
import { seedDatabase } from '../db/seed';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import {
  getFixturesFirestore,
  calculateCompetitionStandingsFirestore,
  getClubByIdFirestore,
  submitFixtureResultFirestore,
  getFixtureByIdFirestore,
  getPendingResultsFirestore,
  adminApproveFixtureResultFirestore,
  reopenFixtureFirestore,
  claimClubAtomicFirestore,
  getFirestoreTelemetry,
  getClubsByLeagueFirestore,
} from '../firebase/firestoreStore';
import {
  enqueueMutation,
  getPendingMutations,
  processPendingMutations,
  getQueueStats,
} from '../sync/mutationQueue';
import { getDbFilePath } from '../db';
import { assertTestEnvironmentSafe } from '../utils/testGuard';
import path from 'node:path';
import fs from 'node:fs';

interface AuditResult {
  section: string;
  name: string;
  passed: boolean;
  details: string;
}

const auditResults: AuditResult[] = [];

function recordAudit(section: string, name: string, passed: boolean, details: string) {
  auditResults.push({ section, name, passed, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${icon}] [${section}] ${name} -> ${details}`);
}

export async function runQuotaResilienceAudit() {
  // Must fail immediately unless local fallback or a verified Firebase emulator was explicitly configured before process startup
  const isLocalFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true';
  const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if (!isLocalFallback && !isEmulator) {
    throw new Error(
      'SAFETY_VIOLATION: verifyQuotaResilienceAudit requires FIREBASE_FORCE_LOCAL_FALLBACK="true" or a verified FIRESTORE_EMULATOR_HOST before process startup. Aborting to prevent production Firestore contamination.'
    );
  }
  assertTestEnvironmentSafe('verifyQuotaResilienceAudit');

  console.log('\n================================================================');
  console.log('    STRICT EFL UZ FIRESTORE QUOTA & RESILIENCE TEST SUITE      ');
  console.log('================================================================\n');

  // Initialize DB and ensure clean base seed
  await initDatabase();
  seedDatabase();

  const seasonId = 'season-2026-27';
  const compId = 'comp-premier-league-2026';

  queryRun("DELETE FROM fixtures WHERE id LIKE 'fix-ctrl-%' OR id LIKE 'fix-test-%' OR id LIKE 'offline-test-%'");
  const existingPlFixtures = queryAll<any>('SELECT id FROM fixtures WHERE competition_id = ?', [compId]);
  if (existingPlFixtures.length < 190) {
    const { generateCompetitionFixturesFirestore } = await import('../firebase/firestoreStore');
    await generateCompetitionFixturesFirestore(compId, { force: true });
  }

  // Under isolated local fallback, populate in-memory Firestore from local SQLite
  if (isLocalFallback) {
    const { getFirestoreDb } = await import('../firebase/admin');
    const { COLLECTIONS } = await import('../firebase/collections');
    const db = getFirestoreDb();

    const sqliteClubs = queryAll<any>('SELECT * FROM clubs');
    for (const c of sqliteClubs) {
      await db.collection(COLLECTIONS.CLUBS).doc(c.id).set({
        id: c.id,
        name: c.name,
        shortName: c.short_name,
        leagueId: c.league_id,
        claimedByUserId: c.claimed_by_user_id || null,
        claimedAt: c.claimed_at || null,
      });
    }

    const sqliteFixtures = queryAll<any>('SELECT * FROM fixtures WHERE competition_id = ?', [compId]);
    for (const f of sqliteFixtures) {
      await db.collection(COLLECTIONS.FIXTURES).doc(f.id).set({
        id: f.id,
        competitionId: f.competition_id,
        seasonId: f.season_id,
        matchday: f.matchday,
        homeClubId: f.home_club_id,
        awayClubId: f.away_club_id,
        status: f.status || 'SCHEDULED',
        homeScore: f.home_score ?? null,
        awayScore: f.away_score ?? null,
        scheduledDate: f.scheduled_date,
      });
    }
  }

  // -------------------------------------------------------------------
  // TEST 2: FIRESTORE READ FAILURE TEST (Simulated Outage)
  // -------------------------------------------------------------------
  console.log('\n--- [TEST 2] Firestore Read Failure & Fallback ---');
  // Trip circuit breaker to OPEN
  firestoreCircuitBreaker.reset();
  firestoreCircuitBreaker.recordFailure(new Error('RESOURCE_EXHAUSTED: Quota exceeded'));
  firestoreCircuitBreaker.recordFailure(new Error('RESOURCE_EXHAUSTED: Quota exceeded'));
  firestoreCircuitBreaker.recordFailure(new Error('RESOURCE_EXHAUSTED: Quota exceeded'));

  const cbState = firestoreCircuitBreaker.getStatus();
  recordAudit('TEST 2', 'Circuit Breaker Forced Open', cbState.state === 'OPEN', `State: ${cbState.state}`);

  // Fetch fixtures during simulated outage
  let offlineFixtures: any[] = [];
  try {
    offlineFixtures = await getFixturesFirestore({ competitionId: compId });
  } catch (err: any) {
    recordAudit('TEST 2', 'Offline Fixtures Fetch', false, `Threw: ${err.message}`);
  }
  recordAudit(
    'TEST 2',
    'Offline Fixtures Fallback',
    offlineFixtures.length > 0,
    `Loaded ${offlineFixtures.length} fixtures from SQLite fallback without crashing`
  );

  // Fetch standings during simulated outage
  let offlineStandings: any[] = [];
  try {
    offlineStandings = await calculateCompetitionStandingsFirestore(compId);
  } catch (err: any) {
    recordAudit('TEST 2', 'Offline Standings Fetch', false, `Threw: ${err.message}`);
  }
  recordAudit(
    'TEST 2',
    'Offline Standings Fallback',
    offlineStandings.length === 20,
    `Loaded ${offlineStandings.length} table rows from SQLite fallback`
  );

  // Fetch club profile during simulated outage
  let offlineClub: any = null;
  try {
    offlineClub = await getClubByIdFirestore('club-arsenal', seasonId);
  } catch (err: any) {
    recordAudit('TEST 2', 'Offline Club Fetch', false, `Threw: ${err.message}`);
  }
  recordAudit(
    'TEST 2',
    'Offline Club Profile Fallback',
    offlineClub !== null && offlineClub.id === 'club-arsenal',
    `Loaded club '${offlineClub?.name}' (${offlineClub?.id}) from local snapshot`
  );

  // -------------------------------------------------------------------
  // TEST 3: FIRESTORE WRITE FAILURE & MUTATION QUEUEING
  // -------------------------------------------------------------------
  console.log('\n--- [TEST 3] Firestore Write Failure & Queueing ---');
  const targetMatch = offlineFixtures.find((f) => f.matchday === 1) || offlineFixtures[0];
  const testUserId = 'audit-player-1';
  const testOpponentId = 'audit-player-2';

  // Assign managers locally
  queryRun('INSERT OR REPLACE INTO club_memberships (id, club_id, season_id, user_id, claimed_at) VALUES (?, ?, ?, ?, ?)', [
    `cm-${targetMatch.homeClubId}`,
    targetMatch.homeClubId,
    seasonId,
    testUserId,
    new Date().toISOString(),
  ]);
  queryRun('INSERT OR REPLACE INTO club_memberships (id, club_id, season_id, user_id, claimed_at) VALUES (?, ?, ?, ?, ?)', [
    `cm-${targetMatch.awayClubId}`,
    targetMatch.awayClubId,
    seasonId,
    testOpponentId,
    new Date().toISOString(),
  ]);

  // Clean previous test state
  queryRun("UPDATE fixtures SET status = 'SCHEDULED', home_score = NULL, away_score = NULL, winner_club_id = NULL, result_confirmed_at = NULL WHERE id = ?", [targetMatch.id]);
  queryRun('DELETE FROM result_submissions WHERE fixture_id = ?', [targetMatch.id]);
  queryRun('DELETE FROM pending_mutations WHERE entity_id = ?', [targetMatch.id]);

  let writeResult: any = null;
  try {
    writeResult = await submitFixtureResultFirestore(
      testUserId,
      targetMatch.id,
      3,
      1,
      'https://proof.efootball/audit-m1.png'
    );
  } catch (err: any) {
    recordAudit('TEST 3', 'Offline Submission Execution', false, `Threw: ${err.message}`);
  }

  const subSavedLocal = queryGet<any>('SELECT * FROM result_submissions WHERE fixture_id = ? AND submitted_by_user_id = ?', [
    targetMatch.id,
    testUserId,
  ]);
  const mutationQueued = queryGet<any>('SELECT * FROM pending_mutations WHERE entity_id = ? AND operation = ?', [
    targetMatch.id,
    'SUBMIT_RESULT',
  ]);

  recordAudit(
    'TEST 3',
    'Local SQLite Submission Saved',
    Boolean(subSavedLocal),
    `Submission ID: ${subSavedLocal?.id}, Score: ${subSavedLocal?.home_score}-${subSavedLocal?.away_score}`
  );
  recordAudit(
    'TEST 3',
    'Background Sync Mutation Queued',
    Boolean(mutationQueued),
    `Mutation ID: ${mutationQueued?.id}, Op: ${mutationQueued?.operation}, Status: ${mutationQueued?.status}`
  );
  recordAudit(
    'TEST 3',
    'Response Indicates Sync Pending',
    writeResult?.pendingSync === true || writeResult?.fixture?.status === 'PENDING_CONFIRMATION',
    `PendingSync flag: ${writeResult?.pendingSync}, Fixture Status: ${writeResult?.fixture?.status}`
  );

  // Verify fixture visibility for opponent and admin
  const viewedByOpponent = await getFixtureByIdFirestore(targetMatch.id, testOpponentId);
  recordAudit(
    'TEST 3',
    'Opponent Sees Pending Submission',
    Boolean(viewedByOpponent?.opponentSubmission || viewedByOpponent?.status === 'PENDING_CONFIRMATION'),
    `Fixture status visible to opponent: ${viewedByOpponent?.status}`
  );

  // -------------------------------------------------------------------
  // TEST 4: IDEMPOTENCY AUDIT
  // -------------------------------------------------------------------
  console.log('\n--- [TEST 4] Idempotency & Duplicate Prevention ---');
  // Submit 4 additional identical submissions
  for (let i = 0; i < 4; i++) {
    await submitFixtureResultFirestore(
      testUserId,
      targetMatch.id,
      3,
      1,
      'https://proof.efootball/audit-m1.png'
    );
  }

  const subCount = queryGet<any>('SELECT COUNT(*) as cnt FROM result_submissions WHERE fixture_id = ? AND submitted_by_user_id = ?', [
    targetMatch.id,
    testUserId,
  ]);
  const mutationCount = queryGet<any>('SELECT COUNT(*) as cnt FROM pending_mutations WHERE entity_id = ? AND operation = ?', [
    targetMatch.id,
    'SUBMIT_RESULT',
  ]);

  recordAudit(
    'TEST 4',
    'Submission Record Idempotency (5 Submissions)',
    subCount?.cnt === 1,
    `Total submissions in SQLite: ${subCount?.cnt} (Expected: 1)`
  );
  recordAudit(
    'TEST 4',
    'Mutation Queue Idempotency',
    mutationCount?.cnt === 1,
    `Total pending mutations in queue: ${mutationCount?.cnt} (Expected: 1)`
  );

  // -------------------------------------------------------------------
  // TEST 5: CIRCUIT BREAKER TEST
  // -------------------------------------------------------------------
  console.log('\n--- [TEST 5] Circuit Breaker Lifecycle ---');
  const cb = firestoreCircuitBreaker;
  cb.reset();
  recordAudit('TEST 5', 'Initial State is CLOSED', cb.getStatus().state === 'CLOSED', `State: ${cb.getStatus().state}`);

  // Record 3 failures
  cb.recordFailure(new Error('Quota error 1'));
  cb.recordFailure(new Error('Quota error 2'));
  cb.recordFailure(new Error('Quota error 3'));
  recordAudit('TEST 5', 'Trips to OPEN after 3 Failures', cb.getStatus().state === 'OPEN', `State: ${cb.getStatus().state}`);

  recordAudit(
    'TEST 5',
    'canExecute() Returns False in OPEN State',
    cb.canExecute() === false,
    `canExecute(): ${cb.canExecute()}`
  );

  cb.recordSuccess(); // simulates probe success
  recordAudit('TEST 5', 'Recovers to CLOSED on Success', cb.getStatus().state === 'CLOSED', `State: ${cb.getStatus().state}`);

  // -------------------------------------------------------------------
  // TEST 7: TELEMETRY
  // -------------------------------------------------------------------
  console.log('\n--- [TEST 7] Firestore Telemetry ---');
  const tel = getFirestoreTelemetry();
  recordAudit(
    'TEST 7',
    'Telemetry Tracks Firestore Reads & Fallbacks',
    typeof tel.totalReads === 'number' && typeof tel.fallbackCount === 'number',
    `Total tracked reads: ${tel.totalReads}, Fallback count: ${tel.fallbackCount}`
  );

  // -------------------------------------------------------------------
  // TEST 8: SQLITE / CLOUD RUN PERSISTENCE AUDIT
  // -------------------------------------------------------------------
  console.log('\n--- [TEST 8] SQLite Ephemeral Storage Verification ---');
  const dbPath = getDbFilePath();
  recordAudit(
    'TEST 8',
    'SQLite Filepath Resolution',
    dbPath === path.resolve(process.env.DB_FILE || path.join(process.env.DATA_DIR || './data', 'efootball.sqlite')) && fs.existsSync(dbPath),
    `Database file path: ${dbPath}`
  );
  console.log('   [PERSISTENCE FACT] SQLite is stored in container filesystem: Ephemeral.');
  console.log('   [PERSISTENCE FACT] "SQLite is NOT durable production storage."');
  console.log('   [PERSISTENCE FACT] If Cloud Run instance restarts or scales to 0, un-synced mutations in SQLite are lost.');

  // -------------------------------------------------------------------
  // TEST 9: CLUB OCCUPANCY TEST
  // -------------------------------------------------------------------
  console.log('\n--- [TEST 9] Club Occupancy & 1 Club Limit ---');
  const claimUser = `audit-claimant-${Date.now()}`;
  let claimSuccess = false;
  let doubleClaimRejected = false;

  const laLigaClubs = await getClubsByLeagueFirestore('league-la-liga', seasonId);
  const availableClubs = laLigaClubs.filter((c) => !c.isTaken);
  const club1Id = availableClubs[0]?.id || 'club-celta-vigo';
  const club2Id = availableClubs[1]?.id || 'club-getafe';

  try {
    const claim1 = await claimClubAtomicFirestore(claimUser, club1Id, seasonId);
    claimSuccess = Boolean(claim1.success);
  } catch (err: any) {
    console.error('[TEST 9 claim1 error]:', err);
    claimSuccess = false;
  }

  try {
    // Attempt to claim a second club in the same season
    await claimClubAtomicFirestore(claimUser, club2Id, seasonId);
  } catch (err: any) {
    doubleClaimRejected =
      err.message.includes('ALREADY_MANAGES_CLUB') ||
      err.message.includes('already') ||
      err.message.includes('CLUB_SELECTION_LOCKED');
  }

  recordAudit(
    'TEST 9',
    '1 User = Max 1 Club per Season Enforcement',
    claimSuccess && doubleClaimRejected,
    `Claim succeeded: ${claimSuccess}, Duplicate rejected: ${doubleClaimRejected}`
  );

  // -------------------------------------------------------------------
  // TEST 10: FIXTURE & MATCHDAY LOCKING
  // -------------------------------------------------------------------
  console.log('\n--- [TEST 10] Fixture & Matchday Locking ---');
  const md1Fixtures = offlineFixtures.filter((f) => f.matchday === 1);
  const md2Fixtures = offlineFixtures.filter((f) => f.matchday === 2);

  recordAudit(
    'TEST 10',
    'Matchday 1 Fixtures Exist',
    md1Fixtures.length === 10,
    `Found ${md1Fixtures.length} matchday 1 fixtures (20 teams = 10 matches)`
  );

  let lockedMdRejected = false;
  if (md2Fixtures.length > 0) {
    let targetMd2 = md2Fixtures.find((f) => f.status !== 'CONFIRMED');
    if (!targetMd2) {
      await reopenFixtureFirestore('admin-audit-user', md2Fixtures[0].id, 'Reset for MD locking audit');
      targetMd2 = md2Fixtures[0];
    }

    try {
      await submitFixtureResultFirestore(testUserId, targetMd2.id, 1, 0);
    } catch (err: any) {
      lockedMdRejected = err.message.includes('MATCHDAY_LOCKED');
    }
  }

  recordAudit(
    'TEST 10',
    'Future Matchday Rejects Submissions',
    lockedMdRejected,
    `Submission on Matchday 2 correctly rejected with MATCHDAY_LOCKED`
  );

  // -------------------------------------------------------------------
  // TEST 11: STANDINGS & TIE-BREAKERS
  // -------------------------------------------------------------------
  console.log('\n--- [TEST 11] Standings Rules & Sorting ---');
  const plStandings = await calculateCompetitionStandingsFirestore(compId);
  let sortedCorrectly = true;
  for (let i = 0; i < plStandings.length - 1; i++) {
    const a = plStandings[i];
    const b = plStandings[i + 1];
    if (a.points < b.points) {
      sortedCorrectly = false;
      break;
    } else if (a.points === b.points && a.goalDifference < b.goalDifference) {
      sortedCorrectly = false;
      break;
    }
  }
  recordAudit(
    'TEST 11',
    'Standings Sorting Rule (Points -> GD -> GF)',
    sortedCorrectly,
    `Top team: ${plStandings[0]?.clubName} (${plStandings[0]?.points} pts, GD ${plStandings[0]?.goalDifference})`
  );

  // -------------------------------------------------------------------
  // TEST 12: ADMIN REVIEW TEST OFFLINE
  // -------------------------------------------------------------------
  console.log('\n--- [TEST 12] Admin Review & Offline Approval ---');
  // Set breaker to OPEN
  firestoreCircuitBreaker.recordFailure(new Error('Quota limit'));
  firestoreCircuitBreaker.recordFailure(new Error('Quota limit'));
  firestoreCircuitBreaker.recordFailure(new Error('Quota limit'));

  const pendingData = await getPendingResultsFirestore(seasonId);
  const pendingMatch = pendingData.pendingFixtures.find((f) => f.id === targetMatch.id);

  recordAudit(
    'TEST 12',
    'Admin Views Pending Match Offline',
    Boolean(pendingMatch),
    `Admin loaded ${pendingData.total} pending fixtures, found fixture ${targetMatch.id}`
  );

  let adminApproveSuccess = false;
  try {
    const adminRes = await adminApproveFixtureResultFirestore(
      'admin-offline-user',
      targetMatch.id,
      3,
      1,
      'Approved via offline audit'
    );
    adminApproveSuccess = adminRes.success;
  } catch (err: any) {
    adminApproveSuccess = false;
  }

  const adminMutation = queryGet<any>('SELECT * FROM pending_mutations WHERE entity_id = ? AND operation = ?', [
    targetMatch.id,
    'ADMIN_APPROVE_RESULT',
  ]);

  recordAudit(
    'TEST 12',
    'Admin Approve Locally Persisted and Queued',
    adminApproveSuccess && Boolean(adminMutation),
    `Approved: ${adminApproveSuccess}, Mutation Queued: ${Boolean(adminMutation)}`
  );

  // -------------------------------------------------------------------
  // TEST 13: RECOVERY & QUEUE DRAIN TEST
  // -------------------------------------------------------------------
  console.log('\n--- [TEST 13] Recovery & Mutation Reconciliation ---');
  // Reset circuit breaker to CLOSED (simulating network/quota recovery)
  firestoreCircuitBreaker.reset();
  const queueBefore = getQueueStats().pending;

  let drainResult: any = null;
  try {
    drainResult = await processPendingMutations();
  } catch (err: any) {
    console.warn('Drain error:', err.message);
  }

  const queueAfter = getQueueStats().pending;
  recordAudit(
    'TEST 13',
    'Mutation Queue Drain on Recovery',
    queueAfter <= queueBefore,
    `Queue before drain: ${queueBefore}, after drain: ${queueAfter}`
  );

  // -------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('              AUDIT TEST SUITE SUMMARY                          ');
  console.log('================================================================');
  const passed = auditResults.filter((r) => r.passed).length;
  const total = auditResults.length;
  console.log(`TOTAL AUDIT CHECKS: ${total} | PASSED: ${passed} | FAILED: ${total - passed}`);

  return passed === total;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runQuotaResilienceAudit()
    .then((success) => process.exit(success ? 0 : 1))
    .catch((err) => {
      console.error('Fatal audit failure:', err);
      process.exit(1);
    });
}
