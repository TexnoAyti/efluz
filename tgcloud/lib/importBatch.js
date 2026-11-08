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
  ticketBalances: ['id','user_id','telegram_id','balance','total_granted','total_spent','total_refunded','free_ticket_granted_at','updated_at'],
  ticketTransactions: ['id','user_id','type','amount','idempotency_key','note','performed_by_admin_id','tournament_id','created_at'],
  playerTrophies: ['id','season_id','competition_id','club_id','winner_user_id','winner_username','club_name','competition_name','active','decided_by','evaluated_at','confirmed_at'],
  retentionDecisions: ['id','user_id','season_id','source_season_id','club_id','choice','decided_at'],
  premiumEntitlements: ['id','user_id','season_id','status','source','note','payment_charge_id','activated_at','revoked_at','revoked_by','updated_at','updated_by'],
  clubAdmissions: ['id','season_id','enabled','automatic','stage','revision','league_overrides','updated_by','updated_at'],
  clubSelectionBans: ['id','user_id','telegram_id','is_banned','reason','actor_id','revision','updated_at'],
  clubMembershipHistory: ['id','source_id','user_id','club_id','season_id','source_status','reference_status','claimed_at','updated_at','released_at','source_record'],
  userMembershipHistory: ['id','source_id','user_id','club_id','season_id','source_status','reference_status','claimed_at','updated_at','released_at','source_record'],
  uzeflifeAuditHistory: ['id','action','actor','revision','occurred_at','details','source_record'],
  uzeflifeNoticeHistory: ['id','source_status','created_at','notice_count','replay_policy','source_sha256'],
  notificationReadState: ['id','user_id','state'],
  matchdayLockHistory: ['id','competition_id','season_id','matchday','source_is_open','source_is_locked','override_status','updated_at','reference_status','source_record'],
  matchDeadlineHistory: ['id','fixture_id','competition_id','season_id','matchday','deadline_at','created_at','reference_status','source_record'],
  banAuditHistory: ['id','user_id','telegram_id','is_banned','previous_is_banned','revision','updated_at','source_record','replay_policy'],
  banControlHistory: ['id','target_user_id','expected_revision','originally_consumed','expires_at','source_record','replay_policy'],
  customTournamentHistory: ['id','name','organizer_user_id','status','format','max_participants','source_sha256','replay_policy'],
  customTournamentParticipantHistory: ['id','tournament_id','user_id','club_id','status','source_sha256','replay_policy'],
  customTournamentFixtureHistory: ['id','tournament_id','status','stage','leg','round','match_index','source_sha256','replay_policy'],
  customTournamentAuditHistory: ['id','tournament_id','action','actor_user_id','source_sha256','replay_policy'],
  telegramTagHistory: ['id','user_id','season_id','telegram_id','applied_tag','source_managed','source_record','replay_policy'],
  telegramTagStateHistory: ['id','source_value','source_expires_at','replay_policy'],
  matchChatRoomHistory: ['id','match_id','season_id','source_closed','participant_count','message_count','source_sha256','replay_policy'],
  matchdayJobHistory: ['id','competition_id','season_id','matchday','source_status','source_sha256','replay_policy'],
  standingsHistory: ['id','competition_id','season_id','source_row_count','source_played','reference_status','source_sha256','replay_policy'],
  teamTicketBalances: ['id','user_id','balance','total_granted','total_revoked','total_spent','updated_at'],
  teamTicketTransactions: ['id','user_id','type','amount','actor_id','team_id','note','created_at'],
  ticketIdempotencyHistory: ['id','user_id','transaction_id','tournament_id','created_at'],
  sealedLegacyHistory: ['id','source_space','collection_path','document_id','source_checksum','source_bytes','handling'],
  rawDocuments: ['id','source_space','collection_path','document_id','encoded','data','source_checksum'],
  rawDocumentParts: ['id','source_document_id','source_space','collection_path','document_id','part_index','part_count','part_data','source_checksum','part_checksum'],
  uzeflifeState: ['id','name','status','format','current_round','total_rounds','round_hours','participants_count','matches_count','source_revision'],
  uzeflifeEntrants: ['id','name','status'],
  uzeflifeFixtures: ['id','round','bracket','home','away','winner','home_score','away_score','penalty_home','penalty_away','deadline_at'],
  teamsCatalog: ['id','name','owner_user_id','admin_user_id','unresolved_member_count','logo_url','member_count','membership_required','updated_at'],
  teamMembers: ['id','team_id','source_member_id','user_id','member_name','status','created_at','updated_at'],
});
export const SQL_TABLES = Object.freeze({
  users:'efl_users',seasons:'efl_seasons',leagues:'efl_leagues',clubs:'efl_clubs',
  clubOccupancies:'efl_club_occupancies',fixtures:'efl_fixtures',
  matchAccess:'efl_match_access',matchMessages:'efl_match_messages',
  competitions:'efl_competitions',participants:'efl_competition_participants',
  resultSubmissions:'efl_result_submissions',disputes:'efl_disputes',
  notifications:'efl_notifications',auditLogs:'efl_audit_logs',
  ticketBalances:'efl_ticket_balances',ticketTransactions:'efl_ticket_transactions',playerTrophies:'efl_player_trophies',retentionDecisions:'efl_retention_decisions',premiumEntitlements:'efl_premium_entitlements',clubAdmissions:'efl_club_admissions',clubSelectionBans:'efl_club_selection_bans',clubMembershipHistory:'efl_club_membership_history',userMembershipHistory:'efl_user_membership_history',uzeflifeAuditHistory:'efl_uzeflife_audit_history',uzeflifeNoticeHistory:'efl_uzeflife_notice_history',notificationReadState:'efl_notification_read_state',matchdayLockHistory:'efl_matchday_lock_history',matchDeadlineHistory:'efl_match_deadline_history',banAuditHistory:'efl_ban_audit_history',banControlHistory:'efl_ban_control_history',customTournamentHistory:'efl_custom_tournament_history',customTournamentParticipantHistory:'efl_custom_tournament_participant_history',customTournamentFixtureHistory:'efl_custom_tournament_fixture_history',customTournamentAuditHistory:'efl_custom_tournament_audit_history',telegramTagHistory:'efl_telegram_tag_history',telegramTagStateHistory:'efl_telegram_tag_state_history',matchChatRoomHistory:'efl_match_chat_room_history',matchdayJobHistory:'efl_matchday_job_history',standingsHistory:'efl_standings_history',teamTicketBalances:'efl_team_ticket_balances',teamTicketTransactions:'efl_team_ticket_transactions',ticketIdempotencyHistory:'efl_ticket_idempotency_history',sealedLegacyHistory:'efl_sealed_legacy_history',rawDocuments:'efl_raw_documents',rawDocumentParts:'efl_raw_document_parts',uzeflifeState:'efl_uzeflife_state',uzeflifeEntrants:'efl_uzeflife_entrants',uzeflifeFixtures:'efl_uzeflife_fixtures',teamsCatalog:'efl_teams_catalog',teamMembers:'efl_team_members'
});
export const PRIMARY_KEYS = Object.freeze({
  users:'id',seasons:'id',leagues:'id',clubs:'id',
  clubOccupancies:'id',fixtures:'id',matchAccess:'match_id',matchMessages:'id',
  competitions:'id',participants:'id',resultSubmissions:'id',disputes:'id',
  notifications:'id',auditLogs:'id',ticketBalances:'id',ticketTransactions:'id',playerTrophies:'id',retentionDecisions:'id',premiumEntitlements:'id',clubAdmissions:'id',clubSelectionBans:'id',clubMembershipHistory:'id',userMembershipHistory:'id',uzeflifeAuditHistory:'id',uzeflifeNoticeHistory:'id',notificationReadState:'id',matchdayLockHistory:'id',matchDeadlineHistory:'id',banAuditHistory:'id',banControlHistory:'id',customTournamentHistory:'id',customTournamentParticipantHistory:'id',customTournamentFixtureHistory:'id',customTournamentAuditHistory:'id',telegramTagHistory:'id',telegramTagStateHistory:'id',matchChatRoomHistory:'id',matchdayJobHistory:'id',standingsHistory:'id',teamTicketBalances:'id',teamTicketTransactions:'id',ticketIdempotencyHistory:'id',sealedLegacyHistory:'id',rawDocuments:'id',rawDocumentParts:'id',uzeflifeState:'id',uzeflifeEntrants:'id',uzeflifeFixtures:'id',teamsCatalog:'id',teamMembers:'id'
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
      if (!['settings','format_config','data','encoded','old_value','new_value','league_overrides','source_record','details','state','source_value'].includes(key) &&
        (typeof value === 'object' || Array.isArray(value))) throw new Error('INVALID_VALUE');
    }
    if(table==='ticketBalances' &&
       (!Number.isSafeInteger(row.balance)||row.balance<0||
        !Number.isSafeInteger(row.total_granted)||row.total_granted<0||
        !Number.isSafeInteger(row.total_spent)||row.total_spent<0||
        !Number.isSafeInteger(row.total_refunded)||row.total_refunded<0||
        typeof row.user_id!=='string'||!row.user_id||
        typeof row.telegram_id!=='string'||!row.telegram_id||
        !Number.isSafeInteger(row.updated_at)||row.updated_at<0||
        (row.free_ticket_granted_at!==null&&
          (!Number.isSafeInteger(row.free_ticket_granted_at)||
           row.free_ticket_granted_at<0))))
      throw new Error('INVALID_TICKET_BALANCE_ROW');
    if(table==='ticketTransactions' &&
       (!Number.isSafeInteger(row.amount)||row.amount<0||
        !['GRANT','SPEND','REFUND'].includes(row.type)||
        typeof row.user_id!=='string'||!row.user_id||
        typeof row.idempotency_key!=='string'||!row.idempotency_key||
        !Number.isSafeInteger(row.created_at)||row.created_at<0))
      throw new Error('INVALID_TICKET_TRANSACTION_ROW');
    if(table==='retentionDecisions'&&
      (!['KEEP','RELEASE'].includes(row.choice)||
       !Number.isSafeInteger(row.decided_at)||row.decided_at<0||
       !['user_id','season_id','source_season_id','club_id'].every(
         k=>typeof row[k]==='string'&&row[k].length>0)))
      throw Error('INVALID_RETENTION_IMPORT_ROW');
    if(table==='premiumEntitlements'&&
      (!['ACTIVE','REVOKED'].includes(row.status)||
       !['user_id','season_id','source','updated_by'].every(
         k=>typeof row[k]==='string'&&row[k].length>0)||
       typeof row.note!=='string'||
       !Number.isSafeInteger(row.activated_at)||row.activated_at<0||
       !Number.isSafeInteger(row.updated_at)||row.updated_at<row.activated_at||
       (row.revoked_at!==null&&
         (!Number.isSafeInteger(row.revoked_at)||row.revoked_at<row.activated_at))||
       (row.status==='ACTIVE'&&row.revoked_at!==null)||
       (row.status==='REVOKED'&&row.revoked_at===null)||
       (row.payment_charge_id!==null&&typeof row.payment_charge_id!=='string')||
       (row.revoked_by!==null&&typeof row.revoked_by!=='string')))
      throw Error('INVALID_PREMIUM_IMPORT_ROW');
    if(table==='clubAdmissions'&&
      (typeof row.season_id!=='string'||!row.season_id||
       typeof row.enabled!=='boolean'||
       (row.automatic!==null&&typeof row.automatic!=='boolean')||
       !Number.isSafeInteger(row.stage)||row.stage<0||
       typeof row.revision!=='string'||!row.revision||
       !row.league_overrides||typeof row.league_overrides!=='object'||
       Array.isArray(row.league_overrides)||
       typeof row.updated_by!=='string'||
       !Number.isSafeInteger(row.updated_at)||row.updated_at<0))
      throw Error('INVALID_CLUB_ADMISSION_IMPORT_ROW');
    if(table==='clubSelectionBans'&&
      (row.id!==row.user_id||
       typeof row.telegram_id!=='string'||!row.telegram_id||
       typeof row.is_banned!=='boolean'||
       typeof row.reason!=='string'||typeof row.actor_id!=='string'||
       !Number.isSafeInteger(row.revision)||row.revision<0||
       !Number.isSafeInteger(row.updated_at)||row.updated_at<0))
      throw Error('INVALID_CLUB_BAN_IMPORT_ROW');
    if((table==='clubMembershipHistory'||table==='userMembershipHistory')&&
      (typeof row.user_id!=='string'||!row.user_id||
       typeof row.club_id!=='string'||!row.club_id||
       typeof row.season_id!=='string'||!row.season_id||
       !['active','released'].includes(row.source_status)||
       !['RESOLVED','UNRESOLVED'].includes(row.reference_status)||
       !row.source_record||typeof row.source_record!=='object'||
       Array.isArray(row.source_record)||
       row.user_id!==row.source_record.userId||
       row.season_id!==row.source_record.seasonId||
       row.source_status!==row.source_record.status||
       (row.source_id!==null&&typeof row.source_id!=='string')||
       (row.claimed_at!==null&&
         (!Number.isSafeInteger(row.claimed_at)||row.claimed_at<0))||
       (row.updated_at!==null&&
         (!Number.isSafeInteger(row.updated_at)||row.updated_at<0))||
       (row.released_at!==null&&
         (!Number.isSafeInteger(row.released_at)||row.released_at<0))))
      throw Error('INVALID_HISTORICAL_MEMBERSHIP_IMPORT_ROW');
    if(table==='uzeflifeAuditHistory'&&
      (typeof row.action!=='string'||!row.action||
       typeof row.actor!=='string'||!row.actor||
       !Number.isSafeInteger(row.revision)||row.revision<0||
       !Number.isSafeInteger(row.occurred_at)||row.occurred_at<0||
       !row.details||typeof row.details!=='object'||Array.isArray(row.details)||
       !row.source_record||typeof row.source_record!=='object'||
       Array.isArray(row.source_record)||
       row.source_record.action!==row.action||
       row.source_record.actor!==row.actor||
       row.source_record.revision!==row.revision))
      throw Error('INVALID_UZEFLIFE_AUDIT_HISTORY_ROW');
    if(table==='uzeflifeNoticeHistory'&&
      (row.replay_policy!=='HISTORICAL_ONLY'||
       typeof row.source_status!=='string'||!row.source_status||
       !Number.isSafeInteger(row.notice_count)||row.notice_count<0||
       !Number.isSafeInteger(row.created_at)||row.created_at<0||
       typeof row.source_sha256!=='string'||
       !/^[a-f0-9]{64}$/.test(row.source_sha256)))
      throw Error('INVALID_UZEFLIFE_NOTICE_HISTORY_ROW');
    if(table==='notificationReadState'&&
       (row.id!==row.user_id||!row.state||
        typeof row.state!=='object'||Array.isArray(row.state)||
        Object.entries(row.state).some(([key,value])=>
         !key||typeof value!=='string'||value.length>256)))
      throw Error('INVALID_NOTIFICATION_READ_IMPORT_ROW');
    if(table==='matchdayLockHistory'&&
      (!row.source_record||typeof row.source_record!=='object'||
       Array.isArray(row.source_record)||
       !['RESOLVED','UNRESOLVED'].includes(row.reference_status)||
       row.source_record.id!==row.id||
       row.source_record.competitionId!==row.competition_id||
       row.source_record.seasonId!==row.season_id||
       row.source_record.matchday!==row.matchday||
       row.source_record.isOpen!==row.source_is_open||
       row.source_record.isLocked!==row.source_is_locked||
       row.source_record.overrideStatus!==row.override_status))
      throw Error('INVALID_MATCHDAY_HISTORY_ROW');
    if(table==='matchDeadlineHistory'&&
      (!row.source_record||typeof row.source_record!=='object'||
       Array.isArray(row.source_record)||
       !['RESOLVED','UNRESOLVED'].includes(row.reference_status)||
       row.source_record.fixtureId!==row.fixture_id||
       row.source_record.competitionId!==row.competition_id||
       row.source_record.seasonId!==row.season_id||
       row.source_record.matchday!==row.matchday))
      throw Error('INVALID_MATCH_DEADLINE_HISTORY_ROW');
    if(table==='banAuditHistory'&&
       (row.replay_policy!=='HISTORICAL_ONLY'||
        !row.source_record||typeof row.source_record!=='object'||
        Array.isArray(row.source_record)||
        row.source_record.userId!==row.user_id||
        row.source_record.telegramId!==row.telegram_id||
        row.source_record.isBanned!==row.is_banned||
        row.source_record.previousIsBanned!==row.previous_is_banned||
        row.source_record.revision!==row.revision||
        !Number.isSafeInteger(row.updated_at)||row.updated_at<0))
      throw Error('INVALID_BAN_AUDIT_HISTORY_IMPORT');
    if(table==='banControlHistory'&&
       (row.replay_policy!=='HISTORICAL_ONLY'||
        !row.source_record||typeof row.source_record!=='object'||
        Array.isArray(row.source_record)||
        row.source_record.targetId!==row.target_user_id||
        row.source_record.expectedRevision!==row.expected_revision||
        row.source_record.consumed!==row.originally_consumed||
        row.source_record.expiresAt!==row.expires_at))
      throw Error('INVALID_BAN_CONTROL_HISTORY_IMPORT');
    if(table.startsWith('customTournament')&&table.endsWith('History')&&
      (row.replay_policy!=='HISTORICAL_ONLY'||
       typeof row.source_sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.source_sha256)||
       (table==='customTournamentHistory'&&
         (!row.organizer_user_id||!row.name||!row.format||!row.status||
          !Number.isSafeInteger(row.max_participants)||row.max_participants<1))||
       (table==='customTournamentParticipantHistory'&&
         (!row.tournament_id||!row.user_id||!row.club_id||!row.status))||
       (table==='customTournamentFixtureHistory'&&
         (!row.tournament_id||!row.status||!row.stage||
          !Number.isSafeInteger(row.leg)||!Number.isSafeInteger(row.round)||
          !Number.isSafeInteger(row.match_index)))||
       (table==='customTournamentAuditHistory'&&
         (!row.tournament_id||!row.action||!row.actor_user_id))))
      throw Error('INVALID_CUSTOM_TOURNAMENT_HISTORY_IMPORT');
    if(table==='telegramTagHistory'&&
      (row.replay_policy!=='HISTORICAL_ONLY'||
       !row.source_record||typeof row.source_record!=='object'||
       Array.isArray(row.source_record)||
       row.source_record.userId!==row.user_id||
       row.source_record.seasonId!==row.season_id||
       String(row.source_record.telegramId)!==row.telegram_id||
       row.source_record.appliedTag!==row.applied_tag||
       row.source_record.managed!==row.source_managed))
      throw Error('INVALID_TELEGRAM_TAG_HISTORY_IMPORT');
    if(table==='telegramTagStateHistory'&&
      (row.replay_policy!=='HISTORICAL_ONLY'||
       !Object.hasOwn(row,'source_value')||
       (row.source_expires_at!==null&&
         (!Number.isSafeInteger(row.source_expires_at)||row.source_expires_at<0))))
      throw Error('INVALID_TELEGRAM_TAG_STATE_HISTORY_IMPORT');
    if(['matchChatRoomHistory','matchdayJobHistory','standingsHistory'].includes(table)&&
      (row.replay_policy!=='HISTORICAL_ONLY'||
       !/^[a-f0-9]{64}$/.test(String(row.source_sha256))||
       !row.season_id||
       (table==='matchChatRoomHistory'&&
         (!row.match_id||typeof row.source_closed!=='boolean'||
          !Number.isSafeInteger(row.participant_count)||row.participant_count<0||
          !Number.isSafeInteger(row.message_count)||row.message_count<0))||
       (table==='matchdayJobHistory'&&
         (!row.competition_id||!row.source_status||
          !Number.isSafeInteger(row.matchday)||row.matchday<0))||
       (table==='standingsHistory'&&
         (!row.competition_id||
          !Number.isSafeInteger(row.source_row_count)||row.source_row_count<0||
          !Number.isSafeInteger(row.source_played)||row.source_played<0||
          !['RESOLVED','UNRESOLVED'].includes(row.reference_status)))))
      throw Error('INVALID_OPERATIONAL_HISTORY_IMPORT');
    if(table==='teamTicketBalances'&&
       (row.id!==row.user_id||
        !['balance','total_granted','total_revoked','total_spent','updated_at'].every(
         field=>Number.isSafeInteger(row[field])&&row[field]>=0)))
      throw Error('INVALID_TEAM_TICKET_BALANCE_IMPORT');
    if(table==='teamTicketTransactions'&&
       (!row.user_id||!row.type||!row.actor_id||
        !Number.isSafeInteger(row.amount)||row.amount<0||
        !Number.isSafeInteger(row.created_at)||row.created_at<0))
      throw Error('INVALID_TEAM_TICKET_TRANSACTION_IMPORT');
    if(table==='ticketIdempotencyHistory'&&
       (!row.user_id||!row.transaction_id||!row.tournament_id||
        !Number.isSafeInteger(row.created_at)||row.created_at<0))
      throw Error('INVALID_TICKET_IDEMPOTENCY_IMPORT');
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
