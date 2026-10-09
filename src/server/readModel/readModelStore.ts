import { withSeasonQualificationPolicy } from '../../lib/seasonQualificationPolicy';
import { filterRetiredFixtures, hasFixtureMatchdayCorrection } from '../services/retiredFixtureService';
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
import { sharedReadRefresh, isReadRefreshUnavailable } from './sharedReadRefresh';
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
  return key.replace(/^efluz:v1:pg:(preview|production):(fresh:|lkg:|dirty:)?/, '').replace(/^efluz:v1:(fresh:|lkg:|dirty:)?/, '').replace(/^efluz:v1:/, '');
}
const readCachePrefix = () => process.env.DATABASE_PROVIDER === 'supabase'
  ? `${KEY_PREFIX}:pg:${process.env.SUPABASE_DATA_NAMESPACE}` : KEY_PREFIX;

export function getFreshKey(datasetKey: string): string {
  const clean = getRawDatasetKey(datasetKey);
  return `${readCachePrefix()}:fresh:${clean}`;
}

export function getLkgKey(datasetKey: string): string {
  const clean = getRawDatasetKey(datasetKey);
  return `${readCachePrefix()}:lkg:${clean}`;
}

export function getDirtyKey(datasetKey: string): string {
  const clean = getRawDatasetKey(datasetKey);
  return `${readCachePrefix()}:dirty:${clean}`;
}

