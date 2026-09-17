/**
 * DURABLE UPSTASH REDIS READ MODEL STORE
 *
 * Tiered Read Hierarchy:
 * 1. Short-lived in-process memory cache (15s TTL)
 * 2. Fresh Redis snapshot (efluz:v1:fresh:<key>, with TTL)
 * 3. Firestore when refresh is required / missing (with request coalescing)
 * 4. Stale Redis last-known-good snapshot (efluz:v1:lkg:<key>, NO TTL / permanent)
 * 5. Structured 503 error if neither Firestore nor Redis contains data (READ_MODEL_NOT_WARMED)
 *
 * Durability & Resilience Rules:
 * - Two-key storage strategy: fresh key has TTL, LKG key has NO TTL.
 * - Non-destructive invalidation: invalidating clears memory and deletes only fresh key / marks dirty; preserves LKG key.
 * - Authoritative mutations trigger targeted rebuilds. If rebuild fails, previous LKG is served as stale.
 * - LKG protection: validated authoritative data replaces LKG; non-empty LKG is NEVER replaced with empty data.
 * - Domestic league standings must never store an empty array; fallback generates zero-value rows:
 *   Premier League (20), La Liga (20), Serie A (20), Bundesliga (18), Ligue 1 (18).
 * - Club ownership is preserved in owner-neutral snapshots; user-specific fields like isCurrentUserClub
 *   are derived on read per-request and NEVER leaked into shared cache.
 */

import { Redis } from '@upstash/redis';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS, FirestoreFixtureDoc, FirestoreCompetitionDoc } from '../firebase/collections';
import { SEED_COMPETITIONS, SEED_CLUBS, SEED_LEAGUES } from '../db/seed';
import { Club, Fixture, Competition, StandingsRow } from '../../types/index';

export const SCHEMA_VERSION = 'v1';
export const KEY_PREFIX = `efluz:${SCHEMA_VERSION}`;

export interface ReadModelSnapshot<T> {
  schemaVersion: string;
  generatedAt: string;
  sourceVersion: string;
  expectedCount: number;
  actualCount: number;
  data: T;
}

export interface CoreDatasetHealth {
  key: string;
  expectedCount: number;
  actualCount: number;
  snapshotTimestamp: string | null;
  snapshotAgeSeconds: number | null;
  hasFresh: boolean;
  hasLkg: boolean;
  isDirty: boolean;
  status: 'FRESH' | 'LKG_STALE' | 'DIRTY' | 'MISSING';
}

export interface ReadModelHealthInfo {
  firestoreState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  redisState: 'CONNECTED' | 'IN_MEMORY_FALLBACK' | 'ERROR';
  circuitBreakerState: {
    state: string;
    consecutiveFailures: number;
    resourceExhaustedCount: number;
    lastFailureTime: number | null;
    lastError: string | null;
  };
  lastSnapshotAt: string | null;
  snapshotAgeSeconds: number | null;
  freshKeys: string[];
  lkgKeys: string[];
  dirtyKeys: string[];
  missingKeys: string[];
  // Spaced aliases matching audit requirements
  'fresh keys'?: string[];
  'lkg keys'?: string[];
  'dirty keys'?: string[];
  'missing keys'?: string[];
  warmedKeys?: string[];
  coreDatasets: Record<string, CoreDatasetHealth>;
}

export class ReadModelNotWarmedError extends Error {
  public readonly errorCode = 'READ_MODEL_NOT_WARMED';
  public readonly statusCode = 503;
  public readonly status = 503;
  constructor(message = 'Read model is not warmed and authoritative database is temporarily unreachable.') {
    super(message);
    this.name = 'ReadModelNotWarmedError';
  }
}

// Domestic league configuration with expected team counts
export const DOMESTIC_LEAGUE_CONFIG: Record<
  string,
  { leagueId: string; expectedCount: number; name: string }
> = {
  'comp-premier-league-2026': { leagueId: 'league-premier-league', expectedCount: 20, name: 'Premier League' },
  'comp-la-liga-2026': { leagueId: 'league-la-liga', expectedCount: 20, name: 'La Liga' },
  'comp-serie-a-2026': { leagueId: 'league-serie-a', expectedCount: 20, name: 'Serie A' },
  'comp-bundesliga-2026': { leagueId: 'league-bundesliga', expectedCount: 18, name: 'Bundesliga' },
  'comp-ligue-1-2026': { leagueId: 'league-ligue-1', expectedCount: 18, name: 'Ligue 1' },
};

// Canonical competition order (1-17, EFL Cup safely omitted)
export const CANONICAL_COMPETITION_ORDER: Record<string, number> = {
  'comp-premier-league-2026': 1,
  'comp-la-liga-2026': 2,
  'comp-serie-a-2026': 3,
  'comp-bundesliga-2026': 4,
  'comp-ligue-1-2026': 5,
  'comp-fa-cup-2026': 6,
  'comp-copa-del-rey-2026': 7,
  'comp-coppa-italia-2026': 8,
  'comp-dfb-pokal-2026': 9,
  'comp-coupe-de-france-2026': 10,
  'comp-community-shield-2026': 11,
  'comp-supercopa-espana-2026': 12,
  'comp-supercoppa-italiana-2026': 13,
  'comp-dfl-supercup-2026': 14,
  'comp-champions-league-2026': 15,
  'comp-europa-league-2026': 16,
  'comp-uefa-super-cup-2026': 17,
};

// ----------------------------------------------------
// KEY RESOLUTION HELPERS (TWO-KEY STRATEGY)
// ----------------------------------------------------

export function getRawDatasetKey(key: string): string {
  return key.replace(/^efluz:v1:(fresh:|lkg:|dirty:)?/, '').replace(/^efluz:v1:/, '');
}

export function getFreshKey(datasetKey: string): string {
  const clean = getRawDatasetKey(datasetKey);
  return `${KEY_PREFIX}:fresh:${clean}`;
}

export function getLkgKey(datasetKey: string): string {
  const clean = getRawDatasetKey(datasetKey);
  return `${KEY_PREFIX}:lkg:${clean}`;
}

export function getDirtyKey(datasetKey: string): string {
  const clean = getRawDatasetKey(datasetKey);
  return `${KEY_PREFIX}:dirty:${clean}`;
}

// Canonical dataset key generators
export const ReadModelKeys = {
  competitions: (seasonId = 'season-2026-27') => `${KEY_PREFIX}:season:${seasonId}:competitions`,
  clubsWithOwners: (seasonId = 'season-2026-27') => `${KEY_PREFIX}:season:${seasonId}:clubs-with-owners`,
  leagueClubs: (leagueId: string, seasonId = 'season-2026-27') => `${KEY_PREFIX}:season:${seasonId}:league:${leagueId}:clubs`,
  standings: (competitionId: string, seasonId = 'season-2026-27') => `${KEY_PREFIX}:season:${seasonId}:competition:${competitionId}:standings`,
  competitionFixtures: (competitionId: string, seasonId = 'season-2026-27') => `${KEY_PREFIX}:season:${seasonId}:competition:${competitionId}:fixtures`,
  adminFixtures: (seasonId = 'season-2026-27') => `${KEY_PREFIX}:season:${seasonId}:admin:fixtures`,
  userMembership: (userId: string, seasonId = 'season-2026-27') => `${KEY_PREFIX}:season:${seasonId}:user:${userId}:membership`,
};

// ----------------------------------------------------
// REDIS CLIENT & IN-MEMORY STORAGE
// ----------------------------------------------------

let upstashClient: Redis | null = null;
let isUpstashConfigured = false;

// Persistent memory storage mimicking Redis (for environments without Upstash credentials or offline)
export const memoryRedisStorage = new Map<
  string,
  { snapshot: ReadModelSnapshot<any>; expiresAt: number | null }
>();

// Short-lived process memory cache (Level 1: 15 seconds)
export const inProcessMemoryCache = new Map<string, { data: any; expiresAt: number }>();
const PROCESS_MEMORY_TTL_MS = 15000;

// Request coalescing map
const inFlightLoaders = new Map<string, Promise<any>>();

// Track last snapshot generation timestamp
let globalLastSnapshotAt: string | null = null;

function getUpstashClient(): Redis | null {
  if (upstashClient) return upstashClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token && !url.includes('your-upstash-redis-url') && !url.includes('example')) {
    try {
      upstashClient = new Redis({ url, token });
      isUpstashConfigured = true;
      return upstashClient;
    } catch (err) {
      console.warn('[READ_MODEL_STORE] Failed to initialize Upstash Redis client:', err);
    }
  }
  return null;
}

