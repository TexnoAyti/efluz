import assert from 'node:assert/strict';
import { prepareEssentialNotifications } from '../services/essentialNotificationPreparation';
import { backlogReminderWindowOpen } from '../services/leagueBacklogReminders';

const original = { ...process.env };

try {
  assert.equal(backlogReminderWindowOpen(Date.parse('2026-11-14T03:00:00Z')), true, '08:00 Tashkent cron must be inside the delivery window');
  assert.equal(backlogReminderWindowOpen(Date.parse('2026-11-14T22:00:00Z')), false, '03:00 Tashkent must stay outside the delivery window');
  process.env.MIGRATION_WRITE_FREEZE = 'true';
  process.env.DATABASE_PROVIDER = 'supabase';
  process.env.SUPABASE_DATA_NAMESPACE = 'production';
  assert.equal(await prepareEssentialNotifications(), false, 'migration freeze must block preparation');

  process.env.MIGRATION_WRITE_FREEZE = 'false';
  process.env.SUPABASE_DATA_NAMESPACE = 'preview';
  assert.equal(await prepareEssentialNotifications(), false, 'preview must never prepare production notifications');

  console.log('PASS essential notification preparation stays fail-closed outside writable production');
} finally {
  process.env = original;
}
