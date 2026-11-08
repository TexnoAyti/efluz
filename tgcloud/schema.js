import { table, integer, text, boolean, json, index, uniqueIndex, sql } from 'sdk/db';

// EFLUZ Serverless core schema. Relations are enforced in application code.
export const users = table('efl_users', {
  id: text('id').primaryKey(), telegramId: text('telegram_id').notNull().unique(),
  username: text('username'), firstName: text('first_name').notNull().default(''),
  lastName: text('last_name').notNull().default(''), isAdmin: boolean('is_admin').notNull().default(false),
  isBanned: boolean('is_banned').notNull().default(false), createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => ({ telegramIdx: uniqueIndex('efl_users_telegram_uidx').on(t.telegramId) }));

export const seasons = table('efl_seasons', {
  id: text('id').primaryKey(), name: text('name').notNull(), status: text('status').notNull().default('DRAFT'),
  isActive: boolean('is_active').notNull().default(false), settings: json('settings'),
  startsAt: integer('starts_at'), endsAt: integer('ends_at'), createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => ({ activeIdx: index('efl_seasons_active_idx').on(t.isActive, t.status) }));

export const leagues = table('efl_leagues', {
  id: text('id').primaryKey(), seasonId: text('season_id').notNull(), name: text('name').notNull(),
  country: text('country').notNull().default(''), continent: text('continent').notNull().default('EUROPE'),
  logoUrl: text('logo_url'), capacity: integer('capacity').notNull().default(20),
  sortOrder: integer('sort_order').notNull().default(0), status: text('status').notNull().default('CLOSED'),
  currentRound: integer('current_round').notNull().default(0), createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => ({ seasonOrderIdx: index('efl_leagues_season_order_idx').on(t.seasonId, t.sortOrder) }));

export const clubs = table('efl_clubs', {
  id: text('id').primaryKey(), leagueId: text('league_id').notNull(), name: text('name').notNull(),
  shortName: text('short_name').notNull().default(''), country: text('country').notNull().default(''),
  logoUrl: text('logo_url'), stadium: text('stadium').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0), createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => ({ leagueOrderIdx: index('efl_clubs_league_order_idx').on(t.leagueId, t.sortOrder) }));

export const clubOccupancies = table('efl_club_occupancies', {
  id: text('id').primaryKey(), seasonId: text('season_id').notNull(), leagueId: text('league_id').notNull(),
  clubId: text('club_id').notNull(), userId: text('user_id').notNull(), telegramId: text('telegram_id').notNull(),
  status: text('status').notNull().default('ACTIVE'), joinedAt: integer('joined_at').notNull(),
  releasedAt: integer('released_at'), updatedAt: integer('updated_at').notNull(),
}, (t) => ({
  oneClubOwner: uniqueIndex('efl_occupancy_active_club_uidx').on(t.seasonId, t.clubId).where(sql`status = 'ACTIVE'`),
  oneClubPerLeaguePerPlayer: uniqueIndex('efl_occupancy_one_league_per_player_uidx').on(t.seasonId,t.leagueId,t.userId).where(sql`status = 'ACTIVE'`),
  ownerIdx: index('efl_occupancy_owner_idx').on(t.telegramId, t.seasonId, t.status),
  leagueIdx: index('efl_occupancy_league_idx').on(t.leagueId, t.status),
}));

export const fixtures = table('efl_fixtures', {
  id: text('id').primaryKey(), seasonId: text('season_id').notNull(), competitionId: text('competition_id').notNull(),
  leagueId: text('league_id'), round: integer('round').notNull().default(1),
  // Cup brackets may contain TBD slots; do not coerce pending opponents into a fake club.
  homeClubId: text('home_club_id'), awayClubId: text('away_club_id'),
  homeTelegramId: text('home_telegram_id'), awayTelegramId: text('away_telegram_id'),
  homeScore: integer('home_score'), awayScore: integer('away_score'),
  status: text('status').notNull().default('SCHEDULED'),
  confirmationStatus: text('confirmation_status').notNull().default('NONE'),
  scheduledAt: integer('scheduled_at'), playedAt: integer('played_at'), updatedAt: integer('updated_at').notNull(),
}, (t) => ({
  roundIdx: index('efl_fixtures_round_idx').on(t.competitionId, t.round, t.status),
  homeOwnerIdx: index('efl_fixtures_home_owner_idx').on(t.homeTelegramId, t.status),
  awayOwnerIdx: index('efl_fixtures_away_owner_idx').on(t.awayTelegramId, t.status),
}));

// Explicit, fixture-specific late score windows. A previous round never
// becomes writable just because a newer round is open. Admin authorization
// must be reconciled with original competition policy before production.
export const fixtureScoreWindows = table('efl_fixture_score_windows', {
  fixtureId: text('fixture_id').primaryKey(),
  seasonId: text('season_id').notNull(),
  competitionId: text('competition_id').notNull(),
  isOpen: boolean('is_open').notNull().default(false),
  authorizedBy: text('authorized_by').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, t => ({
  competitionIdx: index('efl_fixture_score_window_comp_idx').on(t.competitionId,t.isOpen),
}));

export const matchAccess = table('efl_match_access', {
  matchId: text('match_id').primaryKey(), homeTelegramId: text('home_telegram_id').notNull(),
  awayTelegramId: text('away_telegram_id').notNull(), writable: boolean('writable').notNull().default(false),
  updatedAt: integer('updated_at').notNull().default(0),
});

export const matchMessages = table('efl_match_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }), matchId: text('match_id').notNull(),
  senderTelegramId: text('sender_telegram_id').notNull(), clientId: text('client_id').notNull().unique(),
  body: text('body').notNull(), createdAt: integer('created_at').notNull(),
}, (t) => ({ matchCursorIdx: index('efl_match_messages_cursor_idx').on(t.matchId, t.id) }));

export const migrationState = table('efl_migration_state', {
  key: text('key').primaryKey(), cursor: text('cursor'), status: text('status').notNull().default('PENDING'),
  checksum: text('checksum'), details: json('details'), updatedAt: integer('updated_at').notNull(),
});

// Extended core domain retained for lossless source migration.

export const competitions = table('efl_competitions', {
  id:text('id').primaryKey(),seasonId:text('season_id').notNull(),
  leagueId:text('league_id'),name:text('name').notNull(),type:text('type').notNull(),
  scheduleMode:text('schedule_mode').notNull().default('GENERATED_SCHEDULE'),
  status:text('status').notNull(),formatConfig:json('format_config'),
  currentMatchday:integer('current_matchday'),isMatchdayOpen:boolean('is_matchday_open'),
  createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),
},(t)=>({seasonIdx:index('efl_competitions_season_idx').on(t.seasonId,t.type)}));

export const participants = table('efl_competition_participants', {
  id:text('id').primaryKey(),competitionId:text('competition_id').notNull(),
  seasonId:text('season_id').notNull(),clubId:text('club_id').notNull(),
  ownerUserId:text('owner_user_id'),seedNumber:integer('seed_number'),
  sourceCompetitionId:text('source_competition_id'),sourcePosition:integer('source_position'),
  qualificationReason:text('qualification_reason'),createdAt:integer('created_at').notNull(),
},(t)=>({
  memberUnique:uniqueIndex('efl_competition_participant_unique').on(t.competitionId,t.clubId),
  competitionIdx:index('efl_participants_competition_idx').on(t.competitionId)
}));

export const resultSubmissions = table('efl_result_submissions', {
  id:text('id').primaryKey(),fixtureId:text('fixture_id').notNull(),
  submittedByUserId:text('submitted_by_user_id').notNull(),clubId:text('club_id').notNull(),
  homeScore:integer('home_score').notNull(),awayScore:integer('away_score').notNull(),
  homeExtraTimeScore:integer('home_extra_time_score'),awayExtraTimeScore:integer('away_extra_time_score'),
  homePenaltyScore:integer('home_penalty_score'),awayPenaltyScore:integer('away_penalty_score'),
  proofUrl:text('proof_url'),createdAt:integer('created_at').notNull(),
},(t)=>({
  oneSubmission:uniqueIndex('efl_result_submission_once').on(t.fixtureId,t.submittedByUserId),
  fixtureIdx:index('efl_result_submissions_fixture_idx').on(t.fixtureId)
}));

export const disputes = table('efl_disputes', {
  id:text('id').primaryKey(),fixtureId:text('fixture_id').notNull().unique(),
  seasonId:text('season_id').notNull(),homeSubmissionId:text('home_submission_id'),
  awaySubmissionId:text('away_submission_id'),status:text('status').notNull(),
  resolvedByUserId:text('resolved_by_user_id'),resolutionNotes:text('resolution_notes'),
  createdAt:integer('created_at').notNull(),resolvedAt:integer('resolved_at'),
},(t)=>({statusIdx:index('efl_disputes_status_idx').on(t.seasonId,t.status)}));

export const notifications = table('efl_notifications',{
  id:text('id').primaryKey(),userId:text('user_id').notNull(),
  type:text('type').notNull(),title:text('title').notNull(),message:text('message').notNull(),
  data:json('data'),isRead:boolean('is_read').notNull().default(false),
  createdAt:integer('created_at').notNull(),
},(t)=>({inboxIdx:index('efl_notifications_user_idx').on(t.userId,t.isRead,t.createdAt)}));

// Durable staging notification delivery queue, linked to the existing inbox.
// No private message content or Telegram token is copied into this queue.
// Sending is *not* enabled; completion/retries need Telegram SDK verification.
export const notificationDeliveries=table('efl_notification_deliveries',{
  id:text('id').primaryKey(),notificationId:text('notification_id').notNull().unique(),
  userId:text('user_id').notNull(),status:text('status').notNull().default('PENDING'),
  attempts:integer('attempts').notNull().default(0),
  leaseToken:text('lease_token'),leaseUntil:integer('lease_until'),
  retryAfter:integer('retry_after').notNull().default(0),
  createdAt:integer('created_at').notNull(),sentAt:integer('sent_at'),
  lastError:text('last_error'),
},t=>({
  pendingIdx:index('efl_notification_delivery_pending_idx').on(t.status,t.createdAt),
  recipientIdx:index('efl_notification_delivery_user_idx').on(t.userId,t.status),
}));

export const auditLogs = table('efl_audit_logs',{
  id:text('id').primaryKey(),actorUserId:text('actor_user_id').notNull(),
  actorUsername:text('actor_username').notNull(),action:text('action').notNull(),
  entityType:text('entity_type').notNull(),entityId:text('entity_id').notNull(),
  oldValue:json('old_value'),newValue:json('new_value'),createdAt:integer('created_at').notNull(),
},(t)=>({entityIdx:index('efl_audit_entity_idx').on(t.entityType,t.entityId)}));

 
// Lossless mirror for legacy document collections that do not yet have an
// equivalent relational model (TEAMS, UZEFLIFE, tickets, AI, etc.).
// It is a migration archive, NOT a general-purpose public API.
export const rawDocuments=table('efl_raw_documents',{
  id:text('id').primaryKey(),sourceSpace:text('source_space').notNull(),
  collectionPath:text('collection_path').notNull(),
  documentId:text('document_id').notNull(),
  encoded:json('encoded').notNull(),data:json('data').notNull(),
  sourceChecksum:text('source_checksum').notNull(),
},(t)=>({
  sourceKey:uniqueIndex('efl_raw_doc_source_key').on(t.sourceSpace,t.collectionPath,t.documentId),
  collectionIdx:index('efl_raw_doc_collection_idx').on(t.sourceSpace,t.collectionPath)
}));


// Oversized legacy documents (UZEFLIFE, proof archives) are stored as
// deterministic, individually checksummed base64 chunks. Never expose this
// table to a public endpoint; it can include private source data.
export const rawDocumentParts=table('efl_raw_document_parts',{
  id:text('id').primaryKey(),
  sourceDocumentId:text('source_document_id').notNull(),
  sourceSpace:text('source_space').notNull(),
  collectionPath:text('collection_path').notNull(),
  documentId:text('document_id').notNull(),
  partIndex:integer('part_index').notNull(),
  partCount:integer('part_count').notNull(),
  partData:text('part_data').notNull(),
  sourceChecksum:text('source_checksum').notNull(),
  partChecksum:text('part_checksum').notNull(),
},(t)=>({
  sourcePart:uniqueIndex('efl_raw_parts_source_index_uidx').on(t.sourceDocumentId,t.partIndex),
  sourceLookup:index('efl_raw_parts_source_idx').on(t.sourceSpace,t.collectionPath,t.documentId)
}));


// Lossless original UZEFLIFE state stays in the private raw-document archive.
// These separate tables provide a bounded, read-only operational projection.
export const uzeflifeState=table('efl_uzeflife_state',{
 id:text('id').primaryKey(),name:text('name').notNull(),
 status:text('status').notNull(),format:text('format').notNull().default(''),
 currentRound:integer('current_round').notNull().default(0),
 totalRounds:integer('total_rounds').notNull().default(0),
 roundHours:integer('round_hours').notNull().default(24),
 participantsCount:integer('participants_count').notNull(),
 matchesCount:integer('matches_count').notNull(),
 sourceRevision:integer('source_revision').notNull().default(0),
});

export const uzeflifeEntrants=table('efl_uzeflife_entrants',{
 id:text('id').primaryKey(),name:text('name').notNull(),
 status:text('status').notNull(),
},(t)=>({stateIdx:index('efl_uzeflife_entrants_status_idx').on(t.status)}));

export const uzeflifeFixtures=table('efl_uzeflife_fixtures',{
 id:text('id').primaryKey(),round:integer('round').notNull(),
 bracket:integer('bracket').notNull(),home:text('home').notNull(),
 away:text('away').notNull(),winner:text('winner'),
 homeScore:integer('home_score'),awayScore:integer('away_score'),
 penaltyHome:integer('penalty_home'),penaltyAway:integer('penalty_away'),
 deadlineAt:integer('deadline_at'),
},(t)=>({roundIndex:index('efl_uzeflife_fixtures_round_idx').on(t.round,t.bracket)}));


// Public TEAMS catalog projection. Private membership, invitation, payment
// and embedded base64 logos stay in the private source archive.
export const teamsCatalog=table('efl_teams_catalog',{
 id:text('id').primaryKey(),name:text('name').notNull(),
 ownerUserId:text('owner_user_id'),adminUserId:text('admin_user_id'),
 unresolvedMemberCount:integer('unresolved_member_count').notNull().default(0),
 logoUrl:text('logo_url'),memberCount:integer('member_count').notNull(),
 membershipRequired:boolean('membership_required').notNull().default(false),
 updatedAt:integer('updated_at').notNull().default(0),
},(t)=>({nameIndex:index('efl_teams_catalog_name_idx').on(t.name)}));


// Isolated TEAMS join workflow. No production writes until source membership,
// payment ticket and captain approval rules are fully reconciled.
export const teamJoinRequests=table('efl_team_join_requests',{
 id:text('id').primaryKey(),
 teamId:text('team_id').notNull(),userId:text('user_id').notNull(),
 telegramId:text('telegram_id').notNull(),status:text('status').notNull().default('PENDING'),
 createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>({
 oneRequestPerTeam:uniqueIndex('efl_team_request_unique').on(t.teamId,t.userId),
 oneApprovedTeam:uniqueIndex('efl_team_approved_user_unique').on(t.userId)
   .where(sql`status = 'APPROVED'`),
 statusIndex:index('efl_team_requests_status_idx').on(t.teamId,t.status)
}));


// Private TEAMS source membership normalization. Historic source member IDs
// without a verified EFL userId remain UNRESOLVED and cannot be granted a
// fabricated player identity. No endpoint exposes raw names to the public.
export const teamMembers=table('efl_team_members',{
 id:text('id').primaryKey(),
 teamId:text('team_id').notNull(),sourceMemberId:text('source_member_id').notNull(),
 userId:text('user_id'),memberName:text('member_name').notNull().default(''),
 status:text('status').notNull(),
 createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull(),
},t=>({
 oncePerSourceMember:uniqueIndex('efl_team_member_source_unique').on(t.teamId,t.sourceMemberId),
 oneLinkedTeamPerUser:uniqueIndex('efl_team_member_linked_user_unique').on(t.userId)
  .where(sql`status = 'LINKED'`),
 teamIdx:index('efl_team_member_team_idx').on(t.teamId,t.status)
}));


// Shadow-only historical ticket ledger. The source balances are snapshots,
// not totals reconstructed from transactions. No spending/grant endpoint exists.
export const ticketBalances=table('efl_ticket_balances',{
 id:text('id').primaryKey(),userId:text('user_id').notNull().unique(),
 telegramId:text('telegram_id').notNull(),balance:integer('balance').notNull(),
 totalGranted:integer('total_granted').notNull(),
 totalSpent:integer('total_spent').notNull(),
 totalRefunded:integer('total_refunded').notNull(),
 freeTicketGrantedAt:integer('free_ticket_granted_at'),
 updatedAt:integer('updated_at').notNull(),
},t=>({userIndex:uniqueIndex('efl_ticket_balance_user_idx').on(t.userId)}));

export const ticketTransactions=table('efl_ticket_transactions',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),
 type:text('type').notNull(),amount:integer('amount').notNull(),
 idempotencyKey:text('idempotency_key').notNull().unique(),
 note:text('note'),performedByAdminId:text('performed_by_admin_id'),
 tournamentId:text('tournament_id'),createdAt:integer('created_at').notNull(),
},t=>({
 idempotencyIndex:uniqueIndex('efl_ticket_transaction_key_idx').on(t.idempotencyKey),
 userIndex:index('efl_ticket_transaction_user_idx').on(t.userId,t.createdAt)
}));


// Existing winners only. Award creation/voting remains disabled until parity.
export const playerTrophies=table('efl_player_trophies',{
 id:text('id').primaryKey(),seasonId:text('season_id').notNull(),
 competitionId:text('competition_id').notNull(),clubId:text('club_id').notNull(),
 winnerUserId:text('winner_user_id').notNull(),
 winnerUsername:text('winner_username').notNull(),
 clubName:text('club_name').notNull(),competitionName:text('competition_name').notNull(),
 active:boolean('active').notNull(),decidedBy:text('decided_by').notNull(),
 evaluatedAt:integer('evaluated_at').notNull(),
 confirmedAt:integer('confirmed_at').notNull()
},t=>({winnerIdx:index('efl_player_trophies_winner_idx').on(t.winnerUserId,t.seasonId)}));


// Historical season-2 club decision records. Never reselect a club on import.
export const retentionDecisions=table('efl_retention_decisions',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),
 seasonId:text('season_id').notNull(),
 sourceSeasonId:text('source_season_id').notNull(),
 clubId:text('club_id').notNull(),choice:text('choice').notNull(),
 decidedAt:integer('decided_at').notNull(),
},t=>({userIdx:index('efl_retention_decisions_user_idx').on(t.userId,t.seasonId)}));

