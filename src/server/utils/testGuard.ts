/**
 * Centralized production safety guard for EFL UZ.
 * Strictly prevents random test users, test matches, test results,
 * or test mutations from being created or persisted in production.
 */

export function isTestSafe(): boolean {
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production' ||
    Boolean(process.env.K_SERVICE);

  const isTestExplicitlyAllowed = process.env.ALLOW_TEST_WRITES === 'true';

  return !isProduction && isTestExplicitlyAllowed;
}

export function assertTestEnvironmentSafe(actionName = 'test_mutation'): void {
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL_ENV === 'production' ||
    Boolean(process.env.K_SERVICE);

  const isTestExplicitlyAllowed = process.env.ALLOW_TEST_WRITES === 'true';

  if (isProduction || !isTestExplicitlyAllowed) {
    const errorMsg = `PRODUCTION_SAFETY_VIOLATION: Test mutation "${actionName}" is strictly prohibited. Production database cannot be modified by test helpers or mock data.`;
    console.error(`[CRITICAL PRODUCTION BLOCKED] ${errorMsg}`);
    throw new Error(errorMsg);
  }
}

/**
 * Checks if an entity ID or username indicates a synthetic/test record.
 * If so, verifies that test mutations are safe, otherwise blocks immediately.
 */
export function guardAgainstTestEntityCreation(entityType: string, entityId: string, entityNameOrUsername?: string): void {
  const isTestId =
    entityId.startsWith('test-') ||
    entityId.startsWith('test_') ||
    entityId.startsWith('audit-player-') ||
    entityId.startsWith('user-persistence-test') ||
    entityId.startsWith('user-lock-test') ||
    entityId.startsWith('user-1010') ||
    entityId.includes('test_fixture') ||
    entityId.includes('mock_');

  const isTestName =
    entityNameOrUsername &&
    (entityNameOrUsername.startsWith('test_') ||
      entityNameOrUsername.startsWith('tester_') ||
      entityNameOrUsername.includes('mock_user'));

  if (isTestId || isTestName) {
    assertTestEnvironmentSafe(`create_${entityType}:${entityId}`);
  }
}
