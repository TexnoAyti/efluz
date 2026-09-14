/**
 * STRICTLY READ-ONLY PRODUCTION CONTAMINATION & FORENSIC AUDIT SCRIPT
 *
 * Requirements:
 * 1. Must be run with READ_ONLY_FORENSICS=true
 * 2. Connects to production project 'gen-lang-client-0195097895' and database 'ai-studio-efluz-4c6c88a6-697e-4fdf-82ed-45fec68ca34d'
 * 3. Strictly read-only: wraps Firestore in a defensive proxy rejecting any write/mutation attempt
 * 4. Produces artifacts/production-contamination-report.json with recovery candidates and confidence scoring
 * 5. ZERO writes, ZERO mutations, ZERO guessing.
 */

import fs from 'fs';
import path from 'path';
import { initializeFirebaseAdmin, getFirebaseStatus } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import {
  isSyntheticIdentifier,
  SYNTHETIC_ID_PATTERNS,
  PROD_PROJECT_ID,
  PROD_DATABASE_ID,
} from '../utils/testGuard';

// Enforce READ_ONLY_FORENSICS=true
if (process.env.READ_ONLY_FORENSICS !== 'true') {
  console.error('\n❌ FATAL: READ_ONLY_FORENSICS=true environment variable is required to run this script.');
  console.error('Run: READ_ONLY_FORENSICS=true npm run audit:contamination:readonly\n');
  process.exit(1);
}

interface ForensicReport {
  readOnly: boolean;
  projectId: string;
  databaseId: string;
  seasonId: string;
  generatedAt: string;
  suspiciousClubClaims: Array<{
    clubId: string;
    clubName?: string;
    collection: string;
    docId: string;
    syntheticUserId: string;
    claimedAt?: string;
    status?: string;
    details: string;
  }>;
  clubRecoveryCandidates: Array<{
    clubId: string;
    clubName?: string;
    affectedBySyntheticUserId: string;
    currentOccupancyOwner: string | null;
    currentClubClaimedBy: string | null;
    legitimateMemberships: Array<{
      userId: string;
      claimedAt: string;
      status: string;
    }>;
    recoveryConfidence: 'HIGH' | 'MEDIUM' | 'MANUAL_REVIEW';
    recommendedOwnerUserId: string | null;
    reason: string;
  }>;
  suspiciousFixtures: Array<{
    fixtureId: string;
    reason: string;
    competitionId?: string;
    homeClubId?: string;
    awayClubId?: string;
    currentStatus?: string;
    currentHomeScore?: number | null;
    currentAwayScore?: number | null;
    winnerClubId?: string | null;
    resultConfirmedAt?: string | null;
    adminOfflineOverwroteWith31: boolean;
    auditLogIds: string[];
    syntheticSubmissionIds: string[];
  }>;
  fixtureRecoveryCandidates: Array<{
    fixtureId: string;
    homeClubId: string;
    awayClubId: string;
    currentScore: string;
    originalScoreEvidence: string | null;
    homeScoreCandidate: number | null;
    awayScoreCandidate: number | null;
    legitimateSubmissionsCount: number;
    recoveryConfidence: 'HIGH' | 'MEDIUM' | 'MANUAL_REVIEW';
    reason: string;
    actionRequired: string;
  }>;
  syntheticDocumentsSafeToDeleteLater: Array<{
    collection: string;
    docId: string;
    reason: string;
  }>;
  manualReviewRequired: Array<{
    category: 'CLUB_OWNERSHIP' | 'FIXTURE' | 'CONFLICTING_STATE';
    entityId: string;
    issue: string;
    evidence: any;
  }>;
  duplicateOrConflictingOwnership: Array<{
    type: string;
    clubId: string;
    details: string;
  }>;
  estimatedFirestoreReads: number;
}

let firestoreReadCounter = 0;

/**
 * Defensive Read-Only Proxy for Firestore.
 * Strictly traps and forbids any mutation method: set, update, delete, create, add, batch, bulkWriter, runTransaction.
 * Exposes only collection, doc, get, where, orderBy, limit, select.
 */
