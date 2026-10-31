import type { StandingsRow } from '../../types';
import { assertSeasonCompetitionEnabled, CURRENT_SEASON_ID } from '../../lib/seasonParticipationPolicy';
import { SEED_CLUBS } from '../db/seed';
import { getFirestoreDb } from '../firebase/admin';
import { DOMESTIC_LEAGUE_CONFIG, normalizeFixtureSnapshot, ReadModelNotWarmedError } from '../readModel/readModelStore';
import { filterRetiredFixtures } from './retiredFixtureService';
import { getFixtureTombstones, rebuildStandingsSnapshotFromFixtures } from './fixtureTombstoneService';

const pending = new Map<string, Promise<{standings: StandingsRow[]; fixtureTruthCount: number; snapshotAt: string}>>();
/** Public football data only. Read current league fixtures without refreshing or
 * publishing durable snapshots. No completed-value cache: the next read sees edits. */
export async function readNativeLeagueTable(competitionId: string, seasonId: string) {
  const config = DOMESTIC_LEAGUE_CONFIG[competitionId];
  if (process.env.DATABASE_PROVIDER !== 'supabase' || !config || seasonId !== CURRENT_SEASON_ID) return null;
  assertSeasonCompetitionEnabled(competitionId, seasonId);
  const key = JSON.stringify([seasonId, competitionId]);
  const existing = pending.get(key);
  if (existing) return existing;
  const work = (async () => {
    const [docs, tombstones] = await Promise.all([
      getFirestoreDb().collection('fixtures').where('seasonId', '==', seasonId)
        .where('competitionId', '==', competitionId).limit(1001).get(),
      getFixtureTombstones(seasonId),
    ]);
    if (docs.size >= 1001) throw new ReadModelNotWarmedError('LEAGUE_FIXTURE_LIMIT_EXCEEDED');
    const deleted = new Set(tombstones.map(row => row.fixtureId));
    const fixtures = filterRetiredFixtures(docs.docs.map(doc => normalizeFixtureSnapshot({...doc.data(), id: doc.id}, seasonId)), seasonId)
      .filter(row => row.seasonId === seasonId && row.competitionId === competitionId && !deleted.has(row.id));
    const baseRows: StandingsRow[] = SEED_CLUBS.filter(club => club.leagueId === config.leagueId).map(club => ({
      clubId: club.id, clubName: club.name, shortName: club.shortName, logoUrl: club.logoUrl, clubLogoUrl: club.logoUrl, position: 0,
      played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, form: [],
    }));
    if (baseRows.length !== config.expectedCount) throw new ReadModelNotWarmedError('LEAGUE_ROSTER_UNAVAILABLE');
    const standings = await rebuildStandingsSnapshotFromFixtures(competitionId, seasonId, fixtures, {persist: false, baseRows});
    return {standings: standings!, fixtureTruthCount: fixtures.length, snapshotAt: new Date().toISOString()};
  })();
  pending.set(key, work);
  try {return await work;} finally {if (pending.get(key) === work) pending.delete(key);}
}
