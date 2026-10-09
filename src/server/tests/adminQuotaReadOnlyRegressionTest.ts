import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { initDatabase } from '../db';
import { createSessionToken } from '../auth/sessionToken';
import { getFirestoreDb } from '../firebase/admin';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware';
import { User } from '../../types';

async function main() {
  process.env.SESSION_SECRET = 'isolated-admin-quota-test-secret-32-bytes';
  process.env.ADMIN_TELEGRAM_IDS = '5209126900';
  await initDatabase();
  const db = getFirestoreDb();
  const originalCollection = db.collection.bind(db);
  db.collection = (() => { throw Object.assign(new Error('RESOURCE_EXHAUSTED: Quota exceeded'), { code: 8 }); }) as any;

  const app = express();
  app.use(authMiddleware);
  app.get('/admin', requireAdmin, (_req, res) => res.json({ ok: true }));
  app.post('/admin', requireAdmin, (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const user = (telegramId: string, overrides: Partial<User> = {}): User => ({
    id: `user-${telegramId}`, telegramId, username: 'test_admin', firstName: 'Test',
    lastName: '', photoUrl: '', isAdmin: true, isSuspended: false,
    createdAt: '', updatedAt: '', ...overrides,
  });
  const request = (method: string, token: string) => fetch(`${base}/admin`, {
    method, headers: { Authorization: `Bearer ${token}` },
  });

  try {
    const approved = createSessionToken(user('5209126900'));
    const read = await request('GET', approved);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('x-admin-read-only'), 'true');
    assert.equal((await read.json() as any).ok, true);
    assert.equal((await request('POST', approved)).status, 503, 'mutations must still fail closed');
    assert.equal((await request('GET', createSessionToken(user('99999')))).status, 503, 'token admin claim is not enough');
    assert.equal((await request('GET', createSessionToken(user('5209126900', { isSuspended: true })))).status, 503);
    process.env.ADMIN_TELEGRAM_IDS = '@test_admin';
    assert.equal((await request('GET', approved)).status, 200, 'configured Telegram username also grants emergency read access');
    assert.equal((await request('GET', createSessionToken(user('99999', { username: 'other' })))).status, 503);
    assert.equal((await request('POST', approved)).status, 503);
    process.env.ADMIN_TELEGRAM_IDS = '';
    assert.equal((await request('GET', approved)).status, 503, 'configuration removal revokes fallback immediately');
    assert.equal((await request('GET', `${approved}tampered`)).status, 401);
    console.log('PASS: quota emergency access is GET-only, configured admin only, signed, and fails closed for mutations');
  } finally {
    server.close();
    db.collection = originalCollection;
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
