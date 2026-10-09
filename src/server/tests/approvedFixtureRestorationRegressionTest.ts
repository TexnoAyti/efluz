import assert from 'node:assert/strict';
import { assertTestEnvironmentSafe } from '../utils/testGuard';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { RETIRED_FIXTURES } from '../services/retiredFixtureService';
import { restoreApprovedInterMilanFixture, RESTORATION_ID } from '../services/approvedFixtureRestoration';
import { addFixtureTombstone, getFixtureTombstones } from '../services/fixtureTombstoneService';
import { ReadModelKeys, redisSetRaw, redisGetFresh, resetMemoryRedisStore, getCompetitionFixturesFromReadModel, getUpstashClient, getFreshKey, getLkgKey, getDirtyKey } from '../readModel/readModelStore';

assertTestEnvironmentSafe('approvedFixtureRestorationRegressionTest');
await initDatabase();
const db = getFirestoreDb(), correction = RETIRED_FIXTURES[0], id = correction.retainedFixtureId;
const target = db.collection('fixtures').doc(id), marker = db.collection('maintenance_operations').doc(RESTORATION_ID);
const audit = db.collection('audit_logs').doc(`audit_ADMIN_DELETE_FIXTURE_fixture_${id}`);
const other: any = { id: 'test-restore-unrelated', seasonId: correction.seasonId, competitionId: correction.competitionId, matchday: 10, homeClubId: 'club-roma', awayClubId: 'club-lazio', status: 'CONFIRMED', homeScore: 4, awayScore: 0 };
const seedSnapshots = async () => {
  await redisSetRaw(ReadModelKeys.competitionFixtures(correction.competitionId, correction.seasonId), { data: [other] });
  await redisSetRaw(ReadModelKeys.adminFixtures(correction.seasonId), { data: [other] });
};
const resetScenarioCache = async () => {
  resetMemoryRedisStore();
  const client = getUpstashClient();
  if (client) for (const key of [ReadModelKeys.competitionFixtures(correction.competitionId, correction.seasonId), ReadModelKeys.adminFixtures(correction.seasonId), `approved-restoration:${RESTORATION_ID}`]) {
    await client.del(getFreshKey(key), getLkgKey(key), getDirtyKey(key));
  }
};
await seedSnapshots();
await db.collection('fixtures').doc(other.id).set(other);
await addFixtureTombstone({ fixtureId: id, seasonId: correction.seasonId, competitionId: correction.competitionId, deletedAt: '2026-10-04T08:25:00Z', deletedBy: 'test-admin' });
// Missing or mismatched original must not fabricate a live fixture.
await assert.rejects(restoreApprovedInterMilanFixture, /RESTORATION_ORIGINAL_NOT_VERIFIED/);
assert.equal((await target.get()).exists, false);
const original: any = { id, competitionId: correction.competitionId, seasonId: correction.seasonId, matchday: 1, homeClubId: 'club-inter', awayClubId: 'club-milan', status: 'CONFIRMED', homeScore: 2, awayScore: 1, winnerClubId: 'club-inter', resultConfirmedAt: '2026-09-25', proofUrl: 'https://example.com/old-proof.png', createdAt: '2026-09-25' };
await audit.set({ action: 'ADMIN_DELETE_FIXTURE', entityId: id, actorUserId: 'test-admin', oldValueJson: JSON.stringify(original) });
await restoreApprovedInterMilanFixture();
const restored = (await target.get()).data()!;
assert.equal(restored.matchday, 10);
assert.equal(restored.roundName, 'Matchday 10');
assert.equal(restored.status, 'SCHEDULED');
assert.equal(restored.homeScore, null); assert.equal(restored.awayScore, null);
assert.equal(restored.resultConfirmedAt, null); assert.equal(restored.winnerClubId, null);
assert.equal(restored.proofUrl, undefined);
assert.ok(!(await getFixtureTombstones(correction.seasonId)).some(t => t.fixtureId === id));
assert.deepEqual((await db.collection('fixtures').doc(other.id).get()).data(), other);
assert.equal((await audit.get()).data()?.oldValueJson, JSON.stringify(original));
for (const key of [ReadModelKeys.competitionFixtures(correction.competitionId, correction.seasonId), ReadModelKeys.adminFixtures(correction.seasonId)]) {
  const rows = (await redisGetFresh<any[]>(key))!.data;
  assert.equal(rows.filter(f => f.id === id).length, 1);
  assert.equal(rows.find(f => f.id === id)?.homeScore ?? null, null);
  assert.ok(rows.some(f => f.id === other.id && f.homeScore === 4));
}
await restoreApprovedInterMilanFixture();
assert.deepEqual((await target.get()).data(), restored);
// A later deliberate deletion stays deleted, even after process/Redis cache loss.
await target.delete(); await resetScenarioCache(); await seedSnapshots();
await restoreApprovedInterMilanFixture();
assert.equal((await target.get()).exists, false);
assert.equal((await marker.get()).data()?.phase, 'COMPLETED');
// Publication failure after durable creation resumes without overwriting new activity.
await marker.delete(); await resetScenarioCache();
await assert.rejects(restoreApprovedInterMilanFixture, /RESTORATION_SNAPSHOT_MISSING/);
assert.equal((await target.get()).data()?.status, 'SCHEDULED');
assert.equal((await marker.get()).data()?.phase, 'RESTORED');
await target.update({ status: 'PENDING_CONFIRMATION', homeScore: 1, awayScore: 1, updatedAt: new Date(Date.now() + 1000).toISOString() });
await seedSnapshots();
await restoreApprovedInterMilanFixture();
assert.equal((await target.get()).data()?.status, 'PENDING_CONFIRMATION');
assert.equal((await redisGetFresh<any[]>(ReadModelKeys.competitionFixtures(correction.competitionId, correction.seasonId)))?.data.find(f => f.id === id)?.homeScore, 1);
const publicResult = await getCompetitionFixturesFromReadModel(correction.competitionId, { seasonId: correction.seasonId, matchday: 10 });
assert.ok(publicResult.fixtures.some(f => f.id === id && f.matchday === 10));
console.log('PASS verified deletion audit restoration: Matchday 10 SCHEDULED with no score/proof, durable caches, no duplicate, unchanged other matches, retry after publication failure preserves new activity, completion prevents later resurrection. Isolated data only.');