// Canonical dataset key generators
export const ReadModelKeys = {
  competitions: (seasonId = 'season-2026-27') => `${KEY_PREFIX}:season:${seasonId}:competitions`,
  clubsWithOwners: (seasonId = 'season-2026-27') => `${KEY_PREFIX}:season:${seasonId}:clubs-with-owners`,
  clubAdmission: (seasonId = 'season-2026-27') => `${KEY_PREFIX}:season:${seasonId}:club-admission`,
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

export function resetUpstashClient(): void {
  upstashClient = null;
  isUpstashConfigured = false;
  reportedRedisConfig = false;
  redisRetryAt = 0;
}

let redisRetryAt = 0;
export function getUpstashClient(): Redis | null {
  if (Date.now() < redisRetryAt) return null;
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
      upstashClient = new Redis({ url: config.url, token: config.token, retry: false, enableAutoPipelining: false, signal: () => AbortSignal.timeout(1200) });
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
      redisRetryAt = Date.now() + 60_000;
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
      redisRetryAt = Date.now() + 60_000;
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
/** Optional publication of a verified read result. Never used as mutation durability. */
export async function persistReadSnapshot<T>(
  datasetKey: string,
  snapshot: Partial<ReadModelSnapshot<T>> & { data: T },
  ttlSeconds = 86400,
): Promise<void> {
  try { await redisSetRaw(datasetKey, snapshot, ttlSeconds); return; }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('SNAPSHOT_REJECTED:')) throw error;
    redisRetryAt = Date.now() + 60_000;
  }
  const cleanKey = getRawDatasetKey(datasetKey);
  const actualCount = Array.isArray(snapshot.data) ? snapshot.data.length : snapshot.data == null ? 0 : 1;
  const previous = memoryRedisStorage.get(getLkgKey(cleanKey))?.snapshot;
  const generatedAt = snapshot.generatedAt || new Date().toISOString();
  if (previous && (previous.actualCount > 0 && actualCount === 0 || previous.generatedAt > generatedAt)) throw new Error(`SNAPSHOT_REJECTED: ${cleanKey}`);
  const value: ReadModelSnapshot<T> = {
    ...snapshot, schemaVersion: snapshot.schemaVersion || SCHEMA_VERSION,
    generatedAt, sourceVersion: snapshot.sourceVersion || 'firestore-authoritative',
    expectedCount: snapshot.expectedCount ?? actualCount, actualCount,
    data: snapshot.data, degraded: true,
  };
  // Bounded per-process cache; it does not survive a cold start or claim durability.
  const expiresAt = Date.now() + Math.min(ttlSeconds, 300) * 1000;
  memoryRedisStorage.set(getFreshKey(cleanKey), { snapshot: value, expiresAt });
  memoryRedisStorage.set(getLkgKey(cleanKey), { snapshot: value, expiresAt });
  memoryRedisStorage.delete(getDirtyKey(cleanKey));
  setInProcessMemory(cleanKey, value);
  console.warn(`[READ_MODEL_DEGRADED] Serving verified read result from process cache: ${cleanKey}`);
}

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
    if (isUpstashConfigured || process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.K_SERVICE) throw new Error('REDIS_REQUIRED_FOR_DURABLE_SNAPSHOT');
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

  const breakerStatus = firestoreCircuitBreaker.getStatus();
  const firestoreHealthy = breakerStatus.state === 'CLOSED' && !breakerStatus.softLimitExceeded;
  const isDirty = await redisIsDirty(cleanKey);

  // 1. Process Memory Cache (Level 1)
  const memoryHit = getFromProcessMemory<ReadModelSnapshot<T>>(cleanKey);
  if (!isDirty && memoryHit && memoryHit.data !== undefined && Date.now() - Date.parse(memoryHit.generatedAt) < ttlSeconds * 1000) {
    if (!firestoreHealthy) {
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
      stale: Boolean(memoryHit.stale),
      degraded: Boolean(memoryHit.degraded),
    };
  }

  // 2. Fresh Redis Snapshot (Level 2)
  let freshSnapshot: ReadModelSnapshot<T> | null = null;
  if (!isDirty) {
    freshSnapshot = await redisGetFresh<T>(cleanKey);
  }

  // Return valid cached data before reserving a Firestore recovery probe.
  if (freshSnapshot && freshSnapshot.data !== undefined) {
    const ageMs = Date.now() - new Date(freshSnapshot.generatedAt).getTime();
    if (ageMs < ttlSeconds * 1000) {
      setInProcessMemory(cleanKey, freshSnapshot);
      return {
        data: freshSnapshot.data,
        source: 'redis_fresh',
        generatedAt: freshSnapshot.generatedAt,
        sourceVersion: freshSnapshot.sourceVersion,
        stale: !firestoreHealthy || Boolean(freshSnapshot.stale),
        degraded: !firestoreHealthy || Boolean(freshSnapshot.degraded),
      };
    }
  }

  const canQueryFirestore = firestoreCircuitBreaker.canExecute();

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
        await persistReadSnapshot(cleanKey, snapshot, ttlSeconds);
        firestoreCircuitBreaker.recordSuccess();

        return freshData;
      } catch (err: any) {
        if (isReadRefreshUnavailable(err)) firestoreCircuitBreaker.cancelProbe();
        else firestoreCircuitBreaker.recordFailure(err);
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
      degraded: Boolean(memoryRedisStorage.get(getFreshKey(cleanKey))?.snapshot.degraded),
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
  await persistReadSnapshot(ReadModelKeys.competitions(seasonId), snapshot, 3600);
  return snapshot;
}

