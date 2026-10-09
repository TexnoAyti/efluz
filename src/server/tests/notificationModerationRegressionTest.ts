import assert from 'node:assert/strict';
import express from 'express';
import { initDatabase } from '../db';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import { adminNotificationsRouter } from '../routes/adminNotifications.routes';
import { getUserNotificationsFirestore, invalidateFirestoreCache } from '../firebase/firestoreStore';
import { redisSetRaw, redisDelRaw, getFreshKey, clearProcessMemoryForTest, getUpstashClient } from '../readModel/readModelStore';

await initDatabase();
const db = getFirestoreDb();
await db.collection(COLLECTIONS.USERS).doc('moderator-admin').set({ id: 'moderator-admin', telegramId: '101', isAdmin: true, isSuspended: false });
await db.collection(COLLECTIONS.USERS).doc('moderator-player').set({ id: 'moderator-player', telegramId: '102', isAdmin: false, isSuspended: false });
const original = { id: 'moderation-notification', userId: 'moderator-player', title: 'Notice', message: 'Body', type: 'SYSTEM', isRead: false, createdAt: '2026-01-01T00:00:00.000Z' };
await db.collection(COLLECTIONS.NOTIFICATIONS).doc(original.id).set(original);
const dataset = 'efluz:v1:user:moderator-player:notifications:30';
await redisSetRaw(dataset, { data: [original] });
const app = express();
app.use(express.json());
app.use((req, _res, next) => { const id = req.headers['x-isolated-user']; if (id) req.user = { id } as any; next(); });
app.use('/admin/notifications', adminNotificationsRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${(server.address() as any).port}/admin/notifications`;
const request = async (path: string, method = 'GET', body?: unknown, actor = 'moderator-admin') => fetch(origin + path, {
  method, headers: { 'Content-Type': 'application/json', ...(actor ? { 'x-isolated-user': actor } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const visible = async () => (await getUserNotificationsFirestore('moderator-player')).map(n => n.id);
try {
  assert.equal((await request('', 'GET', undefined, '')).status, 401);
  assert.equal((await request('', 'GET', undefined, 'moderator-player')).status, 403);
  assert.equal((await request('/' + original.id, 'PATCH', { visibility: 'deleted' }, 'moderator-player')).status, 403);
  assert.equal((await request('/' + original.id, 'PATCH', { visibility: 'invalid' })).status, 400);
  assert.deepEqual(await visible(), [original.id]);
  assert.equal((await request('/' + original.id, 'PATCH', { visibility: 'hidden' })).status, 200);
  assert.deepEqual(await visible(), [], 'Warm in-process and Redis snapshots must respect hide');
  assert.equal((await request('/' + original.id, 'PATCH', { visibility: 'visible' })).status, 200);
  assert.deepEqual(await visible(), [original.id]);
  assert.equal((await request('/types/SYSTEM', 'PATCH', { visible: false })).status, 200);
  assert.deepEqual(await visible(), []);
  const future = { ...original, id: 'moderation-future', createdAt: '2026-01-02T00:00:00.000Z' };
  await db.collection(COLLECTIONS.NOTIFICATIONS).doc(future.id).set(future);
  await redisSetRaw(dataset, { data: [original, future] });
  invalidateFirestoreCache();
  assert.deepEqual(await visible(), [], 'Type control also hides future items');
  assert.equal((await request('/types/SYSTEM', 'PATCH', { visible: true })).status, 200);
  assert.deepEqual(await visible(), [original.id, future.id]);
  assert.equal((await request('/' + original.id, 'PATCH', { visibility: 'deleted' })).status, 200);
  await redisDelRaw(getFreshKey(dataset)); clearProcessMemoryForTest(); invalidateFirestoreCache();
  assert.deepEqual(await visible(), [future.id], 'Stale recovery snapshot cannot resurrect deletion');
  assert.equal((await request('/' + original.id, 'PATCH', { visibility: 'visible' })).status, 409);
  const listed = await (await request('')).json();
  assert.ok(!listed.notifications.some((n: any) => n.id === original.id));
  assert.equal((await db.collection(COLLECTIONS.NOTIFICATIONS).doc(original.id).get()).data()?.moderatedBy, 'moderator-admin');
  for (let index = 0; index < 105; index++) {
    const id = 'moderation-page-' + index;
    await db.collection(COLLECTIONS.NOTIFICATIONS).doc(id).set({ ...original, id, createdAt: new Date(Date.UTC(2026, 1, 1, 0, 0, index)).toISOString() });
  }
  let cursor: string | null = null;
  const ids: string[] = [];
  do {
    const page = await (await request(cursor ? '?cursor=' + encodeURIComponent(cursor) : '')).json();
    ids.push(...page.notifications.map((n: any) => n.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.filter(id => id.startsWith('moderation-page-')).length, 105, 'Older notifications remain manageable through pagination');
  assert.equal(new Set(ids).size, ids.length, 'Pagination cannot duplicate items');
  assert.equal((await request('?cursor=missing-document')).status, 400);
  const redis = getUpstashClient();
  if (redis) {
    const broadcast = (id: string, createdById = 'moderator-admin') => ({ id, seasonId: 'season-2026-27', title: 'Same sent message', body: 'Same body', type: 'CUSTOM_ALERT', createdById, createdByUsername: 'Admin', createdAt: '2026-02-01T00:00:00.000Z', metrics: { totalRecipients: 2 }, recipients: [] });
    await redis.hset('efluz:v1:telegram:broadcasts', {
      'moderation-broadcast-one': broadcast('moderation-broadcast-one'),
      'moderation-broadcast-two': broadcast('moderation-broadcast-two'),
      'smart-moderation-recipient': broadcast('smart-moderation-recipient', 'system:smart-notifications'),
    });
    const recipients = ['broadcast-recipient-one', 'broadcast-recipient-two'];
    const copies = (userId: string) => ['moderation-broadcast-one', 'moderation-broadcast-two'].map(id => ({ ...original, id: 'notif-' + id + '-' + userId, userId, type: 'CUSTOM_ALERT' }));
    for (const userId of recipients) await redisSetRaw('efluz:v1:user:' + userId + ':notifications:30', { data: copies(userId) });
    await redisSetRaw('efluz:v1:user:' + recipients[0] + ':notifications:20', { data: copies(recipients[0]) });
    let messages = await (await request('/messages')).json();
    assert.equal(messages.notifications.filter((n: any) => n.id === 'moderation-broadcast-one').length, 1, 'One sent message is one row for all recipients');
    assert.equal(messages.notifications.find((n: any) => n.id === 'moderation-broadcast-one').recipientCount, 2);
    assert.ok(!messages.notifications.some((n: any) => n.id === 'smart-moderation-recipient'));
    assert.ok(messages.notifications.some((n: any) => n.id === 'moderation-broadcast-two'), 'Identical text from a second send must remain a separate message');
    assert.equal((await request('/messages/moderation-broadcast-one', 'PATCH', { visibility: 'hidden' }, 'moderator-player')).status, 403);
    assert.equal((await request('/messages/moderation-broadcast-one', 'PATCH', { visibility: 'hidden' })).status, 200);
    for (const userId of recipients) assert.equal((await getUserNotificationsFirestore(userId)).length, 1);
    assert.equal((await getUserNotificationsFirestore(recipients[0], 20)).length, 1, 'Group control covers all cached page sizes');
    assert.equal((await request('/messages/moderation-broadcast-one', 'PATCH', { visibility: 'visible' })).status, 200);
    for (const userId of recipients) assert.equal((await getUserNotificationsFirestore(userId)).length, 2);
    assert.equal((await request('/messages/moderation-broadcast-one', 'PATCH', { visibility: 'deleted' })).status, 200);
    for (const userId of recipients) {
      await redisDelRaw(getFreshKey('efluz:v1:user:' + userId + ':notifications:30'));
      clearProcessMemoryForTest(); invalidateFirestoreCache();
      assert.equal((await getUserNotificationsFirestore(userId)).length, 1, 'Group deletion removes every recipient copy from stale snapshots');
    }
    assert.equal((await request('/messages/moderation-broadcast-one', 'PATCH', { visibility: 'visible' })).status, 409);
    messages = await (await request('/messages')).json();
    assert.ok(!messages.notifications.some((n: any) => n.id === 'moderation-broadcast-one'));
    assert.ok(messages.notifications.some((n: any) => n.id === 'moderation-broadcast-two'));
    assert.equal((await request('/messages/smart-moderation-recipient', 'PATCH', { visibility: 'hidden' })).status, 404);
    console.log('PASS actual Redis: sent message rows, distinct duplicate-text sends, hide/show/delete across all recipients and stale page sizes');
  }
  await db.collection(COLLECTIONS.USERS).doc('moderator-admin').update({ isAdmin: false });
  assert.equal((await request('/types/SYSTEM', 'PATCH', { visible: false })).status, 403);
  console.log('PASS: admin authorization, revoked role, hide/show, type and future controls, durable deletion and stale-cache filtering');
} finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
