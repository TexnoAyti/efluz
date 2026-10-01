import assert from 'node:assert/strict';
import { getCompetitionsFromReadModel, ReadModelKeys, redisSetRaw } from '../readModel/readModelStore';
import { getFirestoreTelemetry } from '../firebase/firestoreStore';
import { addFixtureTombstone } from '../services/fixtureTombstoneService';
import { withVisibleFixtureCounts } from '../services/competitionFixtureCounts';

const season = 'test-season';
const competitions: any[] = [
  { id: 'serie', seasonId: season, type: 'LEAGUE', fixtureCount: 190, fixturesCount: 190 },
  { id: 'bundes', seasonId: season, type: 'LEAGUE', fixtureCount: 153, fixturesCount: 153 },
  { id: 'unknown', seasonId: season, type: 'LEAGUE', fixtureCount: 190 },
  { id: 'ucl', seasonId: season, type: 'EUROPEAN_LEAGUE_PHASE', fixtureCount: 128 },
];
await redisSetRaw(ReadModelKeys.competitions(season), { data: competitions }, 3600);
for (const [id, count] of [['serie', 190], ['bundes', 152]] as const) {
  const fixtures = Array.from({ length: count }, (_, i) => ({ id: `${id}-${i}`, competitionId: id, seasonId: season }));
  await redisSetRaw(ReadModelKeys.competitionFixtures(id, season), { data: fixtures, actualCount: count }, 3600);
}
await addFixtureTombstone({ fixtureId: 'serie-0', seasonId: season, competitionId: 'serie', deletedAt: new Date().toISOString() });
const before = getFirestoreTelemetry().totalReads;
const result: any = await getCompetitionsFromReadModel(season);
assert.equal(result.competitions[0].fixtureCount, 189);
assert.equal(result.competitions[0].configuredFixtureCount, 190);
assert.equal(result.competitions[1].fixtureCount, 152);
assert.equal(result.competitions[2].fixtureCount, 190);
assert.equal(result.competitions[3].fixtureCount, 128);
assert.deepEqual(competitions[0], { id: 'serie', seasonId: season, type: 'LEAGUE', fixtureCount: 190, fixturesCount: 190 });
const again: any = await withVisibleFixtureCounts(competitions, season);
assert.equal(again[0].fixtureCount, 189);
assert.equal(getFirestoreTelemetry().totalReads, before);
console.log('PASS visible cached counts, tombstones, absent snapshot fallback, unchanged UEFA catalog and zero added Firestore reads.');
