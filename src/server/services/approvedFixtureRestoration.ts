import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { upsertFixtureToSqlite } from '../db';
import { Fixture } from '../../types';
import { RETIRED_FIXTURES } from './retiredFixtureService';
import { restoreFixtureTombstone } from './fixtureTombstoneService';
import { ReadModelKeys, redisGetFresh, redisGetLkg, redisSetRaw, getUpstashClient, getFreshKey, getLkgKey, getDirtyKey, clearProcessMemoryCache, normalizeFixtureSnapshot } from '../readModel/readModelStore';

// One specific recovery explicitly requested by the project owner on 2026-10-04.
// Not a recurring missing-fixture repair: a durable completion record prevents
// a later intentional deletion from resurrecting this match. Never reset an
// existing result, copy deleted submissions, or alter another fixture.
export const RESTORATION_ID = 'restore-inter-milan-without-result-20261004';
const correction = RETIRED_FIXTURES[0];
const fixtureId = correction.retainedFixtureId;
const checkpointKey = `approved-restoration:${RESTORATION_ID}`;

async function publishFixture(key: string, fixture: Fixture): Promise<void> {
  const client = getUpstashClient();
  if (client) {
    const accepted = await client.eval(`
      local raw = redis.call('GET', KEYS[2]) or redis.call('GET', KEYS[1])
      if not raw then return 0 end
      local snapshot = cjson.decode(raw)
      local changed = cjson.decode(ARGV[1])
      local found = false
      for i, row in ipairs(snapshot.data or {}) do
        if row.id == changed.id then
          if row.updatedAt and changed.updatedAt and row.updatedAt > changed.updatedAt then return 1 end
          snapshot.data[i] = changed
          found = true
          break
        end
      end
      if not found then table.insert(snapshot.data, changed) end
      snapshot.generatedAt = ARGV[2]
      snapshot.sourceVersion = ARGV[3]
      snapshot.actualCount = #(snapshot.data)
      snapshot.expectedCount = #(snapshot.data)
      local value = cjson.encode(snapshot)
      redis.call('SET', KEYS[2], value)
      redis.call('SET', KEYS[1], value, 'EX', 86400)
      redis.call('DEL', KEYS[3])
      return 1
    `, [getFreshKey(key), getLkgKey(key), getDirtyKey(key)], [JSON.stringify(fixture), new Date().toISOString(), RESTORATION_ID]);
    if (Number(accepted) !== 1) throw new Error(`RESTORATION_SNAPSHOT_MISSING: ${key}`);
    clearProcessMemoryCache();
  } else {
    const snapshot = await redisGetFresh<Fixture[]>(key) || await redisGetLkg<Fixture[]>(key);
    if (!Array.isArray(snapshot?.data)) throw new Error(`RESTORATION_SNAPSHOT_MISSING: ${key}`);
    const newer = snapshot.data.find(f => f.id === fixture.id && String(f.updatedAt) > String(fixture.updatedAt));
    if (newer) return;
    const data = snapshot.data.filter(f => f.id !== fixture.id).concat(fixture);
    await redisSetRaw(key, { data, sourceVersion: RESTORATION_ID }, 86400);
  }
}

