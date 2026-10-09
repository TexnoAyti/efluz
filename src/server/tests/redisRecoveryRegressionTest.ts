import assert from 'node:assert/strict';
import { resolveRedisConfig } from '../readModel/redisConfig';
import { getFirestoreDb } from '../firebase/admin';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { rebuildAllReadModels, resetMemoryRedisStore, buildClubsSnapshot } from '../readModel/readModelStore';
import { COLLECTIONS } from '../firebase/collections';

async function main() {
  const env = { UPSTASH_REDIS_REST_URL:'https://redis.example.invalid', KV_REST_API_URL:'https://real.upstash.io', KV_REST_API_TOKEN:'test-token' };
  assert.equal(resolveRedisConfig(env)?.urlName,'KV_REST_API_URL');
  assert.equal(resolveRedisConfig({STORAGE_KV_REST_API_URL:'https://a.upstash.io',STORAGE_KV_REST_API_TOKEN:'a'})?.urlName,'STORAGE_KV_REST_API_URL');
  assert.equal(resolveRedisConfig({UPSTASH_REDIS_REST_URL:'https://a.upstash.io',KV_REST_API_TOKEN:'a'}),null);
  assert.equal(resolveRedisConfig({A_KV_REST_API_URL:'https://a.upstash.io',A_KV_REST_API_TOKEN:'a',B_KV_REST_API_URL:'https://b.upstash.io',B_KV_REST_API_TOKEN:'b'}),null);
  resetMemoryRedisStore();
  const db = getFirestoreDb();
  const original = db.collection.bind(db);
  let reads = 0;
  db.collection = (() => { reads++; throw Object.assign(new Error('RESOURCE_EXHAUSTED: quota'),{code:8}); }) as any;
  try {
    process.env.VERCEL='1';
    await assert.rejects(rebuildAllReadModels(),/REDIS_NOT_CONFIGURED/);
    assert.equal(reads,0,'Missing durable Redis must abort production rebuild before Firestore');
    delete process.env.VERCEL;
    firestoreCircuitBreaker.recordSuccess();
    const result = await rebuildAllReadModels();
    assert.equal(result.success,false);
    assert.equal(reads,1,'Stop remaining datasets after first quota failure');
    assert.equal(result.warmedLkgKeys.length,0);
  } finally { delete process.env.VERCEL; db.collection=original; firestoreCircuitBreaker.recordSuccess(); }
  let occupancyQueries=0;
  db.collection=((name:string) => { if(name===COLLECTIONS.CLUB_OCCUPANCIES) occupancyQueries++; return original(name); }) as any;
  try {
    await buildClubsSnapshot();
    assert.equal(occupancyQueries,1,'Empty season requires one occupancy query, not duplicate query');
  } finally { db.collection=original; }
  console.log('PASS: Redis credential pairs/custom prefix, ambiguous configuration refusal, zero-read missing Redis rebuild, quota short-circuit and no duplicate occupancy query');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