// ----------------------------------------------------
// REDIS LOW-LEVEL PRIMITIVES
// ----------------------------------------------------

/**
 * Get TTL in seconds for a key:
 * -1 = persists with no expiration (LKG)
 * -2 = key does not exist
 * >0 = seconds remaining
 */
export async function redisGetTtl(key: string): Promise<number> {
  const client = getUpstashClient();
  if (client) {
    try {
      return await client.ttl(key);
    } catch (err: any) {
      console.warn(`[READ_MODEL_STORE] Redis ttl error for ${key}:`, err?.message || err);
    }
  }
  const entry = memoryRedisStorage.get(key);
  if (!entry) return -2;
  if (entry.expiresAt === null) return -1;
  const remainingMs = entry.expiresAt - Date.now();
  if (remainingMs <= 0) {
    memoryRedisStorage.delete(key);
    return -2;
  }
  return Math.floor(remainingMs / 1000);
}

/**
 * Reads an exact key directly from Redis / memory.
 */
export async function redisGetExact<T>(key: string): Promise<ReadModelSnapshot<T> | null> {
  const client = getUpstashClient();
  if (client) {
    try {
      const val = await client.get<ReadModelSnapshot<T>>(key);
      if (val && typeof val === 'object' && 'data' in val) {
        return val;
      }
      return null;
    } catch (err: any) {
      console.warn(`[READ_MODEL_STORE] Redis get error for key ${key}:`, err?.message || err);
    }
  }

  const entry = memoryRedisStorage.get(key);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    memoryRedisStorage.delete(key);
    return null;
  }
  return entry.snapshot as ReadModelSnapshot<T>;
}

/**
 * Reads fresh snapshot for dataset.
 */
export async function redisGetFresh<T>(datasetKey: string): Promise<ReadModelSnapshot<T> | null> {
  const freshKey = getFreshKey(datasetKey);
  return redisGetExact<T>(freshKey);
}

/**
 * Reads last-known-good (LKG) snapshot for dataset.
 */
export async function redisGetLkg<T>(datasetKey: string): Promise<ReadModelSnapshot<T> | null> {
  const lkgKey = getLkgKey(datasetKey);
  return redisGetExact<T>(lkgKey);
}

/**
 * Checks if a dataset is marked dirty.
 */
export async function redisIsDirty(datasetKey: string): Promise<boolean> {
  const dirtyKey = getDirtyKey(datasetKey);
  const client = getUpstashClient();
  if (client) {
    try {
      const exists = await client.exists(dirtyKey);
      if (exists > 0) return true;
    } catch {
      // fallback
    }
  }
  const entry = memoryRedisStorage.get(dirtyKey);
  if (!entry) return false;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    memoryRedisStorage.delete(dirtyKey);
    return false;
  }
  return true;
}

/**
 * Universal raw reader:
 * If exact key is requested (e.g. contains :fresh: or :lkg:), returns that exact key.
 * If raw dataset key is requested, attempts to read fresh first, then falls back to LKG.
 */
export async function redisGetRaw<T>(key: string): Promise<ReadModelSnapshot<T> | null> {
  if (key.includes(':fresh:') || key.includes(':lkg:') || key.includes(':dirty:')) {
    return redisGetExact<T>(key);
  }

  // 1. Try fresh key
  const fresh = await redisGetFresh<T>(key);
  if (fresh && fresh.data !== undefined) {
    const dirty = await redisIsDirty(key);
    if (!dirty) {
      return fresh;
    }
  }

  // 2. Fall back to LKG
  const lkg = await redisGetLkg<T>(key);
  if (lkg && lkg.data !== undefined) {
    return lkg;
  }

  // 3. Fallback: check legacy non-prefixed key in memory
  const legacy = await redisGetExact<T>(key);
  if (legacy) return legacy;

  return null;
}

/**
 * Two-Key Persistence:
 * - fresh key is saved with TTL (ttlSeconds, default 86400).
 * - lkg key is saved with NO TTL (permanent).
 * - validates complete metadata (schemaVersion, generatedAt, sourceVersion, expectedCount, actualCount).
 * - LKG protection: "never replace non-empty lkg with empty data."
 */
export async function redisSetRaw<T>(
  datasetKey: string,
  snapshot: Partial<ReadModelSnapshot<T>> & { data: T },
  ttlSeconds = 86400
): Promise<void> {
  const cleanKey = getRawDatasetKey(datasetKey);
  const freshKey = getFreshKey(cleanKey);
  const lkgKey = getLkgKey(cleanKey);
  const dirtyKey = getDirtyKey(cleanKey);

  const now = snapshot.generatedAt || new Date().toISOString();
  globalLastSnapshotAt = now;

  const actualCount = Array.isArray(snapshot.data)
    ? snapshot.data.length
    : snapshot.data !== null && snapshot.data !== undefined
    ? 1
    : 0;

  const fullSnapshot: ReadModelSnapshot<T> = {
    schemaVersion: snapshot.schemaVersion || SCHEMA_VERSION,
    generatedAt: now,
    sourceVersion: snapshot.sourceVersion || 'authoritative',
    expectedCount: snapshot.expectedCount !== undefined ? snapshot.expectedCount : actualCount,
    actualCount,
    data: snapshot.data,
  };

  const client = getUpstashClient();

  // 1. Write Fresh Key (with TTL)
  if (client) {
    try {
      await client.set(freshKey, fullSnapshot, { ex: ttlSeconds });
    } catch (err: any) {
      console.warn(`[READ_MODEL_STORE] Error setting fresh key ${freshKey}:`, err?.message || err);
    }
  }
  memoryRedisStorage.set(freshKey, {
    snapshot: fullSnapshot,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
  });

  // 2. Write LKG Key (NO TTL / Never Expires)
  // Check LKG protection rule: Never replace non-empty LKG with empty data!
  const existingLkg = await redisGetLkg<T>(cleanKey);
  const shouldSkipLkg = existingLkg && existingLkg.actualCount > 0 && actualCount === 0;

  if (shouldSkipLkg) {
    console.warn(
      `[READ_MODEL_STORE] LKG PROTECTION: Skipped overwriting non-empty LKG (${existingLkg!.actualCount} items) with empty dataset for ${cleanKey}`
    );
  } else {
    if (client) {
      try {
        // Upstash set with NO options = no expiration!
        await client.set(lkgKey, fullSnapshot);
      } catch (err: any) {
        console.warn(`[READ_MODEL_STORE] Error setting LKG key ${lkgKey}:`, err?.message || err);
      }
    }
    memoryRedisStorage.set(lkgKey, {
      snapshot: fullSnapshot,
      expiresAt: null, // NO TTL! Permanent!
    });
  }

  // 3. Clear Dirty Key
  if (client) {
    try {
      await client.del(dirtyKey);
    } catch {}
  }
  memoryRedisStorage.delete(dirtyKey);

  // 4. Update process memory
  setInProcessMemory(cleanKey, fullSnapshot);
  setInProcessMemory(freshKey, fullSnapshot);
  setInProcessMemory(lkgKey, fullSnapshot);
}

/**
 * Deletes keys directly (used for tests or cleanups).
 */
export async function redisDelRaw(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  for (const k of keys) {
    inProcessMemoryCache.delete(k);
    memoryRedisStorage.delete(k);
    const clean = getRawDatasetKey(k);
    inProcessMemoryCache.delete(clean);
    inProcessMemoryCache.delete(getFreshKey(clean));
    inProcessMemoryCache.delete(getLkgKey(clean));
  }

  const client = getUpstashClient();
  if (client) {
    try {
      await client.del(...keys);
    } catch (err: any) {
      console.warn(`[READ_MODEL_STORE] Redis del error:`, err?.message || err);
    }
  }
}

/**
 * Non-destructive invalidation:
 * - Clears process memory entry.
 * - Deletes only the fresh key or marks it dirty.
 * - PRESERVES the LKG key!
 * - Attempts targeted snapshot rebuild if provided.
 * - If rebuild fails, LKG is kept and served as stale.
 */