// Historical premium state only. No payment or entitlement mutation endpoint.
export const premiumEntitlements=table('efl_premium_entitlements',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),
 seasonId:text('season_id').notNull(),status:text('status').notNull(),
 source:text('source').notNull(),note:text('note').notNull(),
 paymentChargeId:text('payment_charge_id'),
 activatedAt:integer('activated_at').notNull(),
 revokedAt:integer('revoked_at'),revokedBy:text('revoked_by'),
 updatedAt:integer('updated_at').notNull(),updatedBy:text('updated_by').notNull(),
},t=>({ownerIdx:index('efl_premium_entitlements_owner_idx').on(t.userId,t.seasonId)}));


// Shadow-only snapshots. Runtime admission and ban enforcement remains gated.
export const clubAdmissions=table('efl_club_admissions',{
 id:text('id').primaryKey(),seasonId:text('season_id').notNull(),
 enabled:boolean('enabled').notNull(),automatic:boolean('automatic'),
 stage:integer('stage').notNull(),revision:text('revision').notNull(),
 leagueOverrides:json('league_overrides').notNull(),
 updatedBy:text('updated_by').notNull(),updatedAt:integer('updated_at').notNull()
},t=>({seasonIdx:index('efl_club_admissions_season_idx').on(t.seasonId)}));

