// Pure, side-effect-free validation used by the shadow migration endpoint.
// Import never deletes, overwrites, or reallocates existing production ownership.
export const IMPORT_TABLES = Object.freeze({
  users: ['id','telegram_id','username','first_name','last_name','is_admin','is_banned','created_at','updated_at'],
  seasons: ['id','name','status','is_active','settings','starts_at','ends_at','created_at','updated_at'],
  leagues: ['id','season_id','name','country','continent','logo_url','capacity','sort_order','status','current_round','created_at','updated_at'],
  clubs: ['id','league_id','name','short_name','country','logo_url','stadium','sort_order','created_at','updated_at'],
  clubOccupancies: ['id','season_id','league_id','club_id','user_id','telegram_id','status','joined_at','released_at','updated_at'],
  fixtures: ['id','season_id','competition_id','league_id','round','home_club_id','away_club_id','home_telegram_id','away_telegram_id','home_score','away_score','status','confirmation_status','scheduled_at','played_at','updated_at'],
  matchAccess: ['match_id','home_telegram_id','away_telegram_id','writable','updated_at'],
  matchMessages: ['id','match_id','sender_telegram_id','client_id','body','created_at'],
  competitions: ['id','season_id','league_id','name','type','schedule_mode','status','format_config','current_matchday','is_matchday_open','created_at','updated_at'],
  participants: ['id','competition_id','season_id','club_id','owner_user_id','seed_number','source_competition_id','source_position','qualification_reason','created_at'],
  resultSubmissions: ['id','fixture_id','submitted_by_user_id','club_id','home_score','away_score','home_extra_time_score','away_extra_time_score','home_penalty_score','away_penalty_score','proof_url','created_at'],
  disputes: ['id','fixture_id','season_id','home_submission_id','away_submission_id','status','resolved_by_user_id','resolution_notes','created_at','resolved_at'],
  notifications: ['id','user_id','type','title','message','data','is_read','created_at'],
  auditLogs: ['id','actor_user_id','actor_username','action','entity_type','entity_id','old_value','new_value','created_at'],
  rawDocuments: ['id','source_space','collection_path','document_id','encoded','data','source_checksum'],
  rawDocumentParts: ['id','source_document_id','source_space','collection_path','document_id','part_index','part_count','part_data','source_checksum','part_checksum'],
});
export const SQL_TABLES = Object.freeze({
  users:'efl_users',seasons:'efl_seasons',leagues:'efl_leagues',clubs:'efl_clubs',
  clubOccupancies:'efl_club_occupancies',fixtures:'efl_fixtures',
  matchAccess:'efl_match_access',matchMessages:'efl_match_messages',
  competitions:'efl_competitions',participants:'efl_competition_participants',
  resultSubmissions:'efl_result_submissions',disputes:'efl_disputes',
  notifications:'efl_notifications',auditLogs:'efl_audit_logs',rawDocuments:'efl_raw_documents',rawDocumentParts:'efl_raw_document_parts'
});
export const PRIMARY_KEYS = Object.freeze({
  users:'id',seasons:'id',leagues:'id',clubs:'id',
  clubOccupancies:'id',fixtures:'id',matchAccess:'match_id',matchMessages:'id',
  competitions:'id',participants:'id',resultSubmissions:'id',disputes:'id',
  notifications:'id',auditLogs:'id',rawDocuments:'id',rawDocumentParts:'id'
});
const has = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export function stableRow(row, columns) {
  return JSON.stringify(columns.map(k=>canonical(row[k] === undefined ? null : row[k])));
}
export function validateImportBatch(input) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw new Error('INVALID_BATCH');
  // Telegram Serverless calls must remain bounded even if the row count is small.
  // This also prevents one oversized JSON document from exhausting the isolate.
  let packetBytes;
  try { packetBytes = JSON.stringify(input).length; }
  catch { throw new Error('INVALID_BATCH_ENCODING'); }
  if (packetBytes > 98304) throw new Error('INVALID_BATCH_BYTES');
  const { table, batchId, rows } = input;
  if (!has(IMPORT_TABLES,table)) throw new Error('INVALID_TABLE');
  if (typeof batchId!=='string' || !/^[a-zA-Z0-9_:-]{8,120}$/.test(batchId)) throw new Error('INVALID_BATCH_ID');
  if (!Array.isArray(rows) || rows.length<1 || rows.length>100) throw new Error('INVALID_BATCH_SIZE');
  const columns=IMPORT_TABLES[table], pk=PRIMARY_KEYS[table], ids=new Set();
  for (const row of rows) {
    if (!row || typeof row!=='object' || Array.isArray(row) || !has(row,pk)) throw new Error('INVALID_ROW');
    if (typeof row[pk]!=='string' && !(table==='matchMessages' && Number.isSafeInteger(row[pk]) && row[pk]>0)) throw new Error('INVALID_PRIMARY_KEY');
    if (!String(row[pk]).trim() || String(row[pk]).length>160) throw new Error('INVALID_PRIMARY_KEY');
    if (Object.keys(row).some(k=>!columns.includes(k))) throw new Error('UNKNOWN_COLUMN');
    if (columns.some(k=>!has(row,k))) throw new Error('MISSING_COLUMN');
    if (Object.values(row).some(v=>v===undefined || (typeof v==='number' && !Number.isFinite(v)))) throw new Error('INVALID_VALUE');
    // Every non-JSON database column must be scalar; no implicit stringification
    // of objects, functions or symbols can enter IDs, statuses or score fields.
    for (const [key,value] of Object.entries(row)) {
      if (value === null) continue;
      if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint')
        throw new Error('INVALID_VALUE');
      if (!['settings','format_config','data','encoded','old_value','new_value'].includes(key) &&
        (typeof value === 'object' || Array.isArray(value))) throw new Error('INVALID_VALUE');
    }
    if (table === 'rawDocuments' &&
      (!row.data || typeof row.data !== 'object' || Array.isArray(row.data) ||
       !row.encoded || typeof row.encoded !== 'object' || Array.isArray(row.encoded) ||
       typeof row.source_checksum !== 'string' || !/^[a-f0-9]{64}$/.test(row.source_checksum)))
      throw new Error('INVALID_ARCHIVE_ROW');

    if (table === 'rawDocumentParts') {
      if(!/^[a-f0-9]{64}$/.test(String(row.id))||
         !/^[a-f0-9]{64}$/.test(String(row.source_document_id))||
         !/^[a-f0-9]{64}$/.test(String(row.source_checksum))||
         !/^[a-f0-9]{64}$/.test(String(row.part_checksum))||
         row.source_space!=='production'||
         typeof row.collection_path!=='string'||!row.collection_path||
         typeof row.document_id!=='string'||!row.document_id||
         !Number.isSafeInteger(row.part_index)||row.part_index<0||
         !Number.isSafeInteger(row.part_count)||row.part_count<1||
         row.part_index>=row.part_count||
         typeof row.part_data!=='string'||row.part_data.length>70000||
         !/^[A-Za-z0-9+/]+={0,2}$/.test(row.part_data))
        throw new Error('INVALID_ARCHIVE_PART');
    }
    if (ids.has(String(row[pk]))) throw new Error('DUPLICATE_IN_BATCH');
    ids.add(String(row[pk]));
  }
  return {table,batchId,rows,columns,pk,sqlTable:SQL_TABLES[table]};
}
