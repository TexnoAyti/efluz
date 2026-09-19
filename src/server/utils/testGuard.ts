/**
 * Centralized production safety guard for EFL UZ.
 * DEFAULT-DENY POLICY: Strictly prevents test users, test matches, test results,
 * or test mutations from modifying any production or hosted database.
 */

import { getFirebaseStatus, initializeFirebaseAdmin } from '../firebase/admin';

export const PROD_PROJECT_ID = 'gen-lang-client-0195097895';
export const PROD_DATABASE_ID = 'ai-studio-efluz-4c6c88a6-697e-4fdf-82ed-45fec68ca34d';

export const SYNTHETIC_ID_PATTERNS = [
  'audit-',
  'test-',
  'test_',
  'admin_test',
  'admin-test',
  'admin-offline',
  'admin-audit',
  'offline-test',
  'fix-retry-test',
  'user_a_',
  'user_b_',
  'notif_b_',
  'spoofed_',
] as const;

/**
 * Checks whether the current process is running in any hosted environment.
 * Every hosted environment is treated as unsafe for test mutations, including ais-dev-* Cloud Run services.
 */
export function isHostedEnvironment(): boolean {
  // If forced local fallback is active, we are strictly in local in-memory emulation
  if (process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true') {
    return false;
  }
  return Boolean(
    (process.env.K_SERVICE && process.env.K_SERVICE.trim() !== '') ||
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NODE_ENV === 'production'
  );
}

/**
 * Checks whether the process is connected to the real production project or database.
 */
export function isConnectedToProductionFirestore(): boolean {
  // Under forced local fallback, we are connected to the isolated in-memory mock
  if (process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true') {
    return false;
  }

  // If hosted in production, treat as connected to production
  if (isHostedEnvironment()) {
    return true;
  }

  const status = getFirebaseStatus();
  if (status.authMode === 'local_fallback') {
    return false;
  }

  // Under verified local emulator for test project, we are not on production
  if (
    process.env.FIRESTORE_EMULATOR_HOST &&
    (status.projectId?.startsWith('demo-') || status.projectId?.startsWith('test-'))
  ) {
    return false;
  }

  // Otherwise, we are connected to real Firestore
  return true;
}

/**
 * Checks whether the process or configuration targets the real production project or database.
 */
export function isTargetingProductionProjectOrDb(): boolean {
  if (process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true') {
    return false;
  }

  const status = getFirebaseStatus();
  const envProjectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT;
  const envDbId = process.env.FIRESTORE_DATABASE_ID || process.env.FIREBASE_DATABASE_ID;

  if (
    status.projectId === PROD_PROJECT_ID ||
    status.databaseId === PROD_DATABASE_ID ||
    envProjectId === PROD_PROJECT_ID ||
    envDbId === PROD_DATABASE_ID
  ) {
    return true;
  }
  return false;
}

/**
 * Checks if a string contains any recognized synthetic or test pattern.
 */
export function isSyntheticIdentifier(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') return false;
  const lower = id.toLowerCase();
  return SYNTHETIC_ID_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Validates if test mutations are permitted under strict default-deny policy.
 * Test mutations may be allowed ONLY when one of these is true:
 * 1. FIREBASE_FORCE_LOCAL_FALLBACK === "true", and getFirestoreDb is guaranteed
 *    to return the isolated in-memory implementation;
 * 2. FIRESTORE_EMULATOR_HOST is configured and the Firebase project ID begins with "demo-" or "test-".
 *
 * ALLOW_TEST_WRITES alone must NEVER authorize Firestore writes.
 * Any hosted environment is strictly unsafe.
 */
export function isTestSafe(): boolean {
  // Path 1: Local In-Memory Fallback
  if (process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true') {
    const { info } = initializeFirebaseAdmin();
    if (info.authMode === 'local_fallback') {
      return true;
    }
  }

  // Hosted environments (Cloud Run, Vercel, production) are NEVER safe for test mutations
  if (isHostedEnvironment()) {
    return false;
  }

  // Path 2: Verified Local Emulator with demo- or test- project
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const projId =
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      '';
    if (projId.startsWith('demo-') || projId.startsWith('test-')) {
      return true;
    }
  }

  return false;
}

/**
 * Throws a fatal safety violation if the environment is not verified safe for test mutations.
 */
export function assertTestEnvironmentSafe(actionName = 'test_mutation'): void {
  if (!isTestSafe()) {
    const reasons: string[] = [];
    if (isHostedEnvironment()) reasons.push('hosted environment detected (K_SERVICE/VERCEL/NODE_ENV=production)');
    if (isTargetingProductionProjectOrDb()) reasons.push('production project/database targeted');
    if (process.env.ALLOW_TEST_WRITES === 'true') reasons.push('ALLOW_TEST_WRITES is deprecated and cannot authorize writes');
    if (process.env.FIREBASE_FORCE_LOCAL_FALLBACK !== 'true' && !process.env.FIRESTORE_EMULATOR_HOST) {
      reasons.push('neither FIREBASE_FORCE_LOCAL_FALLBACK=true nor FIRESTORE_EMULATOR_HOST is configured');
    }

    const errorMsg = `PRODUCTION_SAFETY_VIOLATION: Test mutation "${actionName}" is strictly prohibited. Production database cannot be modified by test helpers or mock data. Violations: [${reasons.join('; ')}]`;
    console.error(`[CRITICAL PRODUCTION BLOCKED] ${errorMsg}`);
    throw new Error(errorMsg);
  }
}

/**
 * Checks if an entity ID or username indicates a synthetic/test record.
 * If so, verifies that test mutations are safe, otherwise blocks immediately.
 */
export function guardAgainstTestEntityCreation(entityType: string, entityId: string, entityNameOrUsername?: string): void {
  if (isSyntheticIdentifier(entityId) || isSyntheticIdentifier(entityNameOrUsername)) {
    assertTestEnvironmentSafe(`create_${entityType}:${entityId}`);
  }
}

/**
 * Production guard to reject synthetic actor IDs or entity IDs before any mutation.
 * When connected to the real production project/database or running in a hosted environment,
 * rejects any synthetic identifier with a fatal error before any Firestore or SQLite write.
 */
export function assertNoSyntheticIdsInProduction(
  actionName: string,
  ids: Array<string | null | undefined>
): void {
  // If connected to real production, hosted environment, or outside safe test sandbox, strictly reject synthetic IDs
  if (!isConnectedToProductionFirestore()) {
    return;
  }

  for (const id of ids) {
    if (isSyntheticIdentifier(id)) {
      const errorMsg = `PRODUCTION_SAFETY_VIOLATION: Synthetic identifier "${id}" rejected in production/hosted environment during "${actionName}". Mutation blocked before persistence.`;
      console.error(`[CRITICAL PRODUCTION BLOCKED] ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }
}
