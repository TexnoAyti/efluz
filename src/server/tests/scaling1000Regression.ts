import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { createSessionToken } from '../auth/sessionToken';
import { rateLimit } from '../middleware/rateLimitMiddleware';
import { getFirestoreDb } from '../firebase/admin';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { getUpstashClient, KEY_PREFIX, ReadModelKeys, redisSetRaw, clearProcessMemoryForTest } from '../readModel/readModelStore';
import { SEED_CLUBS } from '../db/seed';
import { quotaCachedRead } from '../services/quotaReadCache';

// Called by the real Redis suite: loopback HTTP only, no production accounts,
// provider credentials, Telegram sends or Firestore writes.
export async function runScaling1000Regression() {
  process.env.SESSION_SECRET = 'scaling-test-session-secret-32-bytes';
  process.env.TELEGRAM_BOT_TOKEN = 'scaling-test-bot-token-32-bytes';
  const client = getUpstashClient();
  assert.ok(client, 'Capacity test requires actual Redis, not the memory/mock fallback');
  const season = 'season-2026-27';
  const users = Array.from({ length: 1000 }, (_, i) => ({
    id: `user-${920000000 + i}`, telegramId: String(920000000 + i),
    username: `scaling_${i}`, firstName: `Visitor ${i}`, isAdmin: false,
    isSuspended: false, createdAt: '', updatedAt: '',
  }));
  const tokens = users.map(user => createSessionToken(user));
  const clubs = SEED_CLUBS.map((club, i) => ({ ...club, ownerUserId: users[i].id,
    ownerUsername: users[i].username, isOccupied: true, isTaken: true }));
  assert.equal(clubs.length, 96);
  const leagueIds = [...new Set(clubs.map(club => club.leagueId))];
  const competitions = leagueIds.map(leagueId => ({
    id: `comp-${leagueId.replace(/^league-/, '')}-2026`, seasonId: season, leagueId,
    type: 'LEAGUE', name: leagueId, currentMatchday: 1, isMatchdayOpen: true, formatConfig: {},
  }));
  const fixtures = competitions.flatMap(comp => {
    const members = clubs.filter(club => club.leagueId === comp.leagueId);
    return Array.from({ length: Math.floor(members.length / 2) }, (_, i) => ({
      id: `scaling-${comp.id}-${i}`, seasonId: season, competitionId: comp.id,
      homeClubId: members[i * 2].id, awayClubId: members[i * 2 + 1].id,
      matchday: 1, status: 'SCHEDULED', homeScore: null, awayScore: null,
      scheduledAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      userSubmission: { submittedByUserId: 'foreign', homeScore: 99, awayScore: 99 },
    }));
  });
  await redisSetRaw(ReadModelKeys.clubsWithOwners(season), { data: clubs });
  await redisSetRaw(ReadModelKeys.competitions(season), { data: competitions });
  await redisSetRaw(ReadModelKeys.adminFixtures(season), { data: fixtures });
  for (const comp of competitions) {
    await redisSetRaw(ReadModelKeys.competitionFixtures(comp.id, season), { data: fixtures.filter(f => f.competitionId === comp.id) });
    await redisSetRaw(ReadModelKeys.standings(comp.id, season), { data: clubs.filter(c => c.leagueId === comp.leagueId).map((c, i) => ({ clubId: c.id, clubName: c.name, position: i + 1, points: 0, played: 0 })) });
  }
  // Prime user notifications as a real deployment's read model would do.
  for (let offset = 0; offset < users.length; offset += 50) {
    await Promise.all(users.slice(offset, offset + 50).map(user => redisSetRaw(`${KEY_PREFIX}:user:${user.id}:notifications:30`, {
      data: [{ id: `notice-${user.id}`, userId: user.id, type: 'SYSTEM', title: 'Scaling test', message: 'Private', isRead: false, createdAt: new Date().toISOString() }],
    })));
  }
  await quotaCachedRead(`deadlines:${season}`, 3600, async () => []);
  await Promise.all(users.slice(0, 96).map(user => quotaCachedRead(`no-shows:${season}:${user.id}`, 900, async () => [])));
  clearProcessMemoryForTest(); // Redis must survive a process-cache cold start.
  const { createApp, ensureDbReady } = await import('../app');
  await ensureDbReady();
  // Startup seeds example cup fixtures locally. This test owns its entire
  // fixture dataset, so remove those examples before measuring Redis reads.
  const { queryRun } = await import('../db');
  queryRun('DELETE FROM fixtures');
  const db = getFirestoreDb();
  const original = db.collection.bind(db);
  let firestoreCalls = 0;
  db.collection = (() => { firestoreCalls++; throw new Error('WARM_READ_MUST_NOT_ACCESS_FIRESTORE'); }) as any;
  firestoreCircuitBreaker.forceState('OPEN');
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const durations: number[] = [];
  const started = performance.now();
  try {
    const paths = ['/api/me', '/api/me/matches', '/api/me/notifications', '/api/clubs/available', '/api/me/match-ops',
      '/api/competitions/comp-premier-league-2026/standings', '/api/competitions/comp-premier-league-2026/fixtures'];
    for (const path of paths) {
      await Promise.all(users.map(async (user, i) => {
        const begin = performance.now();
        const response = await fetch(base + path, { headers: { Authorization: `Bearer ${tokens[i]}` } });
        const body = await response.json() as any;
        assert.equal(response.status, 200, `${path}: user ${i}: ${JSON.stringify(body)}`);
        if (path === '/api/me') {
          assert.equal(body.user.id, user.id);
          assert.equal(body.currentClub?.id || null, clubs[i]?.id || null);
          assert.equal(body.currentClubStatus, 'resolved');
        } else if (path === '/api/me/matches') {
          assert.equal(body.fixtures.length, i < 96 ? 1 : 0, `User ${i}: ${JSON.stringify(body.fixtures.map((f: any) => ({ id: f.id, competitionId: f.competitionId })))}`);
          assert.ok(body.fixtures.every((f: any) => !f.userSubmission &&
            [f.homeClubId, f.awayClubId].includes(clubs[i]?.id)));
        } else if (path === '/api/me/notifications') {
          assert.equal(body.notifications.length, 1);
          assert.equal(body.notifications[0].userId, user.id);
        } else if (path === '/api/clubs/available') {
          assert.deepEqual(body.clubs, [], 'Claimed clubs must never appear available');
        } else if (path.endsWith('/standings')) {
          assert.equal(body.standings.length, 20);
          assert.ok(body.standings.every((row: any) => row.points === 0));
        } else if (path.endsWith('/fixtures')) {
          assert.equal(body.fixtures.length, 10);
        }
        assert.match(response.headers.get('cache-control') || '', /private|no-store/);
        durations.push(performance.now() - begin);
      }));
    }
    assert.equal(firestoreCalls, 0, '7000 warm HTTP requests must make zero Firestore collection calls');
    assert.equal((await fetch(base + '/api/me')).status, 401);
    durations.sort((a, b) => a - b);
    console.log(`PASS scaling HTTP: 1000 signed users on one IP, 96 owners + 904 spectators, 7000 successful requests, zero Firestore calls; local elapsed=${Math.round(performance.now() - started)}ms p95=${Math.round(durations[Math.floor(durations.length * .95)])}ms`);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.collection = original;
    firestoreCircuitBreaker.forceState('CLOSED');
  }

  const securityApp = express();
  securityApp.use(express.json());
  securityApp.use(rateLimit('scaling-security', 2, 600));
  securityApp.all('*', (_req, res) => res.json({ ok: true }));
  const securityServer = securityApp.listen(0, '127.0.0.1');
  await once(securityServer, 'listening');
  const securityBase = `http://127.0.0.1:${(securityServer.address() as any).port}`;
  try {
    const auth = { Authorization: `Bearer ${tokens[0]}` };
    assert.equal((await fetch(securityBase, { headers: auth })).status, 200);
    assert.equal((await fetch(securityBase, { headers: { 'x-session-token': createSessionToken(users[0]) } })).status, 200);
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(users[0].telegramId), first_name: 'Test' }) });
    const data = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.TELEGRAM_BOT_TOKEN!).digest();
    params.set('hash', crypto.createHmac('sha256', secret).update(data).digest('hex'));
    const limited = await fetch(securityBase + '/api/auth/telegram', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData: params.toString() }) });
    assert.equal(limited.status, 429, 'Session renewal / Telegram login must not reset the same user budget');
    assert.ok(limited.headers.get('retry-after'));
    assert.equal((await fetch(securityBase, { headers: { Authorization: `Bearer ${tokens[1]}` } })).status, 200, 'A different verified user keeps their own budget');
    for (let i = 0; i < 3; i++) {
      const invalid = await fetch(securityBase, { headers: {
        Authorization: `Bearer ${tokens[i]}forged`, 'x-user-id': users[i].id,
        'x-forwarded-for': `198.51.100.${i + 1}`, 'x-vercel-forwarded-for': `198.51.100.${i + 1}`,
      } });
      assert.equal(invalid.status, i < 2 ? 200 : 429, 'Unsigned IDs/forged sessions/untrusted proxy headers must share the IP budget');
    }
    assert.equal((await fetch(securityBase, { headers: { Authorization: `Bearer ${createSessionToken(users[2], -1)}` } })).status, 429, 'Expired tokens cannot rotate budgets');
    process.env.VERCEL = '1';
    try {
      for (const ip of ['203.0.113.1', '203.0.113.2']) {
        for (let i = 0; i < 3; i++) {
          assert.equal((await fetch(securityBase, { headers: { 'x-vercel-forwarded-for': ip } })).status, i < 2 ? 200 : 429, 'Vercel platform IPs get separate anonymous budgets');
        }
      }
      assert.equal((await fetch(securityBase, { headers: { 'x-vercel-forwarded-for': '203.0.113.3, 203.0.113.4' } })).status, 429, 'Ambiguous proxy chains cannot rotate the IP budget');
    } finally { delete process.env.VERCEL; }
    console.log('PASS actual Redis rate limits: canonical signed identity, per-user isolation, renewal/HMAC continuity, spoofed headers and expired tokens rejected');
  } finally { await new Promise<void>(resolve => securityServer.close(() => resolve())); }
}
