import { StandingsRow } from '../../types';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { calculateCompetitionStandingsFirestore } from '../firebase/firestoreStore';
import {
  getMaterializedCompetitionStandings,
  rebuildMaterializedCompetitionStandings,
} from '../db/sqliteStandings';

/**
 * Read path for standings. SQLite is authoritative whenever Firestore cannot
 * be safely read. No Firestore request is attempted while the breaker is open
 * or the read budget has switched the process into fallback mode.
 */
export async function getResilientCompetitionStandings(competitionId: string): Promise<StandingsRow[]> {
  if (!firestoreCircuitBreaker.canExecute()) {
    const materialized = getMaterializedCompetitionStandings(competitionId);
    if (materialized.length > 0) return materialized;
    return rebuildMaterializedCompetitionStandings(competitionId);
  }

  const standings = await calculateCompetitionStandingsFirestore(competitionId);
  if (standings.length > 0) {
    return standings;
  }

  const materialized = getMaterializedCompetitionStandings(competitionId);
  return materialized.length > 0 ? materialized : rebuildMaterializedCompetitionStandings(competitionId);
}
