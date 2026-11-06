import assert from 'node:assert/strict';
import { S2_OPENS_AT, S2_PUBLIC_AT, seasonTwoAdmissionPhase } from '../../lib/seasonTwoAdmissionWindow';
import { CURRENT_SEASON_ID } from '../../lib/seasonParticipationPolicy';
import { EFL_SECOND_SEASON } from '../../lib/seasonPreparation';

assert.equal(S2_OPENS_AT, '2026-11-06T15:00:00.000Z');
assert.equal(S2_PUBLIC_AT, '2026-11-06T15:15:00.000Z');
assert.equal(seasonTwoAdmissionPhase(Date.parse(S2_OPENS_AT) - 1), 'NOT_STARTED');
assert.equal(seasonTwoAdmissionPhase(Date.parse(S2_OPENS_AT)), 'PRIORITY');
assert.equal(seasonTwoAdmissionPhase(Date.parse(S2_PUBLIC_AT) - 1), 'PRIORITY');
assert.equal(seasonTwoAdmissionPhase(Date.parse(S2_PUBLIC_AT)), 'PUBLIC');
assert.equal(EFL_SECOND_SEASON.sourceSeasonId, CURRENT_SEASON_ID);
assert.notEqual(EFL_SECOND_SEASON.id, CURRENT_SEASON_ID);
assert.equal(EFL_SECOND_SEASON.leagues[0].id, 'league-premier-league');
assert.equal(new Set(EFL_SECOND_SEASON.leagues.flatMap(l => l.roster.clubs.map(c => c.id))).size, EFL_SECOND_SEASON.leagues.reduce((n,l)=>n+l.roster.clubs.length,0));
console.log('PASS: 20:00–20:15 Uzbekistan boundaries, season independence, roster uniqueness, league order');
