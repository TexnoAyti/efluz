import { queryRun, queryAll, queryGet, dbTransaction } from './index';
import { calculateCompetitionStandings } from '../tournament/standingsEngine';
import { StandingsRow } from '../../types';

/**
 * Recomputes standings from local SQLite fixtures & participants for a given competition
 * and atomically persists the materialized snapshot to the `competition_standings` table.
 * Returns the computed standings rows.
 */
export function refreshMaterializedStandingsForCompetition(competitionId: string): StandingsRow[] {
  const standings = calculateCompetitionStandings(competitionId);
  const now = new Date().toISOString();

  dbTransaction(() => {
    // Clear previous snapshot for this competition
    queryRun('DELETE FROM competition_standings WHERE competition_id = ?', [competitionId]);

    // Insert newly calculated standings
    for (const row of standings) {
      queryRun(
        `INSERT OR REPLACE INTO competition_standings (
          competition_id, club_id, rank, club_name, short_name, logo_url,
          played, won, drawn, lost, goals_for, goals_against, goal_difference,
          points, form_json, qualification_status, manager_username, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          competitionId,
          row.clubId,
          row.position,
          row.clubName,
          row.shortName || '',
          row.logoUrl || '',
          row.played,
          row.won,
          row.drawn,
          row.lost,
          row.goalsFor,
          row.goalsAgainst,
          row.goalDifference,
          row.points,
          JSON.stringify(row.form || []),
          null,
          row.managerUsername || null,
          now,
        ]
      );
    }
  });

  return standings;
}

/**
 * Retrieves the materialized standings from SQLite. If no materialized rows exist,
 * automatically computes and caches them.
 */
export function getMaterializedStandingsForCompetition(competitionId: string): StandingsRow[] {
  const rows = queryAll<any>(
    'SELECT * FROM competition_standings WHERE competition_id = ? ORDER BY rank ASC',
    [competitionId]
  );

  if (!rows || rows.length === 0) {
    return refreshMaterializedStandingsForCompetition(competitionId);
  }

  return rows.map((r) => ({
    position: r.rank,
    clubId: r.club_id,
    clubName: r.club_name,
    shortName: r.short_name,
    logoUrl: r.logo_url,
    managerUsername: r.manager_username || undefined,
    played: r.played,
    won: r.won,
    drawn: r.drawn,
    lost: r.lost,
    goalsFor: r.goals_for,
    goalsAgainst: r.goals_against,
    goalDifference: r.goal_difference,
    points: r.points,
    form: r.form_json ? JSON.parse(r.form_json) : [],
  }));
}

/**
 * Helper to update materialized standings in SQLite when a fixture is confirmed or modified.
 */
export function updateMaterializedStandingsFromFixture(fixtureId: string): StandingsRow[] | null {
  const fix = queryGet<{ competition_id: string }>('SELECT competition_id FROM fixtures WHERE id = ?', [fixtureId]);
  if (!fix?.competition_id) {
    return null;
  }
  return refreshMaterializedStandingsForCompetition(fix.competition_id);
}
