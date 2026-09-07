import { dbTransaction, queryAll, queryRun } from './index';
import { saveDatabaseSync } from './index';
import { LEGACY_TEST_USER_IDS } from '../auth/telegramAuth';

const TEST_FIXTURE_ID_PATTERNS = [
  'offline-test-%',
  'test-%',
  'dev-test-%',
  'fixture-test-%',
];

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

function buildPlaceholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

/**
 * Removes only known developer/test identities and explicitly marked test fixtures.
 * Legitimate user accounts and official fixtures are preserved.
 * Idempotent: safe to run at every local/runtime initialization.
 */
export function cleanupLegacyTestData(): LegacyTestDataCleanupSummary {
  const userIds = Array.from(LEGACY_TEST_USER_IDS);
  const summary: LegacyTestDataCleanupSummary = {
    removedUsers: 0,
    removedMemberships: 0,
    removedOccupancies: 0,
    removedNotifications: 0,
    removedAuditLogs: 0,
    removedResultSubmissions: 0,
    removedDisputes: 0,
    removedPendingMutations: 0,
    removedTestFixtures: 0,
    resetOfficialFixtures: 0,
    clearedParticipants: 0,
  };

  dbTransaction(() => {
    const testFixtureRows: any[] = queryAll(
      `SELECT id, fixture_source AS fixtureSource FROM fixtures WHERE
        lower(id) LIKE 'offline-test-%' OR
        lower(id) LIKE 'test-%' OR
        lower(id) LIKE 'dev-test-%' OR
        lower(id) LIKE 'fixture-test-%' OR
        lower(coalesce(fixture_source, '')) LIKE '%test%' OR
        lower(coalesce(fixture_source, '')) = 'dev' OR
        lower(coalesce(fixture_source, '')) = 'offline_test'`
    );
    const explicitTestFixtureIds = new Set<string>(
      testFixtureRows.filter((row) => isTestFixtureSource(row.fixtureSource) || row.id).map((row) => String(row.id))
    );

    const fakeSubmissionFixtureRows = userIds.length > 0
      ? queryAll<any>(
          `SELECT DISTINCT fixture_id AS fixtureId FROM result_submissions WHERE submitted_by_user_id IN (${buildPlaceholders(userIds.length)})`,
          userIds
        )
      : [];

    const officialFixtureIdsToReset = new Set<string>();
    for (const row of fakeSubmissionFixtureRows) {
      const fixtureId = String(row.fixtureId || '');
      if (fixtureId && !explicitTestFixtureIds.has(fixtureId)) officialFixtureIdsToReset.add(fixtureId);
    }

    if (userIds.length > 0) {
      summary.removedResultSubmissions += queryRun(
        `DELETE FROM result_submissions WHERE submitted_by_user_id IN (${buildPlaceholders(userIds.length)})`,
        userIds
      ).changes;
      summary.removedMemberships += queryRun(
        `DELETE FROM club_memberships WHERE user_id IN (${buildPlaceholders(userIds.length)})`,
        userIds
      ).changes;
      summary.removedOccupancies += queryRun(
        `DELETE FROM active_occupancies_cache WHERE user_id IN (${buildPlaceholders(userIds.length)})`,
        userIds
      ).changes;
      summary.removedNotifications += queryRun(
        `DELETE FROM notifications WHERE user_id IN (${buildPlaceholders(userIds.length)})`,
        userIds
      ).changes;
      summary.removedAuditLogs += queryRun(
        `DELETE FROM audit_logs WHERE actor_user_id IN (${buildPlaceholders(userIds.length)})`,
        userIds
      ).changes;
      summary.removedPendingMutations += queryRun(
        `DELETE FROM pending_mutations WHERE entity_id IN (${buildPlaceholders(userIds.length)}) OR payload LIKE ANY_TEST_PAYLOAD`,
        []
      ).changes;
      summary.clearedParticipants += queryRun(
        `UPDATE competition_participants SET owner_user_id = NULL WHERE owner_user_id IN (${buildPlaceholders(userIds.length)})`,
        userIds
      ).changes;
      summary.removedUsers += queryRun(
        `DELETE FROM users WHERE id IN (${buildPlaceholders(userIds.length)})`,
        userIds
      ).changes;
    }

    for (const fixtureId of explicitTestFixtureIds) {
      queryRun('DELETE FROM disputes WHERE fixture_id = ?', [fixtureId]);
      queryRun('DELETE FROM result_submissions WHERE fixture_id = ?', [fixtureId]);
      queryRun('DELETE FROM pending_mutations WHERE entity_id = ?', [fixtureId]);
      summary.removedTestFixtures += queryRun('DELETE FROM fixtures WHERE id = ?', [fixtureId]).changes;
    }

    for (const fixtureId of officialFixtureIdsToReset) {
      const remaining = queryAll<any>('SELECT id FROM result_submissions WHERE fixture_id = ? LIMIT 1', [fixtureId]);
      if (remaining.length === 0) {
        summary.resetOfficialFixtures += queryRun(
          `UPDATE fixtures
             SET status = 'SCHEDULED',
                 home_score = NULL,
                 away_score = NULL,
                 winner_club_id = NULL,
                 result_confirmed_at = NULL,
                 updated_at = ?
           WHERE id = ? AND lower(coalesce(fixture_source, 'official_2026_27')) NOT LIKE '%test%'`,
          [new Date().toISOString(), fixtureId]
        ).changes;
        queryRun('DELETE FROM disputes WHERE fixture_id = ?', [fixtureId]);
      }
    }
  });

  saveDatabaseSync();
  return summary;
}