export const clubSelectionBans=table('efl_club_selection_bans',{
 id:text('id').primaryKey(),userId:text('user_id').notNull().unique(),
 telegramId:text('telegram_id').notNull(),isBanned:boolean('is_banned').notNull(),
 reason:text('reason').notNull(),actorId:text('actor_id').notNull(),
 revision:integer('revision').notNull(),updatedAt:integer('updated_at').notNull()
},t=>({userIdx:uniqueIndex('efl_club_selection_bans_user_idx').on(t.userId)}));


// Historical-only membership records. An UNRESOLVED record must never
// grant a club or cause a production occupancy mutation.
export const clubMembershipHistory=table('efl_club_membership_history',{
 id:text('id').primaryKey(),sourceId:text('source_id'),
 userId:text('user_id').notNull(),clubId:text('club_id').notNull(),
 seasonId:text('season_id').notNull(),sourceStatus:text('source_status').notNull(),
 referenceStatus:text('reference_status').notNull(),
 claimedAt:integer('claimed_at'),updatedAt:integer('updated_at'),
 releasedAt:integer('released_at'),sourceRecord:json('source_record').notNull()
},t=>({userIdx:index('efl_club_membership_history_user_idx').on(t.userId,t.seasonId)}));

export const userMembershipHistory=table('efl_user_membership_history',{
 id:text('id').primaryKey(),sourceId:text('source_id'),
 userId:text('user_id').notNull(),clubId:text('club_id').notNull(),
 seasonId:text('season_id').notNull(),sourceStatus:text('source_status').notNull(),
 referenceStatus:text('reference_status').notNull(),
 claimedAt:integer('claimed_at'),updatedAt:integer('updated_at'),
 releasedAt:integer('released_at'),sourceRecord:json('source_record').notNull()
},t=>({userIdx:index('efl_user_membership_history_user_idx').on(t.userId,t.seasonId)}));


