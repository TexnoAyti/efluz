import assert from 'node:assert/strict';
import {
  getAdminFixturesFromReadModel, invalidateFixtureReadModels, ReadModelKeys,
  redisGetFresh, redisSetRaw, replaceCupFixturesInAdminSnapshot,
} from '../readModel/readModelStore';
import type { Fixture } from '../../types';

const season = 'season-2026-27';
const cup = 'comp-fa-cup-2026';
const other = 'comp-premier-league-2026';
const fixture = (id: string, competitionId: string): Fixture => ({
  id, competitionId, seasonId: season, matchday: 1,
  homeClubId: null, awayClubId: null, scheduledAt: '2026-09-29T00:00:00.000Z',
  status: 'SCHEDULED', createdAt: '2026-09-29T00:00:00.000Z',
  updatedAt: '2026-09-29T00:00:00.000Z',
} as Fixture);

async function main() {
  const oldCup = fixture('old-cup', cup);
  const league = fixture('league', other);
  const newCup = fixture('new-cup', cup);
  await redisSetRaw(ReadModelKeys.adminFixtures(season), {
    generatedAt: '2026-09-29T00:00:00.000Z', data: [oldCup, league],
  });
  await invalidateFixtureReadModels(cup, season);
  await replaceCupFixturesInAdminSnapshot(cup, season, [newCup]);
  const saved = await redisGetFresh<Fixture[]>(ReadModelKeys.adminFixtures(season));
  assert.deepEqual(new Set(saved?.data.map((row) => row.id)), new Set(['new-cup', 'league']));
  const page = await getAdminFixturesFromReadModel({ seasonId: season, competitionId: cup });
  assert.deepEqual(page.fixtures.map((row) => row.id), ['new-cup']);

  // An earlier redraw left the admin LKG dirty, while the cup page refreshed
  // its own snapshot. The admin response must use that newer cup data.
  await invalidateFixtureReadModels(cup, season);
  await redisSetRaw(ReadModelKeys.competitionFixtures(cup, season), {
    // Its clock may precede a stale admin LKG written by a later cache rebuild.
    generatedAt: '2026-09-29T00:00:00.000Z', data: [fixture('latest-cup', cup)],
  });
  const repaired = await getAdminFixturesFromReadModel({ seasonId: season });
  assert.equal(repaired.fixtures.some((row) => row.id === 'old-cup' || row.id === 'new-cup'), false);
  assert.equal(repaired.fixtures.some((row) => row.id === 'latest-cup'), true);
  assert.equal(repaired.fixtures.some((row) => row.id === 'league'), true);
  console.log('Admin cup snapshot sync: PASS');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
