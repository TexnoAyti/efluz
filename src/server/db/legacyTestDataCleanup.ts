import { dbTransaction, queryAll, queryRun, saveDatabaseSync } from './index';
import { LEGACY_TEST_USER_IDS } from '../auth/telegramAuth';

export interface LegacyTestDataCleanupSummary {
  removedUsers: number;
  removedMemberships: number;
  removedOccupancies: number;
  removedNotifications: number;
  removedAuditLogs: number;
  removedResultSubmissions: number;
  removedDisputes: number;
  removedPendingMutations: number;
  removedTestFixtures: number;
  resetOfficialFixtures: number;
  clearedParticipants: number;
}

function isTestFixtureSource(source: unknown): boolean {
  const value = String(source || '').toLowerCase();
  return value === 'test' || value === 'dev' || value === 'offline_test' || value.includes('test');
}

function isExplicitTestFixtureId(id: unknown): boolean {
  const value = String(id || '').toLowerCase();
  return value.startsWith('offline-test-') || value.startsWith('test-') || value.startsWith('dev-test-') || value.startsWith('fixture-test-');
}

function placeholders(count: number): string { return new Array(count).fill('?').join(', '); }

function isKnownTestUserId(id: unknown): boolean {
  const value = String(id || '').toLowerCase();
  return userIdsForPredicate.has(value)
    || value.startsWith('user-lock-test-')
    || value.startsWith('user_a_')
    || value.startsWith('user_b_');
}

const userIdsForPredicate = new Set<string>([
  ...LEGACY_TEST_USER_IDS,
  'user-test-1',
  'user-test-2',
  'user-100001',
  'user-100002',
  'user-200001',
  'user-200002',
  'admin_test_user',
  'offline-test-user',
].map((v) => v.toLowerCase()));