// Append-only historical UZEFLIFE records. No worker may consume these tables.
export const uzeflifeAuditHistory=table('efl_uzeflife_audit_history',{
 id:text('id').primaryKey(),action:text('action').notNull(),
 actor:text('actor').notNull(),revision:integer('revision').notNull(),
 occurredAt:integer('occurred_at').notNull(),details:json('details').notNull(),
 sourceRecord:json('source_record').notNull()
},t=>({revisionIdx:index('efl_uzeflife_audit_history_revision_idx').on(t.revision)}));

export const uzeflifeNoticeHistory=table('efl_uzeflife_notice_history',{
 id:text('id').primaryKey(),sourceStatus:text('source_status').notNull(),
 createdAt:integer('created_at').notNull(),noticeCount:integer('notice_count').notNull(),
 replayPolicy:text('replay_policy').notNull(),sourceSha256:text('source_sha256').notNull()
});


// Durable notification read markers imported without changing delivery state.
export const notificationReadState=table('efl_notification_read_state',{
 id:text('id').primaryKey(),userId:text('user_id').notNull().unique(),
 state:json('state').notNull()
});


// Historical matchday controls are never consulted by live admission,
// matchday or delivery workers until source-compatibility cutover is proven.
export const matchdayLockHistory=table('efl_matchday_lock_history',{
 id:text('id').primaryKey(),competitionId:text('competition_id').notNull(),
 seasonId:text('season_id').notNull(),matchday:integer('matchday').notNull(),
 sourceIsOpen:boolean('source_is_open').notNull(),
 sourceIsLocked:boolean('source_is_locked').notNull(),
 overrideStatus:text('override_status').notNull(),updatedAt:integer('updated_at'),
 referenceStatus:text('reference_status').notNull(),sourceRecord:json('source_record').notNull()
},t=>({compIdx:index('efl_matchday_lock_history_comp_idx').on(t.competitionId,t.matchday)}));