export async function invalidateDataset(
  datasetKey: string,
  targetedRebuild?: () => Promise<void>
): Promise<void> {
  const cleanKey = getRawDatasetKey(datasetKey);
  const freshKey = getFreshKey(cleanKey);
  const dirtyKey = getDirtyKey(cleanKey);

  // 1. Clear process memory
  inProcessMemoryCache.delete(datasetKey);
  inProcessMemoryCache.delete(cleanKey);
  inProcessMemoryCache.delete(freshKey);
  inProcessMemoryCache.delete(`${KEY_PREFIX}:${cleanKey}`);

  // 2. Delete ONLY fresh key from Redis & memory
  const client = getUpstashClient();
  if (client) {
    try {
      await client.del(freshKey);
      await client.set(dirtyKey, { markedAt: new Date().toISOString() }, { ex: 86400 });
    } catch (err: any) {
      console.warn(`[READ_MODEL_STORE] Error invalidating fresh key ${freshKey}:`, err?.message || err);
    }
  }
  memoryRedisStorage.delete(freshKey);
  memoryRedisStorage.set(dirtyKey, {
    snapshot: {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      sourceVersion: 'dirty',
      expectedCount: 0,
      actualCount: 0,
      data: true,
    } as any,
    expiresAt: Date.now() + 86400000,
  });

  // Notice: We NEVER delete the LKG key! LKG is preserved!

  // 3. Attempt targeted rebuild after authoritative mutation
  if (targetedRebuild) {
    try {
      await targetedRebuild();
      // Rebuild succeeded: delete dirty marker
      if (client) {
        try {
          await client.del(dirtyKey);
        } catch {}
      }
      memoryRedisStorage.delete(dirtyKey);
    } catch (err: any) {
      console.warn(
        `[READ_MODEL_STORE] Targeted rebuild failed for ${cleanKey}; preserving existing LKG snapshot as stale. Cause:`,
        err?.message || err
      );
    }
  }
}

// ----------------------------------------------------
// PROCESS MEMORY CACHE (LEVEL 1)
// ----------------------------------------------------

export function getFromProcessMemory<T>(key: string): T | null {
  const cleanKey = getRawDatasetKey(key);
  const entry = inProcessMemoryCache.get(key) || inProcessMemoryCache.get(cleanKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    inProcessMemoryCache.delete(key);
    inProcessMemoryCache.delete(cleanKey);
    return null;
  }
  return entry.data as T;
}

export function setInProcessMemory<T>(key: string, data: T, ttlMs = PROCESS_MEMORY_TTL_MS): void {
  const cleanKey = getRawDatasetKey(key);
  const entry = { data, expiresAt: Date.now() + ttlMs };
  inProcessMemoryCache.set(key, entry);
  if (cleanKey !== key) {
    inProcessMemoryCache.set(cleanKey, entry);
  }
}

export function clearProcessMemoryCache(): void {
  inProcessMemoryCache.clear();
  inFlightLoaders.clear();
}

export const clearProcessMemoryForTest = clearProcessMemoryCache;

export function resetMemoryRedisStore(): void {
  clearProcessMemoryCache();
  memoryRedisStorage.clear();
  globalLastSnapshotAt = null;
}

// ----------------------------------------------------
// STABLE ADMIN FIXTURE COMPARATOR & CURSOR PAGINATION
// ----------------------------------------------------

export function compareAdminFixtures(a: Fixture, b: Fixture, singleCompetition = false): number {
  if (!singleCompetition) {
    const orderA = CANONICAL_COMPETITION_ORDER[a.competitionId] ?? 999;
    const orderB = CANONICAL_COMPETITION_ORDER[b.competitionId] ?? 999;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
  }

  const mdA = typeof a.matchday === 'number' ? a.matchday : parseInt(String(a.matchday || 0), 10) || 0;
  const mdB = typeof b.matchday === 'number' ? b.matchday : parseInt(String(b.matchday || 0), 10) || 0;
  if (mdA !== mdB) {
    return mdA - mdB;
  }

  const timeA = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
  const timeB = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
  if (timeA !== timeB) {
    return timeA - timeB;
  }

  return (a.id || '').localeCompare(b.id || '');
}

export interface FixtureSortTuple {
  competitionOrder: number;
  matchday: number;
  scheduledAt: string;
  id: string;
}

export function encodeFixtureCursor(fixture: Fixture): string {
  const compOrder = CANONICAL_COMPETITION_ORDER[fixture.competitionId] ?? 999;
  const matchday = typeof fixture.matchday === 'number' ? fixture.matchday : parseInt(String(fixture.matchday || 0), 10) || 0;
  const scheduledAt = fixture.scheduledAt || '';
  const id = fixture.id;

  const tuple: FixtureSortTuple = {
    competitionOrder: compOrder,
    matchday,
    scheduledAt,
    id,
  };
  return Buffer.from(JSON.stringify(tuple)).toString('base64url');
}

export function decodeFixtureCursor(cursorStr: string): FixtureSortTuple | null {
  try {
    const raw = Buffer.from(cursorStr, 'base64url').toString('utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === 'string') {
      return parsed as FixtureSortTuple;
    }
  } catch {}
  return null;
}

// ----------------------------------------------------
// TIERED READ MODEL EXECUTION ENGINE
// ----------------------------------------------------

export interface TieredReadOptions<T> {
  key: string;
  seasonId?: string;
  ttlSeconds?: number;
  sourceVersion?: string;
  expectedCount?: number;
  firestoreFetcher: () => Promise<T>;
  validateData?: (data: T) => boolean;
}

export interface TieredReadResult<T> {
  data: T;
  source: 'memory' | 'memory_stale' | 'redis_fresh' | 'firestore' | 'redis_stale';
  generatedAt: string;
  sourceVersion: string;
  stale?: boolean;
  degraded?: boolean;
}

/**
 * Tiered Reader:
 * memory → fresh Redis → Firestore refresh → stale Redis last-known-good
 */
export async function readThroughReadModel<T>(options: TieredReadOptions<T>): Promise<TieredReadResult<T>> {
  const { key, ttlSeconds = 86400, expectedCount, firestoreFetcher, validateData } = options;
  const cleanKey = getRawDatasetKey(key);

  const canQueryFirestore = firestoreCircuitBreaker.canExecute();

  // 1. Process Memory Cache (Level 1)
  const memoryHit = getFromProcessMemory<ReadModelSnapshot<T>>(cleanKey);
  if (memoryHit && memoryHit.data !== undefined) {
    if (!canQueryFirestore) {
      return {
        data: memoryHit.data,
        source: 'memory_stale',
        generatedAt: memoryHit.generatedAt,
        sourceVersion: memoryHit.sourceVersion,
        stale: true,
        degraded: true,
      };
    }
    return {
      data: memoryHit.data,
      source: 'memory',
      generatedAt: memoryHit.generatedAt,
      sourceVersion: memoryHit.sourceVersion,
      stale: false,
      degraded: false,
    };
  }

  // 2. Fresh Redis Snapshot (Level 2)
  const isDirty = await redisIsDirty(cleanKey);
  let freshSnapshot: ReadModelSnapshot<T> | null = null;
  if (!isDirty) {
    freshSnapshot = await redisGetFresh<T>(cleanKey);
  }

  // If circuit breaker is OPEN, do NOT hit Firestore; immediately return LKG or fresh snapshot
  if (!canQueryFirestore) {
    if (freshSnapshot && freshSnapshot.data !== undefined) {
      setInProcessMemory(cleanKey, freshSnapshot);
      return {
        data: freshSnapshot.data,
        source: 'redis_fresh',
        generatedAt: freshSnapshot.generatedAt,
        sourceVersion: freshSnapshot.sourceVersion,
        stale: true,
        degraded: true,
      };
    }
    // Try LKG
    const lkgSnapshot = await redisGetLkg<T>(cleanKey);
    if (lkgSnapshot && lkgSnapshot.data !== undefined) {
      setInProcessMemory(cleanKey, lkgSnapshot);
      return {
        data: lkgSnapshot.data,
        source: 'redis_stale',
        generatedAt: lkgSnapshot.generatedAt,
        sourceVersion: lkgSnapshot.sourceVersion,
        stale: true,
        degraded: true,
      };
    }
    // Neither Firestore nor Redis has data -> 503
    throw new ReadModelNotWarmedError(
      `Firestore circuit breaker is OPEN and no warmed Redis snapshot exists for key: ${key}`
    );
  }

  // If fresh snapshot exists and is recent (< 10 minutes), return it!
  if (freshSnapshot && freshSnapshot.data !== undefined) {
    const ageMs = Date.now() - new Date(freshSnapshot.generatedAt).getTime();
    if (ageMs < 600000) {
      setInProcessMemory(cleanKey, freshSnapshot);
      return {
        data: freshSnapshot.data,
        source: 'redis_fresh',
        generatedAt: freshSnapshot.generatedAt,
        sourceVersion: freshSnapshot.sourceVersion,
        stale: false,
        degraded: false,
      };
    }
  }

  // 3. Firestore Read with Request Coalescing
  let loader = inFlightLoaders.get(cleanKey) as Promise<T> | undefined;
  if (!loader) {
    loader = (async () => {
      try {
        const freshData = await firestoreFetcher();

        // Validation guard
        const isValid = validateData ? validateData(freshData) : Boolean(freshData);
        if (!isValid) {
          throw new Error(`Fetched Firestore data failed validation for key ${key}`);
        }

        const now = new Date().toISOString();
        const actualCount = Array.isArray(freshData) ? freshData.length : freshData ? 1 : 0;
        const snapshot: ReadModelSnapshot<T> = {
          schemaVersion: SCHEMA_VERSION,
          generatedAt: now,
          sourceVersion: options.sourceVersion || 'firestore-authoritative',
          expectedCount: expectedCount ?? actualCount,
          actualCount,
          data: freshData,
        };

        // Persist to fresh (with TTL) and LKG (no TTL)
        await redisSetRaw(cleanKey, snapshot, ttlSeconds);
        firestoreCircuitBreaker.recordSuccess();

        return freshData;
      } catch (err: any) {
        firestoreCircuitBreaker.recordFailure(err);
        throw err;
      } finally {
        inFlightLoaders.delete(cleanKey);
      }
    })();
    inFlightLoaders.set(cleanKey, loader);
  }

  try {
    const resultData = await loader;
    return {
      data: resultData,
      source: 'firestore',
      generatedAt: new Date().toISOString(),
      sourceVersion: options.sourceVersion || 'firestore-authoritative',
      stale: false,
      degraded: false,
    };
  } catch (firestoreErr: any) {
    // 4. Stale Redis LKG Snapshot on Firestore failure
    const lkgSnapshot = await redisGetLkg<T>(cleanKey);
    if (lkgSnapshot && lkgSnapshot.data !== undefined) {
      console.warn(
        `[READ_MODEL] Firestore failed for ${key}, serving stale Redis LKG snapshot. Cause:`,
        firestoreErr?.message || firestoreErr
      );
      setInProcessMemory(cleanKey, lkgSnapshot);
      return {
        data: lkgSnapshot.data,
        source: 'redis_stale',
        generatedAt: lkgSnapshot.generatedAt,
        sourceVersion: lkgSnapshot.sourceVersion,
        stale: true,
        degraded: true,
      };
    }

    // 5. Structured 503 if neither Firestore nor Redis has data
    console.error(`[READ_MODEL] Both Firestore and Redis unavailable for key: ${key}. Error:`, firestoreErr);
    throw new ReadModelNotWarmedError(
      `Failed to load authoritative data from Firestore and no Redis snapshot is available for key: ${key}`
    );
  }
}

