import { queryAll, queryGet, queryRun } from './index';
import { StandingsRow } from '../../types';

interface StandingsClubRow {
  id: string;
  name: string;
  shortName: string;
  logoUrl?: string | null;
  managerUsername?: string | null;
}

interface ConfirmedFixtureRow {
  homeClubId: string;
  awayClubId: string;
  homeScore: number;
  awayScore: number;
}

/**
 * SQLite is the authoritative read source while Firestore is unavailable.
 * The table is materialized, but can be deterministically rebuilt from local
 * confirmed fixtures when the snapshot is missing or stale.
 */
export function getMaterializedCompetitionStandings(competitionId: string): StandingsRow[] {
  const rows = queryAll<any>(
    `SELECT competition_id, club_id, rank, club_name, short_name, logo_url,
            played, won, drawn, lost, goals_for, goals_against,
            goal_difference, points, form_json, manager_username
       FROM competition_standings
      WHERE competition_id = ?
      ORDER BY rank ASC`,
    [competitionId]
  );

  if (rows.length === 0) return [];

  return rows.map((r) => ({
    position: Number(r.rank),
    clubId: r.club_id,
    clubName: r.club_name,
    shortName: r.short_name,
    logoUrl: r.logo_url || '',
    managerUsername: r.manager_username || null,
    played: Number(r.played || 0),
    won: Number(r.won || 0),
    drawn: Number(r.drawn || 0),
    lost: Number(r.lost || 0),
    goalsFor: Number(r.goals_for || 0),
    goalsAgainst: Number(r.goals_against || 0),
    goalDifference: Number(r.goal_difference || 0),
    points: Number(r.points || 0),
    form: parseForm(r.form_json),
  }));
}

function parseForm(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String).slice(-5) : [];
  } catch {
    return [];
  }
}

function loadCompetitionClubs(competitionId: string): StandingsClubRow[] {
  const comp = queryGet<any>('SELECT * FROM competitions WHERE id = ?', [competitionId]);
  if (!comp) return [];

  if (comp.league_id) {
    return queryAll<any>(
      `SELECT id, name, short_name as shortName, logo_url as logoUrl
         FROM clubs
        WHERE league_id = ? AND active = 1
        ORDER BY name ASC`,
      [comp.league_id]
    );
  }

  return queryAll<any>(
    `SELECT c.id, c.name, c.short_name as shortName, c.logo_url as logoUrl,
            u.username as managerUsername
       FROM competition_participants cp
       JOIN clubs c ON c.id = cp.club_id
       LEFT JOIN users u ON u.id = cp.owner_user_id
      WHERE cp.competition_id = ?
      ORDER BY cp.seed_number ASC`,
    [competitionId]
  );
}

function loadConfirmedFixtures(competitionId: string): ConfirmedFixtureRow[] {
  return queryAll<any>(
    `SELECT home_club_id as homeClubId,
            away_club_id as awayClubId,
            home_score as homeScore,
            away_score as awayScore
       FROM fixtures
      WHERE competition_id = ?
        AND status = 'CONFIRMED'
        AND home_score IS NOT NULL
        AND away_score IS NOT NULL`,
    [competitionId]
  ).map((f) => ({
    homeClubId: f.homeClubId,
    awayClubId: f.awayClubId,
    homeScore: Number(f.homeScore),
    awayScore: Number(f.awayScore),
  }));
}

/** Rebuild and persist the SQLite materialized standings snapshot. */
export function rebuildMaterializedCompetitionStandings(competitionId: string): StandingsRow[] {
  const clubs = loadCompetitionClubs(competitionId);
  if (clubs.length === 0) return [];

  const fixtures = loadConfirmedFixtures(competitionId);
  const stats = new Map<string, any>();

  for (const club of clubs) {
    stats.set(club.id, {
      ...club,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      form: [] as string[],
    });
  }

  for (const fixture of fixtures) {
    const home = stats.get(fixture.homeClubId);
    const away = stats.get(fixture.awayClubId);
    if (!home || !away) continue;

    home.played += 1;
    away.played += 1;
    home.goalsFor += fixture.homeScore;
    home.goalsAgainst += fixture.awayScore;
    away.goalsFor += fixture.awayScore;
    away.goalsAgainst += fixture.homeScore;

    if (fixture.homeScore > fixture.awayScore) {
      home.won += 1;
      home.points += 3;
      home.form.push('W');
      away.lost += 1;
      away.form.push('L');
    } else if (fixture.homeScore < fixture.awayScore) {
      away.won += 1;
      away.points += 3;
      away.form.push('W');
      home.lost += 1;
      home.form.push('L');
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
      home.form.push('D');
      away.form.push('D');
    }
  }

  const sorted = Array.from(stats.values()).map((r) => {
    r.goalDifference = r.goalsFor - r.goalsAgainst;
    r.form = r.form.slice(-5);
    return r;
  }).sort((a, b) =>
    b.points - a.points ||
    b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor ||
    String(a.name).localeCompare(String(b.name))
  );

  queryRun('DELETE FROM competition_standings WHERE competition_id = ?', [competitionId]);

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    queryRun(
      `INSERT INTO competition_standings
        (competition_id, club_id, rank, club_name, short_name, logo_url,
         played, won, drawn, lost, goals_for, goals_against, goal_difference,
         points, form_json, qualification_status, manager_username, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        competitionId,
        r.id,
        i + 1,
        r.name,
        r.shortName,
        r.logoUrl || '',
        r.played,
        r.won,
        r.drawn,
        r.lost,
        r.goalsFor,
        r.goalsAgainst,
        r.goalDifference,
        r.points,
        JSON.stringify(r.form),
        r.managerUsername || null,
        new Date().toISOString(),
      ]
    );
  }

  return getMaterializedCompetitionStandings(competitionId);
}

/** Update SQLite standings after a local fixture confirmation. */
export function refreshMaterializedStandingsForCompetition(competitionId: string): StandingsRow[] {
  return rebuildMaterializedCompetitionStandings(competitionId);
}
