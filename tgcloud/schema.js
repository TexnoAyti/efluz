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