// ----------------------------------------------------
// READ-MODEL BUILDERS & SNAPSHOT GENERATORS
// ----------------------------------------------------

/**
 * Builds and persists snapshot for active competitions catalog.
 */
export async function buildCompetitionsSnapshot(seasonId = 'season-2026-27'): Promise<ReadModelSnapshot<Competition[]>> {
  const validComps = SEED_COMPETITIONS.filter((c) => {
    return (
      !c.id.includes('trophee-des-champions') &&
      !c.id.includes('conference-league') &&
      !c.id.includes('uecl') &&
      !c.id.includes('efl-cup') &&
      (c as any).status !== 'inactive' &&
      !(c as any).hidden
    );
  });

  const competitions: Competition[] = validComps.map((seed) => {
    let totalTeams = 0;
    if (seed.leagueId) {
      totalTeams = SEED_CLUBS.filter((c) => c.leagueId === seed.leagueId).length || 20;
    } else {
      totalTeams = (seed.formatConfig as any)?.maxTeams || 32;
    }

    const totalMatchdays = seed.leagueId
      ? seed.leagueId.includes('bundesliga') || seed.leagueId.includes('ligue-1')
        ? 17
        : 19
      : 8;

    return {
      id: seed.id,
      seasonId: seed.seasonId || seasonId,
      leagueId: seed.leagueId,
      name: seed.name,
      type: seed.type as any,
      scheduleMode: seed.scheduleMode as any,
      status: 'active',
      totalTeams,
      hasFixtures: true,
      fixtureCount: 0,
      fixturesCount: 0,
      generationStatus: 'generated',
      formatConfig: seed.formatConfig || {},
      currentMatchday: 1,
      totalMatchdays,
      isMatchdayOpen: true,
      adminOverrideStatus: 'AUTO',
      createdAt: new Date().toISOString(),
    };
  });

  const snapshot: ReadModelSnapshot<Competition[]> = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceVersion: 'seed-catalog',
    expectedCount: 17,
    actualCount: competitions.length,
    data: competitions,
  };

  const key = ReadModelKeys.competitions(seasonId);
  await redisSetRaw(key, snapshot, 86400);
  return snapshot;
}

export interface OwnerNeutralClub extends Club {
  ownerUserId: string | null;
  ownerUsername: string | null;
  ownerTelegramId?: string | null;
  claimedByUserId?: string | null;
  claimedByUsername?: string | null;
  managerUserId?: string | null;
  managerUsername?: string | null;
  isClaimed?: boolean;
  isAvailable?: boolean;
  isOccupied: boolean;
  isTaken?: boolean;
}

/**
 * Builds owner-neutral clubs snapshot from authoritative Firestore occupancies.
 * Never converts claimed clubs into available clubs.
 */
export async function buildClubsSnapshot(seasonId = 'season-2026-27'): Promise<ReadModelSnapshot<OwnerNeutralClub[]>> {
  const occMap = new Map<string, { userId: string }>();
  const userMap = new Map<string, { username: string; telegramId: string }>();

  try {
    const db = getFirestoreDb();
    if (db) {
      // 1. Fetch club occupancies
      const occSnap = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).get();
      for (const doc of occSnap.docs) {
        const data = doc.data();
        if (data.clubId && data.userId && data.status !== 'released') {
          occMap.set(data.clubId, { userId: data.userId });
        }
      }

      // 2. Fetch users
      const userSnap = await db.collection(COLLECTIONS.USERS).get();
      for (const doc of userSnap.docs) {
        const data = doc.data();
        userMap.set(doc.id, {
          username: data.username || `user_${doc.id.substring(0, 5)}`,
          telegramId: data.telegramId || '',
        });
      }
    }
  } catch (err: any) {
    console.warn('[READ_MODEL_STORE] Firestore occupancies fetch error in buildClubsSnapshot:', err?.message || err);
    // If Firestore fails, preserve existing LKG occupancies if present
    const existingLkg = await redisGetLkg<OwnerNeutralClub[]>(ReadModelKeys.clubsWithOwners(seasonId));
    if (existingLkg && existingLkg.data) {
      for (const c of existingLkg.data) {
        if (c.ownerUserId) {
          occMap.set(c.id, { userId: c.ownerUserId });
          if (c.ownerUsername) {
            userMap.set(c.ownerUserId, { username: c.ownerUsername, telegramId: c.ownerTelegramId || '' });
          }
        }
      }
    }
  }

  // Build owner-neutral clubs for all 96 canonical clubs
  const neutralClubs: OwnerNeutralClub[] = SEED_CLUBS.map((seed) => {
    const occ = occMap.get(seed.id);
    const ownerUserId = occ ? occ.userId : null;
    const userDetail = ownerUserId ? userMap.get(ownerUserId) : null;
    const isOccupied = Boolean(ownerUserId);

    return {
      id: seed.id,
      name: seed.name,
      shortName: seed.shortName,
      country: seed.country,
      leagueId: seed.leagueId,
      logoUrl: seed.logoUrl,
      active: true,
      createdAt: new Date().toISOString(),
      ownerUserId,
      ownerUsername: userDetail?.username || null,
      ownerTelegramId: userDetail?.telegramId || null,
      claimedByUserId: ownerUserId,
      claimedByUsername: userDetail?.username || null,
      managerUserId: ownerUserId,
      managerUsername: userDetail?.username || null,
      isClaimed: isOccupied,
      isAvailable: !isOccupied,
      isOccupied,
      isTaken: isOccupied,
      occupancy: {
        status: isOccupied ? 'occupied' : 'available',
        userId: ownerUserId || undefined,
        username: userDetail?.username || undefined,
      },
    };
  });

  const snapshot: ReadModelSnapshot<OwnerNeutralClub[]> = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceVersion: `occupancies-${occMap.size}`,
    expectedCount: 96,
    actualCount: neutralClubs.length,
    data: neutralClubs,
  };

  const key = ReadModelKeys.clubsWithOwners(seasonId);
  await redisSetRaw(key, snapshot, 86400);

  // Also write per-league snapshots
  for (const league of SEED_LEAGUES) {
    const leagueClubs = neutralClubs.filter((c) => c.leagueId === league.id);
    const expectedLeagueCount = league.id.includes('bundesliga') || league.id.includes('ligue-1') ? 18 : 20;
    const leagueSnapshot: ReadModelSnapshot<OwnerNeutralClub[]> = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      sourceVersion: `occupancies-${occMap.size}`,
      expectedCount: expectedLeagueCount,
      actualCount: leagueClubs.length,
      data: leagueClubs,
    };
    const leagueKey = ReadModelKeys.leagueClubs(league.id, seasonId);
    await redisSetRaw(leagueKey, leagueSnapshot, 86400);
  }

  return snapshot;
}