export const matchDeadlineHistory=table('efl_match_deadline_history',{
 id:text('id').primaryKey(),fixtureId:text('fixture_id').notNull(),
 competitionId:text('competition_id').notNull(),seasonId:text('season_id').notNull(),
 matchday:integer('matchday').notNull(),deadlineAt:integer('deadline_at'),
 createdAt:integer('created_at'),referenceStatus:text('reference_status').notNull(),
 sourceRecord:json('source_record').notNull()
},t=>({fixtureIdx:index('efl_match_deadline_history_fixture_idx').on(t.fixtureId)}));


// Historical moderator operations must never execute from these tables.
export const banAuditHistory=table('efl_ban_audit_history',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),
 telegramId:text('telegram_id').notNull(),
 isBanned:boolean('is_banned').notNull(),previousIsBanned:boolean('previous_is_banned').notNull(),
 revision:integer('revision').notNull(),updatedAt:integer('updated_at').notNull(),
 sourceRecord:json('source_record').notNull(),replayPolicy:text('replay_policy').notNull()
},t=>({userIdx:index('efl_ban_audit_user_idx').on(t.userId,t.revision)}));

export const banControlHistory=table('efl_ban_control_history',{
 id:text('id').primaryKey(),targetUserId:text('target_user_id').notNull(),
 expectedRevision:integer('expected_revision').notNull(),
 originallyConsumed:boolean('originally_consumed').notNull(),
 expiresAt:integer('expires_at').notNull(),
 sourceRecord:json('source_record').notNull(),replayPolicy:text('replay_policy').notNull()
},t=>({targetIdx:index('efl_ban_control_target_idx').on(t.targetUserId)}));


