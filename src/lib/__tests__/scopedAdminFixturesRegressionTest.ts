import assert from 'node:assert/strict';
import type { Fixture } from '../../types';
import { getScopedAdminFixturePage } from '../scopedAdminFixtures';
const fixtures = Array.from({ length: 57 }, (_, index) => ({
  id: `fixture-${String(index).padStart(3, '0')}`, competitionId: 'comp-la-liga-2026',
  homeClubId: 'barcelona', awayClubId: index % 2 ? 'real-madrid' : 'valencia',
  homeClub: { name: 'Barcelona' }, awayClub: { name: index % 2 ? 'Real Madrid' : 'Valencia' },
  matchday: Math.floor(index / 10) + 1, status: index % 2 ? 'CONFIRMED' : 'SCHEDULED',
} as Fixture)).reverse();
const first = getScopedAdminFixturePage(fixtures, { page: 1, limit: 25 });
const second = getScopedAdminFixturePage(fixtures, { page: 2, limit: 25 });
const third = getScopedAdminFixturePage(fixtures, { page: 3, limit: 25 });
assert.equal(first.total, 57); assert.equal(first.hasMore, true);
assert.equal(third.fixtures.length, 7); assert.equal(third.hasMore, false);
assert.equal(new Set([...first.fixtures, ...second.fixtures, ...third.fixtures].map(fixture => fixture.id)).size, 57);
assert.equal(first.fixtures[0].id, 'fixture-000');
assert.equal(getScopedAdminFixturePage(fixtures, { competitionId: 'other-league' }).total, 0);
const filtered = getScopedAdminFixturePage(fixtures, { status: 'CONFIRMED', clubId: 'real-madrid', matchday: '2', search: '  MADRID ', limit: 25 });
assert.equal(filtered.total, 5);
assert.ok(filtered.fixtures.every(fixture => fixture.matchday === 2 && fixture.status === 'CONFIRMED'));
assert.equal(getScopedAdminFixturePage(fixtures, { search: 'fixture-056' }).fixtures[0].id, 'fixture-056');
assert.equal(fixtures[0].id, 'fixture-056', 'Filtering does not mutate the scoped dataset');
console.log('PASS scoped shared-panel pagination, stable ordering, combined filters, exact fixture search and source preservation');
