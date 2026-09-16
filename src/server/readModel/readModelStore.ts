/**
 * DURABLE UPSTASH REDIS READ MODEL STORE
 *
 * Tiered Read Hierarchy:
 * 1. Short-lived in-process memory cache (15s TTL)
 * 2. Fresh Redis snapshot (Upstash REST API)
 * 3. Firestore when refresh is required / missing
 * 4. Stale Redis snapshot if Firestore fails or quota is exhausted (RESOURCE_EXHAUSTED)
 * 5. SQLite fallback only for static catalog data (never overwriting good Redis snapshots)
 *
 * Safety Directives:
 * - Redis is not the source of truth. Firestore remains authoritative.
 * - Never return an empty array merely because Firestore failed when Redis has a valid snapshot.
 * - Never overwrite a good Redis snapshot with empty degraded response, SQLite data, or failed results.
 * - If neither Firestore nor Redis contains data, return structured 503 { errorCode: "READ_MODEL_NOT_WARMED" }.
 * - On RESOURCE_EXHAUSTED or quota failure: trip circuit breaker, serve stale Redis data, allow controlled probes.
 * - Request coalescing: concurrent requests for the same missing key trigger only one Firestore read.
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
  data: T;
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
  warmedKeys: string[];
  missingKeys: string[];
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

// Canonical competition order (1-17)
export const CANONICAL_COMPETITION_ORDER: Record<string, number> = {
  // Leagues
  'comp-premier-league-2026': 1,
  'comp-la-liga-2026': 2,
  'comp-serie-a-2026': 3,
  'comp-bundesliga-2026': 4,
  'comp-ligue-1-2026': 5,

  // Domestic Cups (exactly 5, EFL Cup safely removed)
  'comp-fa-cup-2026': 6,
  'comp-copa-del-rey-2026': 7,
  'comp-coppa-italia-2026': 8,
  'comp-dfb-pokal-2026': 9,
  'comp-coupe-de-france-2026': 10,

  // Super Cups
  'comp-community-shield-2026': 11,
  'comp-supercopa-espana-2026': 12,
  'comp-supercoppa-italiana-2026': 13,
  'comp-dfl-supercup-2026': 14,

  // European Competitions
  'comp-champions-league-2026': 15,
  'comp-europa-league-2026': 16,
  'comp-uefa-super-cup-2026': 17,
};

// ----------------------------------------------------
// REDIS CLIENT & FALLBACK STORAGE
// ----------------------------------------------------
let upstashClient: Redis | null = null;
let isUpstashConfigured = false;
const memoryRedisStorage = new Map<string, { snapshot: ReadModelSnapshot<any>; expiresAt: number | null }>();

// Short-lived process memory cache (Level 1)
const inProcessMemoryCache = new Map<string, { data: any; expiresAt: number }>();
const PROCESS_MEMORY_TTL_MS = 15000; // 15 seconds

// Request coalescing map: single in-flight promise per key
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

export async function redisGetRaw<T>(key: string): Promise<ReadModelSnapshot<T> | null> {
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
      // Fallback to local memory storage on Redis transport error
      const entry = memoryRedisStorage.get(key);
      return entry ? (entry.snapshot as ReadModelSnapshot<T>) : null;
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

export async function redisSetRaw<T>(key: string, snapshot: ReadModelSnapshot<T>, ttlSeconds = 86400): Promise<void> {
  // Record snapshot timestamp
  globalLastSnapshotAt = snapshot.generatedAt;

  const client = getUpstashClient();
  if (client) {
    try {
      await client.set(key, snapshot, { ex: ttlSeconds });
      // Keep memory fallback in sync as secondary mirror
      memoryRedisStorage.set(key, {
        snapshot,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
      });
      return;
    } catch (err: any) {
      console.warn(`[READ_MODEL_STORE] Redis set error for key ${key}:`, err?.message || err);
    }
  }

  memoryRedisStorage.set(key, {
    snapshot,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
  });
}

export async function redisDelRaw(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  for (const k of keys) {
    inProcessMemoryCache.delete(k);
    memoryRedisStorage.delete(k);
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

export async function redisKeysRaw(pattern: string): Promise<string[]> {
  const client = getUpstashClient();
  if (client) {
    try {
      return await client.keys(pattern);
    } catch (err: any) {
      console.warn(`[READ_MODEL_STORE] Redis keys error:`, err?.message || err);
    }
  }
  // Memory storage pattern match (simple prefix / wildcard match)
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  const matched: string[] = [];
  for (const k of memoryRedisStorage.keys()) {
    if (regex.test(k)) {
      matched.push(k);
    }
  }
  return matched;
}

// ----------------------------------------------------
// PROCESS MEMORY CACHE (LEVEL 1)
// ----------------------------------------------------
export function getFromProcessMemory<T>(key: string): T | null {
  const entry = inProcessMemoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    inProcessMemoryCache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setInProcessMemory<T>(key: string, data: T, ttlMs = PROCESS_MEMORY_TTL_MS): void {
  inProcessMemoryCache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Simulates a fresh Vercel serverless cold start by purging in-process memory.
 */