// Private shadow-only custom tournament domain. Sensitive invite and spectator
// tokens are deliberately excluded; source checksum binds the private archive.
export const customTournamentHistory=table('efl_custom_tournament_history',{
 id:text('id').primaryKey(),name:text('name').notNull(),
 organizerUserId:text('organizer_user_id').notNull(),status:text('status').notNull(),
 format:text('format').notNull(),maxParticipants:integer('max_participants').notNull(),
 sourceSha256:text('source_sha256').notNull(),replayPolicy:text('replay_policy').notNull()
});
export const customTournamentParticipantHistory=table('efl_custom_tournament_participant_history',{
 id:text('id').primaryKey(),tournamentId:text('tournament_id').notNull(),
 userId:text('user_id').notNull(),clubId:text('club_id').notNull(),
 status:text('status').notNull(),sourceSha256:text('source_sha256').notNull(),
 replayPolicy:text('replay_policy').notNull()
},t=>({tournamentIdx:index('efl_custom_participant_tournament_idx').on(t.tournamentId)}));
export const customTournamentFixtureHistory=table('efl_custom_tournament_fixture_history',{
 id:text('id').primaryKey(),tournamentId:text('tournament_id').notNull(),
 status:text('status').notNull(),stage:text('stage').notNull(),
 leg:integer('leg').notNull(),round:integer('round').notNull(),
 matchIndex:integer('match_index').notNull(),sourceSha256:text('source_sha256').notNull(),
 replayPolicy:text('replay_policy').notNull()
},t=>({tournamentIdx:index('efl_custom_fixture_tournament_idx').on(t.tournamentId)}));
export const customTournamentAuditHistory=table('efl_custom_tournament_audit_history',{
 id:text('id').primaryKey(),tournamentId:text('tournament_id').notNull(),
 action:text('action').notNull(),actorUserId:text('actor_user_id').notNull(),
 sourceSha256:text('source_sha256').notNull(),
 replayPolicy:text('replay_policy').notNull()
},t=>({tournamentIdx:index('efl_custom_audit_tournament_idx').on(t.tournamentId)}));


