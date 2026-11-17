import assert from 'node:assert/strict';
import type {User} from '../../types';
import {ADMIN_LEAGUES,canManageFixture,canUseDangerZone,permittedAdminLeagues,permittedAdminCompetitionIds} from '../../lib/adminPermissions';
const all = ADMIN_LEAGUES.map(row=>row.id);
const delegate={id:'user-test-all-leagues',telegramId:'999000111',isAdmin:true,isSuspended:false,adminPermissions:{scope:'LEAGUES',leagueIds:all}} as User;
assert.equal(all.length,6,'Production currently contains six active domestic leagues');
assert.equal(new Set(all).size,6);
assert.equal(permittedAdminLeagues(delegate).length,6);
for (const league of ADMIN_LEAGUES) {
  assert.equal(canManageFixture(delegate,league.competitionId),true,league.id);
  if (league.competitionId.endsWith('-2026')) assert.equal(canManageFixture(delegate,league.competitionId.replace(/-2026$/,'-2027')),true);
  if (league.cupCompetitionId) assert.equal(canManageFixture(delegate,league.cupCompetitionId),true);
}
assert.equal(permittedAdminCompetitionIds(delegate).includes(''),false);
assert.equal(canManageFixture(delegate,'comp-uzbekistan-superliga-2027'),true);
assert.equal(canManageFixture(delegate,'comp-champions-league-2026'),false,'UEFA is not a domestic league permission');
assert.equal(canManageFixture(delegate,'comp-europa-league-2026'),false);
assert.equal(canUseDangerZone(delegate),false,'Delegate cannot impersonate owner or inspect chats');
assert.equal(canManageFixture({...delegate,isSuspended:true},'comp-la-liga-2027'),false);
console.log('PASS full six-league delegated administration without superadmin, European cup or chat escalation');
