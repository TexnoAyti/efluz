import assert from 'node:assert/strict';
import { fixturesForClub, resolveActiveClub, saveActiveClub } from '../activeClub';
import { loadActiveClubStanding } from '../useActiveClubStanding';
import { Club, Competition, Fixture, StandingsRow } from '../../types';

const arsenal = { id: 'arsenal', leagueId: 'england' } as Club;
const madrid = { id: 'madrid', leagueId: 'spain' } as Club;
const clubs = [arsenal, madrid];
const entries = new Map<string, string>();
const storage = {
  getItem: (key: string) => entries.get(key) || null,
  setItem: (key: string, value: string) => { entries.set(key, value); },
  removeItem: (key: string) => { entries.delete(key); },
};
assert.equal(resolveActiveClub(clubs, arsenal, 'a', '2026', storage)?.id, 'arsenal');
saveActiveClub('madrid', 'a', '2026', storage);
assert.equal(resolveActiveClub(clubs, arsenal, 'a', '2026', storage)?.id, 'madrid', 'reload restores secondary club');
assert.equal(resolveActiveClub(clubs, arsenal, 'b', '2026', storage)?.id, 'arsenal', 'another account cannot inherit selection');
assert.equal(resolveActiveClub(clubs, arsenal, 'a', '2027', storage)?.id, 'arsenal', 'another season cannot inherit selection');
assert.equal(resolveActiveClub([arsenal], arsenal, 'a', '2026', storage)?.id, 'arsenal', 'released club cannot be restored');
assert.equal(entries.size, 0, 'invalid selection removed');
assert.equal(resolveActiveClub([], arsenal, 'a', '2026', storage), null, 'unowned API fallback rejected');
const brokenStorage = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); }, removeItem() { throw Error('denied'); } };
saveActiveClub('madrid', 'a', '2026', brokenStorage);
assert.equal(resolveActiveClub(clubs, arsenal, 'a', '2026', brokenStorage)?.id, 'arsenal');

const fixtures = [
  { id: 'a', homeClubId: 'arsenal', awayClubId: 'chelsea' },
  { id: 'b', homeClubId: 'barcelona', awayClubId: 'madrid' },
  { id: 'c', homeClub: { id: 'madrid' }, awayClub: { id: 'psg' } },
] as Fixture[];
assert.deepEqual(fixturesForClub(fixtures, 'arsenal').map((f) => f.id), ['a']);
assert.deepEqual(fixturesForClub(fixtures, 'madrid').map((f) => f.id), ['b', 'c']);
assert.deepEqual(fixturesForClub(fixtures.slice(0, 1), 'madrid'), [], 'empty secondary schedule cannot fall back to primary matches');
assert.deepEqual(fixturesForClub(fixtures), []);
assert.equal(fixtures.length, 3, 'source schedule not mutated');

const requests: string[] = [];
const client = {
  async getCompetitions(seasonId: string) {
    requests.push(seasonId);
    return { competitions: [
      { id: 'cup-spain', type: 'KNOCKOUT', leagueId: 'spain' },
      { id: 'liga', type: 'LEAGUE', leagueId: 'spain' },
    ] as Competition[] };
  },
  async getCompetitionStandings(id: string) {
    requests.push(id);
    return { standings: [{ clubId: 'barcelona', points: 20 }, { clubId: 'madrid', points: 7 }] as StandingsRow[] };
  },
};
assert.equal((await loadActiveClubStanding('madrid', 'spain', '2026', client))?.points, 7, 'secondary club gets its own stats');
assert.deepEqual(requests, ['2026', 'liga']);
assert.equal(await loadActiveClubStanding('psg', 'spain', '2026', client), null, 'missing row cannot borrow another club stats');
requests.length = 0;
assert.equal(await loadActiveClubStanding('arsenal', 'england', '2026', client), null);
assert.deepEqual(requests, ['2026'], 'missing league does not fetch another league standings');
await assert.rejects(loadActiveClubStanding('madrid', 'spain', '2026', { ...client, getCompetitionStandings: async () => { throw Error('offline'); } }), /offline/);
console.log('Club switch regression: PASS (selection, account/season isolation, released clubs, storage denial, fixture filtering, league statistics, API failure).');