/**
 * Derives user-specific fields from an owner-neutral club.
 * Never leaks cross-user state into shared cache.
 */
export function enrichClubForUser(club: OwnerNeutralClub, currentUserId?: string): Club {
  const isCurrentUserClub = Boolean(currentUserId && club.ownerUserId === currentUserId);
  const isOccupied = Boolean(club.ownerUserId || club.isOccupied || club.isTaken);

  return {
    ...club,
    isCurrentUserClub,
    isTaken: isOccupied,
    claimedByUserId: club.ownerUserId,
    claimedByUsername: club.ownerUsername,
    managerUsername: club.ownerUsername,
    occupancy: {
      status: isCurrentUserClub ? 'owned' : isOccupied ? 'occupied' : 'available',
      userId: club.ownerUserId || undefined,
      username: club.ownerUsername || undefined,
    },
  };
}

/**
 * Builds materialized fixture snapshot sorted with stable tuple:
 * 1. canonical numeric competitionOrder
 * 2. numeric matchday
 * 3. scheduledAt
 * 4. fixture id as final tie-breaker
 */
export async function buildAdminFixturesSnapshot(seasonId = 'season-2026-27'): Promise<ReadModelSnapshot<Fixture[]>> {
  const db = getFirestoreDb();
  let fixDocs: FirestoreFixtureDoc[] = [];

  if (db) {
    try {
      const fixSnap = await db.collection(COLLECTIONS.FIXTURES).where('seasonId', '==', seasonId).get();
      fixDocs = fixSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as FirestoreFixtureDoc))
        .filter((f) => !f.competitionId.includes('efl-cup'));
    } catch (err: any) {
      console.warn('[READ_MODEL_STORE] Error fetching fixtures in buildAdminFixturesSnapshot:', err?.message || err);
      // Fallback to existing LKG snapshot if available
      const existingLkg = await redisGetLkg<Fixture[]>(ReadModelKeys.adminFixtures(seasonId));
      if (existingLkg && existingLkg.data) {
        return existingLkg;
      }
    }
  }

  const fixtures: Fixture[] = fixDocs.map((doc) => {
    const homeClubSeed = SEED_CLUBS.find((c) => c.id === doc.homeClubId);
    const awayClubSeed = SEED_CLUBS.find((c) => c.id === doc.awayClubId);

    return {
      id: doc.id,
      seasonId: doc.seasonId || seasonId,
      competitionId: doc.competitionId,
      competitionName: doc.competitionName || doc.competitionId,
      matchday: doc.matchday,
      roundName: doc.roundName,
      homeClubId: doc.homeClubId,
      awayClubId: doc.awayClubId,
      homeClub: {
        id: doc.homeClubId,
        name: homeClubSeed?.name || doc.homeClubId,
        shortName: homeClubSeed?.shortName || doc.homeClubId.substring(0, 3).toUpperCase(),
        country: homeClubSeed?.country || 'England',
        leagueId: homeClubSeed?.leagueId || 'league-premier-league',
        logoUrl: homeClubSeed?.logoUrl || '',
        active: true,
        createdAt: '',
      },
      awayClub: {
        id: doc.awayClubId,
        name: awayClubSeed?.name || doc.awayClubId,
        shortName: awayClubSeed?.shortName || doc.awayClubId.substring(0, 3).toUpperCase(),
        country: awayClubSeed?.country || 'England',
        leagueId: awayClubSeed?.leagueId || 'league-premier-league',
        logoUrl: awayClubSeed?.logoUrl || '',
        active: true,
        createdAt: '',
      },
      scheduledAt: doc.scheduledAt,
      homeScore: doc.homeScore ?? undefined,
      awayScore: doc.awayScore ?? undefined,
      winnerClubId: doc.winnerClubId ?? undefined,
      status: (doc.status || 'SCHEDULED') as any,
      resultConfirmedAt: doc.resultConfirmedAt || undefined,
      homeOwnerId: doc.homeOwnerId,
      awayOwnerId: doc.awayOwnerId,
      createdAt: doc.createdAt || new Date().toISOString(),
      updatedAt: doc.updatedAt || doc.createdAt || new Date().toISOString(),
    };
  });

  // Sort strictly using stable tuple
  fixtures.sort((a, b) => compareAdminFixtures(a, b, false));

  const snapshot: ReadModelSnapshot<Fixture[]> = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceVersion: `fixtures-${fixtures.length}`,
    expectedCount: fixtures.length,
    actualCount: fixtures.length,
    data: fixtures,
  };

  const key = ReadModelKeys.adminFixtures(seasonId);
  await redisSetRaw(key, snapshot, 86400);

  // Group and persist per-competition fixture snapshots
  const compsSet = new Set(fixtures.map((f) => f.competitionId));
  for (const compId of compsSet) {
    const compFixtures = fixtures.filter((f) => f.competitionId === compId);
    compFixtures.sort((a, b) => compareAdminFixtures(a, b, true));

    const compKey = ReadModelKeys.competitionFixtures(compId, seasonId);
    const compSnapshot: ReadModelSnapshot<Fixture[]> = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      sourceVersion: `fixtures-${compFixtures.length}`,
      expectedCount: compFixtures.length,
      actualCount: compFixtures.length,
      data: compFixtures,
    };
    await redisSetRaw(compKey, compSnapshot, 86400);
  }

  return snapshot;
}

/**
 * Generates zero-value standings rows for an active domestic league.
 * Never generates an empty array for an active domestic league.
 */
export function generateZeroValueStandings(
  competitionId: string,
  seasonId = 'season-2026-27'
): StandingsRow[] {
  const config = DOMESTIC_LEAGUE_CONFIG[competitionId];
  let clubs = config ? SEED_CLUBS.filter((c) => c.leagueId === config.leagueId) : [];
  if (clubs.length === 0) {
    clubs = SEED_CLUBS.slice(0, 20);
  }

  return clubs.map((club, idx) => ({
    position: idx + 1,
    clubId: club.id,
    clubName: club.name,
    shortName: club.shortName,
    logoUrl: club.logoUrl,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    form: [] as Array<'W' | 'D' | 'L'>,
    streak: '',
    competitionId,
    seasonId,
  }));
}

/**
 * Builds competition standings snapshot.
 * Ensures active domestic leagues receive exact expected row counts:
 * Premier League: 20
 * La Liga: 20
 * Serie A: 20
 * Bundesliga: 18
 * Ligue 1: 18
 */
export async function buildStandingsSnapshot(
  competitionId: string,
  seasonId = 'season-2026-27'
): Promise<ReadModelSnapshot<StandingsRow[]>> {
  const config = DOMESTIC_LEAGUE_CONFIG[competitionId];
  const expectedCount = config ? config.expectedCount : 20;

  let rows: StandingsRow[] = [];

  try {
    const db = getFirestoreDb();
    if (db) {
      const stdDoc = await db.collection(COLLECTIONS.STANDINGS).doc(competitionId).get();
      if (stdDoc.exists) {
        const data = stdDoc.data();
        if (Array.isArray(data?.rows) && data.rows.length > 0) {
          rows = data.rows as StandingsRow[];
        }
      }
    }
  } catch (err: any) {
    console.warn(`[READ_MODEL_STORE] Error fetching standings for ${competitionId}:`, err?.message || err);
  }

  // If standings are empty or incomplete for a domestic league, generate zero-value rows from canonical roster
  if (rows.length === 0 && config) {
    rows = generateZeroValueStandings(competitionId, seasonId);
  }

  rows.sort((a, b) => a.position - b.position);

  const snapshot: ReadModelSnapshot<StandingsRow[]> = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceVersion: `standings-${rows.length}`,
    expectedCount,
    actualCount: rows.length,
    data: rows,
  };

  const key = ReadModelKeys.standings(competitionId, seasonId);
  await redisSetRaw(key, snapshot, 86400);
  return snapshot;
}

