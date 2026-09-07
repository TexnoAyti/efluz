import { LEGACY_TEST_USER_IDS, isDevAuthEnabled } from '../auth/telegramAuth';
import { initDatabase, queryAll, queryRun } from '../db';
import { cleanupLegacyTestData } from '../db/legacyTestDataCleanup';

async function main(): Promise<void> {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousEnableDevAuth = process.env.ENABLE_DEV_AUTH;
  try {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_DEV_AUTH = 'true';
    if (isDevAuthEnabled()) throw new Error('Dev auth must remain disabled on hosted production runtimes.');

    await initDatabase();

    const fixtureId = `dev-data-safety-test-${Date.now()}`;
    const userId = 'user-dev-a';
    const now = new Date().toISOString();

    queryRun(`INSERT OR REPLACE INTO users (id, telegram_id, username, first_name, last_name, is_admin, is_suspended, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
      [userId, '10001', 'arsenal_pro', 'Test', 'User', now, now]);
    const clubs = queryAll<any>(`SELECT id FROM clubs WHERE league_id = 'league-premier-league' ORDER BY id LIMIT 2`);
    if (clubs.length < 2) throw new Error('SQLite baseline does not contain two clubs.');
    queryRun(`INSERT INTO fixtures
      (id, season_id, competition_id, matchday, round_name, home_club_id, away_club_id, scheduled_at, status,
       home_score, away_score, winner_club_id, result_confirmed_at, created_at, updated_at, fixture_source)
      VALUES (?, 'season-2026-27', 'comp-premier-league-2026', 1, 'dev test', ?, ?, ?, 'CONFIRMED', 4, 0, ?, ?, ?, ?, 'test')`,
      [fixtureId, clubs[0].id, clubs[1].id, now, clubs[0].id, now, now, now]);

    const before = queryAll<any>('SELECT id FROM users WHERE id = ?', [userId]).length;
    if (before !== 1) throw new Error('Test user fixture setup failed.');

    cleanupLegacyTestData();

    const afterUser = queryAll<any>('SELECT id FROM users WHERE id = ?', [userId]).length;
    const afterFixture = queryAll<any>('SELECT id FROM fixtures WHERE id = ?', [fixtureId]).length;
    if (afterUser !== 0) throw new Error('Legacy test user was not cleaned.');
    if (afterFixture !== 0) throw new Error('Legacy test fixture was not cleaned.');
    if (!LEGACY_TEST_USER_IDS.has(userId)) throw new Error('Legacy test identity registry missing expected user.');

    console.log('DEV_DATA_SAFETY_TEST: PASS');
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
    process.env.ENABLE_DEV_AUTH = previousEnableDevAuth;
  }
}

void main().catch((error) => {
  console.error('DEV_DATA_SAFETY_TEST: FAIL');
  console.error(error);
  process.exitCode = 1;
});
