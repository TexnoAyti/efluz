import { Competition, Fixture } from '../../types';
import { ReadModelKeys, redisGetFresh, redisGetLkg } from '../readModel/readModelStore';
import { filterTombstonedFixtures } from './fixtureTombstoneService';

/** Only existing complete fixture snapshots are consulted; never fetch Firestore
 * merely to decorate the catalog. Unknown counts retain the catalog value.
 */
export async function withVisibleFixtureCounts(competitions: Competition[], seasonId: string): Promise<Competition[]> {
  return Promise.all(competitions.map(async competition => {
    if (competition.type !== 'LEAGUE') return competition;
    const key = ReadModelKeys.competitionFixtures(competition.id, seasonId);
    const snapshot = (await redisGetFresh<Fixture[]>(key)) || (await redisGetLkg<Fixture[]>(key));
    if (!Array.isArray(snapshot?.data) || (snapshot.actualCount != null && snapshot.actualCount !== snapshot.data.length)) return competition;
    const matching = snapshot.data.filter(fixture => fixture.competitionId === competition.id && (!fixture.seasonId || fixture.seasonId === seasonId));
    const fixtures = await filterTombstonedFixtures(matching, seasonId);
    return {
      ...competition,
      fixtureCount: fixtures.length,
      fixturesCount: fixtures.length,
      hasFixtures: fixtures.length > 0,
      configuredFixtureCount: competition.fixturesCount ?? competition.fixtureCount,
      fixtureCountSource: 'visible-fixture-snapshot',
      fixtureCountSnapshotAt: snapshot.generatedAt,
    } as Competition;
  }));
}
