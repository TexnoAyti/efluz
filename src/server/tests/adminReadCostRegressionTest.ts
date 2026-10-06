import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { ReadModelKeys, redisSetRaw, redisDelRaw, getFreshKey, resetUpstashClient } from '../readModel/readModelStore';
import { getScopedAdminReviews } from '../services/scopedAdminReviews';
import { getLeagueAdminOverview } from '../services/leagueAdminScope';
import { getBoundedRedisClient } from '../readModel/boundedRedis';
import { getDurableReadCosts, readCostMiddleware, READ_COST_INCREMENT_LUA } from '../services/durableReadCosts';
import { trackFirestoreRead, trackFirestoreAggregation } from '../firebase/firestoreStore';
import { readSharedAdminReview } from '../services/adminReviewCache';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';

await assert.rejects(getDurableReadCosts('invalid', 'bad'), /INVALID_READ_COST_WINDOW/);
await assert.rejects(getDurableReadCosts('2020-01-01T00:00:00Z', '2020-01-01T01:00:00Z'), /INVALID_READ_COST_WINDOW/);
console.log('PASS read-cost window validation');

// Full integration is imported by the real-Redis suite, never a Lua emulation.
if (process.env.REDIS_TEST_PORT) {
  await initDatabase();
  const db = getFirestoreDb(), originalCollection = db.collection.bind(db);
  const season = 'season-2026-27', league = 'comp-premier-league-2026', cup = 'comp-fa-cup-2026';
  const user = { id: 'scoped-read-admin', isAdmin: true, adminPermissions: { scope: 'LEAGUES', leagueIds: ['league-premier-league'] } } as any;
  const games = Array.from({ length: 380 }, (_, i) => ({ id: 'read-game-' + i, competitionId: league, seasonId: season, homeClubId: 'club-arsenal', awayClubId: 'club-chelsea', matchday: 1 + i % 38, status: i < 2 ? 'PENDING_CONFIRMATION' : 'CONFIRMED', homeScore: 2, awayScore: 1 }));
  await redisSetRaw(ReadModelKeys.competitions(season), { data: [{ id: league, name: 'Premier League', type: 'LEAGUE', seasonId: season, leagueId: 'league-premier-league' }, { id: cup, name: 'FA Cup', type: 'DOMESTIC_CUP', seasonId: season }, { id: 'comp-la-liga-2026', name: 'La Liga', type: 'LEAGUE', seasonId: season, leagueId: 'league-la-liga' }] });
  await redisSetRaw(ReadModelKeys.clubsWithOwners(season), { data: [{ id: 'club-arsenal', name: 'Arsenal', leagueId: 'league-premier-league' }, { id: 'club-chelsea', name: 'Chelsea', leagueId: 'league-premier-league' }] });
  await redisSetRaw(ReadModelKeys.competitionFixtures(league, season), { data: games });
  await redisSetRaw(ReadModelKeys.competitionFixtures(cup, season), { data: [{ ...games[0], id: 'read-cup-game', competitionId: cup }] });
  await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc('read-pending').set({ fixtureId: games[0].id, userId: 'user-one', homeScore: 2, awayScore: 1 });
  await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc('read-other').set({ fixtureId: 'other-league-game', userId: 'user-two' });
  await db.collection(COLLECTIONS.DISPUTES).doc('read-open').set({ fixtureId: games[2].id, status: 'OPEN' });
  await db.collection(COLLECTIONS.DISPUTES).doc('read-closed').set({ fixtureId: games[3].id, status: 'RESOLVED' });
  let fixtureQueries = 0, reviewQueries = 0;
  const wrap = (query: any): any => ({ where: (...args: any[]) => wrap(query.where(...args)), get: async () => { reviewQueries++; return query.get(); } });
  db.collection = ((name: string) => {
    if (name === COLLECTIONS.FIXTURES) { fixtureQueries++; throw new Error('FULL_COMPETITION_FIRESTORE_SCAN_FORBIDDEN'); }
    if (([COLLECTIONS.RESULT_SUBMISSIONS, COLLECTIONS.DISPUTES] as string[]).includes(name)) return wrap(originalCollection(name));
    throw new Error('UNEXPECTED_READ:' + name);
  }) as any;
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => getScopedAdminReviews(user, season)));
    assert.equal(results[0].pendingFixtures.length, 3);
    assert.equal(results[0].pendingFixtures.find(f => f.id === games[0].id)?.submissions.length, 1);
    assert.deepEqual(results[0].disputes.map(d => d.id), ['read-open'], 'Open dispute on an already confirmed fixture must remain visible');
    assert.equal(results[0].submissions.length, 0);
    assert.equal(fixtureQueries, 0);
    const initialQueries = reviewQueries;
    assert.ok(initialQueries <= 15, 'One bounded review query set for all eight requests');
    resetUpstashClient();
    const again = await getScopedAdminReviews(user, season);
    assert.equal(again.pendingFixtures.length, 3); assert.equal(reviewQueries, initialQueries, 'Redis cache survives SDK replacement');
    const overview = await getLeagueAdminOverview(user, season);
    assert.equal(overview.fixtures.length, 381); assert.ok(overview.competitions.every(c => [league, cup].includes(c.id))); assert.equal(fixtureQueries, 0);
    await redisDelRaw(getFreshKey(ReadModelKeys.competitionFixtures(league, season)));
    const cachedWithStaleFixtures = await getScopedAdminReviews(user, season);
    assert.equal(cachedWithStaleFixtures.stale, true, 'Fresh review cache must not hide stale fixture data');
    assert.equal(cachedWithStaleFixtures.degraded, true);
    assert.equal(reviewQueries, initialQueries);
    await redisSetRaw(ReadModelKeys.competitionFixtures(league, season), { data: games });
    const empty = await getScopedAdminReviews({ ...user, adminPermissions: { scope: 'LEAGUES', leagueIds: [] } }, season);
    assert.equal(empty.pendingFixtures.length, 0); assert.equal(empty.disputes.length, 0);
    const archive = await getScopedAdminReviews(user, season, true);
    assert.deepEqual(archive.submissions.map(s => s.id), ['read-pending']);
    assert.ok(!archive.submissions.some(s => s.id === 'read-other'));
    // A held lease must return a marked stale snapshot, never duplicate a DB load.
    const client = getBoundedRedisClient()!;
    const key = 'efluz:v1:test:review-lease';
    await client.set(key + ':lock', 'another-instance', { ex: 30 });
    await client.set(key + ':lkg', { savedAt: Date.now(), result: { pendingFixtures: [], submissions: [], disputes: [], stale: false, degraded: false, source: 'firestore' } }, { ex: 300 });
    let duplicate = 0;
    const stale = await readSharedAdminReview(key, async () => { duplicate++; throw Error('MUST_NOT_LOAD'); });
    assert.equal(stale.stale, true); assert.equal(stale.degraded, true); assert.equal(duplicate, 0);
    await client.del(key + ':lkg');
    await assert.rejects(readSharedAdminReview(key, async () => { duplicate++; throw Error('MUST_NOT_LOAD'); }), /ADMIN_REVIEWS_REFRESHING/);
    assert.equal(duplicate, 0);
    firestoreCircuitBreaker.forceState('OPEN');
    const offline = await getScopedAdminReviews(user, 'test-offline-season');
    assert.equal(offline.stale, true); assert.equal(offline.degraded, true); assert.equal(fixtureQueries, 0);
    firestoreCircuitBreaker.forceState('CLOSED');
    console.log('PASS actual Redis: 380-game league + cup, eight coalesced review requests, zero fixture Firestore queries, bounded submissions/open disputes, cache reuse, permission/archive isolation and lease/outage flags');
  } finally { db.collection = originalCollection; firestoreCircuitBreaker.forceState('CLOSED'); }

  const client = getBoundedRedisClient()!;
  const now = Date.now(), hour = Math.floor(now / 3600000) * 3600000;
  const baseReport = await getDurableReadCosts(new Date(hour).toISOString(), new Date(now + 1000).toISOString());
  const before = baseReport.available ? Number((baseReport as any).byEndpoint['GET /cost/:id'] || 0) : 0;
  const app = express(); app.use(readCostMiddleware);
  app.get('/cost/:id', async (_req, res) => {
    await new Promise(resolve => setTimeout(resolve, 5));
    trackFirestoreRead('test-documents', 3, 'batched-test');
    trackFirestoreAggregation('test-documents', 1, 'count-test');
    res.json({ ok: true });
  });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const port = (server.address() as any).port;
    await Promise.all(Array.from({ length: 8 }, (_, i) => fetch(`http://127.0.0.1:${port}/cost/secret-user-${i}?token=NEVER_STORE`).then(r => r.json())));
    let report: any;
    for (let i = 0; i < 30; i++) {
      report = await getDurableReadCosts(new Date(hour).toISOString(), new Date(Date.now() + 1000).toISOString());
      if (Number(report.byEndpoint?.['GET /cost/:id'] || 0) === before + 32) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(report.byEndpoint['GET /cost/:id'], before + 32);
    assert.ok(!JSON.stringify(report).includes('secret-user-')); assert.ok(!JSON.stringify(report).includes('NEVER_STORE'));
    assert.ok(report.hours.some((h: any) => h.observed));
    assert.ok(await client.ttl('efluz:v1:read-cost:' + new Date(hour).toISOString().slice(0, 13)) > 600000);
    await Promise.all(Array.from({ length: 12 }, () => client.eval(READ_COST_INCREMENT_LUA, ['efluz:v1:test:cost-atomic'], ['totalReads', 3])));
    assert.equal(Number(await client.hget('efluz:v1:test:cost-atomic', 'totalReads')), 36);
    // Historical windows without a hash are unknown, rather than billed zero.
    const absent = await getDurableReadCosts(new Date(hour - 6 * 86400000).toISOString(), new Date(hour - 6 * 86400000 + 3600000).toISOString());
    assert.equal((absent as any).hours[0].observed, false);
    console.log('PASS actual Redis: parallel request attribution, atomic hourly counters, collection/caller breakdown, seven-day TTL, historical unknown markers, no user IDs or query secrets; no additional Firestore reads');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
