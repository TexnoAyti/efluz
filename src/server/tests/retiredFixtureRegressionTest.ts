import assert from 'node:assert/strict';
import { initDatabase, queryRun } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { getCompetitionFixturesFromReadModel, getAdminFixturesFromReadModel, ReadModelKeys, redisSetRaw } from '../readModel/readModelStore';
import { filterRetiredFixtures, RETIRED_FIXTURES } from '../services/retiredFixtureService';
import { filterTombstonedFixtures } from '../services/fixtureTombstoneService';
import { getFixtureByIdFirestore, submitFixtureResultFirestore, adminEditFixtureResultFirestore, adminApproveFixtureResultFirestore, reopenFixtureFirestore, adminDeleteFixtureResultFirestore, executeAdminFixturesPagedFallback, getFixturesFirestore } from '../firebase/firestoreStore';
import { getCompetitionMatchdayControl, controlCompetitionMatchday } from '../services/competitionMatchdayService';
import { loadSeasonOperationsFixtures } from '../services/seasonOperationsService';
import { withVisibleFixtureCounts } from '../services/competitionFixtureCounts';
import { parseFirestoreError } from '../firebase/firestoreErrorHandler';

await initDatabase();
const db = getFirestoreDb(), correction = RETIRED_FIXTURES[0];
const { seasonId, competitionId } = correction;
const played: any = { id: correction.retainedFixtureId, competitionId, seasonId, matchday: 1, homeClubId: 'club-inter', awayClubId: 'club-milan', status: 'CONFIRMED', homeScore: 2, awayScore: 1, resultConfirmedAt: '2026-09-25T14:02:57.717Z', proofUrl: 'https://example.com/played.png' };
const duplicate: any = { ...played, id: correction.id, matchday: 10, status: 'SCHEDULED', homeScore: null, awayScore: null };
const other: any = { ...duplicate, id: 'retirement-other-match', homeClubId: 'club-roma', awayClubId: 'club-lazio', status: 'CONFIRMED' };
const next: any = { ...other, id: 'retirement-next-match', matchday: 11, status: 'SCHEDULED' };
const fixtures = [played, duplicate, other, next];
const correctedPlayed = { ...played, matchday: 10, roundName: 'Matchday 10', scheduledAt: correction.scheduledAt, competitionName: 'Serie A' };
assert.deepEqual(filterRetiredFixtures(fixtures), [correctedPlayed, other, next]);
assert.deepEqual(filterRetiredFixtures([{ ...duplicate, seasonId: 'another-season' }]), [{ ...duplicate, seasonId: 'another-season' }]);
assert.deepEqual(filterRetiredFixtures([{ ...duplicate, id: 'cup-rematch' }]), [{ ...duplicate, id: 'cup-rematch' }]);
assert.deepEqual(await filterTombstonedFixtures(fixtures, seasonId), [correctedPlayed, other, next]);
await redisSetRaw(ReadModelKeys.adminFixtures(seasonId), { data: fixtures }, 3600);
await redisSetRaw(ReadModelKeys.competitionFixtures(competitionId, seasonId), { data: fixtures, actualCount: fixtures.length }, 3600);
await redisSetRaw(ReadModelKeys.clubsWithOwners(seasonId), { data: [{ id: 'club-inter', leagueId: 'league-serie-a', name: 'Inter' }, { id: 'club-milan', leagueId: 'league-serie-a', name: 'Milan' }] }, 3600);
const compRef = db.collection('competitions').doc(competitionId);
await compRef.set({ id: competitionId, seasonId, type: 'LEAGUE', leagueId: 'league-serie-a', currentMatchday: 10, totalMatchdays: 19 });
for (const f of fixtures) await db.collection('fixtures').doc(f.id).set(f);
const proof = { fixtureId: played.id, userId: 'retirement-player', homeScore: 2, awayScore: 1, proofUrl: played.proofUrl };
await db.collection('result_submissions').doc('retirement-proof').set(proof);

