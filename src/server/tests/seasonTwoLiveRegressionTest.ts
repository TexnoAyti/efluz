import assert from 'node:assert/strict';
import { EFL_SECOND_SEASON } from '../../lib/seasonPreparation';
import { normalizeFixtureSnapshot } from '../readModel/readModelStore';
import { getFirestoreDb } from '../firebase/admin';
import { getCompetitionMatchdayControl } from '../services/competitionMatchdayService';
import { previewPreparedLeagueSchedule } from '../services/seasonPreparationService';
import { SEED_CLUBS } from '../db/seed';
assert.equal(process.env.FIREBASE_FORCE_LOCAL_FALLBACK, 'true');
const db = getFirestoreDb();
for (const league of EFL_SECOND_SEASON.leagues.filter(l => l.group === 'EUROPE')) {
  const plan = previewPreparedLeagueSchedule(league.id)!;
  assert.equal(plan.fixtures.length, league.roster.clubs.length * (league.roster.clubs.length - 1) / 2);
  assert.equal(plan.fixtures.length, league.format.totalFixtures);
  const unordered = new Set(plan.fixtures.map(f => [f.homeClubId, f.awayClubId].sort().join('|')));
  assert.equal(unordered.size, plan.fixtures.length, 'No return legs: each unordered pair plays once');
  assert.equal(new Set(plan.fixtures.map(f => f.homeClubId + ':' + f.awayClubId)).size, plan.fixtures.length);
  for (let round = 1; round <= league.format.totalMatchdays; round++) {
    const clubs = plan.fixtures.filter(f => f.matchday === round).flatMap(f => [f.homeClubId, f.awayClubId]);
    assert.equal(clubs.length, league.roster.clubs.length);
    assert.equal(new Set(clubs).size, clubs.length);
  }
  await db.collection('competitions').doc(league.competitionId).set({
    id: league.competitionId, seasonId: EFL_SECOND_SEASON.id, leagueId: league.id, type: 'LEAGUE',
    totalMatchdays: league.format.totalMatchdays, formatConfig: {totalClubs: league.roster.clubs.length, homeAndAway: false},
    currentMatchday: 1, isMatchdayOpen: true, status: 'active',
  });
  const control = await getCompetitionMatchdayControl(league.competitionId);
  assert.equal(control.rounds.length, league.format.totalMatchdays);
  const fresh = league.roster.clubs.find(c => !SEED_CLUBS.some(old => old.id === c.id));
  if (fresh) {
    const row = normalizeFixtureSnapshot({id: 'new-club', seasonId: EFL_SECOND_SEASON.id, homeClubId: fresh.id, awayClubId: league.roster.clubs[0].id, competitionId: league.competitionId});
    assert.equal(row.homeClub?.name, fresh.name);
    assert.equal(row.homeClub?.leagueId, league.id);
    assert.ok(row.homeClub?.logoUrl);
  }
}
console.log('PASS: five European single-round-robin schedules, no return legs, full 17/19-round admin controls and new club identities');
