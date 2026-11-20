import { EndpointError } from 'sdk';
import { db } from 'sdk';
import { verifiedTelegramId } from '../lib/auth.js';
import { IMPORT_CONTROL } from '../lib/importControl.js';
import { applyImportBatch } from '../lib/importEngine.js';

// Disabled by default. Owner ID and explicit switch must be server-side.
export function assertMigrationOwner(ctx) {
  const telegramId = verifiedTelegramId(ctx);
  if (!IMPORT_CONTROL.enabled || !IMPORT_CONTROL.ownerTelegramId || telegramId !== IMPORT_CONTROL.ownerTelegramId)
    throw new EndpointError('Import yopiq.', {code:'IMPORT_DISABLED'});
}
export default async function(input={},ctx) {
  assertMigrationOwner(ctx);
  try { return await applyImportBatch(db,input); }
  catch(error) {
    const code = String(error?.message || 'IMPORT_FAILED');
    const safe = /^(INVALID_|UNKNOWN_COLUMN|MISSING_COLUMN|DUPLICATE_IN_BATCH|ROW_CONFLICT|BATCH_CONFLICT)/.test(code);
    if (!safe) throw error;
    throw new EndpointError(`Import tekshiruvidan o‘tmadi: ${code}`, {code});
  }
}
