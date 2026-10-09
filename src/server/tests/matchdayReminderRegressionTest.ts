import assert from 'node:assert/strict';
import { selectOutstandingOwnerIds } from '../services/matchdayReminderService';

const fixture: any = {
  id: 'fixture-1',
  seasonId: 'season-2026-27',
  competitionId: 'competition-premier-league',
  matchday: 3,
  homeClubId: 'club-arsenal',
  awayClubId: 'club-chelsea',
  homeOwnerId: 'user-home',
  awayOwnerId: 'user-away',
  status: 'PENDING_CONFIRMATION',
};

assert.deepEqual(
  selectOutstandingOwnerIds(fixture, []),
  ['user-home', 'user-away'],
  'Both owners must be reminded when neither submitted.'
);

assert.deepEqual(
  selectOutstandingOwnerIds(fixture, ['user-home']),
  ['user-away'],
  'Only the missing opponent must be reminded after the first submission.'
);

assert.deepEqual(
  selectOutstandingOwnerIds(fixture, ['user-home', 'user-away']),
  [],
  'No reminder must be sent after both owners submitted.'
);

const singleOwnerFixture: any = {
  ...fixture,
  awayOwnerId: undefined,
};
assert.deepEqual(
  selectOutstandingOwnerIds(singleOwnerFixture, []),
  ['user-home'],
  'Unassigned opponent slots must not create synthetic recipients.'
);

console.log('MATCHDAY_REMINDER_REGRESSION_PASS');
