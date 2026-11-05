import assert from 'node:assert/strict';
import { EFL_SECOND_SEASON, getSeasonPreparation } from '../../lib/seasonPreparation';
import { CURRENT_SEASON_ID, isSeasonLeagueEnabled } from '../../lib/seasonParticipationPolicy';
import { seasonsRouter } from '../routes/seasons.routes';
import { getFirestoreDb } from '../firebase/admin';

const db = getFirestoreDb();
const current = { id: CURRENT_SEASON_ID, status: 'active', currentMatchday: 19 };
const owner = { id: 'club-man-city', claimedByUserId: 'season-one-player' };
await db.collection('seasons').doc(current.id).set(current);
await db.collection('clubs').doc(owner.id).set(owner);
await db.collection('fixtures').doc('season-one-result').set({ seasonId: current.id, homeScore: 2, awayScore: 1, status: 'CONFIRMED' });

const route = (seasonsRouter as any).stack.find((layer: any) => layer.route?.path === '/preparation');
assert.ok(route, 'Preparation is reachable before the dynamic season lookup');
const paths = (seasonsRouter as any).stack.map((layer: any) => layer.route?.path);
assert.ok(paths.indexOf('/preparation') < paths.indexOf('/:id'));
function request(query: Record<string, string> = {}) {
  let body: any;
  const headers: Record<string, string> = {};
  route.route.stack[0].handle({ query }, {
    setHeader(key: string, value: string) { headers[key] = value; },
    json(value: any) { body = value; },
  });
  return { body, headers };
}
const { body, headers } = request();
assert.deepEqual(body.preparation, EFL_SECOND_SEASON);
assert.equal(body.preparation.status, 'PREPARATION');
assert.equal(body.preparation.registrationOpen, false);
assert.equal(body.preparation.startDate, null);
assert.equal(headers['Cache-Control'], 'public, max-age=60');
assert.equal(request({ sourceSeasonId: 'season-2027-28' }).body.preparation, null);
assert.equal(getSeasonPreparation('unknown'), null);
assert.equal(new Set(body.preparation.leagues.map((league: any) => league.id)).size, 9);
assert.deepEqual(body.preparation.leagues.filter((league: any) => league.group === 'ASIA').map((league: any) => league.country), ['Uzbekistan', 'Saudi Arabia', 'Japan', 'Turkey']);
assert.equal(body.preparation.leagues.filter((league: any) => league.group === 'EUROPE').length, 5);
assert.equal(body.preparation.leagues.find((league: any) => league.id === 'league-ligue-1').change, 'OPENING');
assert.equal(isSeasonLeagueEnabled('league-ligue-1', CURRENT_SEASON_ID), false, 'Preparation cannot reopen season-one Ligue 1');
assert.equal(isSeasonLeagueEnabled('league-ligue-1', EFL_SECOND_SEASON.id), true);
assert.deepEqual((await db.collection('seasons').doc(current.id).get()).data(), current);
assert.deepEqual((await db.collection('clubs').doc(owner.id).get()).data(), owner);
assert.equal((await db.collection('fixtures').doc('season-one-result').get()).data()?.homeScore, 2);
assert.equal((await db.collection('seasons').doc(EFL_SECOND_SEASON.id).get()).exists, false, 'Viewing preparation must not create or activate a season');
console.log('SEASON_PREPARATION_REGRESSION_PASS');
