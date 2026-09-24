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
import { resolveRedisConfig } from './redisConfig';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS, FirestoreFixtureDoc, FirestoreCompetitionDoc } from '../firebase/collections';
import { queryAll, queryGet } from '../db';
import { trackFirestoreRead } from '../firebase/firestoreStore';
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
  source?: string;
  stale?: boolean;
  degraded?: boolean;
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
  fixtures: (competitionId: string, seasonId = 'season-2026-27') => `${KEY_PREFIX}:season:${seasonId}:competition:${competitionId}:fixtures`,
  adminFixtures: (seasonId = 'season-2026-27') => `${KEY_PREFIX}:season:${seasonId}:admin:fixtures`,
  userMembership: (userId: string, seasonId = 'season-2026-27') => `${KEY_PREFIX}:season:${seasonId}:user:${userId}:membership`,
};

// ----------------------------------------------------
// REDIS CLIENT & IN-MEMORY STORAGE
// ----------------------------------------------------

let upstashClient: Redis | null = null;
let isUpstashConfigured = false;
let reportedRedisConfig = false;

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

export function getUpstashClient(): Redis | null {
  if (upstashClient) return upstashClient;
  const config = resolveRedisConfig(process.env);
  if (!reportedRedisConfig) {
    reportedRedisConfig = true;
    console.info('[READ_MODEL_REDIS_CONFIG]', config
      ? `CONFIGURED: ${config.urlName} / ${config.tokenName}`
      : 'MISSING_OR_AMBIGUOUS: no single complete Redis REST credential pair');
  }
  if (config) {
    try {
      upstashClient = new Redis({ url: config.url, token: config.token });
      isUpstashConfigured = true;
      return upstashClient;
    } catch {
      console.warn('[READ_MODEL_STORE] Redis client configuration is invalid.');
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

  // Publish fresh + permanent snapshot atomically; do not claim durability on a failed write.
  if (client) {
    const accepted = await client.eval(`
      local old = redis.call('GET', KEYS[2])
      if old then
        local ok, previous = pcall(cjson.decode, old)
        if ok and tonumber(previous.actualCount or 0) > 0 and tonumber(ARGV[3]) == 0 then return 0 end
        if ok and previous.generatedAt and previous.generatedAt > ARGV[4] then return 0 end
      end
      redis.call('SET', KEYS[2], ARGV[1])
      redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
      redis.call('DEL', KEYS[3])
      return 1
    `, [freshKey, lkgKey, dirtyKey], [JSON.stringify(fullSnapshot), Math.max(1, ttlSeconds), actualCount, now]);
    if (Number(accepted) !== 1) throw new Error(`SNAPSHOT_REJECTED: ${cleanKey}`);
  } else {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.K_SERVICE) throw new Error('REDIS_REQUIRED_FOR_DURABLE_SNAPSHOT');
    const previous = await redisGetLkg<T>(cleanKey);
    if (previous && (previous.actualCount > 0 && actualCount === 0 || previous.generatedAt > now)) throw new Error(`SNAPSHOT_REJECTED: ${cleanKey}`);
  }
  memoryRedisStorage.set(freshKey, { snapshot: fullSnapshot, expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000 });
  memoryRedisStorage.set(lkgKey, { snapshot: fullSnapshot, expiresAt: null });
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
  const isDirty = await redisIsDirty(cleanKey);

  // 1. Process Memory Cache (Level 1)
  const memoryHit = getFromProcessMemory<ReadModelSnapshot<T>>(cleanKey);
  if (!isDirty && memoryHit && memoryHit.data !== undefined && Date.now() - Date.parse(memoryHit.generatedAt) < ttlSeconds * 1000) {
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
    if (ageMs < ttlSeconds * 1000) {
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
  const db = getFirestoreDb();
  if (!db) throw new ReadModelNotWarmedError('Firestore unavailable for competition refresh');
  const docs = await db.collection(COLLECTIONS.COMPETITIONS).where('seasonId', '==', seasonId).get();
  const competitions = docs.docs.map(d => {
    const data = d.data();
    const seed = SEED_COMPETITIONS.find(c => c.id === d.id);
    const competition = { ...seed, ...data, id: d.id, seasonId } as Competition;
    if (competition.type === 'EUROPEAN_LEAGUE_PHASE') {
      const teams = Number(competition.formatConfig?.leaguePhaseTeams || 32);
      const matchesPerTeam = Number(competition.formatConfig?.matchesPerTeam || 8);
      if (Number(competition.currentMatchday || 1) <= matchesPerTeam) {
        const leaguePhaseFixtureCount = (teams * matchesPerTeam) / 2;
        competition.fixtureCount = leaguePhaseFixtureCount;
        competition.fixturesCount = leaguePhaseFixtureCount;
      }
    }
    return competition;
  }).filter(c => !c.id.includes('efl-cup') && String(c.status) !== 'inactive' && !(c as any).hidden);
  if (!competitions.length) throw new ReadModelNotWarmedError('No authoritative competition catalog');
  const snapshot: ReadModelSnapshot<Competition[]> = {
    schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(),
    sourceVersion: 'firestore-catalog', expectedCount: competitions.length,
    actualCount: competitions.length, data: competitions,
  };
  await redisSetRaw(ReadModelKeys.competitions(seasonId), snapshot, 3600);
  return snapshot;
}

export interface OwnerNeutralClub extends Club {
  ownerUserId: string | null;
  ownerUsername: string | null;
  claimedByUserId?: string | null;
  claimedByUsername?: string | null;
  managerUserId?: string | null;
  managerUsername?: string | null;
  isClaimed?: boolean;
  isAvailable?: boolean;
  isOccupied: boolean;
  isTaken?: boolean;
}

export interface UserMembershipSentinel {
  hasClub: boolean;
  clubId: string | null;
  club: Club | null;
}

/**
 * Builds owner-neutral clubs snapshot from authoritative Firestore occupancies.
 * Never converts claimed clubs into available clubs.
 * If Firestore fails and no LKG exists, throws READ_MODEL_NOT_WARMED.
 */
export async function buildClubsSnapshot(seasonId = 'season-2026-27'): Promise<ReadModelSnapshot<OwnerNeutralClub[]>> {
  const occMap = new Map<string, { userId: string }>();
  const userMap = new Map<string, { username: string }>();
  const existingLkg = await redisGetLkg<OwnerNeutralClub[]>(ReadModelKeys.clubsWithOwners(seasonId));

  let firestoreFailed = false;
  let occupancyDocumentsSeen = 0;
  try {
    const db = getFirestoreDb();
    if (db) {
      // 1. Fetch club occupancies bounded by seasonId and active status (avoid unbounded collection scan)
      const occSnap = await db
        .collection(COLLECTIONS.CLUB_OCCUPANCIES)
        .where('seasonId', '==', seasonId)
        .get();
      occupancyDocumentsSeen = occSnap.size;

      for (const doc of occSnap.docs) {
        const data = doc.data();
        if (data.clubId && data.userId && !['released', 'inactive'].includes(data.status)) {
          occMap.set(data.clubId, { userId: data.userId });
        }
      }

      // 2. Fetch only the users who own clubs (avoids full USERS collection scan)
      const ownerUserIds = Array.from(new Set(Array.from(occMap.values()).map((o) => o.userId)));
      await Promise.all(
        ownerUserIds.map(async (uid) => {
          try {
            const uDoc = await db.collection(COLLECTIONS.USERS).doc(uid).get();
            if (uDoc.exists) {
              const uData = uDoc.data();
              userMap.set(uid, {
                username: uData?.username || `user_${uid.substring(0, 5)}`,
              });
            }
          } catch {
            const previous = existingLkg?.data.find(c => c.ownerUserId === uid);
            if (previous?.ownerUsername) userMap.set(uid, { username: previous.ownerUsername });
          }
        })
      );
    }
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    firestoreFailed = true;
    console.warn('[READ_MODEL_STORE] Firestore occupancies fetch error in buildClubsSnapshot:', err?.message || err);
  }

  if (firestoreFailed) {
    // If Firestore fails, NEVER create an all-available snapshot! Serve LKG if populated, otherwise throw READ_MODEL_NOT_WARMED
    if (existingLkg && Array.isArray(existingLkg.data) && existingLkg.data.length > 0) {
      throw new ReadModelNotWarmedError('Authoritative refresh unavailable; preserve last-known-good snapshot');
    }
    throw new ReadModelNotWarmedError(
      'READ_MODEL_NOT_WARMED: Firestore club/occupancy read failed and no populated clubs-with-owners LKG exists.'
    );
  }

  // If Firestore succeeded but occupancies are 0 while existing LKG had occupancies, protect LKG against transient wipe
  if (occMap.size === 0 && occupancyDocumentsSeen === 0 && existingLkg && Array.isArray(existingLkg.data) && existingLkg.data.some((c) => c.isOccupied)) {
    console.warn('[READ_MODEL_STORE] Firestore returned 0 occupancies while LKG had active owners; preserving LKG snapshot.');
    throw new ReadModelNotWarmedError('Authoritative refresh unavailable; preserve last-known-good snapshot');
  }

  // Build owner-neutral clubs for all 96 canonical clubs (strictly omitting private telegram IDs)
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
export function enrichClubForUser(club: OwnerNeutralClub, currentUserId?: string): Club & Pick<OwnerNeutralClub, 'ownerUserId' | 'ownerUsername' | 'isOccupied'> {
  const isCurrentUserClub = Boolean(currentUserId && club.ownerUserId === currentUserId);
  const isOccupied = Boolean(club.ownerUserId || club.isOccupied || club.isTaken);

  return {
    id: club.id, name: club.name, shortName: club.shortName, country: club.country,
    leagueId: club.leagueId, leagueName: club.leagueName, logoUrl: club.logoUrl,
    active: club.active, stadium: club.stadium, createdAt: club.createdAt,
    ownerUserId: club.ownerUserId, ownerUsername: club.ownerUsername, isOccupied,
    owner: club.owner ? { userId: club.owner.userId, username: club.owner.username,
      firstName: club.owner.firstName, claimedAt: club.owner.claimedAt } : undefined,
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
export function normalizeFixtureSnapshot(doc: any, seasonId = 'season-2026-27'): Fixture {
    const homeClubId = doc.homeClubId ?? doc.home_club_id;
    const awayClubId = doc.awayClubId ?? doc.away_club_id;
    const competitionId = doc.competitionId ?? doc.competition_id;
    const competitionName = doc.competitionName ?? doc.competition_name;
    const scheduledAt = doc.scheduledAt ?? doc.scheduled_at;
    const homeScore = doc.homeScore ?? doc.home_score;
    const awayScore = doc.awayScore ?? doc.away_score;
    const winnerClubId = doc.winnerClubId ?? doc.winner_club_id;
    const resultConfirmedAt = doc.resultConfirmedAt ?? doc.result_confirmed_at;
    const roundName = doc.roundName ?? doc.round_name;
    const createdAt = doc.createdAt ?? doc.created_at;
    const updatedAt = doc.updatedAt ?? doc.updated_at;
    const docSeasonId = doc.seasonId ?? doc.season_id;

    const homeClubSeed = SEED_CLUBS.find((c) => c.id === homeClubId);
    const awayClubSeed = SEED_CLUBS.find((c) => c.id === awayClubId);

    return {
      id: doc.id,
      seasonId: docSeasonId || seasonId,
      competitionId: competitionId,
      competitionName: competitionName || competitionId,
      matchday: doc.matchday,
      roundName: roundName,
      homeClubId: homeClubId && homeClubId !== 'TBD' ? homeClubId : null,
      awayClubId: awayClubId && awayClubId !== 'TBD' ? awayClubId : null,
      homeClub: homeClubId && homeClubId !== 'TBD' ? {
        id: homeClubId,
        name: homeClubSeed?.name || homeClubId,
        shortName: homeClubSeed?.shortName || homeClubId.substring(0, 3).toUpperCase(),
        country: homeClubSeed?.country || 'England',
        leagueId: homeClubSeed?.leagueId || 'league-premier-league',
        logoUrl: homeClubSeed?.logoUrl || '',
        active: true,
        createdAt: '',
      } : undefined,
      awayClub: awayClubId && awayClubId !== 'TBD' ? {
        id: awayClubId,
        name: awayClubSeed?.name || awayClubId,
        shortName: awayClubSeed?.shortName || awayClubId.substring(0, 3).toUpperCase(),
        country: awayClubSeed?.country || 'England',
        leagueId: awayClubSeed?.leagueId || 'league-premier-league',
        logoUrl: awayClubSeed?.logoUrl || '',
        active: true,
        createdAt: '',
      } : undefined,
      scheduledAt: scheduledAt,
      homeScore: homeScore ?? undefined,
      awayScore: awayScore ?? undefined,
      winnerClubId: winnerClubId ?? undefined,
      status: (doc.status || 'SCHEDULED') as any,
      resultConfirmedAt: resultConfirmedAt || undefined,
      homeOwnerId: doc.homeOwnerId ?? doc.home_owner_id,
      awayOwnerId: doc.awayOwnerId ?? doc.away_owner_id,
      createdAt: createdAt || new Date().toISOString(),
      updatedAt: updatedAt || createdAt || new Date().toISOString(),
    };
}

export async function buildAdminFixturesSnapshot(seasonId = 'season-2026-27'): Promise<ReadModelSnapshot<Fixture[]>> {
  const db = getFirestoreDb();
  let fixDocs: FirestoreFixtureDoc[] = [];

  if (db) {
    try {
      const fixSnap = await db.collection(COLLECTIONS.FIXTURES).where('seasonId', '==', seasonId).get();
      trackFirestoreRead(COLLECTIONS.FIXTURES, fixSnap.docs.length, 'buildAdminFixturesSnapshot');
      fixDocs = fixSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as FirestoreFixtureDoc))
        .filter((f) => !f.competitionId.includes('efl-cup'));
    } catch (err: any) {
      firestoreCircuitBreaker.recordFailure(err);
      console.warn('[READ_MODEL_STORE] Error fetching fixtures in buildAdminFixturesSnapshot:', err?.message || err);
      // Fallback to existing LKG snapshot if available
      const existingLkg = await redisGetLkg<Fixture[]>(ReadModelKeys.adminFixtures(seasonId));
      if (existingLkg && existingLkg.data) {
        throw new ReadModelNotWarmedError('Authoritative refresh unavailable; preserve last-known-good snapshot');
      }
      throw new ReadModelNotWarmedError('Authoritative fixture read failed and no snapshot exists');
    }
  } else throw new ReadModelNotWarmedError('Firestore unavailable for fixture refresh');

  let fixtures: Fixture[] = fixDocs.map(doc => normalizeFixtureSnapshot(doc, seasonId));

  try {
    const { enrichFixturesWithAuthoritativeOwners } = await import('../firebase/firestoreStore');
    fixtures = await enrichFixturesWithAuthoritativeOwners(fixtures, seasonId);
  } catch (enrichErr) {
    console.warn('[BUILD_FIXTURES_SNAPSHOT] Non-blocking ownership enrichment fallback:', enrichErr);
  }

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
  if (['comp-champions-league-2026', 'comp-europa-league-2026'].includes(competitionId)) {
    const { calculateEuropeanStandingsFromSqlite, rebuildEuropeanStandings } = await import('../tournament/qualificationEngine');
    const sqliteRows = calculateEuropeanStandingsFromSqlite(competitionId, seasonId);
    if (sqliteRows && sqliteRows.length > 0) {
      return {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        sourceVersion: 'european-sqlite-local',
        expectedCount: sqliteRows.length,
        actualCount: sqliteRows.length,
        data: sqliteRows as unknown as StandingsRow[],
      };
    }
    const rows = await rebuildEuropeanStandings(competitionId, seasonId);
    return { schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), sourceVersion: 'european-authoritative', expectedCount: rows.length, actualCount: rows.length, data: rows as unknown as StandingsRow[] };
  }
  const config = DOMESTIC_LEAGUE_CONFIG[competitionId];
  const expectedCount = config ? config.expectedCount : 20;
  const key = ReadModelKeys.standings(competitionId, seasonId);
  const existingLkg = await redisGetLkg<StandingsRow[]>(key);

  let rows: StandingsRow[] = [];
  let firestoreFailed = false;

  try {
    const db = getFirestoreDb();
    if (db) {
      const stdDoc = await db.collection(COLLECTIONS.STANDINGS).doc(competitionId).get();
      trackFirestoreRead(COLLECTIONS.STANDINGS, stdDoc.exists ? 1 : 0, 'buildStandingsSnapshot');
      if (stdDoc.exists) {
        const data = stdDoc.data();
        if (Array.isArray(data?.rows) && data.rows.length > 0) {
          rows = data.rows as StandingsRow[];
        }
      }
    }
  } catch (err: any) {
    firestoreFailed = true;
    firestoreCircuitBreaker.recordFailure(err);
    console.warn(`[READ_MODEL_STORE] Error fetching standings for ${competitionId}:`, err?.message || err);
  }

  // 1. If Firestore failed: NEVER generate zero-value standings and NEVER overwrite existing populated LKG!
  if (firestoreFailed) {
    if (existingLkg && Array.isArray(existingLkg.data) && existingLkg.data.length > 0) {
      throw new ReadModelNotWarmedError('Authoritative refresh unavailable; preserve last-known-good snapshot');
    }
    throw new ReadModelNotWarmedError(
      `READ_MODEL_NOT_WARMED: Firestore standings retrieval failed for ${competitionId} and no valid LKG snapshot exists.`
    );
  }

  // 2. If standings doc in Firestore is missing or has empty rows:
  if (rows.length === 0) {
    // If a populated LKG already exists, NEVER overwrite it with zero-value rows!
    if (existingLkg && Array.isArray(existingLkg.data) && existingLkg.data.length > 0) {
      throw new ReadModelNotWarmedError('Authoritative refresh unavailable; preserve last-known-good snapshot');
    }

    // Check if confirmed fixtures exist for this competition
    let hasConfirmedFixtures = false;
    try {
      const db = getFirestoreDb();
      if (db) {
        const competition = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
        if (!competition.exists || competition.data()?.seasonId !== seasonId) {
          throw new ReadModelNotWarmedError('Cannot initialize standings without an authoritative competition for this season');
        }
        const fixSnap = await db
          .collection(COLLECTIONS.FIXTURES)
          .where('competitionId', '==', competitionId)
          .where('status', '==', 'CONFIRMED')
          .limit(1)
          .get();
        hasConfirmedFixtures = !fixSnap.empty;
      } else {
        throw new Error('Firestore unavailable: cannot verify empty standings');
      }
    } catch (error) {
      throw error;
    }

    // Only allow zero standings for a genuinely new competition proven to have no confirmed fixtures and no existing standings
    if (!hasConfirmedFixtures && config) {
      rows = generateZeroValueStandings(competitionId, seasonId);
    } else if (hasConfirmedFixtures) {
      throw new Error(
        `Standings for ${competitionId} cannot be zeroed: competition has confirmed fixtures recorded in Firestore.`
      );
    }
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
 * If per-league snapshot is missing but clubs-with-owners LKG exists, derives from LKG without querying Firestore.
 */
export async function getLeagueClubsFromReadModel(
  leagueId: string,
  seasonId = 'season-2026-27',
  currentUserId?: string
): Promise<{ clubs: Club[]; source: string; stale: boolean; degraded: boolean; snapshotAt: string }> {
  const result = await readThroughReadModel<OwnerNeutralClub[]>({
    key: ReadModelKeys.clubsWithOwners(seasonId), seasonId, expectedCount: 96,
    firestoreFetcher: async () => (await buildClubsSnapshot(seasonId)).data,
    validateData: data => Array.isArray(data) && data.length > 0,
  });
  return {
    clubs: result.data.filter(c => c.leagueId === leagueId).map(c => enrichClubForUser(c, currentUserId)),
    source: result.source, stale: Boolean(result.stale), degraded: Boolean(result.degraded),
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
 * - Represents users with no club using a valid cached sentinel: { hasClub: false, clubId: null, club: null }
 * - Derives membership from clubs-with-owners LKG before querying Firestore.
 */
export async function getUserActiveClubFromReadModel(
  userId: string,
  seasonId = 'season-2026-27'
): Promise<Club | null> {
  // Derive identity from the same versioned ownership snapshot used by club lists.
  // Never promote an old negative membership sentinel to a new authoritative answer.
  const result = await readThroughReadModel<OwnerNeutralClub[]>({
    key: ReadModelKeys.clubsWithOwners(seasonId),
    seasonId,
    expectedCount: 96,
    firestoreFetcher: async () => (await buildClubsSnapshot(seasonId)).data,
    validateData: data => Array.isArray(data) && data.length > 0,
  });
  const owner = result.data.find(c => (c.ownerUserId || c.claimedByUserId) === userId);
  return owner ? enrichClubForUser(owner, userId) : null;
}

/** Membership is optional profile data; its outage must not invalidate verified identity. */
export async function getOptionalCurrentClub(userId: string, seasonId = 'season-2026-27') {
  try {
    const currentClub = await getUserActiveClubFromReadModel(userId, seasonId);
    return { currentClub, currentClubStatus: 'resolved' as const, degraded: false };
  } catch (error) {
    if (!(error instanceof ReadModelNotWarmedError)) throw error;
    return { currentClub: null, currentClubStatus: 'unavailable' as const, degraded: true };
  }
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
 * If competition fixtures snapshot is missing but admin-fixtures LKG exists, derives from admin-fixtures without querying Firestore.
 */
export async function getCompetitionFixturesFromReadModel(
  competitionId: string,
  optionsOrMatchday: number | { matchday?: number; status?: string; seasonId?: string } = {},
  fallbackSeasonId = 'season-2026-27'
): Promise<{ fixtures: Fixture[]; source: string; stale: boolean; degraded: boolean; snapshotAt: string }> {
  const options = typeof optionsOrMatchday === 'number'
    ? { matchday: optionsOrMatchday, seasonId: fallbackSeasonId }
    : optionsOrMatchday || {};
  const seasonId = options.seasonId || fallbackSeasonId;
  let rawFixtures: Fixture[] = [];
  let source = 'memory';
  let stale = false;
  let degraded = false;
  let generatedAt = new Date().toISOString();

  // 1. Tier-1 memory & 2. Redis fresh
  const compKey = ReadModelKeys.competitionFixtures(competitionId, seasonId);
  const adminKey = ReadModelKeys.adminFixtures(seasonId);

  let redisFresh = await redisGetFresh<Fixture[]>(compKey);
  if (!redisFresh) {
    const adminFresh = await redisGetFresh<Fixture[]>(adminKey);
    if (adminFresh && Array.isArray(adminFresh.data)) {
      redisFresh = {
        ...adminFresh,
        data: adminFresh.data.filter((f) => f.competitionId === competitionId),
      };
    }
  }

  if (redisFresh && Array.isArray(redisFresh.data) && redisFresh.data.length > 0) {
    rawFixtures = redisFresh.data;
    source = redisFresh.source;
    stale = Boolean(redisFresh.stale);
    degraded = Boolean(redisFresh.degraded);
    generatedAt = redisFresh.generatedAt;
  }

  // 3. Redis LKG
  if (rawFixtures.length === 0) {
    let redisLkg = await redisGetLkg<Fixture[]>(compKey);
    if (!redisLkg) {
      const adminLkg = await redisGetLkg<Fixture[]>(adminKey);
      if (adminLkg && Array.isArray(adminLkg.data)) {
        redisLkg = {
          ...adminLkg,
          data: adminLkg.data.filter((f) => f.competitionId === competitionId),
        };
      }
    }
    if (redisLkg && Array.isArray(redisLkg.data) && redisLkg.data.length > 0) {
      rawFixtures = redisLkg.data;
      source = redisLkg.source;
      stale = true;
      degraded = true;
      generatedAt = redisLkg.generatedAt;
    }
  }

  // 4. SQLite local read model
  if (rawFixtures.length === 0) {
    try {
      const conditions: string[] = ['competition_id = ?'];
      const params: any[] = [competitionId];
      if (seasonId) {
        conditions.push('(season_id = ? OR season_id IS NULL)');
        params.push(seasonId);
      }
      if (options.matchday !== undefined) {
        conditions.push('matchday = ?');
        params.push(options.matchday);
      }
      if (options.status && options.status !== 'ALL') {
        conditions.push('status = ?');
        params.push(options.status);
      }
      const sqliteRows = queryAll<any>(
        `SELECT * FROM fixtures WHERE ${conditions.join(' AND ')} ORDER BY matchday ASC, scheduled_at ASC, id ASC`,
        params
      );
      if (sqliteRows && sqliteRows.length > 0) {
        rawFixtures = sqliteRows.map((r) => normalizeFixtureSnapshot(r, seasonId));
        source = 'sqlite';
        stale = true;
        degraded = true;
      }
    } catch {}
  }

  // 5. Bounded Firestore query as last online fallback (NEVER a full-season scan!)
  if (rawFixtures.length === 0) {
    const db = getFirestoreDb();
    if (db && firestoreCircuitBreaker.canExecute()) {
      try {
        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.FIXTURES)
          .where('seasonId', '==', seasonId)
          .where('competitionId', '==', competitionId);
        if (options.matchday !== undefined) {
          query = query.where('matchday', '==', options.matchday);
        }
        if (options.status && options.status !== 'ALL') {
          query = query.where('status', '==', options.status);
        }
        const snap = await query.get();
        trackFirestoreRead(COLLECTIONS.FIXTURES, snap.docs.length, 'getCompetitionFixturesBoundedFirestore');
        rawFixtures = snap.docs.map((d) => normalizeFixtureSnapshot({ id: d.id, ...d.data() }, seasonId));
        source = 'firestore_bounded';
        stale = false;
        degraded = false;
      } catch (err: any) {
        firestoreCircuitBreaker.recordFailure(err);
      }
    }
  }

  let fixtures = rawFixtures;
  if (options.matchday !== undefined) {
    fixtures = fixtures.filter((fixture) => Number(fixture.matchday) === Number(options.matchday));
  }
  if (options.status && options.status !== 'ALL') {
    fixtures = fixtures.filter((fixture) => fixture.status === options.status);
  }
  if (['comp-champions-league-2026', 'comp-europa-league-2026'].includes(competitionId)) {
    const leaguePhaseFixtures = fixtures.filter((fixture) => Number(fixture.matchday) >= 1 && Number(fixture.matchday) <= 8);
    if (leaguePhaseFixtures.length > 0 && leaguePhaseFixtures.some((fixture) => fixture.status !== 'CONFIRMED')) {
      fixtures = leaguePhaseFixtures;
    }
  }

  let clubsResult: any = null;
  try {
    clubsResult = await readThroughReadModel<OwnerNeutralClub[]>({
      key: ReadModelKeys.clubsWithOwners(seasonId),
      seasonId,
      expectedCount: 96,
      firestoreFetcher: async () => (await buildClubsSnapshot(seasonId)).data,
      validateData: (data) => Array.isArray(data) && data.length > 0,
    });
  } catch {}

  const ownersByClub = new Map<string, OwnerNeutralClub>(
    clubsResult?.data ? clubsResult.data.map((club: OwnerNeutralClub) => [club.id, club]) : []
  );
  fixtures = fixtures.map((fixture) => {
    const homeOwner = fixture.homeClubId ? ownersByClub.get(fixture.homeClubId) : undefined;
    const awayOwner = fixture.awayClubId ? ownersByClub.get(fixture.awayClubId) : undefined;
    const enrichFixtureClub = (club: Fixture['homeClub'], owner?: OwnerNeutralClub) => club ? ({
      ...club,
      claimedByUserId: owner?.ownerUserId || null,
      claimedByUsername: owner?.ownerUsername || null,
      managerUsername: owner?.ownerUsername || undefined,
      isTaken: Boolean(owner?.ownerUserId),
      occupancy: {
        status: owner?.ownerUserId ? 'occupied' as const : 'available' as const,
        userId: owner?.ownerUserId || undefined,
        username: owner?.ownerUsername || undefined,
      },
    }) : club;
    const toFixtureUser = (owner?: OwnerNeutralClub) => owner?.ownerUserId ? ({
      id: owner.ownerUserId,
      username: owner.ownerUsername || '',
      displayName: owner.ownerUsername ? `@${owner.ownerUsername}` : `User #${owner.ownerUserId}`,
    }) : null;
    return {
      ...fixture,
      homeClub: enrichFixtureClub(fixture.homeClub, homeOwner),
      awayClub: enrichFixtureClub(fixture.awayClub, awayOwner),
      homeOwnerId: homeOwner?.ownerUserId || undefined,
      awayOwnerId: awayOwner?.ownerUserId || undefined,
      homeUser: toFixtureUser(homeOwner),
      awayUser: toFixtureUser(awayOwner),
    };
  });
  if (options.matchday !== undefined) fixtures = fixtures.filter(f => Number(f.matchday) === Number(options.matchday));
  if (options.status && options.status !== 'ALL') fixtures = fixtures.filter(f => f.status === options.status);
  try {
    const { enrichFixturesWithAuthoritativeOwners } = await import('../firebase/firestoreStore');
    fixtures = await enrichFixturesWithAuthoritativeOwners(fixtures, seasonId);
  } catch (err) {
    console.warn('[COMPETITION_FIXTURES] Ownership enrichment fallback:', err);
  }
  return {
    fixtures: fixtures.sort((a,b) => compareAdminFixtures(a,b,true)),
    source,
    stale: Boolean(stale || clubsResult?.stale),
    degraded: Boolean(degraded || clubsResult?.degraded),
    snapshotAt: generatedAt,
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

  // 1. Check Redis fresh or LKG snapshot first
  const redisFresh = await redisGetFresh<Fixture[]>(ReadModelKeys.adminFixtures(seasonId));
  const redisLkg = !redisFresh ? await redisGetLkg<Fixture[]>(ReadModelKeys.adminFixtures(seasonId)) : null;
  const snapshotRes = redisFresh || redisLkg;

  if (!snapshotRes || !Array.isArray(snapshotRes.data) || snapshotRes.data.length === 0) {
    // 2. Redis miss: Fallback to SQLite local read model BEFORE scanning Firestore!
    try {
      const { executeAdminFixturesPagedFallback } = await import('../firebase/firestoreStore');
      const fallbackRes = executeAdminFixturesPagedFallback(options, limit);
      if (fallbackRes.total > 0 || !firestoreCircuitBreaker.canExecute()) {
        return {
          fixtures: fallbackRes.fixtures,
          total: fallbackRes.total,
          hasMore: fallbackRes.hasMore,
          nextCursor: fallbackRes.nextCursor,
          limit: fallbackRes.limit,
          source: 'sqlite',
          degraded: true,
          stale: true,
          generatedAt: fallbackRes.generatedAt,
        };
      }
    } catch {}
  }

  const effectiveSnapshotRes = snapshotRes || (await readThroughReadModel<Fixture[]>({
    key: ReadModelKeys.adminFixtures(seasonId),
    seasonId,
    firestoreFetcher: async () => {
      const snap = await buildAdminFixturesSnapshot(seasonId);
      return snap.data;
    },
    validateData: (fixtures) => Array.isArray(fixtures) && fixtures.length > 0,
  }));

  let allFixtures = [...effectiveSnapshotRes.data].sort((a,b) => compareAdminFixtures(a,b));

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
      const foundIdx = allFixtures.findIndex(f => {
        const order = CANONICAL_COMPETITION_ORDER[f.competitionId] ?? 999;
        if (order !== tuple.competitionOrder) return order > tuple.competitionOrder;
        const matchday = Number(f.matchday) || 0;
        if (matchday !== tuple.matchday) return matchday > tuple.matchday;
        const time = Date.parse(f.scheduledAt) || 0, previous = Date.parse(tuple.scheduledAt) || 0;
        return time !== previous ? time > previous : f.id.localeCompare(tuple.id) > 0;
      });
      startIndex = foundIdx < 0 ? allFixtures.length : foundIdx;
    } else {
      const rawIdx = allFixtures.findIndex((f) => f.id === options.cursor);
      if (rawIdx >= 0) {
        startIndex = rawIdx + 1;
      } else throw Object.assign(new Error('INVALID_FIXTURE_CURSOR'), { statusCode: 400 });
    }
  }

  const pagedFixtures = allFixtures.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < allFixtures.length;
  const nextCursor =
    hasMore && pagedFixtures.length > 0
      ? encodeFixtureCursor(pagedFixtures[pagedFixtures.length - 1])
      : undefined;

  let enrichedPagedFixtures = pagedFixtures;
  try {
    const { enrichFixturesWithAuthoritativeOwners } = await import('../firebase/firestoreStore');
    enrichedPagedFixtures = await enrichFixturesWithAuthoritativeOwners(pagedFixtures, seasonId);
  } catch {}

  return {
    fixtures: enrichedPagedFixtures,
    total,
    hasMore,
    nextCursor,
    limit,
    source: effectiveSnapshotRes.source,
    degraded: effectiveSnapshotRes.source === 'redis_stale',
    stale: effectiveSnapshotRes.source === 'redis_stale',
    generatedAt: effectiveSnapshotRes.generatedAt,
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

/** Refresh one changed fixture with one document read instead of scanning the season. */
export async function refreshChangedFixtureReadModel(fixtureId: string): Promise<void> {
  const document = await getFirestoreDb().collection(COLLECTIONS.FIXTURES).doc(fixtureId).get();
  if (!document.exists) throw new Error('FIXTURE_NOT_FOUND');
  const fixture = normalizeFixtureSnapshot({ ...document.data(), id: document.id } as FirestoreFixtureDoc);
  const key = ReadModelKeys.adminFixtures(fixture.seasonId);
  const client = getUpstashClient();
  let patched = false;
  if (client) {
    const result = await client.eval(`
      if redis.call('EXISTS', KEYS[3]) == 1 then return 0 end
      local raw = redis.call('GET', KEYS[2])
      if not raw then return 0 end
      local snapshot = cjson.decode(raw)
      local changed = cjson.decode(ARGV[1])
      for i, row in ipairs(snapshot.data) do
        if row.id == changed.id then
          if row.updatedAt and row.updatedAt > changed.updatedAt then return 1 end
          snapshot.data[i] = changed
          local updated = cjson.encode(snapshot)
          redis.call('SET', KEYS[2], updated)
          local ttl = redis.call('TTL', KEYS[1])
          if ttl > 0 then redis.call('SET', KEYS[1], updated, 'EX', ttl) end
          return 1
        end
      end
      return 0
    `, [getFreshKey(key), getLkgKey(key), getDirtyKey(key)], [JSON.stringify(fixture)]);
    patched = Number(result) === 1;
    inProcessMemoryCache.delete(getRawDatasetKey(key));
    inProcessMemoryCache.delete(key);
    memoryRedisStorage.delete(getFreshKey(key));
    memoryRedisStorage.delete(getLkgKey(key));
  }
  if (!patched) await invalidateDataset(key);
  await invalidateDataset(ReadModelKeys.competitionFixtures(fixture.competitionId, fixture.seasonId));
  await invalidateDataset(ReadModelKeys.standings(fixture.competitionId, fixture.seasonId));
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
  const client = getUpstashClient();
  const hosted = Boolean(process.env.VERCEL || process.env.K_SERVICE || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === 'production');
  if (hosted && !client) throw new Error('REDIS_NOT_CONFIGURED: Production uchun Redis URL va token juftligini tekshiring.');
  if (client && await client.ping() !== 'PONG') throw new Error('REDIS_UNAVAILABLE');
  if (!firestoreCircuitBreaker.canExecute()) throw new Error('FIRESTORE_COOLDOWN: Baza cheklovi faol. Keyinroq qayta urinib ko‘ring.');
  const assertReadable = () => {
    if (firestoreCircuitBreaker.getStatus().state === 'OPEN') throw new Error('FIRESTORE_COOLDOWN');
  };

  const warmedLkgKeys: string[] = [];
  const errors: string[] = [];
  const standingsPerLeague: Record<string, number> = {};

  // 1. Competitions catalog
  let compCount = 0;
  try {
    assertReadable();
    const compSnap = await buildCompetitionsSnapshot(seasonId);
    compCount = compSnap.data.length;
    warmedLkgKeys.push(getLkgKey(ReadModelKeys.competitions(seasonId)));
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    errors.push(`Competitions rebuild error: ${err.message}`);
  }

  // 2. Clubs & occupancies (owner-neutral, all 96 clubs)
  let clubCount = 0;
  let rebuiltClubs: OwnerNeutralClub[] = [];
  try {
    assertReadable();
    const clubSnap = await buildClubsSnapshot(seasonId);
    rebuiltClubs = clubSnap.data;
    clubCount = clubSnap.data.length;
    warmedLkgKeys.push(getLkgKey(ReadModelKeys.clubsWithOwners(seasonId)));
    for (const l of SEED_LEAGUES) {
      warmedLkgKeys.push(getLkgKey(ReadModelKeys.leagueClubs(l.id, seasonId)));
    }
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    errors.push(`Clubs rebuild error: ${err.message}`);
  }

  // 3. Admin & competition fixtures (sorted by canonical tuple)
  let fixtureCount = 0;
  try {
    assertReadable();
    const fixSnap = await buildAdminFixturesSnapshot(seasonId);
    fixtureCount = fixSnap.data.length;
    warmedLkgKeys.push(getLkgKey(ReadModelKeys.adminFixtures(seasonId)));
    const uniqueCompIds = Array.from(new Set(fixSnap.data.map((f) => f.competitionId)));
    for (const cId of uniqueCompIds) {
      warmedLkgKeys.push(getLkgKey(ReadModelKeys.competitionFixtures(cId, seasonId)));
    }
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    errors.push(`Fixtures rebuild error: ${err.message}`);
  }

  // 4. Standings for the 5 domestic leagues
  let standingsCount = 0;
  for (const cId of Object.keys(DOMESTIC_LEAGUE_CONFIG)) {
    try {
      assertReadable();
      const stdSnap = await buildStandingsSnapshot(cId, seasonId);
      standingsCount += stdSnap.data.length;
      standingsPerLeague[DOMESTIC_LEAGUE_CONFIG[cId].name] = stdSnap.data.length;
      warmedLkgKeys.push(getLkgKey(ReadModelKeys.standings(cId, seasonId)));
    } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
      errors.push(`Standings rebuild error for ${cId}: ${err.message}`);
    }
  }

  // 5. Active user memberships
  let membershipCount = 0;
  try {
    for (const club of rebuiltClubs) {
      if (club.ownerUserId) {
          const occ = { userId: club.ownerUserId };
          const membershipData: UserMembershipSentinel = {
            hasClub: true, clubId: club.id, club: enrichClubForUser(club, club.ownerUserId),
          };
          const memKey = ReadModelKeys.userMembership(occ.userId, seasonId);
          const memSnap: ReadModelSnapshot<UserMembershipSentinel> = {
            schemaVersion: SCHEMA_VERSION,
            generatedAt: new Date().toISOString(),
            sourceVersion: `ownership-${club.id}`,
            expectedCount: 1,
            actualCount: 1,
            data: membershipData,
          };
          await redisSetRaw(memKey, memSnap, 86400);
          warmedLkgKeys.push(getLkgKey(memKey));
          membershipCount++;
      }
    }
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    errors.push(`User memberships rebuild error: ${err.message}`);
  }

  if (errors.length === 0) firestoreCircuitBreaker.recordSuccess();
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
