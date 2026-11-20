import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { deflateSync } from 'node:zlib';
import { getFirestoreDb } from '../firebase/admin';
import { PostgresRuntimeStore } from '../services/postgresRuntimeStore';
import { PostgresAiStore } from '../services/postgresAiStore';
import { getRuntimeStateStore } from '../readModel/runtimeStateStore';
import { getUpstashClient, ReadModelKeys, redisSetRaw, KEY_PREFIX, getReadModelHealthStatus } from '../readModel/readModelStore';
import { updateSmartNotificationSettings, getSmartNotificationSettings, DEFAULT_SMART_NOTIFICATION_EVENTS } from '../services/smartNotificationSettingsService';
import { updatePremiumSmartAlertPreferences, getPremiumSmartAlertPreferences } from '../services/premiumSmartNotificationService';
import { getPremiumClubBadgeIds, invalidatePremiumBadges } from '../services/premiumBadgeService';
import { SEED_CLUBS } from '../db/seed';
import { saveQualificationPreviewToken, getQualificationPreviewToken, deleteQualificationPreviewToken } from '../tournament/qualificationEngine';
import { createTournamentImageDownloadRouters } from '../routes/tournamentImageDownload.routes';
import { runDeadlineSweep } from '../services/matchOperationsV4Service';
import { enqueueMatchdayChannelPost, channelMatchdayId } from '../services/matchdayChannelPost';
import { getNotificationStore } from '../services/postgresNotificationStore';
import { getNotificationBackupClient } from '../services/notificationBackupQueue';
import { quotaCachedRead, invalidateQuotaRead } from '../services/quotaReadCache';
import { readSharedAdminReview, invalidateSharedAdminData } from '../services/adminReviewCache';
import { getDurableReadCosts, READ_COST_INCREMENT_LUA } from '../services/durableReadCosts';
import { rateLimit } from '../middleware/rateLimitMiddleware';

const db = getFirestoreDb(); // Isolated runner forces a local transactional store.
process.env.DATABASE_PROVIDER = 'supabase';
process.env.SUPABASE_DATA_NAMESPACE = 'preview';
process.env.UPSTASH_REDIS_REST_URL = 'https://redis-must-not-run.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN = 'isolated-token';
process.env.NOTIFICATION_BACKUP_REDIS_REST_URL = 'https://backup-must-not-run.invalid';
process.env.NOTIFICATION_BACKUP_REDIS_REST_TOKEN = 'isolated-token';
assert.equal(getUpstashClient(), null);
assert.equal(getNotificationBackupClient(), null);
assert.ok(getRuntimeStateStore() instanceof PostgresRuntimeStore);
const originalFetch = globalThis.fetch;
let externalRequests = 0;
globalThis.fetch = ((input: any, init: any) => {
  if (!/^http:\/\/127\.0\.0\.1:/.test(String(input))) { externalRequests++; throw Error('EXTERNAL_TRANSPORT_FORBIDDEN'); }
  return originalFetch(input, init);
}) as typeof fetch;

const first = new PostgresRuntimeStore(), second = new PostgresRuntimeStore();
const leaseResults = await Promise.all([first, second].map(store => store.set('shared-lease', 'owner', { nx: true, ex: 60 })));
assert.equal(leaseResults.filter(Boolean).length, 1);
assert.equal(await second.eval('EFL_STATE_RELEASE_V1', ['shared-lease'], ['other']), 0);
assert.equal(await second.eval('EFL_STATE_RELEASE_V1', ['shared-lease'], ['owner']), 1);
assert.equal(await first.get('shared-lease'), null);
await first.set('zero', 0); await first.set('false', false); await first.set('empty', []);
assert.deepEqual(await second.mget('zero', 'false', 'empty', 'missing'), [0, false, [], null]);
await assert.rejects(first.eval('return 1', ['unsupported'], []), /UNSUPPORTED/);

const originalNow = Date.now;
let clock = originalNow(); Date.now = () => clock;
try {
  await first.set('expires', { secret: 'temporary' }, { ex: 2 });
  clock += 2001;
  assert.equal(await second.get('expires'), null);
  assert.equal(await second.set('expires', 'renewed', { nx: true, ex: 60 }), 'OK');
  await first.pruneExpired();
  assert.equal(await second.get('expires'), 'renewed', 'Cleanup must preserve renewed entries');
  await first.set('short-export', 'private-image', { ex: 1 }); clock += 1001;
  assert.ok(await first.pruneExpired() >= 1);
} finally { Date.now = originalNow; }