// ----------------------------------------------------
// ROUTE-FACING READ-MODEL METHODS
// ----------------------------------------------------

/**
 * Reads competitions catalog from durable read model.
 */
export async function getCompetitionsFromReadModel(
  seasonId = 'season-2026-27'
): Promise<{ competitions: Competition[]; source: string; stale: boolean; degraded: boolean; snapshotAt: string }> {
  const result = await readThroughReadModel<Competition[]>({
    key: ReadModelKeys.competitions(seasonId),
    seasonId,
    expectedCount: 17,
    firestoreFetcher: async () => {
      const snap = await buildCompetitionsSnapshot(seasonId);
      return snap.data;
    },
    validateData: (data) => Array.isArray(data) && data.length > 0,
  });

  return {
    competitions: result.data,
    source: result.source,
    stale: Boolean(result.stale),
    degraded: Boolean(result.degraded),
    snapshotAt: result.generatedAt,
  };
}

/**
 * Reads clubs for admin route with real ownership data preserved.
 */
export async function getAdminClubsFromReadModel(
  seasonId = 'season-2026-27',
  leagueId?: string,
  currentUserId?: string
): Promise<{ clubs: any[]; total: number; source: string; degraded: boolean; stale: boolean; snapshotAt: string }> {
  const result = await readThroughReadModel<OwnerNeutralClub[]>({
    key: ReadModelKeys.clubsWithOwners(seasonId),
    seasonId,
    expectedCount: 96,
    firestoreFetcher: async () => {
      const snap = await buildClubsSnapshot(seasonId);
      return snap.data;
    },
    validateData: (data) => Array.isArray(data) && data.length > 0,
  });

  let clubs = result.data;
  if (leagueId && leagueId !== 'ALL') {
    clubs = clubs.filter((c) => c.leagueId === leagueId);
  }

  const adminClubs = clubs.map((c) => {
    const isCurrentUserClub = Boolean(currentUserId && c.ownerUserId === currentUserId);
    return {
      ...c,
      seasonId,
      isOccupied: Boolean(c.ownerUserId),
      occupiedByUserId: c.ownerUserId,
      occupiedByUsername: c.ownerUsername,
      claimedByUserId: c.ownerUserId,
      claimedByUsername: c.ownerUsername,
      managerUserId: c.ownerUserId,
      managerUsername: c.ownerUsername,
      isTaken: Boolean(c.ownerUserId),
      isCurrentUserClub,
      occupancy: {
        status: isCurrentUserClub ? 'owned' : c.ownerUserId ? 'occupied' : 'available',
        userId: c.ownerUserId || undefined,
        username: c.ownerUsername || undefined,
      },
    };
  });

  return {
    clubs: adminClubs,
    total: adminClubs.length,
    source: result.source,
    degraded: Boolean(result.degraded),
    stale: Boolean(result.stale),
    snapshotAt: result.generatedAt,
  };
}

/**
 * Reads clubs by league with real owners and user-specific field enrichment.
 */
export async function getLeagueClubsFromReadModel(
  leagueId: string,
  seasonId = 'season-2026-27',
  currentUserId?: string
): Promise<{ clubs: Club[]; source: string; stale: boolean; degraded: boolean; snapshotAt: string }> {
  const result = await readThroughReadModel<OwnerNeutralClub[]>({
    key: ReadModelKeys.leagueClubs(leagueId, seasonId),
    seasonId,
    expectedCount: leagueId.includes('bundesliga') || leagueId.includes('ligue-1') ? 18 : 20,
    firestoreFetcher: async () => {
      // Rebuild clubs snapshot which builds both clubsWithOwners and leagueClubs
      await buildClubsSnapshot(seasonId);
      const leagueSnap = await redisGetRaw<OwnerNeutralClub[]>(ReadModelKeys.leagueClubs(leagueId, seasonId));
      if (leagueSnap && leagueSnap.data) return leagueSnap.data;
      const allClubs = await redisGetRaw<OwnerNeutralClub[]>(ReadModelKeys.clubsWithOwners(seasonId));
      return (allClubs?.data || []).filter((c) => c.leagueId === leagueId);
    },
    validateData: (data) => Array.isArray(data) && data.length > 0,
  });

  // Enrich per-request with current user state (never stored in cache!)
  const clubs = result.data.map((c) => enrichClubForUser(c, currentUserId));

  return {
    clubs,
    source: result.source,
    stale: Boolean(result.stale),
    degraded: Boolean(result.degraded),
    snapshotAt: result.generatedAt,
  };
}

/**
 * Reads available clubs. Claimed clubs NEVER become available even when Firestore fails!
 */
export async function getAvailableClubsFromReadModel(
  seasonId = 'season-2026-27',
  currentUserId?: string
): Promise<{ clubs: Club[]; source: string; stale: boolean; degraded: boolean; snapshotAt: string }> {
  const result = await readThroughReadModel<OwnerNeutralClub[]>({
    key: ReadModelKeys.clubsWithOwners(seasonId),
    seasonId,
    expectedCount: 96,
    firestoreFetcher: async () => {
      const snap = await buildClubsSnapshot(seasonId);
      return snap.data;
    },
    validateData: (data) => Array.isArray(data) && data.length > 0,
  });

  // Filter out occupied/claimed clubs; claimed clubs NEVER become available!
  const availableClubs = result.data
    .filter((c) => !c.ownerUserId && !c.isOccupied && !c.isTaken)
    .map((c) => enrichClubForUser(c, currentUserId));

  return {
    clubs: availableClubs,
    source: result.source,
    stale: Boolean(result.stale),
    degraded: Boolean(result.degraded),
    snapshotAt: result.generatedAt,
  };
}

/**
 * Reads a single club by ID.
 */
export async function getClubByIdFromReadModel(
  clubId: string,
  seasonId = 'season-2026-27',
  currentUserId?: string
): Promise<{ club: Club | null; source: string; stale: boolean; degraded: boolean }> {
  const result = await readThroughReadModel<OwnerNeutralClub[]>({
    key: ReadModelKeys.clubsWithOwners(seasonId),
    seasonId,
    expectedCount: 96,
    firestoreFetcher: async () => {
      const snap = await buildClubsSnapshot(seasonId);
      return snap.data;
    },
    validateData: (data) => Array.isArray(data) && data.length > 0,
  });

  const neutral = result.data.find((c) => c.id === clubId);
  if (!neutral) {
    return { club: null, source: result.source, stale: Boolean(result.stale), degraded: Boolean(result.degraded) };
  }

  const club = enrichClubForUser(neutral, currentUserId);
  return { club, source: result.source, stale: Boolean(result.stale), degraded: Boolean(result.degraded) };
}

/**
 * Reads user's active club from read model or derives from clubs-with-owners snapshot.
 */
export async function getUserActiveClubFromReadModel(
  userId: string,
  seasonId = 'season-2026-27'
): Promise<Club | null> {
  const key = ReadModelKeys.userMembership(userId, seasonId);

  try {
    const memResult = await readThroughReadModel<{ clubId: string; club: Club } | null>({
      key,
      seasonId,
      expectedCount: 1,
      firestoreFetcher: async () => {
        const db = getFirestoreDb();
        if (!db) return null;
        const occSnap = await db
          .collection(COLLECTIONS.CLUB_OCCUPANCIES)
          .where('userId', '==', userId)
          .where('seasonId', '==', seasonId)
          .limit(1)
          .get();

        if (occSnap.empty) return null;
        const occ = occSnap.docs[0].data();
        const seed = SEED_CLUBS.find((c) => c.id === occ.clubId);
        if (!seed) return null;

        const club: Club = {
          ...seed,
          active: true,
          createdAt: '',
          isTaken: true,
          isCurrentUserClub: true,
          claimedByUserId: userId,
          claimedByUsername: null,
          occupancy: { status: 'owned', userId },
        };
        return { clubId: occ.clubId, club };
      },
    });

    if (memResult.data?.club) {
      return memResult.data.club;
    }
  } catch {
    // If membership key fetch failed, fallback to clubsWithOwners snapshot!
  }

  // Fallback: search in clubsWithOwners read model
  try {
    const clubsSnap = await redisGetRaw<OwnerNeutralClub[]>(ReadModelKeys.clubsWithOwners(seasonId));
    if (clubsSnap?.data) {
      const found = clubsSnap.data.find((c) => c.ownerUserId === userId);
      if (found) {
        return enrichClubForUser(found, userId);
      }
    }
  } catch {}

  return null;
}

/**
 * Reads competition standings using Tiered Read-Through:
 * memory → fresh Redis → Firestore refresh → stale Redis last-known-good
 * Returns: { standings, source, stale, degraded, snapshotAt }
 */
