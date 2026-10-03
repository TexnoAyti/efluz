import assert from 'node:assert/strict';
import type { Fixture } from '../../types';
import { nextSeasonFixture, sortSeasonFixtures } from '../fixtureOrder';
import { fixturesForClub } from '../activeClub';

const fixture = (id: string, competitionId: string, matchday: number, extra: Partial<Fixture> = {}): Fixture => ({
  id, competitionId, matchday, seasonId: 'season-2026-27', homeClubId: 'my-club',
  awayClubId: 'opponent', scheduledAt: '', createdAt: '', updatedAt: '', status: 'SCHEDULED', ...extra,
});
const league = (day: number, extra: Partial<Fixture> = {}) => fixture('league-' + day, 'comp-ligue-1-2026', day, extra);
const cup = fixture('cup', 'comp-coupe-de-france-2026', 1, { isPlayable: true });
const european = fixture('europe', 'comp-champions-league-2026', 1, { isPlayable: true });
const locked = league(1, { isPlayable: false });
assert.equal(nextSeasonFixture([cup, european, locked])?.id, locked.id, 'Open French cup must not bypass locked league');
assert.equal(nextSeasonFixture([{ ...cup, status: 'DISPUTED' }, locked])?.id, locked.id, 'Later disputed cup must not bypass league');
assert.equal(nextSeasonFixture([league(10), cup, ...Array.from({ length: 9 }, (_, i) => league(i + 1, { status: 'CONFIRMED' }))])?.id, cup.id);
assert.equal(nextSeasonFixture([european, league(10), { ...cup, status: 'CONFIRMED' }])?.id, 'league-10');
for (const lastRound of [17, 19]) {
  const completed = Array.from({ length: lastRound }, (_, i) => league(i + 1, { status: 'CONFIRMED' }));
  assert.equal(nextSeasonFixture([european, ...completed, { ...cup, status: 'CONFIRMED' }])?.id, 'europe');
}
assert.equal(nextSeasonFixture([league(9), league(2, { status: 'PENDING_CONFIRMATION' })])?.id, 'league-2');
assert.equal(nextSeasonFixture([league(1, { status: 'CANCELLED' }), cup])?.id, 'cup');
assert.equal(nextSeasonFixture([{ ...cup, status: 'CONFIRMED' }]), null);
const shuffled = [european, league(19), cup, league(10), league(9), league(1)];
const before = [...shuffled];
assert.deepEqual(sortSeasonFixtures(shuffled).map(f => f.id), ['league-1', 'league-9', 'cup', 'league-10', 'league-19', 'europe']);
assert.deepEqual(shuffled, before, 'Sorting must not mutate API/state arrays');
assert.equal(nextSeasonFixture(fixturesForClub([fixture('other-club', 'comp-ligue-1-2026', 1, { homeClubId: 'other' }), cup], 'my-club'))?.id, 'cup');
assert.equal(sortSeasonFixtures([league(2, { scheduledAt: 'invalid' }), league(1)])[0].id, 'league-1');
console.log('PASS: season order, locked league, cup transitions, 17/19 rounds, active club and immutable sorting');
