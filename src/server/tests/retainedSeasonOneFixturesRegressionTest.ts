import assert from 'node:assert/strict';
import type {Fixture,User} from '../../types';
import {mergeRetainedSeasonOneFixtures} from '../../lib/retainedSeasonOneFixtures';
import {canManageFixture,canUseDangerZone} from '../../lib/adminPermissions';

const fixture=(id:string,seasonId:string,competitionId:string,club:string):Fixture=>({
  id,seasonId,competitionId,homeClubId:club,awayClubId:'club-rival',status:'SCHEDULED',matchday:1
} as Fixture);
const current=fixture('current','season-2027-28','comp-premier-league-2027','club-current');
const ucl=fixture('ucl','season-2026-27','comp-champions-league-2026','club-sunderland');
const uel=fixture('uel','season-2026-27','comp-europa-league-2026','club-sunderland');
const superCup=fixture('super','season-2026-27','comp-super-cup-2026','club-sunderland');
const oldLeague=fixture('old','season-2026-27','comp-premier-league-2026','club-sunderland');
const stranger=fixture('stranger','season-2026-27','comp-champions-league-2026','club-other');
assert.deepEqual(mergeRetainedSeasonOneFixtures([current],[ucl,uel,superCup,oldLeague,stranger,ucl],['club-sunderland']).map(f=>f.id),['current','ucl','uel','super']);
assert.deepEqual(mergeRetainedSeasonOneFixtures([current],[ucl],[]).map(f=>f.id),['current']);
assert.deepEqual(mergeRetainedSeasonOneFixtures([],[ucl],['club-sunderland']).map(f=>f.id),['ucl']);
const delegated={id:'user-8574301555',telegramId:'8574301555',isAdmin:true,isSuspended:false,adminPermissions:{
  scope:'LEAGUES' as const,leagueIds:['league-premier-league','league-la-liga','league-serie-a','league-bundesliga']
}} as User;
assert.equal(canManageFixture(delegated,'comp-premier-league-2026'),true);
assert.equal(canManageFixture(delegated,'comp-premier-league-2027'),true);
assert.equal(canManageFixture(delegated,'comp-bundesliga-2027'),true);
assert.equal(canManageFixture(delegated,'comp-ligue-1-2027'),false);
assert.equal(canManageFixture(delegated,'comp-uzbekistan-superliga-2027'),false);
assert.equal(canManageFixture(delegated,'comp-champions-league-2026'),false);
assert.equal(canUseDangerZone(delegated),false);
assert.equal(canManageFixture({...delegated,isSuspended:true},'comp-premier-league-2027'),false);
console.log('PASS retained Season 1 UEFA fixtures and four-league external admin boundary');