export async function restoreApprovedInterMilanFixture(): Promise<void> {
  const complete = await redisGetFresh<{ completed: boolean }>(checkpointKey) || await redisGetLkg<{ completed: boolean }>(checkpointKey);
  if (complete?.data.completed) return;
  const db = getFirestoreDb();
  const markerRef = db.collection('maintenance_operations').doc(RESTORATION_ID);
  const ref = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  const deletionRef = db.collection(COLLECTIONS.AUDIT_LOGS).doc(`audit_ADMIN_DELETE_FIXTURE_fixture_${fixtureId}`);
  const now = new Date().toISOString();
  const restored = await db.runTransaction(async tx => {
    const marker = await tx.get(markerRef);
    if (marker.exists && marker.data()?.phase === 'COMPLETED') return null;
    const current = await tx.get(ref);
    if (marker.exists) {
      // Resume cache publication after a previous transaction succeeded.
      if (current.exists) return { data: current.data()!, actor: String(marker.data()?.actor || 'system-approved-restoration') };
      tx.set(markerRef, { phase: 'COMPLETED', outcome: 'deleted-after-restoration', completedAt: now }, { merge: true });
      return null;
    }
    if (current.exists) {
      tx.set(markerRef, { phase: 'COMPLETED', outcome: 'already-present-not-overwritten', completedAt: now });
      return null;
    }
    const deletion = await tx.get(deletionRef);
    const audit = deletion.exists ? deletion.data()! : null;
    const original = audit?.oldValueJson ? JSON.parse(audit.oldValueJson) : null;
    if (audit?.action !== 'ADMIN_DELETE_FIXTURE' || audit.entityId !== fixtureId || original?.id !== fixtureId || original.seasonId !== correction.seasonId || original.competitionId !== correction.competitionId || original.homeClubId !== 'club-inter' || original.awayClubId !== 'club-milan') {
      throw new Error('RESTORATION_ORIGINAL_NOT_VERIFIED');
    }
    const data = {
      id: fixtureId, competitionId: correction.competitionId, competitionName: 'Serie A', seasonId: correction.seasonId,
      matchday: correction.matchday, roundName: correction.roundName, scheduledAt: correction.scheduledAt,
      homeClubId: original.homeClubId, awayClubId: original.awayClubId,
      status: 'SCHEDULED', homeScore: null, awayScore: null, winnerClubId: null, resultConfirmedAt: null,
      createdAt: original.createdAt || now, updatedAt: now,
      restoredAt: now, restorationOperationId: RESTORATION_ID,
    };
    const actor = String(audit.actorUserId || 'system-approved-restoration');
    tx.set(ref, data);
    tx.set(markerRef, { phase: 'RESTORED', fixtureId, actor, restoredAt: now });
    tx.set(db.collection(COLLECTIONS.AUDIT_LOGS).doc(`audit_${RESTORATION_ID}`), {
      action: 'OWNER_REQUESTED_FIXTURE_RESTORE_WITHOUT_RESULT', entityType: 'fixture', entityId: fixtureId,
      actorUserId: actor, authorization: 'Project owner recovery request 2026-10-04',
      oldValueJson: audit.oldValueJson, newValueJson: JSON.stringify(data), createdAt: now,
    });
    return { data, actor };
  });
  if (restored) {
    const fixture = normalizeFixtureSnapshot(restored.data, correction.seasonId);
    await restoreFixtureTombstone(fixtureId, correction.seasonId, restored.actor);
    upsertFixtureToSqlite(fixture);
    await publishFixture(ReadModelKeys.competitionFixtures(correction.competitionId, correction.seasonId), fixture);
    await publishFixture(ReadModelKeys.adminFixtures(correction.seasonId), fixture);
    const { invalidateFirestoreCache } = await import('../firebase/firestoreStore');
    invalidateFirestoreCache('firestore:fixtures');
    invalidateFirestoreCache('firestore:club_raw_fixtures');
    invalidateFirestoreCache(`firestore:fixture:${fixtureId}:`);
    await markerRef.set({ phase: 'COMPLETED', completedAt: new Date().toISOString() }, { merge: true });
  }
  await redisSetRaw(checkpointKey, { data: { completed: true }, sourceVersion: RESTORATION_ID }, 31536000);
}

let inFlight: Promise<void> | null = null;
let retryAfter = 0;
export async function runApprovedFixtureRestoration(competitionId: string, seasonId: string): Promise<void> {
  if (process.env.VERCEL_ENV !== 'production' || competitionId !== correction.competitionId || seasonId !== correction.seasonId || Date.now() < retryAfter) return;
  if (!inFlight) inFlight = restoreApprovedInterMilanFixture().catch(error => {
    retryAfter = Date.now() + 30000;
    console.error('[APPROVED_FIXTURE_RESTORATION_FAILED]', error.message);
  }).finally(() => { inFlight = null; });
  await inFlight;
}
