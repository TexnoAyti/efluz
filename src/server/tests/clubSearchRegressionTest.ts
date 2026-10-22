import assert from 'node:assert/strict';
import { findSearchClubs, initialSearchClubs, loadSearchClubs } from '../../lib/clubSearch';
import { clubPagePath } from '../../lib/clubNavigation';
import type { Club } from '../../types';

const season = 'season-2026-27';
const barcelona = findSearchClubs(initialSearchClubs(), ' Barcelona ')[0];
assert.equal(barcelona.id, 'club-barcelona');
assert.equal(findSearchClubs(initialSearchClubs(), 'BARCELONA')[0].id, barcelona.id);
assert.equal(clubPagePath(barcelona.id), '/clubs/club-barcelona');
assert.equal(barcelona.owner, undefined, 'Catalog must not invent an owner');
let index: Club[] = [];
let release!: (result: { clubs: Club[] }) => void;
const slowLeague = new Promise<{ clubs: Club[] }>(resolve => { release = resolve; });
const requested: string[] = [];
const work = loadSearchClubs({
  getLeagues: async () => ({ leagues: [{ id: 'slow' }, { id: 'la-liga' }, { id: 'failed' }] as any }),
  getLeagueClubs: async (leagueId, seasonId) => {
    assert.equal(seasonId, season); requested.push(leagueId);
    if (leagueId === 'slow') return slowLeague;
    if (leagueId === 'failed') throw Error('unavailable');
    return { clubs: [{ ...barcelona, name: 'Barcelona live', createdAt: 'verified' }] };
  },
}, season, clubs => { index = clubs; });
assert.equal(findSearchClubs(index, 'Barcelona')[0].id, barcelona.id, 'Search works before any network response');
await new Promise(resolve => setImmediate(resolve));
assert.equal(findSearchClubs(index, 'Barcelona')[0].name, 'Barcelona live', 'Fast league appears while another league remains pending');
assert.equal(index.filter(club => club.id === barcelona.id).length, 1, 'Live data replaces the catalog without duplicate clubs');
assert.equal(requested.length, 3);
release({ clubs: [] });
await work;
await assert.rejects(loadSearchClubs({ getLeagues: async () => { throw Error('offline'); }, getLeagueClubs: async () => { throw Error('unused'); } }, season, clubs => { index = clubs; }));
assert.equal(findSearchClubs(index, 'Barcelona')[0].id, barcelona.id, 'Failed catalog API cannot erase club discovery');
console.log('PASS Barcelona search: immediate public catalog, case/whitespace, club page path, concurrent progressive league loading, unavailable APIs and no duplicate or invented owners');
