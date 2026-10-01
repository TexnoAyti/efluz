import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { fixturesRouter } from '../routes/fixtures.routes';

async function main() {
  await initDatabase();
  const db = getFirestoreDb();
  const seasonId = 'season-2026-27';
  const competitionId = 'comp-result-http';
  const fixtureId = 'fix-result-http';
  await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).set({
    id: competitionId, seasonId, name: 'HTTP test', type: 'LEAGUE', status: 'active',
    currentMatchday: 1, isMatchdayOpen: true, adminOverrideStatus: 'AUTO',
  });
  for (const [userId, clubId] of [['home-test', 'club-arsenal'], ['away-test', 'club-chelsea'], ['outsider-test', 'club-liverpool']]) {
    await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userId}`).set({userId, clubId, seasonId, status: 'active'});
  }
  const fixtureRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  await fixtureRef.set({id: fixtureId, seasonId, competitionId, matchday: 1, homeClubId: 'club-arsenal', awayClubId: 'club-chelsea', status: 'SCHEDULED', scheduledAt: new Date().toISOString()});
  const app = express();
  app.use(express.json());
  // Authentication is covered independently; use fixed isolated test identities here.
  app.use((req, _res, next) => { req.user = {id: String(req.headers['x-test-user']), isAdmin: false, isSuspended: false} as any; next(); });
  app.use('/api/fixtures', fixturesRouter);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const submit = (user: string, homeScore: number, awayScore: number, proofUrl?: string) => fetch(`${base}/api/fixtures/${fixtureId}/result`, {method: 'POST', headers: {'content-type': 'application/json', 'x-test-user': user}, body: JSON.stringify({homeScore, awayScore, proofUrl, userId: 'home-test'})});
  try {
    const denied = await submit('outsider-test', 9, 0);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json() as any).code, 'RESULT_NOT_PARTICIPANT');
    assert.equal((await fixtureRef.get()).data()?.status, 'SCHEDULED');
    const proof = 'https://example.com/result-proof.png';
    const first = await submit('home-test', 3, 1, proof);
    assert.equal(first.status, 200);
    assert.equal((await first.json() as any).fixture.status, 'PENDING_CONFIRMATION');
    const submissions = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', '==', fixtureId).get();
    assert.equal(submissions.docs[0].data().proofUrl, proof);
    const second = await submit('away-test', 3, 1);
    assert.equal(second.status, 200);
    assert.equal((await second.json() as any).fixture.status, 'CONFIRMED');
    const retry = await submit('home-test', 5, 0);
    assert.equal(retry.status, 409);
    assert.equal((await retry.json() as any).code, 'RESULT_ALREADY_CONFIRMED');
    assert.equal((await fixtureRef.get()).data()?.homeScore, 3);
    console.log('PASS result HTTP lifecycle: outsider 403 without mutation, proof retained, opponent consensus confirms, finalized result 409 without overwrite.');
  } finally { server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