export function clearProcessMemoryCache(): void {
  inProcessMemoryCache.clear();
  inFlightLoaders.clear();
}

/**
 * Completely resets test memory storage (for isolated tests only).
 */
export function resetMemoryRedisStore(): void {
  clearProcessMemoryCache();
  memoryRedisStorage.clear();
  globalLastSnapshotAt = null;
}

// ----------------------------------------------------
// VERSIONED KEY GENERATORS
// ----------------------------------------------------
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
// STABLE ADMIN FIXTURE COMPARATOR & CURSOR PAGINATION
// ----------------------------------------------------

/**
 * Stable sorting tuple comparator:
 * 1. canonical numeric competitionOrder
 * 2. numeric matchday
 * 3. scheduledAt
 * 4. fixture id as the final tie-breaker
 *
 * For single competition views: matchday ascending, scheduledAt ascending, id ascending.
 */
export function compareAdminFixtures(a: Fixture, b: Fixture, singleCompetition = false): number {
  if (!singleCompetition) {
    const orderA = CANONICAL_COMPETITION_ORDER[a.competitionId] ?? 999;
    const orderB = CANONICAL_COMPETITION_ORDER[b.competitionId] ?? 999;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
  }

  // 2. Numeric matchday ascending
  const mdA = typeof a.matchday === 'number' ? a.matchday : parseInt(String(a.matchday || 0), 10) || 0;
  const mdB = typeof b.matchday === 'number' ? b.matchday : parseInt(String(b.matchday || 0), 10) || 0;
  if (mdA !== mdB) {
    return mdA - mdB;
  }

  // 3. scheduledAt ascending
  const timeA = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
  const timeB = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
  if (timeA !== timeB) {
    return timeA - timeB;
  }

  // 4. Fixture id final tie breaker
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
  } catch {
    // If not a JSON tuple, might be a legacy raw fixture ID
  }
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
 * Core tiered reader following the exact hierarchy:
 * 1. Process memory cache
 * 2. Fresh Redis snapshot
 * 3. Firestore (if circuit closed / probe allowed)
 * 4. Stale Redis snapshot (if Firestore fails or circuit open)
 * 5. Structured 503 error if neither exists (no empty array fabrication)
 */
