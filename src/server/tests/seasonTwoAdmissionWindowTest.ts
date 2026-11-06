import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { S2_OPENS_AT, S2_PUBLIC_AT, seasonTwoAdmissionPhase } from '../../lib/seasonTwoAdmissionWindow';
import { CURRENT_SEASON_ID } from '../../lib/seasonParticipationPolicy';
import { EFL_SECOND_SEASON } from '../../lib/seasonPreparation';
import { SECOND_SEASON_CLUB_LOGOS, SECOND_SEASON_CREST_SOURCE_COMMIT } from '../../lib/seasonTwoClubLogos';
import { SEED_CLUBS } from '../db/seed';

assert.equal(S2_OPENS_AT, '2026-11-06T15:30:00.000Z');
assert.equal(S2_PUBLIC_AT, '2026-11-06T15:45:00.000Z');
assert.equal(seasonTwoAdmissionPhase(Date.parse(S2_OPENS_AT) - 1), 'NOT_STARTED');
assert.equal(seasonTwoAdmissionPhase(Date.parse(S2_OPENS_AT)), 'PRIORITY');
assert.equal(seasonTwoAdmissionPhase(Date.parse(S2_PUBLIC_AT) - 1), 'PRIORITY');
assert.equal(seasonTwoAdmissionPhase(Date.parse(S2_PUBLIC_AT)), 'PUBLIC');
assert.equal(EFL_SECOND_SEASON.sourceSeasonId, CURRENT_SEASON_ID);
assert.notEqual(EFL_SECOND_SEASON.id, CURRENT_SEASON_ID);
assert.equal(EFL_SECOND_SEASON.leagues[0].id, 'league-premier-league');
assert.deepEqual(EFL_SECOND_SEASON.leagues.map(l => l.id), [
  'league-premier-league',
  'league-la-liga',
  'league-serie-a',
  'league-bundesliga',
  'league-ligue-1',
  'league-uzbekistan-superliga',
  'league-saudi-pro-league',
  'league-j1',
  'league-turkey-super-lig',
]);
assert.equal(new Set(EFL_SECOND_SEASON.leagues.flatMap(l => l.roster.clubs.map(c => c.id))).size, EFL_SECOND_SEASON.leagues.reduce((n,l)=>n+l.roster.clubs.length,0));
assert.equal(EFL_SECOND_SEASON.leagues.filter(l => l.group === 'EUROPE').length, 5);
assert.equal(EFL_SECOND_SEASON.leagues.filter(l => l.group === 'ASIA').length, 4);
for (const name of ['uzbekistan-superliga', 'saudi-pro-league', 'j1-league', 'turkey-super-lig']) {
  const svg = readFileSync(`public/welcome/${name}.svg`, 'utf8');
  assert.match(svg, /^<svg\b/, `Missing bundled league emblem: ${name}`);
  assert.ok(svg.length > 1000, `Incomplete league emblem: ${name}`);
}
console.log('PASS: Europe/Asia tabs and all four locally bundled new league crests');
const priorCrests = new Set(SEED_CLUBS.filter(c => Boolean(c.logoUrl)).map(c => c.id));
const preparedClubIds = EFL_SECOND_SEASON.leagues.flatMap(l => l.roster.clubs.map(c => c.id));
const addedClubIds = preparedClubIds.filter(id => !priorCrests.has(id));
assert.equal(addedClubIds.length, 85, 'All 85 new-season clubs need real crest assets');
assert.equal(Object.keys(SECOND_SEASON_CLUB_LOGOS).length, 85, 'Crest manifest must cover all new clubs');
for (const clubId of addedClubIds) {
  const url = SECOND_SEASON_CLUB_LOGOS[clubId];
  assert.ok(url, `Missing verified crest for ${clubId}`);
  assert.ok(url.startsWith(`https://raw.githubusercontent.com/JoseArroyave/football-logos/${SECOND_SEASON_CREST_SOURCE_COMMIT}/logos/`));
  assert.ok(url.endsWith('.svg'));
}
console.log('PASS: all 85 newly-added season-two clubs have pinned real SVG crests');
console.log('PASS: 20:30–20:45 Uzbekistan boundaries, season independence, roster uniqueness, league order');
