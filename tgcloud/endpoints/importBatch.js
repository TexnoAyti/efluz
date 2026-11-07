import { db, EndpointError } from 'sdk';
import { verifiedTelegramId } from '../lib/auth.js';
import { validateImportBatch, stableRow } from '../lib/importBatch.js';

// Intentionally disabled until the owner sets both server-side migration settings.
// Never expose import authorization through a browser-provided token or role flag.
function assertMigrationOwner(ctx) {
  const id=verifiedTelegramId(ctx);
  const owner=typeof process!=='undefined' ? process.env.EFL_MIGRATION_OWNER_TELEGRAM_ID : '';
  const enabled=typeof process!=='undefined' ? process.env.EFL_MIGRATION_IMPORT_ENABLED : '';
  if (!owner || enabled!=='true' || id!==owner) {
    throw new EndpointError('Import yopiq.', {code:'IMPORT_DISABLED'});
  }
}
function normalize(value) {
  if (value===undefined) return null;
  if (typeof value==='boolean') return Number(value);
  if (value && typeof value==='object') return JSON.stringify(value);
  return value;
}
function equivalent(existing, incoming, cols) {
  return cols.every(key=>{
    const a=existing[key]===undefined ? null : existing[key];
    const b=normalize(incoming[key]);
    if (a===null || b===null) return a===null && b===null;
    // SQLite boolean and json decoding may differ between clients.
    if (typeof a==='object' || typeof b==='object') {
      try { return JSON.stringify(typeof a==='string' ? JSON.parse(a) : a) === JSON.stringify(typeof b==='string' ? JSON.parse(b) : b); }
      catch { return false; }
    }
    return String(a)===String(b);
  });
}
export default async function(input={},ctx) {
  assertMigrationOwner(ctx);
  let batch;
  try { batch=validateImportBatch(input); }
  catch(error) {throw new EndpointError('Import paketi noto‘g‘ri.',{code:error.message});}
  const {batchId,table,rows,columns,pk,sqlTable}=batch;
  // Stable content fingerprint detects batch IDs reused with different payloads.
  const signature=stableRow({table,rows},['table','rows']);
  const stateKey='import:'+table+':'+batchId;
  const previous=await db.get('SELECT checksum,status FROM efl_migration_state WHERE key=:key',{':key':stateKey});
  if (previous && previous.checksum!==signature) throw new EndpointError('Batch identifikatori avval boshqa ma’lumot uchun ishlatilgan.',{code:'BATCH_CONFLICT'});
  const cols=columns.map(k=>'"'+k+'"').join(',');
  const values=columns.map(k=>':'+k).join(',');
  let inserted=0, skipped=0;
  for (const row of rows) {
    const params=Object.fromEntries(columns.map(k=>[':'+k,normalize(row[k])]));
    const result=await db.run(`INSERT INTO ${sqlTable} (${cols}) VALUES (${values}) ON CONFLICT DO NOTHING`,params);
    const current=await db.get(`SELECT ${cols} FROM ${sqlTable} WHERE "${pk}"=:pk`,{':pk':row[pk]});
    if (!current || !equivalent(current,row,columns)) {
      throw new EndpointError('Mavjud ma’lumot bilan ziddiyat; import to‘xtatildi.',{code:'ROW_CONFLICT'});
    }
    if (result.rowsAffected>0) inserted++; else skipped++;
  }
  // A batch is completed only after every row has passed read-after-write verification.
  await db.run(`INSERT INTO efl_migration_state (key,cursor,status,checksum,details,updated_at)
    VALUES (:key,:cursor,'COMPLETE',:checksum,:details,:updated)
    ON CONFLICT(key) DO UPDATE SET status='COMPLETE',checksum=excluded.checksum,details=excluded.details,updated_at=excluded.updated_at
    WHERE efl_migration_state.checksum=excluded.checksum`,{
    ':key':stateKey,':cursor':String(rows.at(-1)[pk]),':checksum':signature,
    ':details':JSON.stringify({table,batchId,count:rows.length}),':updated':Date.now()
  });
  return {ok:true,table,batchId,inserted,skipped,total:rows.length,status:'COMPLETE'};
}