// Patch only one competition inside the durable catalog. Parallel admins managing
// different leagues must not replace one another's state with an older whole list.
export async function patchCompetitionMatchdayCatalog(competition: FirestoreCompetitionDoc): Promise<void> {
  const key = ReadModelKeys.competitions(competition.seasonId);
  const clean = getRawDatasetKey(key), fresh = getFreshKey(clean), lkg = getLkgKey(clean);
  const now = new Date().toISOString(), client = getUpstashClient();
  if (client) {
    await client.eval(`
      local raw = redis.call('GET', KEYS[2]) or redis.call('GET', KEYS[1])
      if not raw then return 0 end
      local snapshot = cjson.decode(raw)
      local patch = cjson.decode(ARGV[1])
      local found = false
      for _, item in ipairs(snapshot.data) do
        if item.id == patch.id then
          if item.updatedAt and patch.updatedAt and item.updatedAt > patch.updatedAt then return 0 end
          for k, v in pairs(patch) do item[k] = v end
          found…24653 tokens truncated…_KEY, { [record.id]: record });
      const result = photo ? await sendTelegramPhoto(job.telegramId!, photo, photoCaption) : await sendTelegramMessage(
        job.telegramId!,
        formatTelegramMessage(job.title, job.body, job.type, Boolean(job.bodyIsHtml)),
        { parse_mode: 'HTML', reply_markup: job.replyMarkup }
      );
      if (result.ok) {
        await updateBroadcastRecipientState(job.broadcastId, job.userId, 'SENT', undefined, new Date().toISOString());
        succeeded++;
      } else {
        const errorText = result.error_code
          ? `TELEGRAM_${result.error_code}: ${result.error || 'Rejected'}${result.parameters?.retry_after ? '; retry after ' + result.parameters.retry_after + ' seconds' : ''}`
          : 'DELIVERY_UNKNOWN: ' + (result.error || 'No response');
        const definitelyRejected = Boolean(result.error_code);
        const retryable = result.error_code === 429 || Boolean(result.error_code && result.error_code >= 500);
        if (definitelyRejected && retryable && job.retryCount < job.maxRetries) {
          job.retryCount += 1;
          const retryAfterSeconds = Math.max(Number(result.parameters?.retry_after || 0), 2 ** job.retryCount);
          job.availableAt = Date.now() + retryAfterSeconds * 1000;
          job.status = 'QUEUED';
          await updateBroadcastRecipientState(job.broadcastId, job.userId, 'PENDING', errorText, undefined, job.retryCount);
          await client.rpush(QUEUE_KEY, JSON.stringify(job));
        } else {
          // Ambiguous timeouts are never retried automatically because Telegram
          // may have accepted the message before the connection was lost.
          await updateBroadcastRecipientState(job.broadcastId, job.userId, 'FAILED', errorText, undefined, job.retryCount);
          failed++;
        }
      }
      await client.hdel(PROCESSING_KEY, job.jobId);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return { processed, succeeded, failed };
  } finally {
    await client.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", [WORKER_LOCK], [token]);
  }
}

function formatTelegramMessage(title: string, body: string, type: string, bodyIsHtml = false): string {
  let icon = '📢';
  if (type === 'NEW_MATCHDAY') icon = '⚽';
  if (type === 'UPCOMING_MATCH') icon = '⏰';
  if (type === 'COMPETITION_UPDATE') icon = '🏆';

  // No permanent "Official Alert" header/footer. Smart bodies are generated server-side
  // and may contain a small, controlled HTML subset; admin-entered bodies stay escaped.
  const safeBody = bodyIsHtml ? body : escapeHtml(body);
  return `<b>${icon} ${escapeHtml(title)}</b>\n\n${safeBody}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function updateBroadcastRecipientState(
  broadcastId: string,
  userId: string,
  status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED_NO_TELEGRAM',
  error?: string,
  sentAt?: string,
  retryCount?: number
) {
  const bcast = await getBroadcastDetails(broadcastId);
  if (!bcast) throw new Error('BROADCAST_RECORD_MISSING');

  const r = bcast.recipients.find((rec) => rec.userId === userId);
  if (r) {
    r.status = status;
    if (error) r.error = error;
    if (sentAt) r.sentAt = sentAt;
    if (retryCount !== undefined) r.retryCount = retryCount;
  }

  bcast.metrics.sentCount = bcast.recipients.filter(r => r.status === 'SENT').length;
  bcast.metrics.failedCount = bcast.recipients.filter(r => r.status === 'FAILED').length;
  bcast.metrics.skippedCount = bcast.recipients.filter(r => r.status === 'SKIPPED_NO_TELEGRAM').length;

  const totalFinished = bcast.metrics.sentCount + bcast.metrics.failedCount + bcast.metrics.skippedCount;
  if (totalFinished >= bcast.metrics.totalRecipients) {
    bcast.status = bcast.metrics.failedCount > 0 ? 'PARTIALLY_FAILED' : 'COMPLETED';
  }

  // Also persist to Redis if available
  const client = getUpstashClient();
  if (client) {
    await client.hset(BROADCASTS_KEY, { [broadcastId]: bcast });
  }
  memoryBroadcasts.set(broadcastId, bcast);
}

/**
 * Returns past broadcasts list.
 */
export async function getBroadcastHistory(limit = 20): Promise<TelegramBroadcastRecord[]> {
  const client = getUpstashClient();
  if (client) {
    try {
      const records = await client.hgetall<Record<string, TelegramBroadcastRecord>>(BROADCASTS_KEY);
      if (records) {
        const list = Object.values(records) as TelegramBroadcastRecord[];
        return list
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, limit);
      }
    } catch {}
  }

  return Array.from(memoryBroadcasts.values())
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

/** Retry FAILED recipients without re-sending already successful deliveries. */
export async function retryFailedBroadcastRecipients(
  broadcastId: string,
  userId?: string
): Promise<{ retried: number; skipped: number }> {
  const client = getUpstashClient();
  if (!client) throw new Error('REDIS_REQUIRED');
  const record = await getBroadcastDetails(broadcastId);
  if (!record) throw new Error('BROADCAST_NOT_FOUND');

  const directory = await client.get<RecipientDirectoryEntry[]>(`${RECIPIENT_DIR_KEY}:${record.seasonId}`);
  const byUser = new Map((Array.isArray(directory) ? directory : []).map((entry) => [entry.userId, entry]));
  const targets = record.recipients.filter((recipient) =>
    recipient.status === 'FAILED' && (!userId || recipient.userId === userId)
  );
  if (userId && targets.length === 0) throw new Error('FAILED_RECIPIENT_NOT_FOUND');

  let retried = 0;
  let skipped = 0;
  for (const recipient of targets) {
    const directoryEntry = byUser.get(recipient.userId);
    if (!directoryEntry?.messageable || !directoryEntry.telegramId) {
      skipped++;
      continue;
    }
    const now = new Date().toISOString();
    const retryNumber = Number(recipient.retryCount || 0) + 1;
    const job: NotificationQueueJob = {
      jobId: `job-retry-${broadcastId}-${recipient.userId}-${Date.now()}-${retryNumber}`,
      broadcastId,
      userId: recipient.userId,
      username: recipient.username || directoryEntry.username || 'player',
      displayName: recipient.displayName || directoryEntry.displayName || 'EFL Player',
      telegramId: directoryEntry.telegramId,
      title: record.title,
      body: record.body,
      type: record.type,
      status: 'QUEUED',
      retryCount: 0,
      maxRetries: 3,
      createdAt: now,
      availableAt: Date.now(),
      bodyIsHtml: Boolean(record.bodyIsHtml),
      replyMarkup: record.replyMarkup,
    };
    recipient.status = 'PENDING';
    recipient.retryCount = retryNumber;
    delete recipient.error;
    delete recipient.sentAt;
    await client.rpush(QUEUE_KEY, JSON.stringify(job));
    retried++;
  }

  if (retried > 0) {
    record.metrics.failedCount = Math.max(0, Number(record.metrics.failedCount || 0) - retried);
    record.status = 'QUEUED';
    await client.hset(BROADCASTS_KEY, { [record.id]: record });
    memoryBroadcasts.set(record.id, record);
    scheduleNotificationQueueDrain();
  }
  return { retried, skipped };
}

/**
 * Returns single broadcast record by ID.
 */
export async function getBroadcastDetails(broadcastId: string): Promise<TelegramBroadcastRecord | null> {
  const client = getUpstashClient();
  if (client) {
    try {
      const record = await client.hget<TelegramBroadcastRecord>(BROADCASTS_KEY, broadcastId);
      if (record) return record;
    } catch {}
  }
  return memoryBroadcasts.get(broadcastId) || null;
}
