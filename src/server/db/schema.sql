-- EFOOTBALL TOURNAMENT DATABASE SCHEMA (SQLITE)

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    telegram_id TEXT UNIQUE NOT NULL,
    username TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT,
    photo_url TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_suspended INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seasons (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL, -- 'upcoming', 'registration', 'active', 'completed'
    start_date TEXT NOT NULL,
    end_date TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leagues (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    country TEXT NOT NULL,
    tier INTEGER NOT NULL DEFAULT 1,
    logo_url TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clubs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    country TEXT NOT NULL,
    league_id TEXT NOT NULL,
    logo_url TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY(league_id) REFERENCES leagues(id)
);

CREATE TABLE IF NOT EXISTS season_league_clubs (
    id TEXT PRIMARY KEY,
    season_id TEXT NOT NULL,
    league_id TEXT NOT NULL,
    club_id TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY(season_id) REFERENCES seasons(id),
    FOREIGN KEY(league_id) REFERENCES leagues(id),
    FOREIGN KEY(club_id) REFERENCES clubs(id),
    UNIQUE(season_id, club_id)
);

CREATE TABLE IF NOT EXISTS club_memberships (
    id TEXT PRIMARY KEY,
    season_id TEXT NOT NULL,
    club_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    claimed_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active', -- 'active', 'released', 'archived'
    FOREIGN KEY(season_id) REFERENCES seasons(id),
    FOREIGN KEY(club_id) REFERENCES clubs(id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(season_id, club_id) -- ATOMIC UNIQUE CONSTRAINT: 1 owner per club per season
);

CREATE TABLE IF NOT EXISTS competitions (
    id TEXT PRIMARY KEY,
    season_id TEXT NOT NULL,
    league_id TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'LEAGUE', 'KNOCKOUT', 'SUPER_CUP', 'EUROPEAN_LEAGUE_PHASE', 'EUROPEAN_KNOCKOUT'
    schedule_mode TEXT NOT NULL DEFAULT 'GENERATED_SCHEDULE', -- 'REAL_SCHEDULE', 'GENERATED_SCHEDULE'
    status TEXT NOT NULL DEFAULT 'upcoming',
    format_config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(season_id) REFERENCES seasons(id),
    FOREIGN KEY(league_id) REFERENCES leagues(id)
);

CREATE TABLE IF NOT EXISTS competition_participants (
    id TEXT PRIMARY KEY,
    competition_id TEXT NOT NULL,
    club_id TEXT NOT NULL,
    season_id TEXT,
    owner_user_id TEXT,
    source_competition_id TEXT,
    source_position INTEGER,
    qualification_reason TEXT,
    qualification_timestamp TEXT,
    seed_number INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY(competition_id) REFERENCES competitions(id),
    FOREIGN KEY(club_id) REFERENCES clubs(id),
    FOREIGN KEY(season_id) REFERENCES seasons(id),
    FOREIGN KEY(owner_user_id) REFERENCES users(id),
    FOREIGN KEY(source_competition_id) REFERENCES competitions(id),
    UNIQUE(competition_id, club_id)
);

CREATE TABLE IF NOT EXISTS fixtures (
    id TEXT PRIMARY KEY,
    season_id TEXT NOT NULL,
    competition_id TEXT NOT NULL,
    matchday INTEGER NOT NULL,
    round_name TEXT,
    home_club_id TEXT NOT NULL,
    away_club_id TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'SCHEDULED', -- 'SCHEDULED', 'READY', 'PLAYING', 'AWAITING_RESULT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'DISPUTED', 'CANCELLED', 'POSTPONED', 'OVERDUE'
    home_score INTEGER,
    away_score INTEGER,
    winner_club_id TEXT,
    result_confirmed_at TEXT,
    fixture_source TEXT DEFAULT 'official_2026_27',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(season_id) REFERENCES seasons(id),
    FOREIGN KEY(competition_id) REFERENCES competitions(id),
    FOREIGN KEY(home_club_id) REFERENCES clubs(id),
    FOREIGN KEY(away_club_id) REFERENCES clubs(id)
);

CREATE TABLE IF NOT EXISTS result_submissions (
    id TEXT PRIMARY KEY,
    fixture_id TEXT NOT NULL,
    submitted_by_user_id TEXT NOT NULL,
    club_id TEXT NOT NULL,
    home_score INTEGER NOT NULL,
    away_score INTEGER NOT NULL,
    proof_url TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(fixture_id) REFERENCES fixtures(id),
    FOREIGN KEY(submitted_by_user_id) REFERENCES users(id),
    FOREIGN KEY(club_id) REFERENCES clubs(id),
    UNIQUE(fixture_id, submitted_by_user_id) -- 1 submission per user per fixture
);

CREATE TABLE IF NOT EXISTS disputes (
    id TEXT PRIMARY KEY,
    fixture_id TEXT NOT NULL UNIQUE,
    season_id TEXT NOT NULL,
    home_submission_id TEXT,
    away_submission_id TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN', -- 'OPEN', 'RESOLVED', 'CANCELLED'
    resolved_by_user_id TEXT,
    resolution_notes TEXT,
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(fixture_id) REFERENCES fixtures(id),
    FOREIGN KEY(season_id) REFERENCES seasons(id),
    FOREIGN KEY(home_submission_id) REFERENCES result_submissions(id),
    FOREIGN KEY(away_submission_id) REFERENCES result_submissions(id),
    FOREIGN KEY(resolved_by_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    data_json TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS qualification_rules (
    id TEXT PRIMARY KEY,
    competition_id TEXT NOT NULL,
    target_competition_id TEXT NOT NULL,
    min_rank INTEGER NOT NULL,
    max_rank INTEGER NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(competition_id) REFERENCES competitions(id),
    FOREIGN KEY(target_competition_id) REFERENCES competitions(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT NOT NULL,
    actor_username TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    old_value_json TEXT,
    new_value_json TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_mutations (
    mutation_id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS active_occupancies_cache (
    club_id TEXT NOT NULL,
    season_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT,
    display_name TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (season_id, club_id)
);

-- INDEXES FOR MAXIMUM QUERY SPEED & INTEGRITY
CREATE INDEX IF NOT EXISTS idx_club_memberships_user ON club_memberships(user_id, status);
CREATE INDEX IF NOT EXISTS idx_club_memberships_season ON club_memberships(season_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_club_memberships_user_season_active ON club_memberships(user_id, season_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_fixtures_competition ON fixtures(competition_id, matchday);
CREATE INDEX IF NOT EXISTS idx_fixtures_clubs ON fixtures(home_club_id, away_club_id);
CREATE INDEX IF NOT EXISTS idx_fixtures_season ON fixtures(season_id, status);
CREATE INDEX IF NOT EXISTS idx_result_submissions_fixture ON result_submissions(fixture_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
