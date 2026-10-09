import assert from 'node:assert/strict';
import express from 'express';
import { getFirestoreDb } from '../firebase/admin';
import { initDatabase } from '../db';
import { getFixtureTombstones } from '../services/fixtureTombstoneService';
import { adminConsistencyRouter } from '../routes/consistencyGuard.routes';

await initDatabase();
const db = getFirestoreDb();
await db.collection('users').doc('user-5209126900').set({ telegramId: '5209126900', username: 'admin', isAdmin: true, isSuspended: false });
const originalCollection = db.collection.bind(db);
let destructiveCalls = 0;
(db as any).collection = (name: string) => {
  if (name !== 'fixtures') return originalCollection(name);
  return { doc: () => ({
    get: async () => { throw Object.assign(new Error('Upstream service not found; temporarily unavailable'), { code: 14 }); },
    delete: async () => { destructiveCalls++; },
  }) };
};
const app = express();
app.use(express.json());
app.use((req: any, _res, next) => { req.user = { id: 'user-5209126900', telegramId: '5209126900' }; next(); });
app.use('/api/admin', adminConsistencyRouter);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
try {
  const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/admin/fixtures/fixture-deletion-failure-test`, {
    method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Isolated test reason' }),
  });
  assert.ok(response.status >= 500);
  assert.equal(destructiveCalls, 0);
  assert.equal((await getFixtureTombstones()).length, 0);
  console.log('PASS temporary database failure containing "not found" does not purge fixture or persist deletion tombstone. Isolated HTTP/admin flow.');
} finally {
  (db as any).collection = originalCollection;
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
