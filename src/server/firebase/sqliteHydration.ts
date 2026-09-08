import { getFirestoreDb } from './admin';
import { COLLECTIONS } from './collections';
import { firestoreCircuitBreaker } from './circuitBreaker';
import { dbTransaction, queryGet, queryRun } from '../db';
import { trackFirestoreRead } from './firestoreStore';

const TARGET_SEASON_ID = 'season-2026-27';
const MIN_CLUB_COUNT = 80;

function iso(value: any, fallback = ''): string {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value?.toDate === 'function') {
    try { return value.toDate().toISOString(); } catch {}
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function boolInt(value: any): number {
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

function json(value: any): string {
  try { return JSON.stringify(value ?? {}); } catch { return '{}'; }
}

/**
 * Serverless-safe cache hydration.
 * Firestore remains the source of truth; bundled SQLite is only a disposable bootstrap cache.
 * Hydration is aborted unless the remote snapshot passes sanity checks.
 */
export async function hydrateSqliteFromFirestoreSafely(): Promise<boolean> {
  if (!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT)) {
    return false;
  }
  if (process.env.EFLUZ_FIRESTORE_HYDRATION === 'off') return false;
  if (!firestoreCircuitBreaker.canExecute()) return false;

  const db = getFirestoreDb();
  const names = [
    COLLECTIONS.USERS,
    COLLECTIONS.SEASONS,
    COLLECTIONS.LEAGUES,
    COLLECTIONS.CLUBS,
    COLLECTIONS.SEASON_LEAGUE_CLUBS,
    COLLECTIONS.CLUB_MEMBERSHIPS,
    COLLECTIONS.COMPETITIONS,
    COLLECTIONS.COMPETITION_PARTICIPANTS,
    COLLECTIONS.FIXTURES,
    COLLECTIONS.RESULT_SUBMISSIONS,
    COLLECTIONS.DISPUTES,
    COLLECTIONS.STANDINGS,
    COLLECTIONS.NOTIFICATIONS,
    COLLECTIONS.AUDIT_LOGS,
  ];

  try {
    const snapshots: Record<string, any> = {};
    for (const name of names) {
      const snap = await db.collection(name).get();
      snapshots[name] = snap;
      trackFirestoreRead(name, snap.empty ? 1 : snap.docs.length, `hydrateSqliteFromFirestoreSafely:${name}`);
    }

    const seasons = snapshots[COLLECTIONS.SEASONS]?.docs || [];
    const leagues = snapshots[COLLECTIONS.LEAGUES]?.docs || [];
    const clubs = snapshots[COLLECTIONS.CLUBS]?.docs || [];
    const users = snapshots[COLLECTIONS.USERS]?.docs || [];
    const competitions = snapshots[COLLECTIONS.COMPETITIONS]?.docs || [];
    const fixtures = snapshots[COLLECTIONS.FIXTURES]?.docs || [];

    const remoteSeason = seasons.find((d: any) => (d.data()?.id || d.id) === TARGET_SEASON_ID);
    if (!remoteSeason || clubs.length < MIN_CLUB_COUNT || leagues.length < 5 || competitions.length < 5) {
      console.warn('[DB HYDRATION] Remote Firestore snapshot failed sanity checks; preserving local SQLite cache.');
      return false;
    }

    const localFixtureCount = Number(queryGet<any>('SELECT COUNT(*) AS count FROM fixtures')?.count || 0);
    const localUserCount = Number(queryGet<any>('SELECT COUNT(*) AS count FROM users')?.count || 0);
    if (localFixtureCount > 0 && fixtures.length === 0) {
      console.warn('[DB HYDRATION] Remote fixtures are empty while local fixtures exist; refusing destructive hydration.');
      return false;
    }
    if (localUserCount > 0 && users.length === 0) {
      console.warn('[DB HYDRATION] Remote users are empty while local users exist; refusing destructive hydration.');
      return false;
    }

    dbTransaction(() => {
      const clear = [
        'competition_standings',
        'active_occupancies_cache',
        'audit_logs',
        'notifications',
        'disputes',
        'result_submissions',
        'fixtures',
        'competition_participants',
        'club_memberships',
        'season_league_clubs',
        'competitions',
        'clubs',
        'leagues',
        'seasons',
        'users',
      ];
      for (const table of clear) queryRun(`DELETE FROM ${table}`);

      for (const d of users) {
        const x = d.data();
        const id = x.id || d.id;
        queryRun(`INSERT INTO users (id, telegram_id, username, first_name, last_name, photo_url, is_admin, is_suspended, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, String(x.telegramId ?? ''), String(x.username ?? ''), String(x.firstName ?? ''), x.lastName ?? null, x.photoUrl ?? null, boolInt(x.isAdmin), boolInt(x.isSuspended), iso(x.createdAt), iso(x.updatedAt, iso(x.createdAt))]);
      }

      for (const d of seasons) {
        const x = d.data();
        queryRun(`INSERT INTO seasons (id, name, status, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [x.id || d.id, String(x.name ?? ''), String(x.status ?? 'UPCOMING').toLowerCase(), iso(x.startDate), x.endDate ? iso(x.endDate) : null, iso(x.createdAt)]);
      }

      for (const d of leagues) {
        const x = d.data();
        queryRun(`INSERT INTO leagues (id, name, country, tier, logo_url, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [x.id || d.id, String(x.name ?? ''), String(x.country ?? ''), Number(x.tier ?? 1), String(x.logo ?? x.logoUrl ?? ''), iso(x.createdAt)]);
      }

      for (const d of clubs) {
        const x = d.data();
        queryRun(`INSERT INTO clubs (id, name, short_name, country, league_id, logo_url, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [x.id || d.id, String(x.name ?? ''), String(x.shortName ?? ''), String(x.country ?? ''), String(x.leagueId ?? ''), String(x.logo ?? x.logoUrl ?? ''), boolInt(x.isActive ?? x.active ?? true), iso(x.createdAt)]);
      }

      for (const d of snapshots[COLLECTIONS.SEASON_LEAGUE_CLUBS]?.docs || []) {
        const x = d.data();
        queryRun(`INSERT INTO season_league_clubs (id, season_id, league_id, club_id, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [x.id || d.id, String(x.seasonId ?? ''), String(x.leagueId ?? ''), String(x.clubId ?? ''), boolInt(x.isActive ?? true), iso(x.createdAt)]);
      }

      for (const d of snapshots[COLLECTIONS.CLUB_MEMBERSHIPS]?.docs || []) {
        const x = d.data();
        queryRun(`INSERT INTO club_memberships (id, season_id, club_id, user_id, claimed_at, status) VALUES (?, ?, ?, ?, ?, ?)`, [x.id || d.id, String(x.seasonId ?? ''), String(x.clubId ?? ''), String(x.userId ?? ''), iso(x.claimedAt), String(x.status ?? 'active').toLowerCase() === 'active' ? 'active' : 'released']);
        if (String(x.status ?? 'active').toLowerCase() === 'active') {
          const u = users.find((ud: any) => (ud.data()?.id || ud.id) === x.userId)?.data() || {};
          queryRun(`INSERT OR REPLACE INTO active_occupancies_cache (club_id, season_id, user_id, username, display_name, status, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?)`, [String(x.clubId ?? ''), String(x.seasonId ?? ''), String(x.userId ?? ''), String(u.username ?? x.ownerUsername ?? ''), `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || String(u.username ?? ''), iso(x.updatedAt, iso(x.claimedAt))]);
        }
      }

      for (const d of competitions) {
        const x = d.data();
        const fixtureCount = Number(x.fixtureCount ?? x.fixturesCount ?? 0);
        queryRun(`INSERT INTO competitions (id, season_id, league_id, name, type, schedule_mode, status, format_config_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [x.id || d.id, String(x.seasonId ?? ''), x.leagueId ? String(x.leagueId) : null, String(x.name ?? ''), String(x.type ?? 'LEAGUE'), String(x.scheduleMode ?? 'GENERATED_SCHEDULE'), String(x.status ?? 'upcoming'), json(x.formatConfig), iso(x.createdAt)]);
        if (fixtureCount === 0) {
          const count = fixtures.filter((fd: any) => (fd.data()?.competitionId || '') === (x.id || d.id)).length;
          if (count > 0) queryRun('UPDATE competitions SET status = status WHERE id = ?', [x.id || d.id]);
        }
      }

      for (const d of snapshots[COLLECTIONS.COMPETITION_PARTICIPANTS]?.docs || []) {
        const x = d.data();
        queryRun(`INSERT INTO competition_participants (id, competition_id, club_id, season_id, owner_user_id, source_competition_id, source_position, qualification_reason, qualification_timestamp, seed_number, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [x.id || d.id, String(x.competitionId ?? ''), String(x.clubId ?? ''), x.seasonId ? String(x.seasonId) : null, x.ownerUserId ? String(x.ownerUserId) : null, x.sourceCompetitionId ? String(x.sourceCompetitionId) : null, x.sourcePosition == null ? null : Number(x.sourcePosition), x.qualificationReason ?? null, x.qualificationTimestamp ? iso(x.qualificationTimestamp) : null, x.seedNumber == null ? null : Number(x.seedNumber), iso(x.createdAt)]);
      }

      for (const d of fixtures) {
        const x = d.data();
        queryRun(`INSERT INTO fixtures (id, season_id, competition_id, matchday, round_name, home_club_id, away_club_id, scheduled_at, status, home_score, away_score, winner_club_id, result_confirmed_at, fixture_source, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [x.id || d.id, String(x.seasonId ?? ''), String(x.competitionId ?? ''), Number(x.matchday ?? 0), x.roundName ?? null, String(x.homeClubId ?? ''), String(x.awayClubId ?? ''), iso(x.scheduledAt), String(x.status ?? 'SCHEDULED'), x.homeScore == null ? null : Number(x.homeScore), x.awayScore == null ? null : Number(x.awayScore), x.winnerClubId ?? null, x.resultConfirmedAt ? iso(x.resultConfirmedAt) : null, x.fixtureSource ?? 'official_2026_27', iso(x.createdAt), iso(x.updatedAt, iso(x.createdAt))]);
      }

      for (const d of snapshots[COLLECTIONS.RESULT_SUBMISSIONS]?.docs || []) {
        const x = d.data();
        queryRun(`INSERT INTO result_submissions (id, fixture_id, submitted_by_user_id, club_id, home_score, away_score, proof_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [x.id || d.id, String(x.fixtureId ?? ''), String(x.submittedByUserId ?? ''), String(x.clubId ?? ''), Number(x.homeScore ?? 0), Number(x.awayScore ?? 0), x.proofUrl ?? null, iso(x.createdAt)]);
      }

      for (const d of snapshots[COLLECTIONS.DISPUTES]?.docs || []) {
        const x = d.data();
        queryRun(`INSERT INTO disputes (id, fixture_id, season_id, home_submission_id, away_submission_id, status, resolved_by_user_id, resolution_notes, resolved_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [x.id || d.id, String(x.fixtureId ?? ''), String(x.seasonId ?? ''), x.homeSubmissionId ?? null, x.awaySubmissionId ?? null, String(x.status ?? 'OPEN'), x.resolvedByUserId ?? null, x.resolutionNotes ?? null, x.resolvedAt ? iso(x.resolvedAt) : null, iso(x.createdAt)]);
      }

      for (const d of snapshots[COLLECTIONS.NOTIFICATIONS]?.docs || []) {
        const x = d.data();
        queryRun(`INSERT INTO notifications (id, user_id, type, title, message, data_json, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [x.id || d.id, String(x.userId ?? ''), String(x.type ?? ''), String(x.title ?? ''), String(x.message ?? ''), json(x.data), boolInt(x.isRead), iso(x.createdAt)]);
      }

      for (const d of snapshots[COLLECTIONS.AUDIT_LOGS]?.docs || []) {
        const x = d.data();
        queryRun(`INSERT INTO audit_logs (id, actor_user_id, actor_username, action, entity_type, entity_id, old_value_json, new_value_json, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [x.id || d.id, String(x.actorUserId ?? ''), String(x.actorUsername ?? ''), String(x.action ?? ''), String(x.entityType ?? ''), String(x.entityId ?? ''), x.oldValueJson ?? null, x.newValueJson ?? null, x.ipAddress ?? null, iso(x.createdAt)]);
      }

      for (const d of snapshots[COLLECTIONS.STANDINGS]?.docs || []) {
        const x = d.data();
        const rows = Array.isArray(x.rows) ? x.rows : [];
        for (const row of rows) {
          queryRun(`INSERT OR REPLACE INTO competition_standings (competition_id, club_id, rank, club_name, short_name, logo_url, played, won, drawn, lost, goals_for, goals_against, goal_difference, points, form_json, qualification_status, manager_username, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [String(x.competitionId ?? d.id), String(row.clubId ?? ''), Number(row.position ?? row.rank ?? 0), String(row.clubName ?? ''), String(row.shortName ?? ''), row.logoUrl ?? '', Number(row.played ?? 0), Number(row.won ?? 0), Number(row.drawn ?? 0), Number(row.lost ?? 0), Number(row.goalsFor ?? 0), Number(row.goalsAgainst ?? 0), Number(row.goalDifference ?? 0), Number(row.points ?? 0), JSON.stringify(row.form ?? []), null, row.managerUsername ?? null, iso(x.updatedAt)]);
        }
      }
    });

    firestoreCircuitBreaker.recordSuccess();
    console.log(`[DB HYDRATION] Firestore -> SQLite hydration succeeded: users=${users.length}, clubs=${clubs.length}, competitions=${competitions.length}, fixtures=${fixtures.length}`);
    return true;
  } catch (error: any) {
    firestoreCircuitBreaker.recordFailure(error);
    console.warn('[DB HYDRATION] Hydration failed; preserving existing SQLite baseline.', error?.message || error);
    return false;
  }
}
