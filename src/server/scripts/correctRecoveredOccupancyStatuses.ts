/**
 * Controlled Production Data Recovery Status Correction Script
 *
 * Scope:
 * 1. Correct occupancy status from 'occupied' to 'active' for:
 *    - club-barcelona -> user-8117945434
 *    - club-alaves -> user-1238738998
 *    - club-arsenal -> user-7460059265
 *    - club-sunderland -> user-6128910148
 * 2. Correct recovered fixture state for:
 *    - fix-comp-premier-league-2026-md1-bournemouth-vs-tottenham -> PENDING_CONFIRMATION
 *
 * Requirements:
 * - Read-only --plan mode by default.
 * - Require explicit --apply flag AND matching CORRECTION_PLAN_HASH.
 * - Create local JSON backup and Firestore backup under recovery_backups/<runId>/documents.
 * - Atomically execute within a single Firestore write batch.
 * - Post-apply verification queries.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getFirestoreDb, getFirebaseStatus } from '../firebase/admin';
import { COLLECTIONS, ACTIVE_MEMBERSHIP_STATUS } from '../firebase/collections';
import { invalidateFirestoreCache, getClubsByLeagueFirestore } from '../firebase/firestoreStore';

const SEASON_ID = 'season-2026-27';
const EXPECTED_PROD_PROJECT_ID = 'gen-lang-client-0195097895';
const EXPECTED_PROD_DATABASE_ID = 'ai-studio-efluz-4c6c88a6-697e-4fdf-82ed-45fec68ca34d';

export const EXPECTED_MAPPINGS = [
  { clubId: 'club-barcelona', userId: 'user-8117945434', clubName: 'FC Barcelona' },
  { clubId: 'club-alaves', userId: 'user-1238738998', clubName: 'Deportivo Alavés' },
  { clubId: 'club-arsenal', userId: 'user-7460059265', clubName: 'Arsenal FC' },
  { clubId: 'club-sunderland', userId: 'user-6128910148', clubName: 'Sunderland AFC' },
];

const TARGET_FIXTURE_ID = 'fix-comp-premier-league-2026-md1-bournemouth-vs-tottenham';
const LEGIT_SUBMISSION_USER_ID = 'user-6279763392';

interface PlannedDocWrite {
  collection: string;
  docId: string;
  description: string;
  currentState: any;
  targetState: any;
}

export async function runStatusCorrection(isApply: boolean, planHashInput?: string) {
  const runId = `corr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  console.log('================================================================');
  console.log('   CONTROLLED PRODUCTION OCCUPANCY & FIXTURE CORRECTION');
  console.log('================================================================');
  console.log(`Run ID:             ${runId}`);
  console.log(`Execution Mode:     ${isApply ? 'APPLY (MUTATION)' : 'PLAN (READ-ONLY)'}`);
  console.log(`Target Season:      ${SEASON_ID}`);

  const status = getFirebaseStatus();
  console.log(`Firebase Project:   ${status.projectId}`);
  console.log(`Firestore Database: ${status.databaseId}`);

  if (status.projectId !== EXPECTED_PROD_PROJECT_ID && !process.env.ALLOW_ANY_PROJECT) {
    throw new Error(`Project ID mismatch: expected ${EXPECTED_PROD_PROJECT_ID}, got ${status.projectId}`);
  }
  if (status.databaseId !== EXPECTED_PROD_DATABASE_ID && !process.env.ALLOW_ANY_PROJECT) {
    throw new Error(`Database ID mismatch: expected ${EXPECTED_PROD_DATABASE_ID}, got ${status.databaseId}`);
  }

  const db = getFirestoreDb();
  const now = new Date().toISOString();
  const plannedWrites: PlannedDocWrite[] = [];
  const localBackupState: Record<string, any> = {};

  // ===========================================================================
  // 1. INSPECT & PLAN FOR THE 4 CLUBS
  // ===========================================================================
  console.log('\n[PHASE 1] Inspecting and verifying 4 canonical ownership mappings...');

  for (const mapping of EXPECTED_MAPPINGS) {
    const clubDocRef = db.collection(COLLECTIONS.CLUBS).doc(mapping.clubId);
    const occDocRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${SEASON_ID}_${mapping.clubId}`);
    const cmDocRef = db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${SEASON_ID}_${mapping.clubId}`);
    const umDocRef = db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${SEASON_ID}_${mapping.userId}`);

    const [clubSnap, occSnap, cmSnap, umSnap] = await Promise.all([
      clubDocRef.get(),
      occDocRef.get(),
      cmDocRef.get(),
      umDocRef.get(),
    ]);

    const clubData = clubSnap.exists ? clubSnap.data() : null;
    const occData = occSnap.exists ? occSnap.data() : null;
    const cmData = cmSnap.exists ? cmSnap.data() : null;
    const umData = umSnap.exists ? umSnap.data() : null;

    localBackupState[`${COLLECTIONS.CLUBS}/${mapping.clubId}`] = clubData;
    localBackupState[`${COLLECTIONS.CLUB_OCCUPANCIES}/${SEASON_ID}_${mapping.clubId}`] = occData;
    localBackupState[`${COLLECTIONS.CLUB_MEMBERSHIPS}/${SEASON_ID}_${mapping.clubId}`] = cmData;
    localBackupState[`${COLLECTIONS.USER_MEMBERSHIPS}/${SEASON_ID}_${mapping.userId}`] = umData;

    console.log(`\n  Checking ${mapping.clubName} (${mapping.clubId}):`);
    console.log(`    Expected User ID: ${mapping.userId}`);
    console.log(`    Club doc:         isTaken=${clubData?.isTaken}, claimedByUserId=${clubData?.claimedByUserId}`);
    console.log(`    Occupancy doc:    status=${occData?.status}, userId=${occData?.userId}`);
    console.log(`    ClubMembership:   status=${cmData?.status}, userId=${cmData?.userId}`);
    console.log(`    UserMembership:   status=${umData?.status}, clubId=${umData?.clubId}`);

    // Verification check: Abort if any stored userId differs from expected mapping
    if (clubData?.claimedByUserId && clubData.claimedByUserId !== mapping.userId) {
      throw new Error(`CRITICAL_ABORT: clubs/${mapping.clubId} has owner ${clubData.claimedByUserId}, expected ${mapping.userId}`);
    }
    if (occData?.userId && occData.userId !== mapping.userId) {
      throw new Error(`CRITICAL_ABORT: club_occupancies/${SEASON_ID}_${mapping.clubId} has owner ${occData.userId}, expected ${mapping.userId}`);
    }
    if (cmData?.userId && cmData.userId !== mapping.userId) {
      throw new Error(`CRITICAL_ABORT: club_memberships/${SEASON_ID}_${mapping.clubId} has owner ${cmData.userId}, expected ${mapping.userId}`);
    }
    if (umData?.clubId && umData.clubId !== mapping.clubId) {
      throw new Error(`CRITICAL_ABORT: user_memberships/${SEASON_ID}_${mapping.userId} assigned to ${umData.clubId}, expected ${mapping.clubId}`);
    }

    const originalClaimedAt =
      occData?.claimedAt || cmData?.claimedAt || clubData?.claimedAt || umData?.claimedAt || now;

    // Plan write for club_occupancies
    plannedWrites.push({
      collection: COLLECTIONS.CLUB_OCCUPANCIES,
      docId: `${SEASON_ID}_${mapping.clubId}`,
      description: `Set status=${ACTIVE_MEMBERSHIP_STATUS} for ${mapping.clubId} occupancy`,
      currentState: occData,
      targetState: {
        ...(occData || {}),
        seasonId: SEASON_ID,
        clubId: mapping.clubId,
        userId: mapping.userId,
        status: ACTIVE_MEMBERSHIP_STATUS,
        statusSeason: `active_${SEASON_ID}`,
        claimedAt: originalClaimedAt,
        updatedAt: now,
      },
    });

    // Plan write for club_memberships
    plannedWrites.push({
      collection: COLLECTIONS.CLUB_MEMBERSHIPS,
      docId: `${SEASON_ID}_${mapping.clubId}`,
      description: `Set status=${ACTIVE_MEMBERSHIP_STATUS} for ${mapping.clubId} club membership`,
      currentState: cmData,
      targetState: {
        ...(cmData || {}),
        id: `cm-${SEASON_ID}-${mapping.clubId}`,
        seasonId: SEASON_ID,
        clubId: mapping.clubId,
        userId: mapping.userId,
        status: ACTIVE_MEMBERSHIP_STATUS,
        claimedAt: originalClaimedAt,
        updatedAt: now,
      },
    });

    // Plan write for user_memberships
    plannedWrites.push({
      collection: COLLECTIONS.USER_MEMBERSHIPS,
      docId: `${SEASON_ID}_${mapping.userId}`,
      description: `Set status=${ACTIVE_MEMBERSHIP_STATUS} for ${mapping.userId} user membership`,
      currentState: umData,
      targetState: {
        ...(umData || {}),
        seasonId: SEASON_ID,
        userId: mapping.userId,
        clubId: mapping.clubId,
        status: ACTIVE_MEMBERSHIP_STATUS,
        claimedAt: originalClaimedAt,
        updatedAt: now,
      },
    });

    // Plan write for clubs
    plannedWrites.push({
      collection: COLLECTIONS.CLUBS,
      docId: mapping.clubId,
      description: `Confirm isTaken=true, claimedByUserId=${mapping.userId} on clubs doc`,
      currentState: clubData,
      targetState: {
        ...(clubData || {}),
        isTaken: true,
        claimedByUserId: mapping.userId,
        claimedAt: originalClaimedAt,
        updatedAt: now,
      },
    });
  }

  // ===========================================================================
  // 2. INSPECT & PLAN FOR THE FIXTURE STATE
  // ===========================================================================
  console.log(`\n[PHASE 2] Inspecting fixture ${TARGET_FIXTURE_ID}...`);
  const fixtureRef = db.collection(COLLECTIONS.FIXTURES).doc(TARGET_FIXTURE_ID);
  const fixtureSnap = await fixtureRef.get();
  if (!fixtureSnap.exists) {
    throw new Error(`MANUAL_REVIEW_REQUIRED: Fixture ${TARGET_FIXTURE_ID} does not exist.`);
  }
  const fixtureData = fixtureSnap.data();
  localBackupState[`${COLLECTIONS.FIXTURES}/${TARGET_FIXTURE_ID}`] = fixtureData;

  const subsSnap = await db
    .collection(COLLECTIONS.RESULT_SUBMISSIONS)
    .where('fixtureId', '==', TARGET_FIXTURE_ID)
    .get();

  const submissions = subsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  console.log(`  Found ${submissions.length} submission(s) for fixture.`);
  submissions.forEach((s: any) => {
    console.log(`    Sub ${s.id}: userId=${s.submittedByUserId}, score=${s.homeScore}-${s.awayScore}`);
  });

  const legitSub = submissions.find(
    (s: any) => s.submittedByUserId === LEGIT_SUBMISSION_USER_ID && s.homeScore === 0 && s.awayScore === 0
  );

  if (!legitSub || submissions.length !== 1) {
    console.warn('  ⚠️ Fixture does not match exact condition: exactly 1 legitimate submission with 0-0.');
    console.warn('  MANUAL_REVIEW_REQUIRED: Fixture state will not be automatically modified.');
  } else {
    console.log(`  Found exactly 1 legitimate submission from ${LEGIT_SUBMISSION_USER_ID} with score 0-0.`);
    console.log(`  Planning update: status -> PENDING_CONFIRMATION, score/winner fields cleared.`);

    plannedWrites.push({
      collection: COLLECTIONS.FIXTURES,
      docId: TARGET_FIXTURE_ID,
      description: `Set fixture status=PENDING_CONFIRMATION (single valid 0-0 submission pending)`,
      currentState: fixtureData,
      targetState: {
        ...(fixtureData || {}),
        status: 'PENDING_CONFIRMATION',
        homeScore: null,
        awayScore: null,
        winnerClubId: null,
        resultConfirmedAt: null,
        updatedAt: now,
      },
    });
  }

  // ===========================================================================
  // 3. GENERATE DETERMINISTIC PLAN HASH & SUMMARY
  // ===========================================================================
  console.log('\n[PHASE 3] Generating Plan Hash and Operations Summary...');
  const canonicalOps = plannedWrites.map((w) => {
    const cleanTarget = { ...w.targetState };
    delete cleanTarget.updatedAt;
    delete cleanTarget.recoveredAt;
    return {
      collection: w.collection,
      docId: w.docId,
      targetState: cleanTarget,
    };
  });

  const planHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalOps))
    .digest('hex');

  console.log(`  Total planned operations: ${plannedWrites.length}`);
  console.log(`  PLAN HASH:                ${planHash}`);

  // Create local JSON backup file
  const backupDir = path.join(process.cwd(), 'recovery_backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  const localBackupPath = path.join(backupDir, `status_correction_${runId}.json`);
  fs.writeFileSync(
    localBackupPath,
    JSON.stringify(
      {
        runId,
        createdAt: now,
        planHash,
        targetSeason: SEASON_ID,
        projectId: status.projectId,
        databaseId: status.databaseId,
        plannedOperations: plannedWrites.map((w) => ({
          collection: w.collection,
          docId: w.docId,
          description: w.description,
        })),
        originalDocuments: localBackupState,
      },
      null,
      2
    )
  );
  console.log(`  Local backup saved to:    ${localBackupPath}`);

  if (!isApply) {
    console.log('\n================================================================');
    console.log('                 PLAN COMPLETE (READ-ONLY MODE)                 ');
    console.log('================================================================');
    console.log('No documents were modified in Firestore.');
    console.log(`To apply these changes, execute with:`);
    console.log(`  npx tsx src/server/scripts/correctRecoveredOccupancyStatuses.ts --apply --hash=${planHash}`);
    console.log('================================================================\n');
    return { planHash, runId, plannedWritesCount: plannedWrites.length, applied: false };
  }

  // ===========================================================================
  // 4. APPLY PRECONDITIONS VALIDATION
  // ===========================================================================
  console.log('\n[PHASE 4] Validating Apply Preconditions & Plan Hash...');
  const providedHash = planHashInput || process.env.CORRECTION_PLAN_HASH;
  if (!providedHash) {
    throw new Error('APPLY_ERROR: A matching --hash=<hash> or CORRECTION_PLAN_HASH env is required to apply.');
  }
  if (providedHash !== planHash) {
    throw new Error(`APPLY_ERROR: Hash mismatch! Expected ${planHash}, got ${providedHash}`);
  }

  // ===========================================================================
  // 5. ATOMIC EXECUTION (BACKUP + BATCH WRITE)
  // ===========================================================================
  console.log('\n[PHASE 5] Storing Firestore Backups and Applying Atomic Writes...');

  // Step A: Save backups under recovery_backups/<runId>/documents
  const backupBatch = db.batch();
  for (const [docPath, data] of Object.entries(localBackupState)) {
    const [coll, docId] = docPath.split('/');
    const bkpRef = db.collection('recovery_backups').doc(runId).collection('documents').doc(`${coll}_${docId}`);
    backupBatch.set(bkpRef, {
      originalCollection: coll,
      originalDocId: docId,
      backedUpAt: now,
      data,
    });
  }
  const bkpMetaRef = db.collection('recovery_backups').doc(runId);
  backupBatch.set(bkpMetaRef, {
    runId,
    type: 'OCCUPANCY_AND_FIXTURE_STATUS_CORRECTION',
    planHash,
    createdAt: now,
    seasonId: SEASON_ID,
    operationsCount: plannedWrites.length,
  });
  await backupBatch.commit();
  console.log(`  Firestore backup written to recovery_backups/${runId}/documents`);

  // Step B: Apply atomic mutation batch
  const writeBatch = db.batch();
  for (const op of plannedWrites) {
    const docRef = db.collection(op.collection).doc(op.docId);
    writeBatch.set(docRef, op.targetState, { merge: true });
  }

  // Step C: Write audit log
  const auditDocRef = db.collection(COLLECTIONS.AUDIT_LOGS).doc(`audit_${runId}`);
  writeBatch.set(auditDocRef, {
    id: `audit_${runId}`,
    action: 'CONTROLLED_OCCUPANCY_STATUS_CORRECTION',
    actorUserId: 'system-recovery-agent',
    seasonId: SEASON_ID,
    runId,
    planHash,
    timestamp: now,
    details: {
      affectedClubs: EXPECTED_MAPPINGS.map((m) => m.clubId),
      targetFixture: TARGET_FIXTURE_ID,
      operationsCount: plannedWrites.length,
    },
  });

  await writeBatch.commit();
  console.log(`  Successfully committed ${plannedWrites.length} atomic operations to Firestore.`);

  // Invalidate in-memory server cache
  invalidateFirestoreCache();
  console.log('  Invalidated in-memory server caches.');

  // ===========================================================================
  // 6. POST-APPLY VERIFICATION
  // ===========================================================================
  console.log('\n[PHASE 6] Running Post-Apply Direct Verification...');

  // Verification 1: Direct production query for active occupancies in season
  const activeOccSnap = await db
    .collection(COLLECTIONS.CLUB_OCCUPANCIES)
    .where('seasonId', '==', SEASON_ID)
    .where('status', '==', 'active')
    .get();

  const activeOccClubIds = new Set(activeOccSnap.docs.map((d) => d.data().clubId));
  console.log(`  Active occupancies count in ${SEASON_ID}: ${activeOccSnap.docs.length}`);

  for (const mapping of EXPECTED_MAPPINGS) {
    const isActive = activeOccClubIds.has(mapping.clubId);
    console.log(`    ${mapping.clubId} active occupancy in season: ${isActive ? '✅ YES' : '❌ NO'}`);
    if (!isActive) {
      throw new Error(`VERIFICATION_FAILED: ${mapping.clubId} does not appear in active occupancies!`);
    }
  }

  // Verification 2: Verify getClubsByLeagueFirestore('league-la-liga')
  const laLigaClubs = await getClubsByLeagueFirestore('league-la-liga', SEASON_ID);
  const barcaInLaLiga = laLigaClubs.find((c) => c.id === 'club-barcelona');

  console.log('\n  La Liga getClubsByLeagueFirestore check for Barcelona:');
  console.log(`    isTaken:          ${barcaInLaLiga?.isTaken}`);
  console.log(`    claimedByUserId:  ${barcaInLaLiga?.claimedByUserId}`);
  console.log(`    occupancy.status: ${barcaInLaLiga?.occupancy?.status}`);

  if (!barcaInLaLiga || !barcaInLaLiga.isTaken || barcaInLaLiga.claimedByUserId !== 'user-8117945434') {
    throw new Error('VERIFICATION_FAILED: Barcelona ownership not reflected in getClubsByLeagueFirestore!');
  }
  if (barcaInLaLiga.occupancy?.status !== 'occupied') {
    throw new Error(`VERIFICATION_FAILED: Expected Barcelona occupancy.status="occupied", got "${barcaInLaLiga.occupancy?.status}"`);
  }

  // Verification 3: Fixture state
  const updatedFixSnap = await db.collection(COLLECTIONS.FIXTURES).doc(TARGET_FIXTURE_ID).get();
  const updatedFix = updatedFixSnap.data();
  console.log('\n  Fixture state check:');
  console.log(`    Fixture ID:       ${TARGET_FIXTURE_ID}`);
  console.log(`    Status:           ${updatedFix?.status}`);
  console.log(`    Home Score:       ${updatedFix?.homeScore}`);
  console.log(`    Away Score:       ${updatedFix?.awayScore}`);
  console.log(`    Winner:           ${updatedFix?.winnerClubId}`);

  if (updatedFix?.status !== 'PENDING_CONFIRMATION') {
    throw new Error(`VERIFICATION_FAILED: Fixture status expected PENDING_CONFIRMATION, got ${updatedFix?.status}`);
  }

  console.log('\n================================================================');
  console.log('         CORRECTION SUCCESSFULLY APPLIED & VERIFIED             ');
  console.log('================================================================\n');

  return { planHash, runId, plannedWritesCount: plannedWrites.length, applied: true };
}

// CLI entry point
if (process.argv[1]?.includes('correctRecoveredOccupancyStatuses')) {
  const isApply = process.argv.includes('--apply');
  const hashArg = process.argv.find((a) => a.startsWith('--hash='))?.split('=')[1];

  runStatusCorrection(isApply, hashArg)
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n❌ FATAL ERROR during status correction:', err.message);
      process.exit(1);
    });
}