function createReadOnlyFirestoreProxy(rawDb: any): any {
  const disallowedMethods = [
    'set',
    'update',
    'delete',
    'create',
    'add',
    'batch',
    'bulkWriter',
    'runTransaction',
    'commit',
  ];

  function wrapRefOrQuery(target: any, pathName = ''): any {
    return new Proxy(target, {
      get(t, prop, receiver) {
        const propStr = String(prop);

        if (disallowedMethods.includes(propStr)) {
          throw new Error(
            `READ_ONLY_FORENSICS_VIOLATION: Call to "${propStr}" on "${pathName}" is strictly prohibited during read-only forensic audit.`
          );
        }

        const value = Reflect.get(t, prop, receiver);

        if (propStr === 'get') {
          return async function (...args: any[]) {
            const snap = await value.apply(t, args);
            if (snap && typeof snap.size === 'number') {
              firestoreReadCounter += Math.max(1, snap.size);
            } else {
              firestoreReadCounter += 1;
            }
            return snap;
          };
        }

        if (['collection', 'doc', 'where', 'orderBy', 'limit', 'select'].includes(propStr)) {
          if (typeof value === 'function') {
            return function (...args: any[]) {
              const result = value.apply(t, args);
              return wrapRefOrQuery(result, `${pathName}/${propStr}(${args.map((a) => String(a)).join(', ')})`);
            };
          }
        }

        return value;
      },
    });
  }

  return new Proxy(rawDb, {
    get(target, prop, receiver) {
      const propStr = String(prop);

      if (disallowedMethods.includes(propStr)) {
        throw new Error(
          `READ_ONLY_FORENSICS_VIOLATION: Call to "${propStr}" on Firestore instance is strictly prohibited during read-only forensic audit.`
        );
      }

      if (propStr === 'collection') {
        return function (colName: string) {
          return wrapRefOrQuery(target.collection(colName), colName);
        };
      }

      if (propStr === 'doc') {
        return function (docPath: string) {
          return wrapRefOrQuery(target.doc(docPath), docPath);
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  });
}

export async function runProductionContaminationAudit() {
  console.log('\n================================================================');
  console.log('    STRICT READ-ONLY FORENSIC CONTAMINATION AUDIT               ');
  console.log('================================================================\n');

  // Initialize Firebase Admin (must not be local fallback)
  if (process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true') {
    throw new Error(
      'CONFIG_ERROR: Forensic script must connect to real production Firestore. FIREBASE_FORCE_LOCAL_FALLBACK must NOT be set to "true".'
    );
  }

  const { db: rawDb, info } = initializeFirebaseAdmin();
  if (!rawDb) {
    throw new Error(`Failed to initialize Firebase Admin: ${info.error || 'Unknown error'}`);
  }

  // Verify connected project and database match production identifiers
  console.log(`[VERIFY] Connected Project ID:  ${info.projectId}`);
  console.log(`[VERIFY] Connected Database ID: ${info.databaseId}`);

  if (info.projectId !== PROD_PROJECT_ID) {
    throw new Error(
      `PROJECT_MISMATCH: Expected production project "${PROD_PROJECT_ID}", but connected to "${info.projectId}". Aborting.`
    );
  }
  if (info.databaseId !== PROD_DATABASE_ID) {
    throw new Error(
      `DATABASE_MISMATCH: Expected production database "${PROD_DATABASE_ID}", but connected to "${info.databaseId}". Aborting.`
    );
  }

  // Wrap in defensive Read-Only Proxy
  const db = createReadOnlyFirestoreProxy(rawDb);
  const TARGET_SEASON = 'season-2026-27';

  const report: ForensicReport = {
    readOnly: true,
    projectId: info.projectId,
    databaseId: info.databaseId,
    seasonId: TARGET_SEASON,
    generatedAt: new Date().toISOString(),
    suspiciousClubClaims: [],
    clubRecoveryCandidates: [],
    suspiciousFixtures: [],
    fixtureRecoveryCandidates: [],
    syntheticDocumentsSafeToDeleteLater: [],
    manualReviewRequired: [],
    duplicateOrConflictingOwnership: [],
    estimatedFirestoreReads: 0,
  };

  console.log('\n[PHASE 1] Investigating Season 2026-27 Club Ownership Contamination...');

  // 1. Scan Season 2026-27 Club Occupancies (Targeted doc ID prefix query)
  const occupanciesSnap = await db
    .collection(COLLECTIONS.CLUB_OCCUPANCIES)
    .where('__name__', '>=', `${TARGET_SEASON}_`)
    .where('__name__', '<=', `${TARGET_SEASON}_\uf8ff`)
    .get();

  console.log(`[OCCUPANCIES] Loaded ${occupanciesSnap.size} club occupancies for ${TARGET_SEASON}`);

  const affectedClubIds = new Set<string>();

  for (const doc of occupanciesSnap.docs) {
    const data = doc.data();
    const userId = data.userId;
    const clubId = data.clubId || doc.id.replace(`${TARGET_SEASON}_`, '');

    if (isSyntheticIdentifier(userId)) {
      affectedClubIds.add(clubId);
      report.suspiciousClubClaims.push({
        clubId,
        collection: COLLECTIONS.CLUB_OCCUPANCIES,
        docId: doc.id,
        syntheticUserId: userId,
        claimedAt: data.claimedAt,
        status: data.status,
        details: `Club occupancy owned by synthetic user "${userId}"`,
      });
      report.syntheticDocumentsSafeToDeleteLater.push({
        collection: COLLECTIONS.CLUB_OCCUPANCIES,
        docId: doc.id,
        reason: `Contaminated club occupancy by synthetic user "${userId}"`,
      });
    }
  }

  // 2. Scan Season 2026-27 Club Memberships
  const clubMembershipsSnap = await db
    .collection(COLLECTIONS.CLUB_MEMBERSHIPS)
    .where('__name__', '>=', `${TARGET_SEASON}_`)
    .where('__name__', '<=', `${TARGET_SEASON}_\uf8ff`)
    .get();

  console.log(`[CLUB_MEMBERSHIPS] Loaded ${clubMembershipsSnap.size} club memberships for ${TARGET_SEASON}`);

  for (const doc of clubMembershipsSnap.docs) {
    const data = doc.data();
    const userId = data.userId;
    const clubId = data.clubId || doc.id.replace(`${TARGET_SEASON}_`, '');

    if (isSyntheticIdentifier(userId)) {
      affectedClubIds.add(clubId);
      report.suspiciousClubClaims.push({
        clubId,
        collection: COLLECTIONS.CLUB_MEMBERSHIPS,
        docId: doc.id,
        syntheticUserId: userId,
        claimedAt: data.claimedAt,
        status: data.status,
        details: `Club membership record contains synthetic user "${userId}"`,
      });
      report.syntheticDocumentsSafeToDeleteLater.push({
        collection: COLLECTIONS.CLUB_MEMBERSHIPS,
        docId: doc.id,
        reason: `Synthetic club membership record for "${userId}"`,
      });
    }
  }

  // 3. Scan Season 2026-27 User Memberships
  const userMembershipsSnap = await db
    .collection(COLLECTIONS.USER_MEMBERSHIPS)
    .where('__name__', '>=', `${TARGET_SEASON}_`)
    .where('__name__', '<=', `${TARGET_SEASON}_\uf8ff`)
    .get();

  console.log(`[USER_MEMBERSHIPS] Loaded ${userMembershipsSnap.size} user memberships for ${TARGET_SEASON}`);

  const allSeasonUserMemberships: Array<{
    docId: string;
    userId: string;
    clubId: string;
    status: string;
    claimedAt: string;
  }> = [];

  for (const doc of userMembershipsSnap.docs) {
    const data = doc.data();
    const userId = data.userId || doc.id.replace(`${TARGET_SEASON}_`, '');
    const clubId = data.clubId;

    allSeasonUserMemberships.push({
      docId: doc.id,
      userId,
      clubId,
      status: data.status || 'active',
      claimedAt: data.claimedAt || '',
    });

    if (isSyntheticIdentifier(userId)) {
      if (clubId) affectedClubIds.add(clubId);
      report.suspiciousClubClaims.push({
        clubId: clubId || 'UNKNOWN',
        collection: COLLECTIONS.USER_MEMBERSHIPS,
        docId: doc.id,
        syntheticUserId: userId,
        claimedAt: data.claimedAt,
        status: data.status,
        details: `User membership document created for synthetic user "${userId}" pointing to club "${clubId}"`,
      });
      report.syntheticDocumentsSafeToDeleteLater.push({
        collection: COLLECTIONS.USER_MEMBERSHIPS,
        docId: doc.id,
        reason: `Synthetic user membership for "${userId}"`,
      });
    }
  }

  // 4. For each affected club, inspect the Club document and find legitimate former owners
  console.log(`[AFFECTED CLUBS] Detected ${affectedClubIds.size} contaminated club(s): ${Array.from(affectedClubIds).join(', ')}`);

  for (const clubId of affectedClubIds) {
    // Load only the specific affected club doc
    const clubDocSnap = await db.collection(COLLECTIONS.CLUBS).doc(clubId).get();
    const clubData = clubDocSnap.exists ? clubDocSnap.data() : null;

    if (clubData && isSyntheticIdentifier(clubData.claimedByUserId)) {
      report.suspiciousClubClaims.push({
        clubId,
        clubName: clubData.name,
        collection: COLLECTIONS.CLUBS,
        docId: clubId,
        syntheticUserId: clubData.claimedByUserId,
        details: `Club document "${clubId}" claimedByUserId is contaminated with synthetic user "${clubData.claimedByUserId}"`,
      });
    }

    // Check current occupancy
    const occDoc = occupanciesSnap.docs.find((d) => d.id === `${TARGET_SEASON}_${clubId}`);
    const occData = occDoc ? occDoc.data() : null;
    const occUserId = occData ? occData.userId : null;

    // Find all non-synthetic active user_memberships pointing to this club
    const legitimateMemberships = allSeasonUserMemberships.filter(
      (m) => m.clubId === clubId && !isSyntheticIdentifier(m.userId) && m.status === 'active'
    );

    let recoveryConfidence: 'HIGH' | 'MEDIUM' | 'MANUAL_REVIEW' = 'MANUAL_REVIEW';
    let recommendedOwnerUserId: string | null = null;
    let reason = '';

    if (legitimateMemberships.length === 1) {
      recoveryConfidence = 'HIGH';
      recommendedOwnerUserId = legitimateMemberships[0].userId;
      reason = `Exactly one legitimate, non-synthetic active user membership (${recommendedOwnerUserId}) exists for this club in ${TARGET_SEASON}.`;
    } else if (legitimateMemberships.length > 1) {
      recoveryConfidence = 'MEDIUM';
      recommendedOwnerUserId = null;
      reason = `Multiple (${legitimateMemberships.length}) active non-synthetic user memberships exist for club "${clubId}". Needs manual resolution.`;
      report.duplicateOrConflictingOwnership.push({
        type: 'MULTIPLE_ACTIVE_USER_MEMBERSHIPS',
        clubId,
        details: `Users: ${legitimateMemberships.map((m) => m.userId).join(', ')}`,
      });
      report.manualReviewRequired.push({
        category: 'CLUB_OWNERSHIP',
        entityId: clubId,
        issue: `Multiple active memberships found for contaminated club`,
        evidence: legitimateMemberships,
      });
    } else {
      // 0 legitimate active memberships
      recoveryConfidence = 'MANUAL_REVIEW';
      recommendedOwnerUserId = null;
      reason = `Zero legitimate active user memberships found for club "${clubId}". No reliable former owner can be proven.`;
      report.manualReviewRequired.push({
        category: 'CLUB_OWNERSHIP',
        entityId: clubId,
        issue: `Zero former legitimate owners found in active user memberships`,
        evidence: { clubId, currentOccupancyUserId: occUserId },
      });
    }

    // Detect duplicate / conflicting ownership rules
    if (occUserId && !isSyntheticIdentifier(occUserId) && recommendedOwnerUserId && occUserId !== recommendedOwnerUserId) {
      report.duplicateOrConflictingOwnership.push({
        type: 'OCCUPANCY_MISMATCH_WITH_LEGITIMATE_MEMBER',
        clubId,
        details: `Occupancy owner "${occUserId}" differs from legitimate user membership "${recommendedOwnerUserId}"`,
      });
    }
    if (clubData?.claimedByUserId && occUserId && clubData.claimedByUserId !== occUserId) {
      report.duplicateOrConflictingOwnership.push({
        type: 'CLUB_DOC_MISMATCH_WITH_OCCUPANCY',
        clubId,
        details: `Club doc claimedByUserId "${clubData.claimedByUserId}" differs from occupancy "${occUserId}"`,
      });
    }
    if (isSyntheticIdentifier(occUserId)) {
      report.duplicateOrConflictingOwnership.push({
        type: 'SYNTHETIC_LOCK_CONDITION',
        clubId,
        details: `Synthetic user "${occUserId}" occupying club causes CLUB_OCCUPIED or CLUB_SELECTION_LOCKED for legitimate users.`,
      });
    }

    report.clubRecoveryCandidates.push({
      clubId,
      clubName: clubData?.name || clubId,
      affectedBySyntheticUserId: isSyntheticIdentifier(occUserId) ? occUserId! : 'synthetic_claim',
      currentOccupancyOwner: occUserId,
      currentClubClaimedBy: clubData?.claimedByUserId || null,
      legitimateMemberships: legitimateMemberships.map((m) => ({
        userId: m.userId,
        claimedAt: m.claimedAt,
        status: m.status,
      })),
      recoveryConfidence,
      recommendedOwnerUserId,
      reason,
    });
  }

  console.log('\n[PHASE 2] Investigating Suspicious Fixture Alterations & Replays...');

  // 5. Targeted queries for suspicious audit logs (no full scans)
  const suspiciousActors = ['admin-offline-user', 'admin-audit-user', 'admin_test_user'];
  const suspiciousAuditLogs: any[] = [];

  for (const actorId of suspiciousActors) {
    const snap = await db
      .collection(COLLECTIONS.AUDIT_LOGS)
      .where('actorUserId', '==', actorId)
      .get();
    for (const d of snap.docs) {
      suspiciousAuditLogs.push({ id: d.id, ...d.data() });
    }
  }

  console.log(`[AUDIT_LOGS] Found ${suspiciousAuditLogs.length} audit logs from suspicious test actors`);

  // Targeted queries for suspicious result submissions
  const suspiciousSubmitters = ['audit-player-1', 'audit-player-2'];
  const suspiciousSubmissions: any[] = [];

  for (const submitter of suspiciousSubmitters) {
    const snap = await db
      .collection(COLLECTIONS.RESULT_SUBMISSIONS)
      .where('submittedByUserId', '==', submitter)
      .get();
    for (const d of snap.docs) {
      suspiciousSubmissions.push({ id: d.id, ...d.data() });
    }
  }

  console.log(`[RESULT_SUBMISSIONS] Found ${suspiciousSubmissions.length} submissions from synthetic players`);

  // Targeted query for synthetic fixture IDs beginning offline-test- or fix-retry-test-
  const syntheticFixturePrefixes = ['offline-test-', 'fix-retry-test-'];
  const syntheticFixtureDocs: any[] = [];

  for (const prefix of syntheticFixturePrefixes) {
    const snap = await db
      .collection(COLLECTIONS.FIXTURES)
      .where('__name__', '>=', prefix)
      .where('__name__', '<=', `${prefix}\uf8ff`)
      .get();
    for (const d of snap.docs) {
      syntheticFixtureDocs.push({ id: d.id, ...d.data() });
      report.syntheticDocumentsSafeToDeleteLater.push({
        collection: COLLECTIONS.FIXTURES,
        docId: d.id,
        reason: `Purely synthetic fixture created by test suite with ID starting with "${prefix}"`,
      });
    }
  }

  console.log(`[SYNTHETIC_FIXTURES] Found ${syntheticFixtureDocs.length} purely synthetic fixture documents`);

  // Add synthetic submissions to safe-to-delete list
  for (const sub of suspiciousSubmissions) {
    report.syntheticDocumentsSafeToDeleteLater.push({
      collection: COLLECTIONS.RESULT_SUBMISSIONS,
      docId: sub.id,
      reason: `Synthetic result submission from "${sub.submittedByUserId}"`,
    });
  }

  // Identify all affected fixture IDs
  const affectedFixtureIds = new Set<string>();

  for (const log of suspiciousAuditLogs) {
    if (log.entityId && !log.entityId.startsWith('offline-test-') && !log.entityId.startsWith('fix-retry-test-')) {
      affectedFixtureIds.add(log.entityId);
    }
  }

  for (const sub of suspiciousSubmissions) {
    if (sub.fixtureId && !sub.fixtureId.startsWith('offline-test-') && !sub.fixtureId.startsWith('fix-retry-test-')) {
      affectedFixtureIds.add(sub.fixtureId);
    }
  }

  console.log(`[AFFECTED REAL FIXTURES] Targeted inspection of ${affectedFixtureIds.size} fixture(s): ${Array.from(affectedFixtureIds).join(', ')}`);

  // For each real affected fixture, load only:
  // - the fixture document
  // - all result_submissions for that fixture
  // - audit logs for that fixture
  for (const fixtureId of affectedFixtureIds) {
    const fixDocSnap = await db.collection(COLLECTIONS.FIXTURES).doc(fixtureId).get();
    if (!fixDocSnap.exists) {
      continue;
    }
    const fixtureData = fixDocSnap.data()!;

    // Load submissions for this fixture
    const subsSnap = await db
      .collection(COLLECTIONS.RESULT_SUBMISSIONS)
      .where('fixtureId', '==', fixtureId)
      .get();
    const allSubs = subsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

    // Load audit logs for this fixture
    const fixLogsSnap = await db
      .collection(COLLECTIONS.AUDIT_LOGS)
      .where('entityId', '==', fixtureId)
      .get();
    const fixLogs = fixLogsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));

    // Check if admin-offline-user overwrote with 3-1
    const adminOfflineLogs = fixLogs.filter((l: any) => l.actorUserId === 'admin-offline-user');
    const hasAdminOffline31Overwrite = adminOfflineLogs.some(
      (l: any) =>
        (l.newValueJson && (l.newValueJson.includes('"homeScore":3') || l.newValueJson.includes('"3-1"'))) ||
        (fixtureData.homeScore === 3 && fixtureData.awayScore === 1)
    );

    const relatedAuditLogIds = fixLogs.map((l: any) => l.id);
    const relatedSyntheticSubIds = allSubs.filter((s: any) => isSyntheticIdentifier(s.submittedByUserId)).map((s: any) => s.id);

    report.suspiciousFixtures.push({
      fixtureId,
      reason: `Fixture modified by synthetic audit/replay actions`,
      competitionId: fixtureData.competitionId,
      homeClubId: fixtureData.homeClubId,
      awayClubId: fixtureData.awayClubId,
      currentStatus: fixtureData.status,
      currentHomeScore: fixtureData.homeScore,
      currentAwayScore: fixtureData.awayScore,
      winnerClubId: fixtureData.winnerClubId,
      resultConfirmedAt: fixtureData.resultConfirmedAt,
      adminOfflineOverwroteWith31: hasAdminOffline31Overwrite,
      auditLogIds: relatedAuditLogIds,
      syntheticSubmissionIds: relatedSyntheticSubIds,
    });

    // Score recovery analysis:
    // Identify original score ONLY when two legitimate, non-test submissions agree on homeScore and awayScore
    const legitimateSubmissions = allSubs.filter((s: any) => !isSyntheticIdentifier(s.submittedByUserId));

    let recoveryConfidence: 'HIGH' | 'MEDIUM' | 'MANUAL_REVIEW' = 'MANUAL_REVIEW';
    let homeScoreCandidate: number | null = null;
    let awayScoreCandidate: number | null = null;
    let originalScoreEvidence: string | null = null;
    let reason = '';
    let actionRequired = '';

    if (legitimateSubmissions.length >= 2) {
      const [s1, s2] = legitimateSubmissions;
      if (s1.homeScore === s2.homeScore && s1.awayScore === s2.awayScore) {
        recoveryConfidence = 'HIGH';
        homeScoreCandidate = s1.homeScore;
        awayScoreCandidate = s1.awayScore;
        originalScoreEvidence = `${s1.homeScore}-${s1.awayScore}`;
        reason = `Two legitimate, non-test submissions from "${s1.submittedByUserId}" and "${s2.submittedByUserId}" agree on score ${s1.homeScore}-${s1.awayScore}.`;
        actionRequired = `Safe to restore confirmed score to ${s1.homeScore}-${s1.awayScore} during recovery phase.`;
      } else {
        recoveryConfidence = 'MANUAL_REVIEW';
        reason = `Legitimate submissions disagree: (${s1.homeScore}-${s1.awayScore}) vs (${s2.homeScore}-${s2.awayScore}).`;
        actionRequired = `Manual admin adjudication required. Score cannot be guessed.`;
        report.manualReviewRequired.push({
          category: 'FIXTURE',
          entityId: fixtureId,
          issue: 'Conflicting legitimate submissions',
          evidence: { s1, s2 },
        });
      }
    } else if (legitimateSubmissions.length === 1) {
      recoveryConfidence = 'MEDIUM';
      homeScoreCandidate = legitimateSubmissions[0].homeScore;
      awayScoreCandidate = legitimateSubmissions[0].awayScore;
      originalScoreEvidence = `${homeScoreCandidate}-${awayScoreCandidate}`;
      reason = `Only one legitimate submission from "${legitimateSubmissions[0].submittedByUserId}" exists with score ${homeScoreCandidate}-${awayScoreCandidate}. Unilateral evidence.`;
      actionRequired = `Verify with opposing club manager or reset fixture to SCHEDULED / PENDING_CONFIRMATION.`;
    } else {
      recoveryConfidence = 'MANUAL_REVIEW';
      reason = `Zero legitimate submissions exist for this fixture. Current score was set purely by synthetic test script.`;
      actionRequired = `Reset fixture to SCHEDULED with null scores. Match was never played by real users.`;
      report.manualReviewRequired.push({
        category: 'FIXTURE',
        entityId: fixtureId,
        issue: 'Fixture contaminated by synthetic actor with zero legitimate submissions',
        evidence: {
          currentScore: `${fixtureData.homeScore}-${fixtureData.awayScore}`,
          adminOfflineOverwroteWith31: hasAdminOffline31Overwrite,
        },
      });
    }

    report.fixtureRecoveryCandidates.push({
      fixtureId,
      homeClubId: fixtureData.homeClubId,
      awayClubId: fixtureData.awayClubId,
      currentScore: `${fixtureData.homeScore ?? 'null'}-${fixtureData.awayScore ?? 'null'} (${fixtureData.status})`,
      originalScoreEvidence,
      homeScoreCandidate,
      awayScoreCandidate,
      legitimateSubmissionsCount: legitimateSubmissions.length,
      recoveryConfidence,
      reason,
      actionRequired,
    });
  }

  report.estimatedFirestoreReads = firestoreReadCounter;

  // Save report locally to artifacts/production-contamination-report.json
  const artifactsDir = path.resolve(process.cwd(), 'artifacts');
  if (!fs.existsSync(artifactsDir)) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const reportPath = path.join(artifactsDir, 'production-contamination-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log('\n================================================================');
  console.log('              FORENSIC AUDIT SUMMARY REPORT                     ');
  console.log('================================================================');
  console.log(`Report Location:           artifacts/production-contamination-report.json`);
  console.log(`Mode:                      STRICT READ-ONLY (ZERO PRODUCTION WRITES)`);
  console.log(`Estimated Firestore Reads: ${report.estimatedFirestoreReads}`);
  console.log(`Suspicious Club Claims:    ${report.suspiciousClubClaims.length}`);
  console.log(`Club Recovery Candidates:  ${report.clubRecoveryCandidates.length}`);
  console.log(`Suspicious Fixtures:       ${report.suspiciousFixtures.length}`);
  console.log(`Fixture Recovery Options:  ${report.fixtureRecoveryCandidates.length}`);
  console.log(`Safe-To-Delete Test Docs:  ${report.syntheticDocumentsSafeToDeleteLater.length}`);
  console.log(`Manual Reviews Required:   ${report.manualReviewRequired.length}`);
  console.log('================================================================\n');

  return report;
}

// Auto-run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runProductionContaminationAudit()
    .then(() => {
      console.log('✓ Forensic audit completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Fatal error during forensic audit:', err);
      process.exit(1);
    });
}