export async function readThroughReadModel<T>(options: TieredReadOptions<T>): Promise<TieredReadResult<T>> {
  const { key, ttlSeconds = 86400, firestoreFetcher, validateData } = options;

  // Check Firestore Circuit Breaker
  const canQueryFirestore = firestoreCircuitBreaker.canExecute();

  // 1. Process Memory Cache (Level 1)
  const memoryHit = getFromProcessMemory<ReadModelSnapshot<T>>(key);
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
  let redisSnapshot: ReadModelSnapshot<T> | null = null;
  try {
    redisSnapshot = await redisGetRaw<T>(key);
  } catch (err: any) {
    console.warn(`[READ_MODEL] Error reading Redis snapshot for ${key}:`, err?.message || err);
  }

  // If we have a valid Redis snapshot, populate memory cache
  if (redisSnapshot && redisSnapshot.data !== undefined) {
    setInProcessMemory(key, redisSnapshot);
  }

  // If circuit breaker is OPEN, do NOT hit Firestore; immediately return stale Redis snapshot
  if (!canQueryFirestore) {
    if (redisSnapshot && redisSnapshot.data !== undefined) {
      return {
        data: redisSnapshot.data,
        source: 'redis_stale',
        generatedAt: redisSnapshot.generatedAt,
        sourceVersion: redisSnapshot.sourceVersion,
        stale: true,
        degraded: true,
      };
    }
    // Neither Firestore nor Redis has data -> 503
    throw new ReadModelNotWarmedError(
      `Firestore circuit breaker is OPEN and no warmed Redis snapshot exists for key: ${key}`
    );
  }

  // If we already have a Redis snapshot and it's fresh (less than 10 minutes old), return it!
  if (redisSnapshot && redisSnapshot.data !== undefined) {
    const ageMs = Date.now() - new Date(redisSnapshot.generatedAt).getTime();
    if (ageMs < 600000) {
      // 10 minutes fresh
      return {
        data: redisSnapshot.data,
        source: 'redis_fresh',
        generatedAt: redisSnapshot.generatedAt,
        sourceVersion: redisSnapshot.sourceVersion,
        stale: false,
        degraded: false,
      };
    }
  }

  // 3. Firestore Read with Request Coalescing
  let loader = inFlightLoaders.get(key) as Promise<T> | undefined;
  if (!loader) {
    loader = (async () => {
      try {
        const freshData = await firestoreFetcher();

        // Validation guard: Never overwrite good snapshot with empty or degraded data!
        const isValid = validateData ? validateData(freshData) : Boolean(freshData);
        if (!isValid) {
          throw new Error(`Fetched Firestore data failed validation for key ${key}`);
        }

        const now = new Date().toISOString();
        const snapshot: ReadModelSnapshot<T> = {
          schemaVersion: SCHEMA_VERSION,
          generatedAt: now,
          sourceVersion: options.sourceVersion || 'firestore-authoritative',
          data: freshData,
        };

        // Persist to Redis & process memory
        await redisSetRaw(key, snapshot, ttlSeconds);
        setInProcessMemory(key, snapshot);
        firestoreCircuitBreaker.recordSuccess();

        return freshData;
      } catch (err: any) {
        // Record failure to circuit breaker (handles RESOURCE_EXHAUSTED / quota)
        firestoreCircuitBreaker.recordFailure(err);
        throw err;
      } finally {
        inFlightLoaders.delete(key);
      }
    })();
    inFlightLoaders.set(key, loader);
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
    // 4. Stale Redis Snapshot on Firestore failure
    if (redisSnapshot && redisSnapshot.data !== undefined) {
      console.warn(`[READ_MODEL] Firestore failed for ${key}, serving stale Redis snapshot. Cause:`, firestoreErr?.message || firestoreErr);
      return {
        data: redisSnapshot.data,
        source: 'redis_stale',
        generatedAt: redisSnapshot.generatedAt,
        sourceVersion: redisSnapshot.sourceVersion,
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
 * Builds and persists snapshot for active competitions catalog (EFL Cup safely omitted).
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

  const key = ReadModelKeys.competitions(seasonId);
  const snapshot: ReadModelSnapshot<Competition[]> = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceVersion: 'seed-catalog',
    data: competitions,
  };

  await redisSetRaw(key, snapshot, 86400);
  setInProcessMemory(key, snapshot);
  return snapshot;
}

export interface OwnerNeutralClub extends Club {
  ownerUserId: string | null;
  ownerUsername: string | null;
  ownerTelegramId: string | null;
  isClaimed: boolean;
  isAvailable: boolean;
}

/**
 * Builds owner-neutral clubs snapshot from authoritative Firestore occupancies.
 */
export async function buildClubsSnapshot(seasonId = 'season-2026-27'): Promise<ReadModelSnapshot<OwnerNeutralClub[]>> {
  const db = getFirestoreDb();
  if (!db) {
    throw new Error('Firestore DB not initialized');
  }

  // Load occupancies in controlled batch
  const occSnap = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).get();
  const occMap = new Map<string, { userId: string }>();
  for (const doc of occSnap.docs) {
    const data = doc.data();
    if (data.clubId && data.userId) {
      occMap.set(data.clubId, { userId: data.userId });
    }
  }

  // Load user details in controlled batch
  const userMap = new Map<string, { username: string; telegramId: string }>();
  const userSnap = await db.collection(COLLECTIONS.USERS).get();
  for (const doc of userSnap.docs) {
    const data = doc.data();
    userMap.set(doc.id, {
      username: data.username || `user_${doc.id.substring(0, 5)}`,
      telegramId: data.telegramId || '',
    });
  }

  // Build owner-neutral clubs
  const neutralClubs: OwnerNeutralClub[] = SEED_CLUBS.map((seed) => {
    const occ = occMap.get(seed.id);
    const ownerUserId = occ ? occ.userId : null;
    const userDetail = ownerUserId ? userMap.get(ownerUserId) : null;

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
      isClaimed: Boolean(ownerUserId),
      isAvailable: !ownerUserId,
    };
  });

  const key = ReadModelKeys.clubsWithOwners(seasonId);
  const snapshot: ReadModelSnapshot<OwnerNeutralClub[]> = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceVersion: `occupancies-${occSnap.size}`,
    data: neutralClubs,
  };

  await redisSetRaw(key, snapshot, 86400);
  setInProcessMemory(key, snapshot);

  // Also build per-league clubs snapshots
  for (const league of SEED_LEAGUES) {
    const leagueClubs = neutralClubs.filter((c) => c.leagueId === league.id);
    const leagueKey = ReadModelKeys.leagueClubs(league.id, seasonId);
    const leagueSnapshot: ReadModelSnapshot<OwnerNeutralClub[]> = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      sourceVersion: `occupancies-${occSnap.size}`,
      data: leagueClubs,
    };
    await redisSetRaw(leagueKey, leagueSnapshot, 86400);
    setInProcessMemory(leagueKey, leagueSnapshot);
  }

  return snapshot;
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
  if (!db) throw new Error('Firestore DB not initialized');

  // Load all season fixtures
  const fixSnap = await db.collection(COLLECTIONS.FIXTURES).where('seasonId', '==', seasonId).get();

  // Filter out any EFL Cup fixtures from active admin view
  const validFixDocs = fixSnap.docs
    .map((d) => ({ id: d.id, ...d.data() } as FirestoreFixtureDoc))
    .filter((f) => !f.competitionId.includes('efl-cup'));

  // Map to full Fixture objects
  const fixtures: Fixture[] = validFixDocs.map((doc) => {
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

  // Sort with the mandatory stable tuple
  fixtures.sort((a, b) => compareAdminFixtures(a, b, false));

  const key = ReadModelKeys.adminFixtures(seasonId);
  const snapshot: ReadModelSnapshot<Fixture[]> = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceVersion: `fixtures-${fixtures.length}`,
    data: fixtures,
  };

  await redisSetRaw(key, snapshot, 86400);
  setInProcessMemory(key, snapshot);

  // Also group and build per-competition fixture snapshots
  const compsSet = new Set(fixtures.map((f) => f.competitionId));
  for (const compId of compsSet) {
    const compFixtures = fixtures.filter((f) => f.competitionId === compId);
    compFixtures.sort((a, b) => compareAdminFixtures(a, b, true));

    const compKey = ReadModelKeys.competitionFixtures(compId, seasonId);
    const compSnapshot: ReadModelSnapshot<Fixture[]> = {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      sourceVersion: `fixtures-${compFixtures.length}`,
      data: compFixtures,
    };
    await redisSetRaw(compKey, compSnapshot, 86400);
    setInProcessMemory(compKey, compSnapshot);
  }

  return snapshot;
}

