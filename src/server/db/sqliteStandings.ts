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
  return refreshMaterializedStandingsForCompetition(competitionId);
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
