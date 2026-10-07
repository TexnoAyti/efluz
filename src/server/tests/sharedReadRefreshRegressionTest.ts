import assert from 'node:assert/strict';
import { createSharedReadRefresh, RELEASE_READ_REFRESH } from '../readModel/sharedReadRefresh';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { redisSetRaw, readThroughReadModel, clearProcessMemoryForTest, ReadModelKeys, getLeagueClubsFromReadModel, getAdminClubsFromReadModel, memoryRedisStorage, invalidateClubReadModels } from '../readModel/readModelStore';
import { SEED_CLUBS } from '../db/seed';
import { getFirestoreDb } from '../firebase/admin';
import { getReadMetrics, resetFirestoreReadMetrics } from '../firebase/firestoreStore';
import { getBoundedRedisClient } from '../readModel/boundedRedis';

const leases = new Map<string, string>();
const client = {
  set: async (key: string, token: string) => { if (leases.has(key)) return null; leases.set(key, token); return 'OK'; },
  eval: async (script: string, keys: string[], args: string[]) => {
    assert.equal(script, RELEASE_READ_REFRESH);
    if (leases.get(keys[0]) !== args[0]) return 0;
    leases.delete(keys[0]); return 1;
  },
} as unknown as NonNullable<ReturnType<typeof getBoundedRedisClient>>;
const firstServer = createSharedReadRefresh(() => client);
const secondServer = createSharedReadRefresh(() => client);
let started!: () => void, finish!: (value: number) => void;
const entered = new Promise<void>(resolve => started = resolve);
const result = new Promise<number>(resolve => finish = resolve);
let scans = 0;
const one = firstServer('owners', async () => { scans++; started(); return result; });
await entered;
const sameServer = Array.from({ length: 20 }, () => firstServer('owners', async () => { scans++; return 99; }));
await assert.rejects(secondServer('owners', async () => { scans++; return 99; }), /READ_REFRESH_BUSY/);
assert.equal(scans, 1, 'Across two server instances, only one canonical rebuild starts');
finish(7);
assert.deepEqual(await Promise.all([one, ...sameServer]), Array(21).fill(7));
assert.equal(leases.size, 0);
assert.equal(await secondServer('owners', async () => 8), 8, 'Next refresh can run after release');
await assert.rejects(firstServer('failure', async () => { throw new Error('load failed'); }), /load failed/);
assert.equal(leases.size, 0, 'Failed loads release their lease');
await firstServer('lease-owner', async () => { leases.set('efluz:v1:read-refresh:lease-owner', 'replacement'); return 1; });
assert.equal(leases.get('efluz:v1:read-refresh:lease-owner'), 'replacement', 'Old owner cannot delete a replacement lease');
const unavailable = createSharedReadRefresh(() => ({ set: async () => { throw new Error('Redis down'); } }) as any);
await assert.rejects(unavailable('outage', async () => { throw new Error('Firestore scan must not run'); }), /READ_REFRESH_REDIS_UNAVAILABLE/);

// A Redis hit must not reserve the circuit breaker's recovery probe.
firestoreCircuitBreaker.reset();
firestoreCircuitBreaker.setCooldown(0);
firestoreCircuitBreaker.recordFailure({ code: 8, message: 'Quota exceeded' });
await redisSetRaw('read-refresh-cache-test', { data: [1] });
clearProcessMemoryForTest();
let fetches = 0;
assert.deepEqual((await readThroughReadModel({ key: 'read-refresh-cache-test', firestoreFetcher: async () => { fetches++; return [2]; } })).data, [1]);
assert.equal(fetches, 0);
assert.equal(firestoreCircuitBreaker.getStatus().state, 'OPEN');
assert.equal(firestoreCircuitBreaker.canExecute(), true, 'Actual Firestore work can still obtain the probe');
firestoreCircuitBreaker.cancelProbe();
assert.equal(firestoreCircuitBreaker.getStatus().state, 'OPEN');
firestoreCircuitBreaker.reset();
firestoreCircuitBreaker.setCooldown(60000);

// Five cold league cache keys reuse one fresh canonical ownership snapshot.
memoryRedisStorage.clear(); clearProcessMemoryForTest();
const clubs = SEED_CLUBS.map(club => ({ ...club, active: true, createdAt: '', ownerUserId: 'existing-owner', ownerUsername: 'existing', isOccupied: true }));
await redisSetRaw(ReadModelKeys.clubsWithOwners('season-2026-27'), { data: clubs });
clearProcessMemoryForTest();
const db = getFirestoreDb(), original = db.collection;
(db as any).collection = () => { throw new Error('Unexpected Firestore read for a fresh canonical snapshot'); };
const results = await Promise.all(['league-premier-league','league-la-liga','league-serie-a','league-bundesliga','league-ligue-1'].map(id => getLeagueClubsFromReadModel(id, 'season-2026-27')));
assert.deepEqual(results.map(item => item.clubs.length), [20,20,20,18,18]);
assert.equal((await getAdminClubsFromReadModel('season-2026-27')).clubs.length, 96);
assert(results.every(item => item.clubs.every(club => (club as unknown as { ownerUserId: string }).ownerUserId === 'existing-owner')));
(db as any).collection = original;
// Ownership changes invalidate the canonical cache; parallel leagues rebuild once.
await db.collection('users').doc('new-owner').set({ username: 'new_owner', firstName: 'New', lastName: 'Owner' });
await db.collection('club_occupancies').doc('new-claim').set({ seasonId: 'season-2026-27', clubId: SEED_CLUBS[0].id, userId: 'new-owner', status: 'active' });
await invalidateClubReadModels('season-2026-27');
resetFirestoreReadMetrics();
const updated = await Promise.all(['league-premier-league','league-la-liga','league-serie-a','league-bundesliga','league-ligue-1'].map(id => getLeagueClubsFromReadModel(id, 'season-2026-27')));
const changedOwner = updated.flatMap(item => item.clubs).find(club => club.id === SEED_CLUBS[0].id) as unknown as { ownerUserId: string };
assert.equal(changedOwner.ownerUserId, 'new-owner');
assert.equal(getReadMetrics().readsByFunction.buildClubsSnapshot, 1, 'Only one occupancy query after invalidation');
assert.equal(getReadMetrics().readsByFunction['buildClubsSnapshot:owner'], 1, 'Only one owner document fetch across all leagues');
console.log('PASS shared refresh: 21 callers/2 servers/1 scan, release ownership, failure cleanup, Redis outage, cached probe safety, five league caches reuse canonical owners without Firestore');