/**
 * Builds competition standings snapshot.
 */
export async function buildStandingsSnapshot(competitionId: string, seasonId = 'season-2026-27'): Promise<ReadModelSnapshot<StandingsRow[]>> {
  const db = getFirestoreDb();
  if (!db) throw new Error('Firestore DB not initialized');

  // Load standings from preaggregated collection
  const stdSnap = await db.collection(COLLECTIONS.STANDINGS).where('competitionId', '==', competitionId).get();
  let rows: StandingsRow[] = [];

  if (!stdSnap.empty) {
    rows = stdSnap.docs.map((d) => d.data() as StandingsRow);
    rows.sort((a, b) => a.position - b.position);
  }

  const key = ReadModelKeys.standings(competitionId, seasonId);
  const snapshot: ReadModelSnapshot<StandingsRow[]> = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    sourceVersion: `standings-${rows.length}`,
    data: rows,
  };

  await redisSetRaw(key, snapshot, 86400);
  setInProcessMemory(key, snapshot);
  return snapshot;
}

// ----------------------------------------------------
// COMPLETE READ MODEL REBUILD (ADMIN ACTION)
// ----------------------------------------------------

export interface RebuildResult {
  success: boolean;
  generatedAt: string;
  warmedKeys: string[];
  counts: {
    competitions: number;
    clubs: number;
    fixtures: number;
    standings: number;
    userMemberships?: number;
  };
  errors?: string[];
}

