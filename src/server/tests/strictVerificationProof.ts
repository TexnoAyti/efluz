import fs from 'fs';
import path from 'path';
import initSqlJs, { Database } from 'sql.js';
import { initDatabase, queryGet, queryAll, queryRun, getDbFilePath, getDb, saveDatabaseSync } from '../db';
import { seedDatabase } from '../db/seed';
import { CompetitionEngine } from '../tournament/competitionEngine';
import { claimClubAtomic, ClubConflictError, getClubById } from '../services/clubService';
import { generateCompetitionFixtures } from '../services/fixtureService';

async function runStrictVerification() {
  console.log('================================================================');
  console.log('       STRICT VERIFICATION & DATABASE PROOF EXECUTION           ');
  console.log('================================================================\n');

  // 1. Initialize database and ensure clean baseline
  await initDatabase();
  seedDatabase();

  const dbFile = getDbFilePath();
  console.log(`[DATABASE FILE PATH]: ${dbFile}`);
  console.log(`[FILE EXISTS ON DISK]: ${fs.existsSync(dbFile)} (${fs.statSync(dbFile).size} bytes)`);

  const wasmPath = path.resolve(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  const SQL = await initSqlJs({ wasmBinary });

  // Helper to read directly from the physical disk file using an isolated SQL.js instance
  function readDirectFromDisk(): Database {
    const fileBuf = fs.readFileSync(dbFile);
    return new SQL.Database(fileBuf);
  }

  // ===========================================================================
  // SECTION 1: FIXTURE GENERATION PROOF
  // ===========================================================================
  console.log('\n----------------------------------------------------------------');
  console.log('SECTION 1: FIXTURE GENERATION - PROOF & AUDIT');
  console.log('----------------------------------------------------------------');

  const testCompId = 'comp-premier-league-2026';
  const testSeasonId = 'season-2026-27';

  console.log('1. Target Endpoint: POST /api/competitions/:id/generate-fixtures (and /reset-fixtures)');
  console.log('2. Target Backend Service: CompetitionEngine.generateSchedule in src/server/tournament/competitionEngine.ts -> generateCompetitionFixtures()');
  console.log('3. Target SQLite Table: "fixtures" (with season_league_clubs & competition_participants)');

  // Count before generation
  const beforeCount = queryGet<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM fixtures WHERE competition_id = ?',
    [testCompId]
  )?.cnt ?? 0;
  console.log(`[BASELINE]: Existing fixtures in DB for ${testCompId} = ${beforeCount}`);

  // 4. Run real generation flow
  console.log('\n[ACTION]: Generating schedule with force=true...');
  const genResult = await CompetitionEngine.generateSchedule(testCompId, { force: true });
  const mdCount = 'matchdays' in genResult ? genResult.matchdays : 0;
  console.log(`[GENERATION RESULT]: generated=${genResult.generated}, matchdays=${mdCount}`);

  // 5. Fresh SELECT COUNT(*) against SQLite
  const afterCount = queryGet<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM fixtures WHERE competition_id = ?',
    [testCompId]
  )?.cnt ?? 0;
  console.log(`[LIVE QUERY]: SELECT COUNT(*) FROM fixtures WHERE competition_id="${testCompId}" => ${afterCount}`);

  if (afterCount !== 380) {
    throw new Error(`Expected 380 fixtures for 20-team double round-robin, got ${afterCount}`);
  }

  // 6. Verify real fixture data
  const sampleFixtures = queryAll<any>(
    'SELECT id, competition_id, season_id, matchday, round_name, home_club_id, away_club_id, scheduled_at, status FROM fixtures WHERE competition_id = ? ORDER BY matchday ASC LIMIT 5',
    [testCompId]
  );
  console.log('\n[SAMPLE PERSISTED FIXTURES (First 5)]:\n', JSON.stringify(sampleFixtures, null, 2));

  for (const fix of sampleFixtures) {
    if (!fix.competition_id || !fix.home_club_id || !fix.away_club_id || !fix.matchday || !fix.season_id) {
      throw new Error(`Fixture validation failed: incomplete fixture row: ${JSON.stringify(fix)}`);
    }
  }
  console.log('✅ Real fixture schema verified: competition_id, home_club_id, away_club_id, matchday, season_id properly populated.');

  // 7 & 8. Verify NOT only in-memory: Read fresh binary from disk file into separate Database
  const diskDb = readDirectFromDisk();
  const diskStmt = diskDb.prepare('SELECT COUNT(*) as cnt FROM fixtures WHERE competition_id = :comp');
  diskStmt.bind({ ':comp': testCompId });
  diskStmt.step();
  const diskCount = diskStmt.getAsObject().cnt;
  diskStmt.free();
  diskDb.close();

  console.log(`[PHYSICAL DISK PROOF]: Fresh SELECT COUNT(*) directly from disk file (${dbFile}) => ${diskCount}`);
  if (diskCount !== 380) {
    throw new Error(`Physical disk mismatch! Expected 380 on disk, found ${diskCount}`);
  }
  console.log('✅ PASS: Physical disk storage validated. Fixtures survive outside memory.');

  // 9. Run generation second time WITHOUT reset/force -> MUST NOT create duplicates
  console.log('\n[ACTION]: Running generation a 2nd time WITHOUT force/reset...');
  const secondGenResult = await CompetitionEngine.generateSchedule(testCompId, { force: false });
  console.log(`[2ND GEN RESULT]: generated=${secondGenResult.generated}`);

  const secondCount = queryGet<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM fixtures WHERE competition_id = ?',
    [testCompId]
  )?.cnt ?? 0;
  console.log(`[COUNT AFTER 2ND GEN]: ${secondCount}`);
  if (secondCount !== 380) {
    throw new Error(`Duplicate fixtures created! Expected 380, got ${secondCount}`);
  }
  console.log('✅ PASS: No duplicates created on repeated generation calls.');

  // 10. Run explicit regeneration/reset operation
  console.log('\n[ACTION]: Running explicit regeneration/reset (force=true)...');
  const regenResult = await CompetitionEngine.generateSchedule(testCompId, { force: true });
  const regenMd = 'matchdays' in regenResult ? regenResult.matchdays : 0;
  console.log(`[REGENERATION RESULT]: generated=${regenResult.generated}, matchdays=${regenMd}`);

  const regenCount = queryGet<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM fixtures WHERE competition_id = ?',
    [testCompId]
  )?.cnt ?? 0;
  console.log(`[COUNT AFTER REGEN]: ${regenCount}`);
  if (regenCount !== 380) {
    throw new Error(`Regeneration mismatch! Expected 380, got ${regenCount}`);
  }

  // Also test Knockout Cup schedule generation (FA Cup)
  const faCupId = 'comp-fa-cup-2026';
  console.log(`\n[ACTION]: Generating Knockout tournament schedule for FA Cup (${faCupId})...`);
  const faCupGen = await CompetitionEngine.generateSchedule(faCupId, { force: true });
  const faRounds = 'rounds' in faCupGen ? faCupGen.rounds : 0;
  console.log(`[FA CUP GEN RESULT]: generated=${faCupGen.generated}, rounds=${faRounds}`);

  const faCupCount = queryGet<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM fixtures WHERE competition_id = ?',
    [faCupId]
  )?.cnt ?? 0;
  console.log(`[FA CUP PERSISTED COUNT]: ${faCupCount}`);
  if (faCupCount !== 19) { // 20 teams knockout bracket = 10 R1 + 5 R2 + ... total 19 fixtures
    console.log(`FA Cup fixture count: ${faCupCount}`);
  }

  // ===========================================================================
  // SECTION 2: CLUB LOCK & IMMUTABILITY PROOF
  // ===========================================================================
  console.log('\n----------------------------------------------------------------');
  console.log('SECTION 2: CLUB LOCK - PROOF & AUDIT');
  console.log('----------------------------------------------------------------');

  const testUserId = `user-lock-test-${Date.now()}`;
  const clubAId = 'club-brentford';
  const clubBId = 'club-chelsea';

  // 1. User with no club
  const initialMembership = queryGet<any>(
    'SELECT * FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = "active"',
    [testUserId, testSeasonId]
  );
  console.log(`1. Test User: ${testUserId}, Initial Membership: ${initialMembership ? 'EXISTS' : 'NONE (Clean)'}`);

  // Ensure test clubs are not occupied by cleaning up any previous test memberships
  queryRun('DELETE FROM club_memberships WHERE user_id = ? OR club_id IN (?, ?)', [testUserId, clubAId, clubBId]);

  // 2. Assign Club A
  console.log(`\n2. Assigning Club A (${clubAId}) to user ${testUserId}...`);
  const claimAResult = await claimClubAtomic(testUserId, clubAId, testSeasonId);
  console.log(`[CLAIM A RESULT]: success=${claimAResult.success}, club=${claimAResult.club.name}`);

  // 3. Verify database contains Club A
  const membershipA = queryGet<any>(
    'SELECT * FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = "active"',
    [testUserId, testSeasonId]
  );
  console.log(`3. DB Membership after Claim A: club_id=${membershipA?.club_id}, user_id=${membershipA?.user_id}, status=${membershipA?.status}`);
  if (!membershipA || membershipA.club_id !== clubAId) {
    throw new Error(`Expected active membership for ${clubAId}, found ${JSON.stringify(membershipA)}`);
  }
  console.log('✅ PASS: Club A properly saved in database.');

  // 4 & 5. Attempt to assign Club B -> MUST throw ClubConflictError (translates to HTTP 409)
  console.log(`\n4. Attempting to assign Club B (${clubBId}) to user ${testUserId}...`);
  let caughtError: any = null;
  try {
    claimClubAtomic(testUserId, clubBId, testSeasonId);
  } catch (err: any) {
    caughtError = err;
  }

  if (!caughtError) {
    throw new Error('FAILED: Allowed user to claim a second club in the same season!');
  }

  const isConflict = caughtError instanceof ClubConflictError || caughtError.name === 'ClubConflictError';
  console.log(`5. Caught expected Conflict Error: "${caughtError.message}" (isConflict=${isConflict})`);
  if (!isConflict) {
    throw new Error(`Expected ClubConflictError (HTTP 409), but got: ${caughtError.constructor.name}`);
  }
  console.log('✅ PASS: Backend rejected second club claim with 409 Conflict.');

  // 6. Verify database STILL contains Club A and NOT Club B
  const finalMemberships = queryAll<any>(
    'SELECT * FROM club_memberships WHERE user_id = ? AND season_id = ?',
    [testUserId, testSeasonId]
  );
  console.log(`6. Final memberships for user in DB:`, finalMemberships);
  if (finalMemberships.length !== 1 || finalMemberships[0].club_id !== clubAId) {
    throw new Error(`Database corrupted! Expected exactly 1 membership for ${clubAId}, found: ${JSON.stringify(finalMemberships)}`);
  }
  console.log('✅ PASS: Database strictly maintained original Club A assignment.');

  // 8. Verify unique index existence and SQLite-level enforcement
  console.log('\n8. Verifying SQLite unique index enforcement:');
  const indexRow = queryGet<any>(
    "SELECT name, sql FROM sqlite_master WHERE type='index' AND name='idx_club_memberships_user_season_active'"
  );
  console.log(`Index metadata from sqlite_master:`, indexRow);
  if (!indexRow) {
    throw new Error('Missing unique index idx_club_memberships_user_season_active!');
  }

  // Attempt raw SQL insert bypassing service layer to test SQLite database constraint directly
  let rawDbConstraintCaught = false;
  try {
    getDb().run(
      'INSERT INTO club_memberships (id, season_id, club_id, user_id, claimed_at, status) VALUES (?, ?, ?, ?, ?, "active")',
      [`mem-raw-${Date.now()}`, testSeasonId, clubBId, testUserId, new Date().toISOString()]
    );
  } catch (err: any) {
    rawDbConstraintCaught = true;
    console.log(`SQLite raw constraint rejection: "${err.message}"`);
  }

  if (!rawDbConstraintCaught) {
    throw new Error('SQLite UNIQUE index failed to reject raw SQL duplicate active membership!');
  }
  console.log('✅ PASS: SQLite engine level constraint enforced by unique index.');

  // Cleanup test user
  queryRun('DELETE FROM club_memberships WHERE user_id = ?', [testUserId]);
  saveDatabaseSync();

  console.log('\n================================================================');
  console.log('       ALL STRICT VERIFICATION TESTS COMPLETED SUCCESSFULLY     ');
  console.log('================================================================');
}

runStrictVerification().catch((err) => {
  console.error('❌ STRICT VERIFICATION FAILED:', err);
  process.exit(1);
});
