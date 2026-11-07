import { EndpointError } from 'sdk';
import { db } from 'sdk';
import { verifiedTelegramId } from '../lib/auth.js';
import { applyImportBatch } from '../lib/importEngine.js';

// Disabled by default. Owner ID and explicit switch must be server-side.
export function assertMigrationOwner(ctx) {
  const telegramId = verifiedTelegramId(ctx);
  const owner = typeof process !== 'undefined' ? process.env.EFL_MIGRATION_OWNER_TELEGRAM_ID : '';
  const enabled = typeof process !== 'undefined' ? process.env.EFL_MIGRATION_IMPORT_ENABLED : '';
  if (!owner || enabled !== 'true' || telegramId !== owner)
    throw new EndpointError('Import yopiq.', {code:'IMPORT_DISABLED'});
}
export default async function(input={},ctx) {
  assertMigrationOwner(ctx);
  try { return await applyImportBatch(db,input); }
  catch(error) {
    const code = String(error?.message || 'IMPORT_FAILED');
    const safe = /^(INVALID_|UNKNOWN_COLUMN|MISSING_COLUMN|DUPLICATE_IN_BATCH|ROW_CONFLICT|BATCH_CONFLICT)/.test(code);
    if (!safe) throw error;
    throw new EndpointError('Import tekshiruvidan o‘tmadi.', {code});
  }
}