export async function rebuildAllReadModels(seasonId = 'season-2026-27'): Promise<RebuildResult> {
  const warmedKeys: string[] = [];
  const errors: string[] = [];

  // 1. Competitions catalog
  let compCount = 0;
  try {
    const compSnap = await buildCompetitionsSnapshot(seasonId);
    compCount = compSnap.data.length;
    warmedKeys.push(ReadModelKeys.competitions(seasonId));
  } catch (err: any) {
    errors.push(`Competitions rebuild error: ${err.message}`);
  }

  // 2. Clubs & occupancies (owner-neutral)
  let clubCount = 0;
  try {
    const clubSnap = await buildClubsSnapshot(seasonId);
    clubCount = clubSnap.data.length;
    warmedKeys.push(ReadModelKeys.clubsWithOwners(seasonId));
    for (const l of SEED_LEAGUES) {
      warmedKeys.push(ReadModelKeys.leagueClubs(l.id, seasonId));
    }
  } catch (err: any) {
    errors.push(`Clubs rebuild error: ${err.message}`);
  }

  // 3. Admin & competition fixtures (sorted by canonical tuple)
  let fixtureCount = 0;
  try {
    const fixSnap = await buildAdminFixturesSnapshot(seasonId);
    fixtureCount = fixSnap.data.length;
    warmedKeys.push(ReadModelKeys.adminFixtures(seasonId));
    const uniqueCompIds = Array.from(new Set(fixSnap.data.map((f) => f.competitionId)));
    for (const cId of uniqueCompIds) {
      warmedKeys.push(ReadModelKeys.competitionFixtures(cId, seasonId));
    }
  } catch (err: any) {
    errors.push(`Fixtures rebuild error: ${err.message}`);
  }

  // 4. Standings for leagues
  let standingsCount = 0;
  const leagueCompIds = [
    'comp-premier-league-2026',
    'comp-la-liga-2026',
    'comp-serie-a-2026',
    'comp-bundesliga-2026',
    'comp-ligue-1-2026',
  ];
  for (const cId of leagueCompIds) {
    try {
      const stdSnap = await buildStandingsSnapshot(cId, seasonId);
      standingsCount += stdSnap.data.length;
      warmedKeys.push(ReadModelKeys.standings(cId, seasonId));
    } catch (err: any) {
      errors.push(`Standings rebuild error for ${cId}: ${err.message}`);
    }
  }

  // 5. Active user memberships needed by application
  let membershipCount = 0;
  try {
    const db = getFirestoreDb();
    if (db) {
      const occSnap = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where('seasonId', '==', seasonId).where('status', '==', 'active').get();
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
            data: membershipData,
          };
          await redisSetRaw(memKey, memSnap, 86400);
          setInProcessMemory(memKey, memSnap);
          warmedKeys.push(memKey);
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
    warmedKeys,
    counts: {
      competitions: compCount,
      clubs: clubCount,
      fixtures: fixtureCount,
      standings: standingsCount,
      userMemberships: membershipCount,
    },
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ----------------------------------------------------
// PAGINATED ADMIN FIXTURES QUERY VIA READ MODEL
// ----------------------------------------------------

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

  // 1. Load full sorted snapshot via Tiered Read Model
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

  // 2. Filter in-memory
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

  // 3. Cursor Pagination
  let startIndex = 0;
  if (options.cursor) {
    const tuple = decodeFixtureCursor(options.cursor);
    if (tuple) {
      // Find index where fixture matches or follows tuple
      const foundIdx = allFixtures.findIndex((f) => f.id === tuple.id);
      if (foundIdx >= 0) {
        startIndex = foundIdx + 1;
      }
    } else {
      // Fallback: match by raw fixture ID
      const rawIdx = allFixtures.findIndex((f) => f.id === options.cursor);
      if (rawIdx >= 0) {
        startIndex = rawIdx + 1;
      }
    }
  }

  const pagedFixtures = allFixtures.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < allFixtures.length;
  const nextCursor = hasMore && pagedFixtures.length > 0
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
// INVALIDATION HOOKS AFTER REAL AUTHORITATIVE MUTATIONS
// ----------------------------------------------------

export async function invalidateClubReadModels(seasonId = 'season-2026-27'): Promise<void> {
  const keys = [
    ReadModelKeys.clubsWithOwners(seasonId),
    ...SEED_LEAGUES.map((l) => ReadModelKeys.leagueClubs(l.id, seasonId)),
    ReadModelKeys.adminFixtures(seasonId),
  ];
  await redisDelRaw(...keys);
}

export async function invalidateFixtureReadModels(competitionId: string, seasonId = 'season-2026-27'): Promise<void> {
  const keys = [
    ReadModelKeys.adminFixtures(seasonId),
    ReadModelKeys.competitionFixtures(competitionId, seasonId),
    ReadModelKeys.standings(competitionId, seasonId),
  ];
  await redisDelRaw(...keys);
}

export async function invalidateStandingsReadModels(competitionId: string, seasonId = 'season-2026-27'): Promise<void> {
  const key = ReadModelKeys.standings(competitionId, seasonId);
  await redisDelRaw(key);
}

export async function invalidateCompetitionReadModels(seasonId = 'season-2026-27'): Promise<void> {
  const keys = [
    ReadModelKeys.competitions(seasonId),
    ReadModelKeys.adminFixtures(seasonId),
  ];
  await redisDelRaw(...keys);
}

export async function invalidateUserMembershipReadModel(userId: string, seasonId = 'season-2026-27'): Promise<void> {
  const key = ReadModelKeys.userMembership(userId, seasonId);
  await redisDelRaw(key);
}

// ----------------------------------------------------
// READ MODEL HEALTH STATUS
// ----------------------------------------------------

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

  // Check which keys are warmed
  const expectedKeys = [
    ReadModelKeys.competitions(seasonId),
    ReadModelKeys.clubsWithOwners(seasonId),
    ReadModelKeys.adminFixtures(seasonId),
    ...SEED_LEAGUES.map((l) => ReadModelKeys.leagueClubs(l.id, seasonId)),
    'comp-premier-league-2026',
    'comp-la-liga-2026',
    'comp-serie-a-2026',
    'comp-bundesliga-2026',
    'comp-ligue-1-2026',
  ].map((k) => (k.startsWith('efluz:') ? k : ReadModelKeys.standings(k, seasonId)));

  const warmedKeys: string[] = [];
  const missingKeys: string[] = [];

  for (const k of expectedKeys) {
    const snap = await redisGetRaw(k);
    if (snap && snap.data !== undefined) {
      warmedKeys.push(k);
    } else {
      missingKeys.push(k);
    }
  }

  const now = Date.now();
  const snapshotAgeSeconds = globalLastSnapshotAt
    ? Math.floor((now - new Date(globalLastSnapshotAt).getTime()) / 1000)
    : null;

  return {
    firestoreState: cb.state,
    redisState,
    circuitBreakerState: {
      state: cb.state,
      consecutiveFailures: cb.consecutiveFailures,
      resourceExhaustedCount: cb.resourceExhaustedCount,
      lastFailureTime: cb.lastFailureTime,
      lastError: cb.lastError,
    },
    lastSnapshotAt: globalLastSnapshotAt,
    snapshotAgeSeconds,
    warmedKeys,
    missingKeys,
  };
}
