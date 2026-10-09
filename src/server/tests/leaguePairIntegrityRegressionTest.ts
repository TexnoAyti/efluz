import assert from 'node:assert/strict';
import { analyzeLeaguePairs } from '../services/leaguePairIntegrity';
import { SEED_CLUBS } from '../db/seed';
import { initDatabase } from '../db';
import { ReadModelKeys, redisSetRaw } from '../readModel/readModelStore';
import { addFixtureTombstone } from '../services/fixtureTombstoneService';
import { validateDomesticFixturesFirestore, getReadMetrics, adminDeleteFixtureFirestore } from '../firebase/firestoreStore';

const clubs = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
const f = (id: string, homeClubId: string, awayClubId: string): any => ({ id, homeClubId, awayClubId });
const result = analyzeLeaguePairs([f('one', 'b', 'a'), f('two', 'a', 'b'), f('invalid', 'a', 'a')], clubs);
assert.deepEqual(result.missingPairs.map(pair => [pair.homeClubId, pair.awayClubId]), [['a', 'c'], ['b', 'c']]);
assert.deepEqual(result.invalidFixtureIds, ['invalid']);
assert.equal(analyzeLeaguePairs([f('one', 'a', 'b'), f('two', 'a', 'c'), f('three', 'c', 'b')], clubs).missingPairs.length, 0);

await initDatabase();
const season = 'integrity-test';
await redisSetRaw(ReadModelKeys.clubsWithOwners(season), { data: SEED_CLUBS }, 3600);
for (const league of ['premier-league', 'la-liga', 'serie-a', 'bundesliga', 'ligue-1']) {
  const id = `comp-${league}-2026`;
  const roster = SEED_CLUBS.filter(club => club.leagueId === `league-${league}`);
  const fixtures: any[] = [];
  for (let i = 0; i < roster.length; i++) for (let j = i + 1; j < roster.length; j++) {
    fixtures.push({ id: `${id}:${i}:${j}`, seasonId: season, competitionId: id, matchday: 1, homeClubId: roster[i].id, awayClubId: roster[j].id, status: 'SCHEDULED' });
  }
  await redisSetRaw(ReadModelKeys.competitionFixtures(id, season), { data: fixtures }, 3600);
}
await addFixtureTombstone({ fixtureId: 'comp-serie-a-2026:0:1', seasonId: season, competitionId: 'comp-serie-a-2026', deletedAt: new Date().toISOString(), reason: 'Isolated deletion reason' });
const reads = getReadMetrics().totalReads;
const report = await validateDomesticFixturesFirestore(season);
const serie = report.leagues.find(league => league.competitionId === 'comp-serie-a-2026')!;
assert.equal(serie.actualFixtureCount, 189);
assert.equal(serie.missingPairs.length, 1);
assert.equal(serie.deletedFixtures[0].reason, 'Isolated deletion reason');
assert.equal(serie.rosterSource, 'cached-clubs');
assert.equal(serie.isValid, false);
assert.equal(getReadMetrics().totalReads, reads);
await assert.rejects(adminDeleteFixtureFirestore('admin-test', 'admin', 'missing-test-fixture', 'Isolated reason'), (error: any) => error.errorCode === 'FIXTURE_NOT_FOUND');
console.log('PASS missing pair detection despite duplicate counts, invalid clubs, tombstone history, cached-roster validation and zero added Firestore reads; exact missing-fixture error code.');
