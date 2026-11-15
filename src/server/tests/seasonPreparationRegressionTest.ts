import { previewPreparedLeagueSchedule } from '../services/seasonPreparationService';
import { SEED_COMPETITIONS } from '../db/seed';
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
const acl = body.preparation.internationalCompetitions.find((competition: any) => competition.id === 'comp-asian-champions-league-2027');
assert.ok(acl, 'Asian Champions League is part of the preparation API and rollover metadata');
assert.equal(acl.sourceSeasonId, EFL_SECOND_SEASON.id, 'Qualification comes from season two, not ongoing season one');
assert.equal(acl.group, 'ASIA');
assert.equal(acl.registrationOpen, false);
assert.equal(acl.status, 'PREPARATION');
assert.equal(acl.format.templateCompetitionId, 'comp-champions-league-2026');
assert.deepEqual(acl.format.config, SEED_COMPETITIONS.find(competition => competition.id === acl.format.templateCompetitionId)?.formatConfig, 'ACL must use the same approved 32-club format as EFL European UCL');
assert.equal(acl.qualification.selection, 'TOP_RANKED');
assert.equal(acl.qualification.fromPosition, 1);
assert.equal(acl.qualification.totalTeams, 32);
const asianIds = body.preparation.leagues.filter((league: any) => league.group === 'ASIA').map((league: any) => league.id);
assert.deepEqual(acl.qualification.sourceLeagueIds, asianIds, 'Only the four organizer-selected Asian leagues qualify, including Turkey');
assert.deepEqual(Object.keys(acl.qualification.slotsByLeague), asianIds);
assert.ok(Object.values(acl.qualification.slotsByLeague).every(value => value === 8), 'The organizer approved eight places from each Asian league');
assert.equal(Object.values(acl.qualification.slotsByLeague).reduce((sum: number, value: number) => sum + value, 0), acl.qualification.totalTeams);
assert.equal(isSeasonLeagueEnabled('league-ligue-1', CURRENT_SEASON_ID), false, 'Preparation cannot reopen season-one Ligue 1');
assert.equal(isSeasonLeagueEnabled('league-ligue-1', EFL_SECOND_SEASON.id), true);
assert.deepEqual((await db.collection('seasons').doc(current.id).get()).data(), current);
assert.deepEqual((await db.collection('clubs').doc(owner.id).get()).data(), owner);
assert.equal((await db.collection('fixtures').doc('season-one-result').get()).data()?.homeScore, 2);
assert.equal((await db.collection('seasons').doc(EFL_SECOND_SEASON.id).get()).exists, false, 'Viewing preparation must not create or activate a season');
assert.equal((await db.collection('competitions').doc(acl.id).get()).exists, false, 'Preparing ACL cannot activate a competition');
const expectedSizes: Record<string,number> = {
  'league-premier-league':20, 'league-la-liga':20, 'league-serie-a':20,
  'league-bundesliga':18, 'league-ligue-1':18, 'league-uzbekistan-superliga':16,
  'league-saudi-pro-league':18, 'league-j1':20, 'league-turkey-super-lig':18,
};
const allClubIds = new Set<string>();
let fixtureTotal = 0;
for (const league of EFL_SECOND_SEASON.leagues) {
  const n = expectedSizes[league.id];
  assert.equal(league.roster.clubs.length,n, `${league.name} uses its actual current size`);
  assert.equal(league.roster.realSeason, league.id === 'league-uzbekistan-superliga' ? '2026' : '2026/27');
  assert.equal(league.roster.verifiedAt,'2026-11-05');
  assert.ok(league.roster.sources[0].url.startsWith('https://'));
  const ids = new Set(league.roster.clubs.map(club => club.id));
  assert.equal(ids.size,n);
  for (const id of ids) { assert.ok(!allClubIds.has(id)); allClubIds.add(id); }
  const preview = previewPreparedLeagueSchedule(league.id)!;
  assert.equal(preview.seasonId, EFL_SECOND_SEASON.id);
  assert.equal(preview.persisted,false);
  assert.equal(preview.fixtures.length,n*(n-1)/2);
  assert.equal(preview.totalMatchdays,n-1);
  assert.equal(league.format.totalFixtures,preview.fixtures.length);
  const homePairs = new Set<string>();
  const roundClubs = new Set<string>();
  const homes = new Map<string,number>();
  const aways = new Map<string,number>();
  for (const fixture of preview.fixtures) {
    assert.ok(ids.has(fixture.homeClubId) && ids.has(fixture.awayClubId));
    assert.notEqual(fixture.homeClubId,fixture.awayClubId);
    const pair = [fixture.homeClubId,fixture.awayClubId].sort().join('|');
    assert.ok(!homePairs.has(pair),'Each unordered pair plays exactly once'); homePairs.add(pair);
    for (const id of [fixture.homeClubId,fixture.awayClubId]) {
      const key = `${fixture.matchday}|${id}`;
      assert.ok(!roundClubs.has(key),'A club cannot play twice in one round'); roundClubs.add(key);
    }
    homes.set(fixture.homeClubId,(homes.get(fixture.homeClubId)||0)+1);
    aways.set(fixture.awayClubId,(aways.get(fixture.awayClubId)||0)+1);
  }
  for (const club of ids) { assert.equal((homes.get(club)||0)+(aways.get(club)||0),n-1); }
  fixtureTotal += preview.fixtures.length;
  assert.equal((await db.collection('competitions').doc(league.competitionId).get()).exists,false);
}
assert.equal(allClubIds.size,168);
assert.equal(fixtureTotal,1492);
assert.equal(previewPreparedLeagueSchedule('unknown'),null);
const clubsIn = (leagueId:string) => EFL_SECOND_SEASON.leagues.find(league => league.id === leagueId)!.roster.clubs.map(club => club.id);
for (const id of ['club-elche','club-espanyol','club-levante']) assert.ok(clubsIn('league-la-liga').includes(id));
for (const id of ['club-girona','club-las-palmas','club-mallorca']) assert.ok(!clubsIn('league-la-liga').includes(id));
for (const id of ['club-como','club-sassuolo']) assert.ok(clubsIn('league-serie-a').includes(id));
for (const id of ['club-empoli','club-verona']) assert.ok(!clubsIn('league-serie-a').includes(id));
for (const id of ['club-elversberg','club-koln','club-paderborn','club-schalke','club-hamburger-sv']) assert.ok(clubsIn('league-bundesliga').includes(id));
for (const id of ['club-bochum','club-heidenheim','club-holstein-kiel','club-st-pauli','club-wolfsburg']) assert.ok(!clubsIn('league-bundesliga').includes(id));
for (const id of ['club-angers','club-le-havre','club-lorient']) assert.ok(clubsIn('league-ligue-1').includes(id));
for (const id of ['club-montpellier','club-nantes','club-reims']) assert.ok(!clubsIn('league-ligue-1').includes(id));
const scheduleRoute = (seasonsRouter as any).stack.find((layer:any) => layer.route?.path === '/preparation/:leagueId/fixtures');
let scheduleStatus = 200, scheduleBody:any;
const response = { setHeader() {}, status(code:number) { scheduleStatus=code; return this; }, json(value:any) { scheduleBody=value; } };
scheduleRoute.route.stack[0].handle({params:{leagueId:'league-uzbekistan-superliga'}},response);
assert.equal(scheduleBody.fixtures.length,120);
scheduleRoute.route.stack[0].handle({params:{leagueId:'bad-id'}},response);
assert.equal(scheduleStatus,404);
assert.equal(scheduleBody.error,'PREPARED_LEAGUE_NOT_FOUND');
assert.deepEqual((await db.collection('seasons').doc(current.id).get()).data(),current);
assert.deepEqual((await db.collection('clubs').doc(owner.id).get()).data(),owner);
assert.equal((await db.collection('fixtures').doc('season-one-result').get()).data()?.homeScore,2);
console.log('SEASON_PREPARATION_REGRESSION_PASS: nine verified rosters, 168 clubs, 1492 single-round draft fixtures, current season preserved');