const season = 'season-runtime-test';
await updateSmartNotificationSettings({ seasonId: season, enabled: false, events: DEFAULT_SMART_NOTIFICATION_EVENTS, updatedBy: 'owner' });
assert.equal((await getSmartNotificationSettings(season)).enabled, false);
await updatePremiumSmartAlertPreferences({ userId: 'premium-test', seasonId: season, values: { enabled: false, careerDigest: false }, updatedBy: 'premium-test' });
assert.equal((await getPremiumSmartAlertPreferences('premium-test', season)).careerDigest, false);
const originalCollection = db.collection.bind(db);
(db as any).collection = (name: string) => {
  if (name === 'runtime_state') throw Error('simulated database outage');
  return originalCollection(name);
};
try {
  await assert.rejects(getSmartNotificationSettings('uncached-outage-season'), /SETTINGS_UNAVAILABLE/);
  await assert.rejects(getPremiumSmartAlertPreferences('premium-test', season), /ALERTS_UNAVAILABLE/);
  await assert.rejects(getQualificationPreviewToken('unavailable-token'), /STORAGE_UNAVAILABLE/);
} finally { (db as any).collection = originalCollection; }
const preview: any = { previewToken: 'pg-token', seasonId: season, sourceFingerprint: 'source' };
await saveQualificationPreviewToken('pg-token', preview);
assert.deepEqual(await getQualificationPreviewToken('pg-token'), preview);
await deleteQualificationPreviewToken('pg-token');
assert.equal(await getQualificationPreviewToken('pg-token'), null, 'Consumed tokens cannot revive from process memory');

let loads = 0;
assert.deepEqual(await quotaCachedRead('pg-cache', 60, async () => { loads++; return []; }), []);
assert.deepEqual(await quotaCachedRead('pg-cache', 60, async () => { loads++; return ['wrong']; }), []);
assert.equal(loads, 1);
await invalidateQuotaRead('pg-cache');
assert.deepEqual(await quotaCachedRead('pg-cache', 60, async () => { loads++; return ['new']; }), ['new']);
assert.equal(loads, 2);
// Mutation between load and publish must reject the stale writer in another store.
await first.set('publish-lease', 'owner', { ex: 60 });
await second.eval('EFL_QUOTA_CACHE_INVALIDATE_V1', ['publish-fresh', 'publish-version'], []);
assert.equal(await first.eval('EFL_QUOTA_CACHE_PUBLISH_V1', ['publish-fresh', 'publish-lkg', 'publish-version', 'publish-lease'], ['owner', '0', JSON.stringify({ data: ['old'] }), 60]), 0);
assert.equal(await second.get('publish-fresh'), null);
let reviews = 0;
const reviewLoader = async () => { reviews++; return { pendingFixtures: [], submissions: [], disputes: [], degraded: false, stale: false, source: 'postgresql' }; };
await readSharedAdminReview('pg-reviews', reviewLoader);
await readSharedAdminReview('pg-reviews', reviewLoader); assert.equal(reviews, 1);
await invalidateSharedAdminData(); await readSharedAdminReview('pg-reviews', reviewLoader); assert.equal(reviews, 2);

const hour = new Date().toISOString().slice(0, 13);
await first.eval(READ_COST_INCREMENT_LUA, [`${KEY_PREFIX}:read-cost:${hour}`], ['totalReads', 3, 'endpoint:GET /state', 3]);
assert.equal((await getDurableReadCosts() as any).byEndpoint['GET /state'], 3);
assert.equal((await runDeadlineSweep(season)).skipped, false);
assert.equal((await runDeadlineSweep(season)).reason, 'HOURLY_LOCK');