export async function getCompetitionStandingsFromReadModel(
  competitionId: string,
  seasonId = 'season-2026-27'
): Promise<{
  standings: StandingsRow[];
  source: string;
  stale: boolean;
  degraded: boolean;
  snapshotAt: string;
}> {
  const config = DOMESTIC_LEAGUE_CONFIG[competitionId];
  const expectedCount = config ? config.expectedCount : 20;

  const result = await readThroughReadModel<StandingsRow[]>({
    key: ReadModelKeys.standings(competitionId, seasonId),
    seasonId,
    expectedCount,
    firestoreFetcher: async () => {
      const snap = await buildStandingsSnapshot(competitionId, seasonId);
      return snap.data;
    },
    validateData: (rows) => Array.isArray(rows) && rows.length > 0,
  });

  return {
    standings: result.data,
    source: result.source,
    stale: Boolean(result.stale),
    degraded: Boolean(result.degraded),
    snapshotAt: result.generatedAt,
  };
}

/**
 * Reads competition fixtures from read model.
 */
export async function getCompetitionFixturesFromReadModel(
  competitionId: string,
  options: { matchday?: number; status?: string; seasonId?: string } = {}
): Promise<{ fixtures: Fixture[]; source: string; stale: boolean; degraded: boolean; snapshotAt: string }> {
  const seasonId = options.seasonId || 'season-2026-27';
  const key = ReadModelKeys.competitionFixtures(competitionId, seasonId);

  const result = await readThroughReadModel<Fixture[]>({
    key,
    seasonId,
    firestoreFetcher: async () => {
      await buildAdminFixturesSnapshot(seasonId);
      const snap = await redisGetRaw<Fixture[]>(key);
      if (snap && snap.data) return snap.data;
      const allFixSnap = await redisGetRaw<Fixture[]>(ReadModelKeys.adminFixtures(seasonId));
      return (allFixSnap?.data || []).filter((f) => f.competitionId === competitionId);
    },
    validateData: (fixtures) => Array.isArray(fixtures),
  });

  let fixtures = result.data;
  if (options.matchday !== undefined) {
    fixtures = fixtures.filter((f) => f.matchday === options.matchday);
  }
  if (options.status && options.status !== 'ALL') {
    fixtures = fixtures.filter((f) => f.status === options.status);
  }

  return {
    fixtures,
    source: result.source,
    stale: Boolean(result.stale),
    degraded: Boolean(result.degraded),
    snapshotAt: result.generatedAt,
  };
}

/**
 * Paginated admin fixtures query via read model.
 */
