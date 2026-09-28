import assert from 'node:assert/strict';
import express from 'express';
import { startMockUpstashBridge } from './mockUpstashBridge';
import { SEED_CLUBS } from '../db/seed';
import { getLkgKey, ReadModelKeys } from '../readModel/readModelStore';
import { queueOfflineClubClaim, getPendingClubClaim } from '../services/offlineClubClaim';
import { getDurableMutation, OUTBOX_KEYS } from '../outbox/redisOutbox';
import { getFirestoreDb } from '../firebase/admin';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { COLLECTIONS } from '../firebase/collections';
import { processPendingMutations } from '../sync/mutationQueue';
import { clubsRouter } from '../routes/clubs.routes';

const redis = await startMockUpstashBridge();
const seasonId = 'season-2026-27';
const clubId = 'club-arsenal';
const userId = 'user-offline-one';
try {
  const snapshotKey = getLkgKey(ReadModelKeys.clubsWithOwners(seasonId));
  const snapshot = { actualCount: SEED_CLUBS.length, data: SEED_CLUBS.map(c => ({
    id: c.id, ownerUserId: null, claimedByUserId: null, isOccupied: false, isTaken: false,
  })) };
  assert.equal(SEED_CLUBS.length, 96);
  redis.store.set(snapshotKey, JSON.stringify(snapshot));

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: String(req.headers['x-test-user'] || userId), telegramId: undefined } as any;
    next();
  });
  app.use('/api/clubs', clubsRouter);
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api/clubs`;
    firestoreCircuitBreaker.forceState('OPEN');
    const claim = await fetch(`${base}/${clubId}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seasonId }) });
    const claimBody = await claim.json();
    assert.equal(claim.status, 202, JSON.stringify(claimBody));
    assert.equal(claimBody.pending, true);
    const status = await fetch(`${base}/claim-status?seasonId=${seasonId}`);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).pendingClaim.clubId, clubId);
    const competitor = await fetch(`${base}/${clubId}/claim`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user': 'user-offline-two' }, body: JSON.stringify({ seasonId }) });
    assert.equal(competitor.status, 409);
  } finally {
    server.close();
  }

  const first = await queueOfflineClubClaim(userId, clubId, seasonId);
  assert.equal(first.accepted, true);
  assert.equal((await queueOfflineClubClaim(userId, clubId, seasonId)).accepted, true, 'retry is idempotent');
  assert.equal((await queueOfflineClubClaim('user-offline-two', clubId, seasonId)).code, 'CLUB_OCCUPIED');
  assert.equal((await queueOfflineClubClaim(userId, 'club-chelsea', seasonId)).code, 'CLUB_SELECTION_LOCKED');
  assert.equal((await getPendingClubClaim(userId, seasonId))?.status, 'PENDING');
  assert.equal(redis.zsets.get(OUTBOX_KEYS.pending())?.size, 1, 'only one mutation is queued');

  // An occupied authoritative snapshot cannot be submitted as a pending claim.
  snapshot.data.find(c => c.id === 'club-chelsea')!.ownerUserId = 'user-existing';
  redis.store.set(snapshotKey, JSON.stringify(snapshot));
  assert.equal((await queueOfflineClubClaim('user-third', 'club-chelsea', seasonId)).code, 'CLUB_OCCUPIED');
  assert.equal((await queueOfflineClubClaim('user-existing', 'club-liverpool', seasonId)).code, 'CLUB_SELECTION_LOCKED');

  const db = getFirestoreDb();
  const seed = SEED_CLUBS.find(c => c.id === clubId)!;
  await db.collection(COLLECTIONS.CLUBS).doc(clubId).set({
    id: clubId, name: seed.name, shortName: seed.shortName, leagueId: seed.leagueId,
    country: seed.country, logo: seed.logoUrl, isActive: true, createdAt: new Date().toISOString(),
  });
  firestoreCircuitBreaker.forceState('CLOSED');
  const replay = await processPendingMutations();
  assert.equal(replay.synced, 1, JSON.stringify(replay.errors));
  assert.equal((await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`).get()).data()?.userId, userId);
  assert.equal((await getPendingClubClaim(userId, seasonId)), null, 'reservation released after confirmed write');
  assert.equal((await getDurableMutation(`claim_${seasonId}_${clubId}_${userId}`))?.status, 'SYNCED');
  console.log('PASS durable pending claim, duplicate exclusion, authoritative replay');
} finally {
  firestoreCircuitBreaker.reset();
  await redis.close();
}
