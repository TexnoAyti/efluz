import assert from 'node:assert/strict';
import { getFirestoreDb } from '../firebase/admin';
import { redisSetRaw, redisGetFresh, redisGetLkg, redisIsDirty, invalidateDataset, clearProcessMemoryCache, resetMemoryRedisStore } from '../readModel/readModelStore';
import { getClubClaimReceipt } from '../services/durableClubClaim';
getFirestoreDb(); // The isolated runner supplies the in-memory transactional database.
process.env.DATABASE_PROVIDER = 'supabase';
const key = 'postgres-snapshot-regression';
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Redis must not be called'); };
try {
  await redisSetRaw(key, { data: [{ id: 'club', owner: undefined }], generatedAt: '2026-10-09T10:00:00Z' });
  clearProcessMemoryCache(); resetMemoryRedisStore();
  assert.equal((await redisGetFresh<any[]>(key))?.data.length, 1);
  assert.equal((await redisGetLkg<any[]>(key))?.data.length, 1);
  await assert.rejects(redisSetRaw(key, { data: [], generatedAt: '2026-10-09T10:01:00Z' }), /SNAPSHOT_REJECTED/);
  await invalidateDataset(key);
  assert.equal(await redisGetFresh(key), null);
  assert.equal(await redisIsDirty(key), true);
  assert.equal((await redisGetLkg<any[]>(key))?.data.length, 1);
  await redisSetRaw(key, { data: [{ id: 'updated' }], generatedAt: '2026-10-09T10:02:00Z' });
  assert.equal(await redisIsDirty(key), false);
  assert.equal((await redisGetFresh<any[]>(key))?.data[0].id, 'updated');
  assert.equal(await getClubClaimReceipt('user', 'season'), null);
  console.log('PASS PostgreSQL snapshots survive cache reset, reject empty overwrite, preserve LKG on invalidation, clear dirty state, and read claim status without Redis');
} finally { globalThis.fetch = fetchOriginal; delete process.env.DATABASE_PROVIDER; }