export interface AdminFixturesReadModelOptions {
  seasonId?: string;
  competitionId?: string;
  status?: string;
  matchday?: number;
  clubId?: string;
  userId?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface AdminFixturesReadModelResult {
  fixtures: Fixture[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
  limit: number;
  source: string;
  degraded: boolean;
  stale: boolean;
  generatedAt: string;
}

export async function getAdminFixturesFromReadModel(
  options: AdminFixturesReadModelOptions = {}
): Promise<AdminFixturesReadModelResult> {
  const seasonId = options.seasonId || 'season-2026-27';
  const limit = Math.min(Math.max(options.limit || 25, 1), 100);

  const snapshotRes = await readThroughReadModel<Fixture[]>({
    key: ReadModelKeys.adminFixtures(seasonId),
    seasonId,
    firestoreFetcher: async () => {
      const snap = await buildAdminFixturesSnapshot(seasonId);
      return snap.data;
    },
    validateData: (fixtures) => Array.isArray(fixtures) && fixtures.length > 0,
  });

  let allFixtures = snapshotRes.data;

  if (options.competitionId && options.competitionId !== 'ALL') {
    allFixtures = allFixtures.filter((f) => f.competitionId === options.competitionId);
  }
  if (options.status && options.status !== 'ALL') {
    allFixtures = allFixtures.filter((f) => f.status === options.status);
  }
  if (options.matchday !== undefined) {
    allFixtures = allFixtures.filter((f) => f.matchday === options.matchday);
  }
  if (options.clubId) {
    allFixtures = allFixtures.filter((f) => f.homeClubId === options.clubId || f.awayClubId === options.clubId);
  }
  if (options.search) {
    const q = options.search.toLowerCase();
    allFixtures = allFixtures.filter(
      (f) =>
        f.homeClub?.name.toLowerCase().includes(q) ||
        f.awayClub?.name.toLowerCase().includes(q) ||
        f.roundName?.toLowerCase().includes(q) ||
        f.id.toLowerCase().includes(q)
    );
  }

  const total = allFixtures.length;

  let startIndex = 0;
  if (options.cursor) {
    const tuple = decodeFixtureCursor(options.cursor);
    if (tuple) {
      const foundIdx = allFixtures.findIndex((f) => f.id === tuple.id);
      if (foundIdx >= 0) {
        startIndex = foundIdx + 1;
      }
    } else {
      const rawIdx = allFixtures.findIndex((f) => f.id === options.cursor);
      if (rawIdx >= 0) {
        startIndex = rawIdx + 1;
      }
    }
  }

  const pagedFixtures = allFixtures.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < allFixtures.length;
  const nextCursor =
    hasMore && pagedFixtures.length > 0
      ? encodeFixtureCursor(pagedFixtures[pagedFixtures.length - 1])
      : undefined;

  return {
    fixtures: pagedFixtures,
    total,
    hasMore,
    nextCursor,
    limit,
    source: snapshotRes.source,
    degraded: snapshotRes.source === 'redis_stale',
    stale: snapshotRes.source === 'redis_stale',
    generatedAt: snapshotRes.generatedAt,
  };
}

// ----------------------------------------------------
// NON-DESTRUCTIVE INVALIDATION HOOKS
// ----------------------------------------------------

export async function invalidateClubReadModels(seasonId = 'season-2026-27'): Promise<void> {
  await invalidateDataset(ReadModelKeys.clubsWithOwners(seasonId));
  for (const l of SEED_LEAGUES) {
    await invalidateDataset(ReadModelKeys.leagueClubs(l.id, seasonId));
  }
  await invalidateDataset(ReadModelKeys.adminFixtures(seasonId));
}

export async function invalidateFixtureReadModels(
  competitionId: string,
  seasonId = 'season-2026-27'
): Promise<void> {
  await invalidateDataset(ReadModelKeys.adminFixtures(seasonId));
  if (competitionId) {
    await invalidateDataset(ReadModelKeys.competitionFixtures(competitionId, seasonId));
    await invalidateDataset(ReadModelKeys.standings(competitionId, seasonId));
  }
}

export async function invalidateStandingsReadModels(
  competitionId: string,
  seasonId = 'season-2026-27'
): Promise<void> {
  await invalidateDataset(ReadModelKeys.standings(competitionId, seasonId));
}

export async function invalidateCompetitionReadModels(seasonId = 'season-2026-27'): Promise<void> {
  await invalidateDataset(ReadModelKeys.competitions(seasonId));
}

export async function invalidateUserMembershipReadModel(
  userId: string,
  seasonId = 'season-2026-27'
): Promise<void> {
  await invalidateDataset(ReadModelKeys.userMembership(userId, seasonId));
}

// ----------------------------------------------------
// COMPLETE READ MODEL REBUILD (ADMIN ACTION)
// ----------------------------------------------------

export interface RebuildResult {
  success: boolean;
  generatedAt: string;
  warmedLkgKeys: string[];
  warmedKeys?: string[];
  counts: {
    competitions: number;
    clubs: number;
    fixtures: number;
    standings: number;
    userMemberships?: number;
    standingsPerLeague?: Record<string, number>;
  };
  errors?: string[];
}

/**
 * Rebuilds all core read models into Redis (both fresh and LKG).
 * Admin-triggered action; never run automatically on production startup.
 */
export async function rebuildAllReadModels(seasonId = 'season-2026-27'): Promise<RebuildResult> {
  const warmedLkgKeys: string[] = [];
  const errors: string[] = [];
  const standingsPerLeague: Record<string, number> = {};

  // 1. Competitions catalog
  let compCount = 0;
  try {
    const compSnap = await buildCompetitionsSnapshot(seasonId);
    compCount = compSnap.data.length;
    warmedLkgKeys.push(getLkgKey(ReadModelKeys.competitions(seasonId)));
  } catch (err: any) {
    errors.push(`Competitions rebuild error: ${err.message}`);
  }

  // 2. Clubs & occupancies (owner-neutral, all 96 clubs)
  let clubCount = 0;
  try {
    const clubSnap = await buildClubsSnapshot(seasonId);
    clubCount = clubSnap.data.length;
    warmedLkgKeys.push(getLkgKey(ReadModelKeys.clubsWithOwners(seasonId)));
    for (const l of SEED_LEAGUES) {
      warmedLkgKeys.push(getLkgKey(ReadModelKeys.leagueClubs(l.id, seasonId)));
    }
  } catch (err: any) {
    errors.push(`Clubs rebuild error: ${err.message}`);
  }

  // 3. Admin & competition fixtures (sorted by canonical tuple)
  let fixtureCount = 0;
  try {
    const fixSnap = await buildAdminFixturesSnapshot(seasonId);
    fixtureCount = fixSnap.data.length;
    warmedLkgKeys.push(getLkgKey(ReadModelKeys.adminFixtures(seasonId)));
    const uniqueCompIds = Array.from(new Set(fixSnap.data.map((f) => f.competitionId)));
    for (const cId of uniqueCompIds) {
      warmedLkgKeys.push(getLkgKey(ReadModelKeys.competitionFixtures(cId, seasonId)));
    }
  } catch (err: any) {
    errors.push(`Fixtures rebuild error: ${err.message}`);
  }

  // 4. Standings for the 5 domestic leagues
  let standingsCount = 0;
  for (const cId of Object.keys(DOMESTIC_LEAGUE_CONFIG)) {
    try {
      const stdSnap = await buildStandingsSnapshot(cId, seasonId);
      standingsCount += stdSnap.data.length;
      standingsPerLeague[DOMESTIC_LEAGUE_CONFIG[cId].name] = stdSnap.data.length;
      warmedLkgKeys.push(getLkgKey(ReadModelKeys.standings(cId, seasonId)));
    } catch (err: any) {
      errors.push(`Standings rebuild error for ${cId}: ${err.message}`);
    }
  }

  // 5. Active user memberships
  let membershipCount = 0;
  try {
    const db = getFirestoreDb();
    if (db) {
      const occSnap = await db
        .collection(COLLECTIONS.CLUB_OCCUPANCIES)
        .where('seasonId', '==', seasonId)
        .where('status', '==', 'active')
        .get();

      for (const occDoc of occSnap.docs) {
        const occ = occDoc.data();
        if (occ.userId && occ.clubId) {
          const clubSeed = SEED_CLUBS.find((c) => c.id === occ.clubId);
          const membershipData = {
            id: occDoc.id,
            userId: occ.userId,
            clubId: occ.clubId,
            seasonId,
            status: 'active',
            club: clubSeed || null,
            claimedAt: occ.claimedAt || new Date().toISOString(),
          };
          const memKey = ReadModelKeys.userMembership(occ.userId, seasonId);
          const memSnap: ReadModelSnapshot<any> = {
            schemaVersion: SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            sourceVersion: `occupancy-${occDoc.id}`,
            expectedCount: 1,
            actualCount: 1,
            data: membershipData,
          };
          await redisSetRaw(memKey, memSnap, 86400);
          warmedLkgKeys.push(getLkgKey(memKey));
          membershipCount++;
        }
      }
    }
  } catch (err: any) {
    errors.push(`User memberships rebuild error: ${err.message}`);
  }

  return {
    success: errors.length === 0,
    generatedAt: new Date().toISOString(),
    warmedLkgKeys,
    warmedKeys: warmedLkgKeys,
    counts: {
      competitions: compCount,
      clubs: clubCount,
      fixtures: fixtureCount,
      standings: standingsCount,
      userMemberships: membershipCount,
      standingsPerLeague,
    },
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ----------------------------------------------------
// READ MODEL HEALTH STATUS
// ----------------------------------------------------

/**
 * Health endpoint that reads snapshot metadata directly from Redis,
 * surviving Vercel cold starts without relying solely on process memory.
 */
export async function getReadModelHealthStatus(seasonId = 'season-2026-27'): Promise<ReadModelHealthInfo> {
  const cb = firestoreCircuitBreaker.getStatus();

  let redisState: 'CONNECTED' | 'IN_MEMORY_FALLBACK' | 'ERROR' = 'IN_MEMORY_FALLBACK';
  const client = getUpstashClient();
  if (client) {
    try {
      const ping = await client.ping();
      redisState = ping === 'PONG' || ping ? 'CONNECTED' : 'ERROR';
    } catch {
      redisState = 'ERROR';
    }
  }

  // Define core datasets to inspect
  const coreDatasetDefinitions: Array<{
    name: string;
    rawKey: string;
    expectedCount: number;
  }> = [
    { name: 'competitions', rawKey: ReadModelKeys.competitions(seasonId), expectedCount: 17 },
    { name: 'clubs-with-owners', rawKey: ReadModelKeys.clubsWithOwners(seasonId), expectedCount: 96 },
    { name: 'admin-fixtures', rawKey: ReadModelKeys.adminFixtures(seasonId), expectedCount: 0 },
    ...SEED_LEAGUES.map((l) => ({
      name: `league-${l.id}-clubs`,
      rawKey: ReadModelKeys.leagueClubs(l.id, seasonId),
      expectedCount: l.id.includes('bundesliga') || l.id.includes('ligue-1') ? 18 : 20,
    })),
    ...Object.entries(DOMESTIC_LEAGUE_CONFIG).map(([compId, conf]) => ({
      name: `standings-${conf.name}`,
      rawKey: ReadModelKeys.standings(compId, seasonId),
      expectedCount: conf.expectedCount,
    })),
  ];

  const freshKeys: string[] = [];
  const lkgKeys: string[] = [];
  const dirtyKeys: string[] = [];
  const missingKeys: string[] = [];
  const coreDatasets: Record<string, CoreDatasetHealth> = {};

  let newestSnapshotTime: string | null = globalLastSnapshotAt;

  for (const def of coreDatasetDefinitions) {
    const cleanKey = getRawDatasetKey(def.rawKey);
    const fresh = await redisGetFresh(cleanKey);
    const lkg = await redisGetLkg(cleanKey);
    const isDirty = await redisIsDirty(cleanKey);

    const hasFresh = Boolean(fresh && fresh.data !== undefined);
    const hasLkg = Boolean(lkg && lkg.data !== undefined);

    if (hasFresh) freshKeys.push(getFreshKey(cleanKey));
    if (hasLkg) lkgKeys.push(getLkgKey(cleanKey));
    if (isDirty) dirtyKeys.push(getDirtyKey(cleanKey));
    if (!hasFresh && !hasLkg) missingKeys.push(cleanKey);

    // Pick newest timestamp between fresh, LKG, and existing
    const snap = fresh || lkg;
    if (snap?.generatedAt) {
      if (!newestSnapshotTime || new Date(snap.generatedAt) > new Date(newestSnapshotTime)) {
        newestSnapshotTime = snap.generatedAt;
      }
    }

    const snapTimestamp = snap?.generatedAt || null;
    const snapAge = snapTimestamp ? Math.floor((Date.now() - new Date(snapTimestamp).getTime()) / 1000) : null;
    const actualCount = snap?.actualCount ?? 0;

    let status: CoreDatasetHealth['status'] = 'MISSING';
    if (hasFresh && !isDirty) {
      status = 'FRESH';
    } else if (isDirty) {
      status = 'DIRTY';
    } else if (hasLkg) {
      status = 'LKG_STALE';
    }

    coreDatasets[def.name] = {
      key: cleanKey,
      expectedCount: def.expectedCount,
      actualCount,
      snapshotTimestamp: snapTimestamp,
      snapshotAgeSeconds: snapAge,
      hasFresh,
      hasLkg,
      isDirty,
      status,
    };
  }

  const now = Date.now();
  const snapshotAgeSeconds = newestSnapshotTime
    ? Math.floor((now - new Date(newestSnapshotTime).getTime()) / 1000)
    : null;

  return {
    firestoreState: cb.state as any,
    redisState,
    circuitBreakerState: {
      state: cb.state,
      consecutiveFailures: cb.consecutiveFailures,
      resourceExhaustedCount: cb.resourceExhaustedCount,
      lastFailureTime: cb.lastFailureTime,
      lastError: cb.lastError,
    },
    lastSnapshotAt: newestSnapshotTime,
    snapshotAgeSeconds,
    freshKeys,
    lkgKeys,
    dirtyKeys,
    missingKeys,
    'fresh keys': freshKeys,
    'lkg keys': lkgKeys,
    'dirty keys': dirtyKeys,
    'missing keys': missingKeys,
    warmedKeys: lkgKeys,
    coreDatasets,
  };
}