const competition: any = { id: 'pg-league', seasonId: season, name: 'Premier League', leagueId: 'league-premier-league', type: 'LEAGUE', status: 'active', formatConfig: {} };
const clubs: any[] = [{ id: 'home', name: 'Home', leagueId: competition.leagueId }, { id: 'away', name: 'Away', leagueId: competition.leagueId }];
await redisSetRaw(ReadModelKeys.clubsWithOwners(season), { data: clubs });
const fixtures: any[] = [{ id: 'pg-game', competitionId: competition.id, seasonId: season, matchday: 1, homeClubId: 'home', awayClubId: 'away', status: 'SCHEDULED' }];
const post = { competition, fixtures, matchday: 1, deadlineAt: new Date(Date.now() + 86400000).toISOString() };
assert.equal(await enqueueMatchdayChannelPost(post), 'QUEUED');
assert.equal(await enqueueMatchdayChannelPost(post), 'EXISTS');
const notifications = getNotificationStore()!;
const queue = await notifications.get<any[]>(`${KEY_PREFIX}:telegram:queue`);
assert.equal(queue?.length, 1);
assert.equal(queue?.[0].broadcastId, channelMatchdayId(competition.id, season, 1));
// Worker and producer must observe exactly the same durable job.
await notifications.set('worker-probe', 'worker', { ex: 60 });
const claimed = await notifications.eval<any[], any>('EFL_NOTIFY_CLAIM_V1', [`${KEY_PREFIX}:telegram:queue`, 'processing-probe', 'worker-probe'], ['worker', Date.now()]);
assert.equal(claimed?.jobId, queue?.[0].jobId);
assert.deepEqual(await notifications.get(`${KEY_PREFIX}:telegram:queue`), []);

const ai = new PostgresAiStore();
assert.equal(await ai.eval('EFL_AI_DELIVERY_V1', ['ai-delivery'], []), 1);
assert.equal(await ai.eval('EFL_AI_DELIVERY_V1', ['ai-delivery'], []), 0);
const health = await getReadModelHealthStatus(season);
assert.equal(health.storageProvider, 'postgresql'); assert.equal(health.storageState, 'CONNECTED');
const badgeSeason = 'season-badges';
await db.collection('premium_entitlements').doc('badge-entitlement').set({ userId: 'badge-user', seasonId: badgeSeason, status: 'ACTIVE' });
await redisSetRaw(ReadModelKeys.clubsWithOwners(badgeSeason), { data: SEED_CLUBS.map(club => ({ ...club, ownerUserId: club.id === 'club-arsenal' ? 'badge-user' : null })) });
assert.deepEqual(await getPremiumClubBadgeIds(badgeSeason), ['club-arsenal']);
await db.collection('premium_entitlements').doc('badge-entitlement').update({ status: 'REVOKED' });
await invalidatePremiumBadges(badgeSeason);
assert.deepEqual(await getPremiumClubBadgeIds(badgeSeason), []);

// Default image service, actual HTTP round trip, and distributed request budget.
await db.collection('users').doc('image-admin').set({ isAdmin: true, isSuspended: false });
const app = express(); app.use(express.json());
app.use((req: any, _res, next) => { req.user = { id: 'image-admin', telegramId: '123456', isAdmin: true }; next(); });
const routers = createTournamentImageDownloadRouters();
app.use('/api/admin/image-exports', routers.admin); app.use('/api/image-exports', routers.download);
app.get('/budget', rateLimit('pg-budget', 2, 60), (_req, res) => res.json({ ok: true }));
function crc32(buffer: Buffer) { let crc = 0xffffffff; for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) { const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const payload = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(payload)); return Buffer.concat([size, payload, crc]); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1080, 0); ihdr.writeUInt32BE(100, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.alloc((1080 * 3 + 1) * 100))), chunk('IEND', Buffer.alloc(0))]);
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as any).port}`;
try {
  const created = await fetch(base + '/api/admin/image-exports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pngBase64: png.toString('base64'), filename: 'efluz-test.png' }) });
  assert.equal(created.status, 200, await created.clone().text());
  const { downloadPath } = await created.json();
  const file = await fetch(base + downloadPath); assert.equal(file.status, 200);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
  assert.equal((await fetch(base + '/budget')).status, 200);
  assert.equal((await fetch(base + '/budget')).status, 200);
  assert.equal((await fetch(base + '/budget')).status, 429);
} finally { server.close(); globalThis.fetch = originalFetch; }
assert.equal(externalRequests, 0, 'All migrated services must work with both Redis transports forbidden');
console.log('PASS migrated runtime: cross-instance NX/TTL, renewal retention, settings, premium preferences, preview consumption, cache invalidation, admin epochs, telemetry, hourly deadline lease, matchday queue/worker dedupe, AI delivery, health, real image HTTP and rate-limit HTTP; zero Redis/Telegram network calls');
