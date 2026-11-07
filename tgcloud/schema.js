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