// Group tag history. Telegram group tags are not re-applied on import.
export const telegramTagHistory=table('efl_telegram_tag_history',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),
 seasonId:text('season_id').notNull(),telegramId:text('telegram_id').notNull(),
 appliedTag:text('applied_tag').notNull(),sourceManaged:boolean('source_managed').notNull(),
 sourceRecord:json('source_record').notNull(),replayPolicy:text('replay_policy').notNull()
},t=>({userIdx:index('efl_telegram_tag_user_idx').on(t.userId,t.seasonId)}));
export const telegramTagStateHistory=table('efl_telegram_tag_state_history',{
 id:text('id').primaryKey(),sourceValue:json('source_value').notNull(),
 sourceExpiresAt:integer('source_expires_at'),replayPolicy:text('replay_policy').notNull()
});


// Historical-only match chat rooms. No content is exposed by these tables.
export const matchChatRoomHistory=table('efl_match_chat_room_history',{
 id:text('id').primaryKey(),matchId:text('match_id').notNull(),
 seasonId:text('season_id').notNull(),sourceClosed:boolean('source_closed').notNull(),
 participantCount:integer('participant_count').notNull(),
 messageCount:integer('message_count').notNull(),sourceSha256:text('source_sha256').notNull(),
 replayPolicy:text('replay_policy').notNull()
},t=>({matchIdx:index('efl_chat_room_history_match_idx').on(t.matchId)}));
export const matchdayJobHistory=table('efl_matchday_job_history',{
 id:text('id').primaryKey(),competitionId:text('competition_id').notNull(),
 seasonId:text('season_id').notNull(),matchday:integer('matchday').notNull(),
 sourceStatus:text('source_status').notNull(),
 sourceSha256:text('source_sha256').notNull(),replayPolicy:text('replay_policy').notNull()
},t=>({competitionIdx:index('efl_matchday_job_history_comp_idx').on(t.competitionId)}));
export const standingsHistory=table('efl_standings_history',{
 id:text('id').primaryKey(),competitionId:text('competition_id').notNull(),
 seasonId:text('season_id').notNull(),sourceRowCount:integer('source_row_count').notNull(),
 sourcePlayed:integer('source_played').notNull(),
 referenceStatus:text('reference_status').notNull(),
 sourceSha256:text('source_sha256').notNull(),replayPolicy:text('replay_policy').notNull()
},t=>({competitionIdx:index('efl_standings_history_comp_idx').on(t.competitionId)}));