const publicRead = await getCompetitionFixturesFromReadModel(competitionId, { seasonId });
assert.deepEqual(publicRead.fixtures.map(f => f.id).sort(), [played.id, other.id, next.id].sort());
const md10 = await getCompetitionFixturesFromReadModel(competitionId, { seasonId, matchday: 10 });
assert.deepEqual(md10.fixtures.map(f => f.id).sort(), [played.id, other.id].sort());
assert.equal(md10.fixtures.find(f => f.id === played.id)?.roundName, 'Matchday 10');
const md1 = await getCompetitionFixturesFromReadModel(competitionId, { seasonId, matchday: 1 });
assert.ok(!md1.fixtures.some(f => f.id === played.id));
const detail = await getFixtureByIdFirestore(played.id);
assert.equal(detail?.matchday, 10);
assert.equal(detail?.roundName, 'Matchday 10');
const admin = await getAdminFixturesFromReadModel({ seasonId, competitionId, limit: 25 });
assert.equal(admin.total, 3);
assert.ok(!admin.fixtures.some(f => f.id === duplicate.id));
assert.equal((await loadSeasonOperationsFixtures(seasonId)).fixtures.length, 3);
const counts = await withVisibleFixtureCounts([{ id: competitionId, type: 'LEAGUE' } as any], seasonId);
assert.equal(counts[0].fixtureCount, 3);
assert.equal(await getFixtureByIdFirestore(duplicate.id), null);
const clubFixtures = await getFixturesFirestore({ seasonId, competitionId, clubId: 'club-inter' });
assert.ok(clubFixtures.some(f => f.id === played.id && f.matchday === 10 && f.homeScore === 2 && f.awayScore === 1));
assert.ok(!clubFixtures.some(f => f.id === duplicate.id));

for (const mutate of [
  () => submitFixtureResultFirestore('retirement-player', duplicate.id, 0, 0),
  () => adminEditFixtureResultFirestore('retirement-admin', 'admin', duplicate.id, { homeScore: 0, awayScore: 0 }),
  () => adminApproveFixtureResultFirestore('retirement-admin', duplicate.id, 0, 0),
  () => reopenFixtureFirestore('retirement-admin', duplicate.id),
  () => adminDeleteFixtureResultFirestore('retirement-admin', 'admin', duplicate.id),
]) await assert.rejects(mutate, (err: any) => err.code === 'FIXTURE_RETIRED' && parseFirestoreError(err).httpStatus === 409);

const overview = await getCompetitionMatchdayControl(competitionId);
assert.equal(overview.rounds[9].fixtureCount, 2);
assert.equal(overview.rounds[0].fixtureCount, 0);
assert.deepEqual(overview.rounds[9].unfinished, []);
await controlCompetitionMatchday(competitionId, { action: 'SELECT', matchday: 11, adminUserId: 'retirement-admin' });
assert.equal((await compRef.get()).data()?.currentMatchday, 11);
assert.deepEqual((await db.collection('fixtures').doc(played.id).get()).data(), played);
assert.deepEqual((await db.collection('result_submissions').doc('retirement-proof').get()).data(), proof);
assert.deepEqual((await db.collection('fixtures').doc(duplicate.id).get()).data(), duplicate, 'archival copy retained, no destructive writes');

// SQLite pagination and total exclude the archived copy before limiting rows.
for (const f of [played, duplicate]) queryRun(`INSERT OR REPLACE INTO fixtures (id, competition_id, season_id, matchday, home_club_id, away_club_id, scheduled_at, status, home_score, away_score, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [f.id, competitionId, seasonId, f.matchday, f.homeClubId, f.awayClubId, '2026-09-25', f.status, f.homeScore, f.awayScore, '2026-09-25', '2026-09-25']);
const local = executeAdminFixturesPagedFallback({ seasonId, competitionId }, 1);
assert.ok(!local.fixtures.some(f => f.id === duplicate.id));
const local10 = executeAdminFixturesPagedFallback({ seasonId, competitionId, matchday: 10 }, 100);
assert.ok(local10.fixtures.some(f => f.id === played.id && f.matchday === 10 && f.roundName === 'Matchday 10'));
const local1 = executeAdminFixturesPagedFallback({ seasonId, competitionId, matchday: 1 }, 100);
assert.ok(!local1.fixtures.some(f => f.id === played.id));
const club10 = await getFixturesFirestore({ seasonId, competitionId, clubId: 'club-inter', matchday: 10 });
assert.ok(club10.some(f => f.id === played.id && f.matchday === 10));
const club1 = await getFixturesFirestore({ seasonId, competitionId, clubId: 'club-inter', matchday: 1 });
assert.ok(!club1.some(f => f.id === played.id));
console.log('PASS original result/proof/ID untouched; retained match canonicalized to Matchday 10, excluded from round 1; round 10 duplicate suppressed across Redis, SQLite, club/admin lists, counts and progression; result writes denied; no production writes.');
