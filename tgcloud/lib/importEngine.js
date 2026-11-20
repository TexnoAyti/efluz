import { validateImportBatch, stableRow } from './importBatch.js';

// Dependency-injected implementation for isolated testing without Telegram SDK.
const JSON_FIELDS = new Set(['settings','format_config','data','encoded','old_value','new_value','league_overrides','source_record','details','state','source_value']);

export function comparableValue(value, column) {
  if (value === undefined || value === null) return null;
  if (column === 'source_value') return JSON.stringify(value);
  if (typeof value === 'boolean') return Number(value);
  if (JSON_FIELDS.has(column) && typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}
function canonicalJson(value) {
  if (value === null || value === undefined) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return stableRow({value:parsed}, ['value']);
  } catch { return { invalidJson: true }; }
}
export function rowsEquivalent(actual, incoming, columns) {
  return columns.every(column => {
    const a = actual[column] ?? null;
    const b = incoming[column] ?? null;
    if (a === null || b === null) return a === null && b === null;
    if (JSON_FIELDS.has(column)) return canonicalJson(a) === canonicalJson(b);
    if (typeof b === 'boolean') return (a === true || a === 1 || a === '1') === b;
    return String(a) === String(b);
  });
}
export async function applyImportBatch(db, input) {
  const batch = validateImportBatch(input);
  const {table,batchId,rows,columns,pk,sqlTable} = batch;
  const replaceExisting = input?.stagingReplaceExisting === true;
  const signature = stableRow({table,rows}, ['table','rows']);
  const key = 'import:'+table+':'+batchId;
  const prior = await db.get(
    'SELECT checksum,status FROM efl_migration_state WHERE key=:key',
    {':key':key}
  );
  if (prior && prior.checksum !== signature) throw new Error('BATCH_CONFLICT');

  const names = columns.map(c => '"'+c+'"').join(',');
  const params = columns.map(c => ':'+c).join(',');
  // Preflight EVERY existing row before the first mutation. Without this,
  // a conflicting row late in the packet could leave earlier new rows written
  // despite the batch being rejected. Crashes during writes are still handled
  // by idempotent replay; do not claim multi-row transactional atomicity.
  let previouslyPresent = 0;
  for (const row of rows) {
    const lookup = {':pk':row[pk]};
    const existing = await db.get(
      `SELECT ${names} FROM ${sqlTable} WHERE "${pk}"=:pk`,lookup
    );
    if (existing && !replaceExisting && !rowsEquivalent(existing,row,columns))
      throw new Error('ROW_CONFLICT');
    if (existing) previouslyPresent++;
  }
  for (const row of rows) {
    const lookup = {':pk':row[pk]};
    const values = Object.fromEntries(columns.map(c => [':'+c, comparableValue(row[c],c)]));
    const writeSql = replaceExisting
      ? `INSERT INTO ${sqlTable} (${names}) VALUES (${params})
         ON CONFLICT ("${pk}") DO UPDATE SET ${columns.filter(c=>c!==pk).map(c=>`"${c}"=excluded."${c}"`).join(',')}`
      : `INSERT INTO ${sqlTable} (${names}) VALUES (${params}) ON CONFLICT DO NOTHING`;
    await db.run(writeSql, values);
    const persisted = await db.get(
      `SELECT ${names} FROM ${sqlTable} WHERE "${pk}"=:pk`,lookup
    );
    if (!persisted || !rowsEquivalent(persisted,row,columns)) throw new Error('ROW_CONFLICT');
  }
  const stateWrite = await db.run(
    `INSERT INTO efl_migration_state (key,cursor,status,checksum,details,updated_at)
    VALUES (:key,:cursor,'COMPLETE',:checksum,:details,:updated)
    ON CONFLICT(key) DO UPDATE SET cursor=excluded.cursor,status='COMPLETE',
    checksum=excluded.checksum,details=excluded.details,updated_at=excluded.updated_at
    WHERE efl_migration_state.checksum=excluded.checksum`,
    {':key':key,':cursor':String(rows.at(-1)[pk]),':checksum':signature,
      ':details':JSON.stringify({table,batchId,count:rows.length}),
      ':updated':Date.now()}
  );
  // If another writer claimed the batch ID with different content, the
  // compare-and-update clause leaves it unchanged. Recheck before success.
  const complete = await db.get(
    'SELECT checksum,status FROM efl_migration_state WHERE key=:key',
    {':key':key}
  );
  if (!complete || complete.checksum !== signature || complete.status !== 'COMPLETE')
    throw new Error('BATCH_CONFLICT');
  // Raw SDK db.run does not guarantee a rowsAffected counter. Report
  // independently verified rows and preexisting rows, never invented inserts.
  return {ok:true,table,batchId,verified:rows.length,previouslyPresent,
    total:rows.length,status:'COMPLETE'};
}