/** Removes only known dev identities and explicitly marked test fixtures. Safe and idempotent. */
export function cleanupLegacyTestData(): LegacyTestDataCleanupSummary {
  const userIds = Array.from(new Set<string>([
    ...LEGACY_TEST_USER_IDS,
    'user-test-1',
    'user-test-2',
    'user-100001',
    'user-100002',
    'user-200001',
    'user-200002',
    'admin_test_user',
    'offline-test-user',
  ]));
  const summary: LegacyTestDataCleanupSummary = {
    removedUsers: 0, removedMemberships: 0, removedOccupancies: 0,
    removedNotifications: 0, removedAuditLogs: 0, removedResultSubmissions: 0,
    removedDisputes: 0, removedPendingMutations: 0, removedTestFixtures: 0,
    resetOfficialFixtures: 0, clearedParticipants: 0,
  };

  dbTransaction(() => {
    const markedFixtures = queryAll<any>(
      `SELECT id, fixture_source AS fixtureSource FROM fixtures
       WHERE lower(id) LIKE 'offline-test-%'
          OR lower(id) LIKE 'test-%'
          OR lower(id) LIKE 'dev-test-%'
          OR lower(id) LIKE 'fixture-test-%'
          OR lower(coalesce(fixture_source, '')) LIKE '%test%'
          OR lower(coalesce(fixture_source, '')) = 'dev'
          OR lower(coalesce(fixture_source, '')) = 'offline_test'`
    );
    const explicitFixtureIds = new Set<string>(
      markedFixtures
        .filter((row) => isExplicitTestFixtureId(row.id) || isTestFixtureSource(row.fixtureSource))
        .map((row) => String(row.id))
    );

    const dynamicTestUsers = queryAll<any>('SELECT id FROM users')
      .map((r) => String(r.id || ''))
      .filter((id) => isKnownTestUserId(id));
    for (const id of dynamicTestUsers) if (!userIds.includes(id)) userIds.push(id);

    const fakeSubmissionFixtures = userIds.length > 0
      ? queryAll<any>(
          `SELECT DISTINCT fixture_id AS fixtureId FROM result_submissions
           WHERE submitted_by_user_id IN (${placeholders(userIds.length)})`,
          userIds
        )
      : [];

    const officialFixturesToReset = new Set<string>();
    for (const row of fakeSubmissionFixtures) {
      const fixtureId = String(row.fixtureId || '');
      if (fixtureId && !explicitFixtureIds.has(fixtureId)) officialFixturesToReset.add(fixtureId);
    }

    // Remove disputes first because they can reference result submission rows.
    const disputeFixtureIds = new Set<string>([...explicitFixtureIds, ...officialFixturesToReset]);
    for (const fixtureId of disputeFixtureIds) {
      summary.removedDisputes += queryRun('DELETE FROM disputes WHERE fixture_id = ?', [fixtureId]).changes;
    }

    if (userIds.length > 0) {
      summary.removedResultSubmissions += queryRun(
        `DELETE FROM result_submissions WHERE submitted_by_user_id IN (${placeholders(userIds.length)})`, userIds
      ).changes;
      summary.removedMemberships += queryRun(
        `DELETE FROM club_memberships WHERE user_id IN (${placeholders(userIds.length)})`, userIds
      ).changes;
      summary.removedOccupancies += queryRun(
        `DELETE FROM active_occupancies_cache WHERE user_id IN (${placeholders(userIds.length)})`, userIds
      ).changes;
      summary.removedNotifications += queryRun(
        `DELETE FROM notifications WHERE user_id IN (${placeholders(userIds.length)})`, userIds
      ).changes;
      summary.removedAuditLogs += queryRun(
        `DELETE FROM audit_logs WHERE actor_user_id IN (${placeholders(userIds.length)})`, userIds
      ).changes;
      summary.clearedParticipants += queryRun(
        `UPDATE competition_participants SET owner_user_id = NULL
          WHERE owner_user_id IN (${placeholders(userIds.length)})`, userIds
      ).changes;
      summary.removedUsers += queryRun(
        `DELETE FROM users WHERE id IN (${placeholders(userIds.length)})`, userIds
      ).changes;
    }

    // Remove queued test work by deterministic IDs/payload markers.
    const pendingRows = queryAll<any>('SELECT mutation_id, entity_id, payload FROM pending_mutations');
    for (const row of pendingRows) {
      const mutationId = String(row.mutation_id || '').toLowerCase();
      const entityId = String(row.entity_id || '').toLowerCase();
      const payload = String(row.payload || '');
      const isTestMutation = mutationId.includes('test') || isExplicitTestFixtureId(entityId) || userIds.some((id) => payload.includes(id));
      if (isTestMutation) summary.removedPendingMutations += queryRun('DELETE FROM pending_mutations WHERE mutation_id = ?', [row.mutation_id]).changes;
    }

    for (const fixtureId of explicitFixtureIds) {
      summary.removedResultSubmissions += queryRun('DELETE FROM result_submissions WHERE fixture_id = ?', [fixtureId]).changes;
      summary.removedPendingMutations += queryRun('DELETE FROM pending_mutations WHERE entity_id = ?', [fixtureId]).changes;
      summary.removedTestFixtures += queryRun('DELETE FROM fixtures WHERE id = ?', [fixtureId]).changes;
    }

    for (const fixtureId of officialFixturesToReset) {
      const remaining = queryAll<any>('SELECT id FROM result_submissions WHERE fixture_id = ? LIMIT 1', [fixtureId]);
      if (remaining.length === 0) {
        summary.resetOfficialFixtures += queryRun(
          `UPDATE fixtures SET status = 'SCHEDULED', home_score = NULL, away_score = NULL,
                  winner_club_id = NULL, result_confirmed_at = NULL, updated_at = ?
            WHERE id = ? AND lower(coalesce(fixture_source, 'official_2026_27')) NOT LIKE '%test%'`,
          [new Date().toISOString(), fixtureId]
        ).changes;
      }
    }
  });

  saveDatabaseSync();
  return summary;
}
