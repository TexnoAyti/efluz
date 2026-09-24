import { Firestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { getFirestoreDb } from './admin';
import { queryAll, queryGet, queryRun, dbTransaction } from '../db';
import { SEED_CLUBS, SEED_LEAGUES, SEED_COMPETITIONS, SEED_SEASONS, SEED_SEASON } from '../db/seed';
export { firestoreCircuitBreaker, type CircuitBreakerStatus } from './circuitBreaker';
import { firestoreCircuitBreaker, CircuitBreakerStatus } from './circuitBreaker';
import {
  updateOccupancyRecord,
  removeOccupancyRecord,
  getLocalOccupancySnapshot,
  syncOccupanciesFromFirestoreDocs,
  isClubOccupiedLocally,
  getUserOccupiedClubIdLocally,
  getClubOccupantUserIdLocally,
} from './occupancySnapshot';
import {
  enqueueMutation,
  enqueueDurableOutboxMutation,
  getPendingMutations,
  updateMutationStatus,
  processPendingMutations,
  getQueueStats,
} from '../sync/mutationQueue';

const SEED_CLUB_MAP = new Map<string, (typeof SEED_CLUBS)[0]>(
  SEED_CLUBS.map((c) => [c.id, c])
);
import { generateEuropean32LeaguePhaseSchedule } from '../tournament/fixtureEngine';
import { getAdminFixturesFromReadModel } from '../readModel/readModelStore';
import {
  COLLECTIONS,
  FirestoreClubDoc,
  FirestoreClubMembershipDoc,
  FirestoreCompetitionDoc,
  FirestoreCompetitionParticipantDoc,
  FirestoreFixtureDoc,
  FirestoreLeagueDoc,
  FirestoreNotificationDoc,
  FirestoreResultSubmissionDoc,
  FirestoreSeasonDoc,
  FirestoreUserDoc,
  FirestoreDisputeDoc,
  FirestoreAuditLogDoc,
  FirestoreStandingsDoc,
  FirestoreMatchdayLockDoc,
} from './collections';
import { assertTestEnvironmentSafe, guardAgainstTestEntityCreation, assertNoSyntheticIdsInProduction, isHostedEnvironment } from '../utils/testGuard';

export { assertTestEnvironmentSafe, guardAgainstTestEntityCreation, assertNoSyntheticIdsInProduction };
import {
  Club,
  Competition,
  Fixture,
  FixtureOwnerInfo,
  FixtureUserInfo,
  League,
  MatchStatus,
  Season,
  SeasonStatus,
  StandingsRow,
  User,
  Dispute,
  AuditLog,
  Notification,
} from '../../types';

export class ClubConflictError extends Error {
  public code: string;
  constructor(message: string, code = 'CLUB_CONFLICT') {
    super(message);
    this.name = 'ClubConflictError';
    this.code = code;
  }
}

export class ClubNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClubNotFoundError';
  }
}

// ----------------------------------------------------
// SERVER-SIDE IN-MEMORY TTL CACHE & READ BUDGET TRACKING (FREE-TIER QUOTA OPTIMIZER)
// ----------------------------------------------------
interface ServerCacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

const serverCache = new Map<string, ServerCacheEntry<any>>();

// Long-lived fallback memory stores for absolute resilience
export const lastKnownGoodStandings = new Map<string, StandingsRow[]>();
export const lastKnownGoodFixtures = new Map<string, Fixture[]>();

export interface ReadMetrics {
  totalReads?: number;
  sessionReads: number;
  sessionWrites: number;
  aggregationReads?: number;
  readsByCollection: Record<string, number>;
  readsByFunction: Record<string, number>;
  cacheHits: number;
  cacheMisses: number;
  fallbackCount: number;
  resourceExhaustedCount: number;
  pendingMutationsCount: number;
  successfulSyncs: number;
  failedSyncs: number;
  circuitBreaker: CircuitBreakerStatus;
  classifications: {
    STATIC: number;
    DYNAMIC: number;
    MUTATION: number;
    ADMIN: number;
  };
  endpointMetrics: Record<
    string,
    {
      requestCount: number;
      category: 'STATIC' | 'DYNAMIC' | 'MUTATION' | 'ADMIN';
      estimatedReads: number;
    }
  >;
  budget: {
    freeTierDailyLimit: number;
    estimatedReadsToday: number;
    percentageConsumed: number;
    projectedDailyConsumption: number;
    highestReadEndpoint: string;
    estimatedReadsPerUserSession: number;
    estimatedReadsPerAdminSession: number;
  };
  startedAt: string;
}

const readMetrics = {
  sessionReads: 0,
  sessionWrites: 0,
  aggregationReads: 0,
  readsByCollection: {} as Record<string, number>,
  readsByFunction: {} as Record<string, number>,
  cacheHits: 0,
  cacheMisses: 0,
  fallbackCount: 0,
  classifications: {
    STATIC: 0,
    DYNAMIC: 0,
    MUTATION: 0,
    ADMIN: 0,
  },
  endpointMetrics: {} as Record<
    string,
    {
      requestCount: number;
      category: 'STATIC' | 'DYNAMIC' | 'MUTATION' | 'ADMIN';
      estimatedReads: number;
    }
  >,
  startedAt: new Date().toISOString(),
};

export function trackFirestoreRead(collectionName: string, count = 1, caller = 'unknown') {
  readMetrics.sessionReads += count;
  readMetrics.readsByCollection[collectionName] = (readMetrics.readsByCollection[collectionName] || 0) + count;
  readMetrics.readsByFunction[caller] = (readMetrics.readsByFunction[caller] || 0) + count;
}

export function trackFirestoreAggregation(collectionName: string, count = 1, caller = 'unknown') {
  readMetrics.sessionReads += count;
  readMetrics.aggregationReads = (readMetrics.aggregationReads || 0) + count;
  readMetrics.readsByCollection[collectionName] = (readMetrics.readsByCollection[collectionName] || 0) + count;
  readMetrics.readsByFunction[`aggregation:${caller}`] = (readMetrics.readsByFunction[`aggregation:${caller}`] || 0) + count;
}

export function trackFirestoreWrite(collectionName: string, count = 1, caller = 'unknown') {
  readMetrics.sessionWrites += count;
  readMetrics.readsByFunction[`write:${caller}`] = (readMetrics.readsByFunction[`write:${caller}`] || 0) + count;
}

export function recordEndpointCall(
  endpoint: string,
  category: 'STATIC' | 'DYNAMIC' | 'MUTATION' | 'ADMIN',
  estimatedReads = 0
) {
  readMetrics.classifications[category] = (readMetrics.classifications[category] || 0) + 1;
  if (!readMetrics.endpointMetrics[endpoint]) {
    readMetrics.endpointMetrics[endpoint] = {
      requestCount: 0,
      category,
      estimatedReads: 0,
    };
  }
  readMetrics.endpointMetrics[endpoint].requestCount += 1;
  readMetrics.endpointMetrics[endpoint].estimatedReads += estimatedReads;
}

export function recordFallbackUsage() {
  readMetrics.fallbackCount += 1;
}

export function getReadMetrics(): ReadMetrics {
  const elapsedMs = Math.max(1000, Date.now() - new Date(readMetrics.startedAt).getTime());
  const elapsedMinutes = elapsedMs / 60000;
  const projectedDailyConsumption = Math.round((readMetrics.sessionReads / Math.max(0.1, elapsedMinutes)) * 1440);

  let highestReadEndpoint = 'None';
  let maxReads = -1;
  for (const [ep, meta] of Object.entries(readMetrics.endpointMetrics)) {
    if (meta.estimatedReads > maxReads) {
      maxReads = meta.estimatedReads;
      highestReadEndpoint = ep;
    }
  }

  const freeTierDailyLimit = 50000;
  const percentageConsumed = Number(((readMetrics.sessionReads / freeTierDailyLimit) * 100).toFixed(3));
  const queueStats = getQueueStats();
  const circuit = firestoreCircuitBreaker.getStatus();

  return {
    totalReads: readMetrics.sessionReads,
    sessionReads: readMetrics.sessionReads,
    sessionWrites: readMetrics.sessionWrites,
    aggregationReads: readMetrics.aggregationReads,
    readsByCollection: { ...readMetrics.readsByCollection },
    readsByFunction: { ...readMetrics.readsByFunction },
    cacheHits: readMetrics.cacheHits,
    cacheMisses: readMetrics.cacheMisses,
    fallbackCount: readMetrics.fallbackCount,
    resourceExhaustedCount: circuit.resourceExhaustedCount,
    pendingMutationsCount: queueStats.pending,
    successfulSyncs: queueStats.synced,
    failedSyncs: queueStats.failed,
    circuitBreaker: circuit,
    classifications: { ...readMetrics.classifications },
    endpointMetrics: { ...readMetrics.endpointMetrics },
    budget: {
      freeTierDailyLimit,
      estimatedReadsToday: readMetrics.sessionReads,
      percentageConsumed,
      projectedDailyConsumption,
      highestReadEndpoint,
      estimatedReadsPerUserSession: 2,
      estimatedReadsPerAdminSession: 8,
    },
    startedAt: readMetrics.startedAt,
  };
}

export const getFirestoreTelemetry = getReadMetrics;
export const getFirestoreReadMetrics = getReadMetrics;
export const resetFirestoreReadMetrics = resetReadMetrics;

export function resetReadMetrics(): void {
  readMetrics.sessionReads = 0;
  readMetrics.sessionWrites = 0;
  readMetrics.readsByCollection = {};
  readMetrics.readsByFunction = {};
  readMetrics.cacheHits = 0;
  readMetrics.cacheMisses = 0;
  readMetrics.fallbackCount = 0;
  readMetrics.classifications = {
    STATIC: 0,
    DYNAMIC: 0,
    MUTATION: 0,
    ADMIN: 0,
  };
  readMetrics.endpointMetrics = {};
  readMetrics.startedAt = new Date().toISOString();
}

export function invalidateFirestoreCache(prefix?: string) {
  if (!prefix) {
    serverCache.clear();
    return;
  }
  for (const key of serverCache.keys()) {
    if (key.startsWith(prefix) || key.includes(prefix)) {
      serverCache.delete(key);
    }
  }
}

export function invalidateOwnershipCache(seasonId = 'season-2026-27', clubId?: string) {
  invalidateFirestoreCache(`firestore:occupancies:${seasonId}`);
  invalidateFirestoreCache('firestore:clubs:league:');
  if (clubId) {
    invalidateFirestoreCache(`firestore:club:${clubId}`);
  }
  invalidateFirestoreCache('firestore:club:');
  invalidateFirestoreCache('firestore:admin_paged_fixtures:');
  invalidateFirestoreCache('firestore:admin_fixtures_count:');
  invalidateFirestoreCache(`firestore:fixtures:${seasonId}`);
  invalidateFirestoreCache('firestore:fixtures:');
  lastKnownGoodFixtures.clear();
}

export function getFromCache<T>(key: string): T | null {
  const entry = serverCache.get(key);
  if (entry && Date.now() - entry.timestamp < entry.ttlMs) {
    readMetrics.cacheHits++;
    return entry.data as T;
  }
  readMetrics.cacheMisses++;
  return null;
}

export function getAnyCached<T>(key: string): T | null {
  const entry = serverCache.get(key);
  if (entry && entry.data !== undefined && entry.data !== null) {
    return entry.data as T;
  }
  return null;
}

export function setInCache<T>(key: string, data: T, ttlMs = 60000) {
  if (data === null || data === undefined) {
    return;
  }
  // Prevent overwriting healthy cached array with empty array
  if (Array.isArray(data) && data.length === 0) {
    const existing = serverCache.get(key);
    if (existing && Array.isArray(existing.data) && existing.data.length > 0) {
      console.warn(`[CACHE_PRESERVATION] Preserving healthy non-empty cache for '${key}' instead of overwriting with empty array.`);
      return;
    }
  }
  serverCache.set(key, {
    data,
    timestamp: Date.now(),
    ttlMs,
  });
}

// ----------------------------------------------------
// SEASONS & LEAGUES (ZERO FIRESTORE READS)
// ----------------------------------------------------

export async function getActiveSeasonFirestore(): Promise<Season | null> {
  const active = SEED_SEASONS.find((s) => s.status === 'active') || SEED_SEASON;
  return {
    id: active.id,
    name: active.name,
    status: (active.status?.toLowerCase() as SeasonStatus) || 'active',
    startDate: active.startDate,
    endDate: active.endDate,
    createdAt: '',
  };
}

export async function getAllSeasonsFirestore(): Promise<Season[]> {
  return SEED_SEASONS.map((s) => ({
    id: s.id,
    name: s.name,
    status: (s.status?.toLowerCase() as SeasonStatus) || 'active',
    startDate: s.startDate,
    endDate: s.endDate,
    createdAt: '',
  }));
}

export async function getAllLeaguesFirestore(): Promise<League[]> {
  const cacheKey = 'firestore:all_leagues';
  const cached = getFromCache<League[]>(cacheKey);
  if (cached) return cached;

  // Use canonical SEED_LEAGUES directly to achieve ZERO Firestore reads
  const res: League[] = SEED_LEAGUES.map((l) => ({
    id: l.id,
    name: l.name,
    country: l.country,
    tier: l.tier,
    logoUrl: l.logoUrl,
    createdAt: '',
  }));
  setInCache(cacheKey, res, 86400000); // 24h process-lifetime cache
  return res;
}

// ----------------------------------------------------
// CLUBS & MEMBERSHIPS (ATOMIC CLAIMING)
// ----------------------------------------------------

export interface SeasonOccupancyInfo {
  clubOccupancyMap: Map<string, { userId: string }>;
  usernameMap: Map<string, string>;
  userMap: Map<string, { id: string; username: string; displayName: string }>;
}

export async function getActiveOccupanciesForSeason(
  seasonId = 'season-2026-27'
): Promise<SeasonOccupancyInfo> {
  const cacheKey = `firestore:occupancies:${seasonId}`;
  const cached = getFromCache<SeasonOccupancyInfo>(cacheKey);
  if (cached) return cached;

  // 1. Check Redis clubsWithOwners read model (fresh or LKG)
  try {
    const { redisGetFresh, redisGetLkg, ReadModelKeys } = await import('../readModel/readModelStore');
    const clubsRes = (await redisGetFresh<any[]>(ReadModelKeys.clubsWithOwners(seasonId))) ||
                     (await redisGetLkg<any[]>(ReadModelKeys.clubsWithOwners(seasonId)));
    if (clubsRes && Array.isArray(clubsRes.data) && clubsRes.data.length > 0) {
      const clubOccupancyMap = new Map<string, { userId: string }>();
      const usernameMap = new Map<string, string>();
      const userMap = new Map<string, { id: string; username: string; displayName: string }>();
      for (const c of clubsRes.data) {
        if (c.ownerUserId) {
          clubOccupancyMap.set(c.id, { userId: c.ownerUserId });
          const uname = c.ownerUsername ? c.ownerUsername.replace(/^@+/, '').trim() : c.ownerUserId;
          usernameMap.set(c.ownerUserId, uname);
          userMap.set(c.ownerUserId, {
            id: c.ownerUserId,
            username: uname,
            displayName: uname ? `@${uname}` : `User #${c.ownerUserId}`,
          });
        }
      }
      const info: SeasonOccupancyInfo = { clubOccupancyMap, usernameMap, userMap };
      setInCache(cacheKey, info, 300000);
      return info;
    }
  } catch {}

  // 2. Check SQLite local snapshot / active_occupancies_cache
  const localFallback = getLocalFallbackOccupancies(seasonId, cacheKey);
  if (localFallback.clubOccupancyMap.size > 0 || !firestoreCircuitBreaker.canExecute()) {
    return localFallback;
  }

  try {
    const db = getFirestoreDb();
    const occupanciesSnap = await db
      .collection(COLLECTIONS.CLUB_OCCUPANCIES)
      .where('seasonId', '==', seasonId)
      .where('status', '==', 'active')
      .get();

    firestoreCircuitBreaker.recordSuccess();

    trackFirestoreRead(
      COLLECTIONS.CLUB_OCCUPANCIES,
      occupanciesSnap.docs.length,
      'getActiveOccupanciesForSeason'
    );

    const clubOccupancyMap = new Map<string, { userId: string }>();
    const docDataList: any[] = [];
    for (const doc of occupanciesSnap.docs) {
      const data = doc.data();
      docDataList.push(data);
      if (data.clubId && data.userId) {
        clubOccupancyMap.set(data.clubId, { userId: data.userId });
      }
    }

    // Keep persistent local snapshot in sync
    try {
      syncOccupanciesFromFirestoreDocs(seasonId, docDataList);
    } catch {}

    const userIds = Array.from(new Set(Array.from(clubOccupancyMap.values()).map((o) => o.userId)));
    const usernameMap = new Map<string, string>();
    const userMap = new Map<string, { id: string; username: string; displayName: string }>();
    if (userIds.length > 0) {
      const missingUserIds: string[] = [];
      for (const uid of userIds) {
        const cachedUser = getFromCache<User>(`firestore:user:${uid}`);
        if (cachedUser) {
          const uname = cachedUser.username || cachedUser.firstName || uid;
          usernameMap.set(uid, uname);
          const displayName = `${cachedUser.firstName || ''} ${cachedUser.lastName || ''}`.trim() || cachedUser.username || uid;
          userMap.set(uid, { id: uid, username: cachedUser.username || '', displayName });
        } else {
          missingUserIds.push(uid);
        }
      }

      if (missingUserIds.length > 0) {
        for (let i = 0; i < missingUserIds.length; i += 30) {
          const chunk = missingUserIds.slice(i, i + 30);
          const usersSnap = await db.collection(COLLECTIONS.USERS).where('id', 'in', chunk).get().catch(() => null);
          if (usersSnap) {
            trackFirestoreRead(
              COLLECTIONS.USERS,
              usersSnap.docs.length,
              'getActiveOccupanciesForSeason:users'
            );
            for (const uDoc of usersSnap.docs) {
              const uData = uDoc.data() as FirestoreUserDoc;
              const uname = uData.username || uData.firstName || uDoc.id;
              usernameMap.set(uDoc.id, uname);
              const displayName = `${uData.firstName || ''} ${uData.lastName || ''}`.trim() || uData.username || uDoc.id;
              userMap.set(uDoc.id, { id: uDoc.id, username: uData.username || '', displayName });
              setInCache(
                `firestore:user:${uDoc.id}`,
                {
                  id: uDoc.id,
                  telegramId: uData.telegramId || '',
                  username: uData.username || '',
                  firstName: uData.firstName || '',
                  lastName: uData.lastName || '',
                  photoUrl: uData.photoUrl || '',
                  isAdmin: Boolean(uData.isAdmin),
                  isSuspended: Boolean(uData.isSuspended),
                  createdAt: uData.createdAt || '',
                  updatedAt: uData.updatedAt || '',
                },
                300000
              );
            }
          }
        }
      }
    }

    const result: SeasonOccupancyInfo = { clubOccupancyMap, usernameMap, userMap };
    setInCache(cacheKey, result, 60000); // 60s shared occupancy cache
    return result;
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    recordFallbackUsage();
    console.warn('[FIRESTORE FALLBACK] getActiveOccupanciesForSeason:', err.message);
    return getLocalFallbackOccupancies(seasonId, cacheKey);
  }
}

function getLocalFallbackOccupancies(seasonId: string, cacheKey: string): SeasonOccupancyInfo {
  const clubOccupancyMap = new Map<string, { userId: string }>();
  const usernameMap = new Map<string, string>();
  const userMap = new Map<string, { id: string; username: string; displayName: string }>();

  // 1. From active_occupancies_cache
  try {
    const snapshot = getLocalOccupancySnapshot(seasonId);
    for (const snap of snapshot) {
      if (snap.claimedByUserId && snap.status === 'active') {
        clubOccupancyMap.set(snap.clubId, { userId: snap.claimedByUserId });
      }
    }
  } catch {}

  // 2. Merge with SQLite club_memberships + users
  try {
    const rows = queryAll<any>(
      `SELECT cm.club_id, cm.user_id, u.username as manager_username, u.first_name, u.last_name
       FROM club_memberships cm
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE cm.season_id = ? AND cm.status = 'active'`,
      [seasonId]
    );
    for (const r of rows) {
      clubOccupancyMap.set(r.club_id, { userId: r.user_id });
      if (r.manager_username) {
        usernameMap.set(r.user_id, r.manager_username);
      }
      const displayName = `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.manager_username || r.user_id;
      userMap.set(r.user_id, { id: r.user_id, username: r.manager_username || '', displayName });
    }
  } catch {}

  const result: SeasonOccupancyInfo = { clubOccupancyMap, usernameMap, userMap };
  setInCache(cacheKey, result, 60000);
  return result;
}

export async function getClubsByLeagueFirestore(
  leagueId: string,
  seasonId = 'season-2026-27',
  currentUserId?: string
): Promise<Club[]> {
  const cacheKey = `firestore:clubs:league:${leagueId}:${seasonId}`;
  const cached = getFromCache<Club[]>(cacheKey);
  if (cached && cached.length > 0) {
    return cached.map((c) => {
      const isCurrentUserClub = Boolean(currentUserId && c.claimedByUserId === currentUserId);
      const isTaken = c.isTaken;
      return {
        ...c,
        isCurrentUserClub,
        occupancy: {
          ...c.occupancy,
          status: isCurrentUserClub ? 'owned' : isTaken ? 'occupied' : 'available',
        },
      };
    });
  }

  try {
    // 1. Get static clubs for this league from SEED_CLUBS (zero Firestore reads!)
    const staticLeagueClubs = SEED_CLUBS.filter((c) => c.leagueId === leagueId);

    // 2. Fetch or reuse shared active occupancies for this season (0-1 Firestore query across all leagues)
    const { clubOccupancyMap, usernameMap } = await getActiveOccupanciesForSeason(seasonId);

    const clubs: Club[] = staticLeagueClubs.map((seed) => {
      const occupancy = clubOccupancyMap.get(seed.id);
      const isTaken = Boolean(occupancy);
      const isCurrentUserClub = Boolean(currentUserId && occupancy && occupancy.userId === currentUserId);
      const managerUsername = occupancy ? usernameMap.get(occupancy.userId) : undefined;
      const claimedByUserId = occupancy ? occupancy.userId : null;
      const claimedByUsername = managerUsername || null;

      const occupancyStatus: 'owned' | 'occupied' | 'available' = isCurrentUserClub
        ? 'owned'
        : isTaken
        ? 'occupied'
        : 'available';

      return {
        id: seed.id,
        name: seed.name,
        shortName: seed.shortName,
        leagueId: seed.leagueId,
        country: seed.country,
        logoUrl: seed.logoUrl,
        active: true,
        createdAt: '',
        isTaken,
        isCurrentUserClub,
        claimedByUserId,
        claimedByUsername,
        managerUsername,
        occupancy: {
          status: occupancyStatus,
          userId: occupancy ? occupancy.userId : undefined,
          username: managerUsername,
        },
      };
    });

    const sortedClubs = clubs.sort((a, b) => a.name.localeCompare(b.name));
    if (sortedClubs.length > 0) {
      const neutralClubsForCache = sortedClubs.map((c) => ({
        ...c,
        isCurrentUserClub: false,
        occupancy: {
          ...c.occupancy,
          status: (c.isTaken ? 'occupied' : 'available') as 'occupied' | 'available',
        },
      }));
      setInCache(cacheKey, neutralClubsForCache, 60000); // 60s cache
    }
    return sortedClubs;
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getClubsByLeagueFirestore:', err.message);
    const rows = queryAll<any>(
      `SELECT c.*, cm.user_id as claimed_by_user_id, u.username as manager_username
       FROM clubs c
       LEFT JOIN club_memberships cm ON c.id = cm.club_id AND cm.season_id = ? AND cm.status = 'active'
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE c.league_id = ? AND c.active = 1
       ORDER BY c.name ASC`,
      [seasonId, leagueId]
    );

    const fallbackClubs: Club[] = rows.map((r) => {
      const isTaken = Boolean(r.claimed_by_user_id);
      const isCurrentUserClub = Boolean(currentUserId && r.claimed_by_user_id === currentUserId);
      return {
        id: r.id,
        name: r.name,
        shortName: r.short_name,
        leagueId: r.league_id,
        country: r.country,
        logoUrl: r.logo_url,
        active: Boolean(r.active),
        createdAt: r.created_at,
        isTaken,
        isCurrentUserClub,
        claimedByUserId: r.claimed_by_user_id || null,
        claimedByUsername: r.manager_username || null,
        managerUsername: r.manager_username || undefined,
        occupancy: {
          status: isCurrentUserClub ? 'owned' : isTaken ? 'occupied' : 'available',
          userId: r.claimed_by_user_id || undefined,
          username: r.manager_username || undefined,
        },
      };
    });

    if (fallbackClubs.length > 0) {
      setInCache(cacheKey, fallbackClubs, 60000);
    }
    return fallbackClubs;
  }
}

export async function getAvailableClubsFirestore(
  seasonId = 'season-2026-27',
  currentUserId?: string
): Promise<Club[]> {
  const cacheKey = `firestore:clubs:available:${seasonId}`;
  const cached = getFromCache<Club[]>(cacheKey);
  if (cached && cached.length > 0) return cached;

  try {
    const { clubOccupancyMap } = await getActiveOccupanciesForSeason(seasonId);

    // Filter from SEED_CLUBS directly (0 extra reads)
    const availableClubs: Club[] = SEED_CLUBS.filter((c) => !clubOccupancyMap.has(c.id)).map((seed) => ({
      id: seed.id,
      name: seed.name,
      shortName: seed.shortName,
      leagueId: seed.leagueId,
      country: seed.country,
      logoUrl: seed.logoUrl,
      active: true,
      createdAt: '',
      isTaken: false,
      isCurrentUserClub: false,
      occupancy: {
        status: 'available',
      },
    }));

    const sortedClubs = availableClubs.sort((a, b) => a.name.localeCompare(b.name));
    if (sortedClubs.length > 0) {
      setInCache(cacheKey, sortedClubs, 60000);
    }
    return sortedClubs;
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getAvailableClubsFirestore:', err.message);
    const rows = queryAll<any>(
      `SELECT c.* FROM clubs c
       LEFT JOIN club_memberships cm ON c.id = cm.club_id AND cm.season_id = ? AND cm.status = 'active'
       WHERE c.active = 1 AND cm.id IS NULL
       ORDER BY c.name ASC`,
      [seasonId]
    );
    const fallbackClubs = rows.map((r) => ({
      id: r.id,
      name: r.name,
      shortName: r.short_name,
      leagueId: r.league_id,
      country: r.country,
      logoUrl: r.logo_url,
      active: Boolean(r.active),
      createdAt: r.created_at,
      isTaken: false,
      isCurrentUserClub: false,
      occupancy: {
        status: 'available' as const,
      },
    }));
    if (fallbackClubs.length > 0) {
      setInCache(cacheKey, fallbackClubs, 60000);
    }
    return fallbackClubs;
  }
}

export async function getClubByIdFirestore(
  clubId: string,
  seasonId = 'season-2026-27',
  currentUserId?: string
): Promise<Club | null> {
  const cacheKey = `firestore:club:${clubId}:${seasonId}`;
  const cached = getFromCache<Club>(cacheKey);
  if (cached) {
    const isCurrentUserClub = Boolean(currentUserId && cached.claimedByUserId === currentUserId);
    return {
      ...cached,
      isCurrentUserClub,
      occupancy: {
        ...cached.occupancy,
        status: isCurrentUserClub ? 'owned' : cached.isTaken ? 'occupied' : 'available',
      },
    };
  }

  const seed = SEED_CLUB_MAP.get(clubId);

  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();
      trackFirestoreRead(COLLECTIONS.CLUB_OCCUPANCIES, 1, 'getClubByIdFirestore');
      const occDoc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`).get().catch(() => null);

      firestoreCircuitBreaker.recordSuccess();

      let occUserId: string | null = null;
      if (occDoc && occDoc.exists && occDoc.data()?.status === 'active') {
        occUserId = occDoc.data()!.userId;
      }

      let isTaken = false;
      let managerUsername: string | undefined;
      let isCurrentUserClub = false;

      if (occUserId) {
        isTaken = true;
        isCurrentUserClub = Boolean(currentUserId && currentUserId === occUserId);
        const user = await getUserByIdFirestore(occUserId);
        managerUsername = user?.username;
      }

      const occupancyStatus: 'owned' | 'occupied' | 'available' = isCurrentUserClub
        ? 'owned'
        : isTaken
        ? 'occupied'
        : 'available';

      const clubRes: Club = {
        id: clubId,
        name: seed?.name || clubId,
        shortName: seed?.shortName || clubId,
        leagueId: seed?.leagueId || '',
        country: seed?.country || '',
        logoUrl: seed?.logoUrl || '',
        active: true,
        createdAt: '',
        isTaken,
        isCurrentUserClub,
        claimedByUserId: occUserId,
        claimedByUsername: managerUsername || null,
        managerUsername,
        occupancy: {
          status: occupancyStatus,
          userId: occUserId || undefined,
          username: managerUsername,
        },
      };

      setInCache(cacheKey, clubRes, 60000);
      return clubRes;
    } catch (err: any) {
      firestoreCircuitBreaker.recordFailure(err);
      recordFallbackUsage();
      console.warn('[FIRESTORE FALLBACK] getClubByIdFirestore:', err.message);
    }
  } else {
    recordFallbackUsage();
  }

  // SQLite & Local Occupancy Fallback
  let occUserId: string | null = null;
  const localSnap = getLocalOccupancySnapshot(seasonId);
  const matched = localSnap.find((s) => s.clubId === clubId && s.status === 'active');
  if (matched?.claimedByUserId) {
    occUserId = matched.claimedByUserId;
  }

  const r = queryGet<any>(
    `SELECT c.*, cm.user_id as claimed_by_user_id, u.username as manager_username
     FROM clubs c
     LEFT JOIN club_memberships cm ON c.id = cm.club_id AND cm.season_id = ? AND cm.status = 'active'
     LEFT JOIN users u ON cm.user_id = u.id
     WHERE c.id = ?`,
    [seasonId, clubId]
  );

  const finalClaimedBy = occUserId || r?.claimed_by_user_id || null;
  const isTaken = Boolean(finalClaimedBy);
  const isCurrentUserClub = Boolean(currentUserId && finalClaimedBy === currentUserId);
  const managerUsername = r?.manager_username || undefined;

  const fallbackRes: Club = {
    id: clubId,
    name: r?.name || seed?.name || clubId,
    shortName: r?.short_name || seed?.shortName || clubId,
    leagueId: r?.league_id || seed?.leagueId || '',
    country: r?.country || seed?.country || '',
    logoUrl: r?.logo_url || seed?.logoUrl || '',
    active: r ? Boolean(r.active) : true,
    createdAt: r?.created_at || '',
    isTaken,
    isCurrentUserClub,
    claimedByUserId: finalClaimedBy,
    claimedByUsername: managerUsername || null,
    managerUsername,
    occupancy: {
      status: isCurrentUserClub ? 'owned' : isTaken ? 'occupied' : 'available',
      userId: finalClaimedBy || undefined,
      username: managerUsername,
    },
  };
  setInCache(cacheKey, fallbackRes, 60000);
  return fallbackRes;
}

export async function getUserActiveClubFirestore(userId: string, seasonId = 'season-2026-27'): Promise<Club | null> {
  const cacheKey = `firestore:user_active_club:${userId}:${seasonId}`;
  const cached = getFromCache<Club | { noClub: true }>(cacheKey);
  if (cached) {
    if ('noClub' in cached) return null;
    return cached as Club;
  }

  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();

      // 1. Try USER_MEMBERSHIPS doc (${seasonId}_${userId}) - exactly 1 read
      trackFirestoreRead(COLLECTIONS.USER_MEMBERSHIPS, 1, 'getUserActiveClubFirestore');
      const userMemDoc = await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userId}`).get().catch(() => null);

      firestoreCircuitBreaker.recordSuccess();

      if (userMemDoc && userMemDoc.exists && userMemDoc.data()?.status === 'active') {
        const clubId = userMemDoc.data()!.clubId;
        const seed = SEED_CLUB_MAP.get(clubId);
        const user = await getUserByIdFirestore(userId);
        const c: Club = {
          id: clubId,
          name: seed?.name || clubId,
          shortName: seed?.shortName || clubId,
          leagueId: seed?.leagueId || '',
          country: seed?.country || '',
          logoUrl: seed?.logoUrl || '',
          active: true,
          createdAt: '',
          isTaken: true,
          isCurrentUserClub: true,
          claimedByUserId: userId,
          claimedByUsername: user?.username || null,
          managerUsername: user?.username,
          occupancy: {
            status: 'owned',
            userId,
            username: user?.username,
          },
        };
        setInCache(cacheKey, c, 60000);
        return c;
      } else {
        // User has no active club - cache negative response
        setInCache(cacheKey, { noClub: true }, 60000);
        return null;
      }
    } catch (err: any) {
      firestoreCircuitBreaker.recordFailure(err);
      recordFallbackUsage();
      console.warn('[FIRESTORE FALLBACK] getUserActiveClubFirestore:', err.message);
    }
  } else {
    recordFallbackUsage();
  }

  // SQLite + local occupancy snapshot fallback
  const localClubId = getUserOccupiedClubIdLocally(seasonId, userId);
  if (localClubId) {
    const c = await getClubByIdFirestore(localClubId, seasonId, userId);
    if (c) {
      setInCache(cacheKey, c, 60000);
      return c;
    }
  }

  const mem = queryGet<any>(
    `SELECT club_id FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = 'active' LIMIT 1`,
    [userId, seasonId]
  );
  if (mem) {
    const c = await getClubByIdFirestore(mem.club_id, seasonId, userId);
    if (c) {
      setInCache(cacheKey, c, 60000);
      return c;
    }
  }
  setInCache(cacheKey, { noClub: true }, 60000);
  return null;
}

/**
 * ATOMIC FIRESTORE CLUB CLAIM TRANSACTION
 * Guarantees 1 user = max 1 club per season AND 1 club = max 1 user per season.
 */
export async function claimClubAtomicFirestore(
  userId: string,
  clubId: string,
  seasonId = 'season-2026-27',
  options?: { authoritativeOnly?: boolean }
): Promise<{ success: boolean; club: Club; authoritative?: boolean; isFallback?: boolean }> {
  assertNoSyntheticIdsInProduction('claimClubAtomicFirestore', [userId, clubId, seasonId]);
  const now = new Date().toISOString();

  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();

      if (process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true') {
        const seedClub = SEED_CLUBS.find((candidate) => candidate.id === clubId);
        const seedRef = db.collection(COLLECTIONS.CLUBS).doc(clubId);
        const seedDoc = await seedRef.get();
        if (!seedDoc.exists && seedClub) {
          await seedRef.set({
            id: seedClub.id,
            name: seedClub.name,
            shortName: seedClub.shortName,
            leagueId: seedClub.leagueId,
            country: seedClub.country,
            logo: seedClub.logoUrl,
            isActive: true,
            createdAt: now,
          }, { merge: true });
        }
      }

      const claimResult = await db.runTransaction(async (transaction) => {
        const userMemRef = db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userId}`);
        const clubOccRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`);
        const membershipRef = db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${clubId}`);
        const clubRef = db.collection(COLLECTIONS.CLUBS).doc(clubId);

        // 1. Read club existence
        trackFirestoreRead(COLLECTIONS.CLUBS, 1, 'claimClubAtomicFirestore:club');
        const clubDoc = await transaction.get(clubRef);
        if (!clubDoc.exists) {
          throw new ClubNotFoundError(`Club with ID '${clubId}' does not exist.`);
        }
        const clubData = clubDoc.data() as FirestoreClubDoc;

        // 2. Read user's existing membership for this season
        trackFirestoreRead(COLLECTIONS.CLUB_OCCUPANCIES, 1, 'claimClubAtomicFirestore:occupancy');
        trackFirestoreRead(COLLECTIONS.USER_MEMBERSHIPS, 1, 'claimClubAtomicFirestore:membership');
        const clubOccDoc = await transaction.get(clubOccRef);
        const userMemDoc = await transaction.get(userMemRef);
        if (userMemDoc.exists) {
          const userMemData = userMemDoc.data();
          if (userMemData?.clubId && !['released', 'archived', 'inactive'].includes(userMemData.status)) {
            if (userMemData.clubId === clubId) {
              if (!clubOccDoc.exists || clubOccDoc.data()?.userId !== userId || ['released', 'inactive'].includes(clubOccDoc.data()?.status)) {
                throw new ClubConflictError('Club membership and occupancy disagree. Admin review is required.', 'OWNERSHIP_INCONSISTENT');
              }
              // Idempotent: already owns this club
              return {
                success: true,
                club: {
                  id: clubDoc.id,
                  name: clubData.name,
                  shortName: clubData.shortName,
                  leagueId: clubData.leagueId,
                  country: clubData.country,
                  logoUrl: clubData.logo,
                  active: clubData.isActive,
                  createdAt: clubData.createdAt,
                  isTaken: true,
                  isCurrentUserClub: true,
                  claimedByUserId: userId,
                  occupancy: {
                    status: 'owned' as const,
                    userId,
                  },
                },
              };
            }
            // User already has a DIFFERENT club
            throw new ClubConflictError(
              `Your club selection is locked for this season. You have already claimed another club.`,
              'CLUB_SELECTION_LOCKED'
            );
          }
        }

        // 3. Read club occupancy for this season (authoritative source of truth)
        if (clubOccDoc.exists) {
          const clubOccData = clubOccDoc.data();
          if (clubOccData?.userId && !['released', 'inactive'].includes(clubOccData.status) && clubOccData.userId !== userId) {
            throw new ClubConflictError(
              `This club has already been selected by another player for this season.`,
              'CLUB_OCCUPIED'
            );
          }
        }

        // 4. Atomically commit the claim
        const membershipPayload: FirestoreClubMembershipDoc = {
          id: `cm-${seasonId}-${clubId}`,
          seasonId,
          clubId,
          userId,
          claimedAt: now,
          status: 'active',
          updatedAt: now,
        };

        transaction.set(userMemRef, {
          userId,
          clubId,
          seasonId,
          status: 'active',
          claimedAt: now,
          updatedAt: now,
        });

        transaction.set(clubOccRef, {
          clubId,
          userId,
          seasonId,
          status: 'active',
          claimedAt: now,
          updatedAt: now,
        });

        transaction.set(membershipRef, membershipPayload);

        transaction.update(clubRef, {
          isTaken: true,
          claimedByUserId: userId,
        });

        trackFirestoreWrite(COLLECTIONS.CLUB_OCCUPANCIES, 4, 'claimClubAtomicFirestore');

        return {
          success: true,
          club: {
            id: clubDoc.id,
            name: clubData.name,
            shortName: clubData.shortName,
            leagueId: clubData.leagueId,
            country: clubData.country,
            logoUrl: clubData.logo,
            active: clubData.isActive,
            createdAt: clubData.createdAt,
            isTaken: true,
            isCurrentUserClub: true,
            claimedByUserId: userId,
            occupancy: {
              status: 'owned' as const,
              userId,
            },
          },
        };
      });

      // Verify occupancy persistence directly in Firestore
      trackFirestoreRead(COLLECTIONS.CLUB_OCCUPANCIES, 1, 'claimClubAtomicFirestore:verify');
      const verifyOcc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`).get();
      if (!verifyOcc.exists || verifyOcc.data()?.status !== 'active') {
        throw new Error(`OCCUPANCY_PERSISTENCE_FAILED: Failed to verify club occupancy record at '${COLLECTIONS.CLUB_OCCUPANCIES}/${seasonId}_${clubId}'.`);
      }

      firestoreCircuitBreaker.recordSuccess();

      // Mirror to local occupancy snapshot & SQLite
      try {
        updateOccupancyRecord({
          clubId,
          seasonId,
          status: 'active',
          claimedByUserId: userId,
          claimedAt: now,
          updatedAt: now,
        });
        queryRun(
          `INSERT OR REPLACE INTO club_memberships (id, season_id, club_id, user_id, claimed_at, status, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?)`,
          [`cm-${seasonId}-${clubId}`, seasonId, clubId, userId, now, now]
        );
      } catch {}

      invalidateFirestoreCache();
      return {
        ...claimResult,
        authoritative: true,
        isFallback: false,
      };
    } catch (err: any) {
      if (err instanceof ClubConflictError || err instanceof ClubNotFoundError) {
        throw err;
      }
      firestoreCircuitBreaker.recordFailure(err);
      recordFallbackUsage();
      console.warn('[FIRESTORE REJECT] claimClubAtomicFirestore failed authoritatively:', err.message);
      throw err;
    }
  } else {
    recordFallbackUsage();
    throw new Error('CIRCUIT_OPEN: Firestore circuit breaker is OPEN. Authoritative write cannot execute.');
  }

  // Resilient Offline Claim with SQLite & mutation queue
  return dbTransaction(() => {
    const seed = SEED_CLUB_MAP.get(clubId);
    const club = queryGet<any>('SELECT * FROM clubs WHERE id = ?', [clubId]);
    if (!club && !seed) {
      throw new ClubNotFoundError(`Club with ID '${clubId}' does not exist.`);
    }

    const existingMem = queryGet<any>(
      "SELECT * FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = 'active'",
      [userId, seasonId]
    );
    if (existingMem) {
      if (existingMem.club_id === clubId) {
        const c = getClubByIdFirestore(clubId, seasonId, userId);
        return { success: true, club: c as any, authoritative: false, isFallback: true };
      }
      throw new ClubConflictError(
        'Your club selection is locked for this season. You have already claimed another club.',
        'CLUB_SELECTION_LOCKED'
      );
    }

    // Check local occupancy snapshot
    const snapOccUserId = getClubOccupantUserIdLocally(seasonId, clubId);
    if (snapOccUserId && snapOccUserId !== userId) {
      throw new ClubConflictError(
        'This club has already been selected by another player for this season.',
        'CLUB_OCCUPIED'
      );
    }

    const occupied = queryGet<any>(
      "SELECT * FROM club_memberships WHERE club_id = ? AND season_id = ? AND status = 'active'",
      [clubId, seasonId]
    );
    if (occupied && occupied.user_id !== userId) {
      throw new ClubConflictError(
        'This club has already been selected by another player for this season.',
        'CLUB_OCCUPIED'
      );
    }

    const memId = `cm-${seasonId}-${clubId}`;
    queryRun(
      `INSERT OR REPLACE INTO club_memberships (id, season_id, club_id, user_id, claimed_at, status, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      [memId, seasonId, clubId, userId, now, now]
    );

    updateOccupancyRecord({
      clubId,
      seasonId,
      status: 'active',
      claimedByUserId: userId,
      claimedAt: now,
      updatedAt: now,
    });

    // Enqueue durable mutation to sync to Firestore when quota recovers
    enqueueMutation({
      mutationId: `claim_${seasonId}_${clubId}_${userId}`,
      entityType: 'CLUB_CLAIM',
      entityId: clubId,
      operation: 'CLAIM_CLUB',
      payload: { clubId, seasonId, userId, claimedAt: now },
      createdAt: now,
    });

    invalidateFirestoreCache();

    const claimedClub: Club = {
      id: clubId,
      name: club?.name || seed?.name || clubId,
      shortName: club?.short_name || seed?.shortName || clubId,
      leagueId: club?.league_id || seed?.leagueId || '',
      country: club?.country || seed?.country || '',
      logoUrl: club?.logo_url || seed?.logoUrl || '',
      active: true,
      createdAt: now,
      isTaken: true,
      isCurrentUserClub: true,
      claimedByUserId: userId,
      occupancy: {
        status: 'owned' as const,
        userId,
      },
    };

    return { success: true, club: claimedClub, authoritative: false, isFallback: true };
  });
}

// ----------------------------------------------------
// COMPETITIONS & FIXTURES
// ----------------------------------------------------

const compOverrideMap = new Map<string, Partial<FirestoreCompetitionDoc>>();

export async function getAllCompetitionsFirestore(seasonId = 'season-2026-27'): Promise<Competition[]> {
  const cacheKey = `firestore:competitions:${seasonId}`;
  const cached = getFromCache<Competition[]>(cacheKey);
  if (cached && cached.length > 0) return cached;

  // Serve static competitions from SEED_COMPETITIONS (ZERO Firestore reads)
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
    const override = compOverrideMap.get(seed.id) || {};
    const fixturesCount = override.fixturesCount ?? override.fixtureCount ?? (override.hasFixtures ? 1 : 0);
    const hasFixtures = Boolean(override.hasFixtures || fixturesCount > 0);
    const generationStatus: 'generated' | 'not_generated' = hasFixtures ? 'generated' : 'not_generated';

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
      : override.totalMatchdays || 8;

    return {
      id: seed.id,
      seasonId: seed.seasonId || seasonId,
      leagueId: seed.leagueId,
      name: seed.name,
      type: seed.type as any,
      scheduleMode: seed.scheduleMode as any,
      status: (hasFixtures ? 'active' : 'active') as any,
      totalTeams,
      hasFixtures,
      fixtureCount: fixturesCount,
      fixturesCount,
      generationStatus,
      formatConfig: seed.formatConfig || {},
      currentMatchday: override.currentMatchday || 1,
      totalMatchdays,
      isMatchdayOpen: override.isMatchdayOpen !== false,
      matchdayOpenedAt: override.matchdayOpenedAt,
      matchdayDurationHours: override.matchdayDurationHours || 30,
      nextMatchdayOpenAt: override.nextMatchdayOpenAt,
      adminOverrideStatus: override.adminOverrideStatus || 'AUTO',
      createdAt: '',
    };
  });

  setInCache(cacheKey, competitions, 300000); // 5 min cache
  return competitions;
}

export async function getCompetitionByIdFirestore(competitionId: string): Promise<Competition | null> {
  const all = await getAllCompetitionsFirestore();
  const comp = all.find((c) => c.id === competitionId);
  return comp || null;
}

export async function getRawClubFixturesFirestore(
  clubId: string,
  seasonId = 'season-2026-27'
): Promise<FirestoreFixtureDoc[]> {
  const cacheKey = `firestore:club_raw_fixtures:${seasonId}:${clubId}`;
  const cached = getFromCache<FirestoreFixtureDoc[]>(cacheKey);
  if (cached) return cached;

  try {
    const db = getFirestoreDb();
    const [homeSnap, awaySnap] = await Promise.all([
      db
        .collection(COLLECTIONS.FIXTURES)
        .where('homeClubId', '==', clubId)
        .get(),
      db
        .collection(COLLECTIONS.FIXTURES)
        .where('awayClubId', '==', clubId)
        .get(),
    ]);

    const reads =
      (homeSnap.empty ? 1 : homeSnap.docs.length) + (awaySnap.empty ? 1 : awaySnap.docs.length);
    trackFirestoreRead(COLLECTIONS.FIXTURES, reads, 'getRawClubFixturesFirestore');

    const docMap = new Map<string, FirestoreFixtureDoc>();
    homeSnap.docs.forEach((d) => docMap.set(d.id, d.data() as FirestoreFixtureDoc));
    awaySnap.docs.forEach((d) => docMap.set(d.id, d.data() as FirestoreFixtureDoc));

    const docs = Array.from(docMap.values());
    setInCache(cacheKey, docs, 30000); // 30s cache
    return docs;
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getRawClubFixturesFirestore:', err.message);
    return [];
  }
}

export function checkFixturePlayability(
  competitionId: string,
  seasonId: string,
  matchday: number,
  fixtureStatus: string,
  homeClubId?: string | null,
  awayClubId?: string | null,
  compData?: Partial<FirestoreCompetitionDoc> | null,
  preloadedLock?: FirestoreMatchdayLockDoc | null
): { isPlayable: boolean; activeMatchday: number } {
  let resolvedComp = compData;
  if (!resolvedComp && competitionId) {
    resolvedComp = compOverrideMap.get(competitionId) || null;
  }
  const activeMatchday = resolvedComp?.currentMatchday || 1;

  if (fixtureStatus === 'CONFIRMED') {
    return { isPlayable: false, activeMatchday };
  }
  if (!homeClubId || homeClubId === 'TBD' || !awayClubId || awayClubId === 'TBD') {
    return { isPlayable: false, activeMatchday };
  }

  // 1. Resolve exact granular lock: seasonId + competitionId + matchday
  const key = getMatchdayLockKey(seasonId, competitionId, matchday);
  let lock: FirestoreMatchdayLockDoc | null = preloadedLock || null;

  if (!lock) {
    if (matchdayLocksCache.has(key)) {
      lock = matchdayLocksCache.get(key) || null;
    } else {
      try {
        const row = queryGet<any>(
          'SELECT * FROM matchday_locks WHERE season_id = ? AND competition_id = ? AND matchday = ?',
          [seasonId, competitionId, matchday]
        );
        if (row) {
          lock = {
            id: row.id,
            seasonId: row.season_id,
            competitionId: row.competition_id,
            matchday: row.matchday,
            overrideStatus: row.override_status,
            isOpen: Boolean(row.is_open),
            isLocked: Boolean(row.is_locked),
            durationHours: row.duration_hours || undefined,
            openedAt: row.opened_at || undefined,
            lockedAt: row.locked_at || undefined,
            expiresAt: row.expires_at || undefined,
            updatedAt: row.updated_at,
          };
          matchdayLocksCache.set(key, lock);
        }
      } catch {}
    }
  }

  // 2. If granular lock exists, it takes precedence over competition-level defaults
  if (lock) {
    if (lock.overrideStatus === 'FORCE_OPEN' || lock.isOpen === true) {
      return { isPlayable: true, activeMatchday };
    }
    if (
      lock.overrideStatus === 'FORCE_LOCKED' ||
      lock.overrideStatus === 'PAUSED' ||
      lock.isLocked ||
      lock.isOpen === false
    ) {
      return { isPlayable: false, activeMatchday };
    }
  }

  // 3. Only if NO granular lock exists: use competition-level fallback
  const adminStatus = resolvedComp?.adminOverrideStatus || 'AUTO';
  const isMatchdayOpen = resolvedComp?.isMatchdayOpen !== false;
  const compType =
    resolvedComp?.type ||
    (competitionId.includes('cup') ||
    competitionId.includes('pokal') ||
    competitionId.includes('rey') ||
    competitionId.includes('italia')
      ? 'KNOCKOUT'
      : 'LEAGUE');
  const isKnockout =
    compType === 'KNOCKOUT' ||
    compType === 'SUPER_CUP' ||
    compType === 'EUROPEAN_KNOCKOUT';

  if (adminStatus === 'FORCE_LOCKED' || adminStatus === 'PAUSED') {
    return { isPlayable: false, activeMatchday };
  }
  if (!isMatchdayOpen) {
    return { isPlayable: false, activeMatchday };
  }

  if (isKnockout) {
    return { isPlayable: true, activeMatchday };
  }

  if (adminStatus === 'FORCE_OPEN') {
    return { isPlayable: matchday === activeMatchday, activeMatchday };
  }

  return { isPlayable: matchday === activeMatchday, activeMatchday };
}

export async function getFixturesFirestore(filter: {
  competitionId?: string;
  seasonId?: string;
  matchday?: number;
  status?: string;
  userId?: string;
  clubId?: string;
  limit?: number;
}): Promise<Fixture[]> {
  const seasonId = filter.seasonId || 'season-2026-27';

  let targetClubId = filter.clubId;

  // If filtered by userId, resolve user's active club
  if (filter.userId && !targetClubId) {
    const activeClub = await getUserActiveClubFirestore(filter.userId, seasonId);
    if (!activeClub) {
      return [];
    }
    targetClubId = activeClub.id;
  }

  const cacheKey = targetClubId
    ? `firestore:fixtures:club:${targetClubId}:md${filter.matchday || 'all'}:st${filter.status || 'all'}:comp${filter.competitionId || 'all'}`
    : filter.competitionId
    ? `firestore:fixtures:comp:${filter.competitionId}:md${filter.matchday || 'all'}:st${filter.status || 'all'}:lim${filter.limit || 'all'}`
    : null;

  if (cacheKey) {
    const cached = getFromCache<Fixture[]>(cacheKey);
    if (cached) return cached;
  }

  if (!firestoreCircuitBreaker.canExecute()) {
    recordFallbackUsage();
    return executeFixturesFallback(filter, targetClubId, cacheKey);
  }

  try {
    const db = getFirestoreDb();
    let docs: FirestoreFixtureDoc[] = [];

    if (targetClubId) {
      // Fetch or reuse raw club fixtures (0-38 actual reads across /api/me and /api/me/matches)
      docs = await getRawClubFixturesFirestore(targetClubId, seasonId);

      // In-memory filters for targetClubId matches
      if (filter.competitionId) {
        docs = docs.filter((f) => f.competitionId === filter.competitionId);
      }
      if (filter.seasonId) {
        docs = docs.filter((f) => !f.seasonId || f.seasonId === filter.seasonId);
      }
      if (filter.matchday) {
        docs = docs.filter((f) => f.matchday === filter.matchday);
      }
      if (filter.status) {
        docs = docs.filter((f) => f.status === filter.status);
      }
    } else {
      let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.FIXTURES);

      if (filter.competitionId) {
        query = query.where('competitionId', '==', filter.competitionId);
      } else if (filter.seasonId) {
        query = query.where('seasonId', '==', filter.seasonId);
      }

      if (filter.matchday) {
        query = query.where('matchday', '==', filter.matchday);
      }

      if (filter.status) {
        query = query.where('status', '==', filter.status);
      }

      const snap = await query.get();
      firestoreCircuitBreaker.recordSuccess();
      trackFirestoreRead(
        COLLECTIONS.FIXTURES,
        snap.empty ? 1 : snap.docs.length,
        'getFixturesFirestore:query'
      );
      docs = snap.docs.map((d) => d.data() as FirestoreFixtureDoc);
    }

    // Sort by matchday asc, scheduledAt asc
    docs.sort((a, b) => a.matchday - b.matchday || new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

    if (filter.limit && filter.limit > 0) {
      docs = docs.slice(0, filter.limit);
    }

    // Map club data using SEED_CLUB_MAP and dynamic occupancy data
    const { clubOccupancyMap, usernameMap, userMap } = await getActiveOccupanciesForSeason(filter.seasonId || 'season-2026-27');

    // Pre-cache competition override info
    const compMap = new Map<string, any>();
    for (const compId of new Set(docs.map((d) => d.competitionId).filter(Boolean))) {
      let comp = compOverrideMap.get(compId);
      if (!comp) {
        try {
          const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(compId).get();
          if (compDoc.exists) {
            comp = compDoc.data() as FirestoreCompetitionDoc;
            compOverrideMap.set(compId, comp);
          }
        } catch {}
      }
      if (comp) compMap.set(compId, comp);
    }

    // Batch query submissions if userId filter provided (for MyMatchesView)
    const submissionsMap = new Map<string, any[]>();
    if (filter.userId && docs.length > 0) {
      const fixtureIds = docs.map((d) => d.id);
      for (let i = 0; i < fixtureIds.length; i += 30) {
        const chunk = fixtureIds.slice(i, i + 30);
        try {
          const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', 'in', chunk).get();
          for (const subDoc of subsSnap.docs) {
            const subData = subDoc.data();
            const arr = submissionsMap.get(subData.fixtureId) || [];
            arr.push({
              id: subDoc.id,
              fixtureId: subData.fixtureId,
              userId: subData.submittedByUserId,
              submittedByUserId: subData.submittedByUserId,
              clubId: subData.clubId,
              homeScore: subData.homeScore,
              awayScore: subData.awayScore,
              proofUrl: subData.proofUrl || null,
              createdAt: subData.createdAt,
            });
            submissionsMap.set(subData.fixtureId, arr);
          }
        } catch {}
      }
    }

    // Preload competition locks once for all competitions in docs (0 Firestore reads, pure SQLite/cache)
    const compIdsInDocs = Array.from(new Set(docs.map((r) => r.competitionId).filter(Boolean)));
    const compLocksMap = new Map<string, Record<number, FirestoreMatchdayLockDoc>>();
    for (const compId of compIdsInDocs) {
      const locks = await getCompetitionMatchdayLocksFirestore(filter.seasonId || 'season-2026-27', compId);
      compLocksMap.set(compId, locks);
    }

    const fixtures: Fixture[] = docs.map((r) => {
      const homeSeed = SEED_CLUB_MAP.get(r.homeClubId);
      const awaySeed = SEED_CLUB_MAP.get(r.awayClubId);

      const comp = compMap.get(r.competitionId);
      const preloadedLock = compLocksMap.get(r.competitionId)?.[r.matchday] || null;
      const { isPlayable, activeMatchday } = checkFixturePlayability(
        r.competitionId,
        r.seasonId,
        r.matchday,
        r.status,
        r.homeClubId,
        r.awayClubId,
        comp,
        preloadedLock
      );

      const homeOcc = clubOccupancyMap.get(r.homeClubId);
      const homeUser = homeOcc ? (userMap?.get(homeOcc.userId) || { id: homeOcc.userId, username: usernameMap.get(homeOcc.userId) || '', displayName: usernameMap.get(homeOcc.userId) || '' }) : null;

      const awayOcc = clubOccupancyMap.get(r.awayClubId);
      const awayUser = awayOcc ? (userMap?.get(awayOcc.userId) || { id: awayOcc.userId, username: usernameMap.get(awayOcc.userId) || '', displayName: usernameMap.get(awayOcc.userId) || '' }) : null;

      const fixtureSubs = submissionsMap.get(r.id) || [];
      const userSubmission = filter.userId ? fixtureSubs.find((s) => s.submittedByUserId === filter.userId) : undefined;
      const opponentSubmission = filter.userId ? fixtureSubs.find((s) => s.submittedByUserId !== filter.userId) : undefined;

      return {
        id: r.id,
        seasonId: r.seasonId,
        competitionId: r.competitionId,
        competitionName: r.competitionName || r.competitionId,
        matchday: r.matchday,
        roundName: r.roundName,
        homeClubId: (!r.homeClubId || r.homeClubId === 'TBD') ? null : r.homeClubId,
        awayClubId: (!r.awayClubId || r.awayClubId === 'TBD') ? null : r.awayClubId,
        homeClub: (!r.homeClubId || r.homeClubId === 'TBD') ? null : {
          id: r.homeClubId,
          name: homeSeed?.name || r.homeClubId,
          shortName: homeSeed?.shortName || r.homeClubId,
          country: homeSeed?.country || '',
          leagueId: homeSeed?.leagueId || '',
          logoUrl: homeSeed?.logoUrl || '',
          active: true,
          isTaken: Boolean(homeOcc),
          claimedByUserId: homeOcc ? homeOcc.userId : null,
          claimedByUsername: homeOcc ? (usernameMap.get(homeOcc.userId) || null) : null,
          createdAt: '',
        },
        awayClub: (!r.awayClubId || r.awayClubId === 'TBD') ? null : {
          id: r.awayClubId,
          name: awaySeed?.name || r.awayClubId,
          shortName: awaySeed?.shortName || r.awayClubId,
          country: awaySeed?.country || '',
          leagueId: awaySeed?.leagueId || '',
          logoUrl: awaySeed?.logoUrl || '',
          active: true,
          isTaken: Boolean(awayOcc),
          claimedByUserId: awayOcc ? awayOcc.userId : null,
          claimedByUsername: awayOcc ? (usernameMap.get(awayOcc.userId) || null) : null,
          createdAt: '',
        },
        homeOwnerId: homeOcc ? homeOcc.userId : r.homeOwnerId,
        awayOwnerId: awayOcc ? awayOcc.userId : r.awayOwnerId,
        homeUser,
        awayUser,
        activeMatchday,
        isPlayable,
        userSubmission,
        opponentSubmission,
        scheduledAt: r.scheduledAt,
        status: r.status as any,
        homeScore: r.homeScore ?? undefined,
        awayScore: r.awayScore ?? undefined,
        winnerClubId: r.winnerClubId ?? undefined,
        resultConfirmedAt: r.resultConfirmedAt ?? undefined,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });

    const enrichedFixtures = await enrichFixturesWithAuthoritativeOwners(fixtures, seasonId);

    if (cacheKey) {
      setInCache(cacheKey, enrichedFixtures, 30000);
      lastKnownGoodFixtures.set(cacheKey, enrichedFixtures);
    }
    return enrichedFixtures;
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    recordFallbackUsage();
    console.warn('[FIRESTORE FALLBACK] getFixturesFirestore:', err.message);
    return executeFixturesFallback(filter, targetClubId, cacheKey);
  }
}

async function executeFixturesFallback(
  filter: {
    competitionId?: string;
    seasonId?: string;
    matchday?: number;
    status?: string;
    userId?: string;
    clubId?: string;
    limit?: number;
  },
  targetClubId?: string,
  cacheKey?: string | null
): Promise<Fixture[]> {
  // Check memory last-known-good cache first
  if (cacheKey) {
    const memoryCached = lastKnownGoodFixtures.get(cacheKey) || getAnyCached<Fixture[]>(cacheKey);
    if (memoryCached && memoryCached.length > 0) {
      return memoryCached;
    }
  }

  let sql = `
    SELECT f.*,
           hc.name as home_name, hc.short_name as home_short, hc.country as home_country, hc.league_id as home_league, hc.logo_url as home_logo,
           ac.name as away_name, ac.short_name as away_short, ac.country as away_country, ac.league_id as away_league, ac.logo_url as away_logo
    FROM fixtures f
    LEFT JOIN clubs hc ON f.home_club_id = hc.id
    LEFT JOIN clubs ac ON f.away_club_id = ac.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (filter.competitionId) {
    sql += ' AND f.competition_id = ?';
    params.push(filter.competitionId);
  }
  if (filter.seasonId) {
    sql += ' AND f.season_id = ?';
    params.push(filter.seasonId);
  }
  if (filter.matchday) {
    sql += ' AND f.matchday = ?';
    params.push(filter.matchday);
  }
  if (filter.status) {
    sql += ' AND f.status = ?';
    params.push(filter.status);
  }
  if (targetClubId) {
    sql += ' AND (f.home_club_id = ? OR f.away_club_id = ?)';
    params.push(targetClubId, targetClubId);
  }

  sql += ' ORDER BY f.matchday ASC, f.scheduled_at ASC';
  if (filter.limit && filter.limit > 0) {
    sql += ' LIMIT ?';
    params.push(filter.limit);
  }

  const { clubOccupancyMap, usernameMap, userMap } = await getActiveOccupanciesForSeason(filter.seasonId || 'season-2026-27');
  const rows = queryAll<any>(sql, params);

  // Submissions map from SQLite
  const localSubsMap = new Map<string, any[]>();
  if (filter.userId && rows.length > 0) {
    try {
      const fixIds = rows.map((r) => r.id);
      const subsRows = queryAll<any>(
        `SELECT * FROM result_submissions WHERE fixture_id IN (${fixIds.map(() => '?').join(',')})`,
        fixIds
      );
      for (const s of subsRows) {
        const arr = localSubsMap.get(s.fixture_id) || [];
        arr.push({
          id: s.id,
          fixtureId: s.fixture_id,
          userId: s.submitted_by_user_id,
          submittedByUserId: s.submitted_by_user_id,
          clubId: s.club_id,
          homeScore: s.home_score,
          awayScore: s.away_score,
          proofUrl: s.proof_url || null,
          createdAt: s.created_at,
        });
        localSubsMap.set(s.fixture_id, arr);
      }
    } catch {}
  }

  // Preload competition locks once for all competitions in fallback rows (0 Firestore reads, pure SQLite/cache)
  const compIdsInFallback = Array.from(new Set(rows.map((r) => r.competition_id).filter(Boolean)));
  const compLocksMap = new Map<string, Record<number, FirestoreMatchdayLockDoc>>();
  for (const compId of compIdsInFallback) {
    const locks = await getCompetitionMatchdayLocksFirestore(filter.seasonId || 'season-2026-27', compId);
    compLocksMap.set(compId, locks);
  }

  const fallbackFixtures = rows.map((r) => {
    const comp = compOverrideMap.get(r.competition_id);
    const preloadedLock = compLocksMap.get(r.competition_id)?.[r.matchday] || null;
    const { isPlayable, activeMatchday } = checkFixturePlayability(
      r.competition_id,
      r.season_id,
      r.matchday,
      r.status,
      r.home_club_id,
      r.away_club_id,
      comp,
      preloadedLock
    );

    const homeOcc = clubOccupancyMap.get(r.home_club_id);
    const homeUser = homeOcc ? (userMap?.get(homeOcc.userId) || { id: homeOcc.userId, username: usernameMap.get(homeOcc.userId) || '', displayName: usernameMap.get(homeOcc.userId) || '' }) : null;

    const awayOcc = clubOccupancyMap.get(r.away_club_id);
    const awayUser = awayOcc ? (userMap?.get(awayOcc.userId) || { id: awayOcc.userId, username: usernameMap.get(awayOcc.userId) || '', displayName: usernameMap.get(awayOcc.userId) || '' }) : null;

    const fixtureSubs = localSubsMap.get(r.id) || [];
    const userSubmission = filter.userId ? fixtureSubs.find((s) => s.submittedByUserId === filter.userId) : undefined;
    const opponentSubmission = filter.userId ? fixtureSubs.find((s) => s.submittedByUserId !== filter.userId) : undefined;

    return {
      id: r.id,
      seasonId: r.season_id,
      competitionId: r.competition_id,
      competitionName: r.competition_name || r.competition_id,
      matchday: r.matchday,
      roundName: r.round_name,
      homeClubId: (!r.home_club_id || r.home_club_id === 'TBD') ? null : r.home_club_id,
      awayClubId: (!r.away_club_id || r.away_club_id === 'TBD') ? null : r.away_club_id,
      homeClub: (!r.home_club_id || r.home_club_id === 'TBD') ? null : {
        id: r.home_club_id,
        name: r.home_name || r.home_club_id,
        shortName: r.home_short || r.home_club_id,
        country: r.home_country || '',
        leagueId: r.home_league || '',
        logoUrl: r.home_logo || '',
        active: true,
        isTaken: Boolean(homeOcc),
        claimedByUserId: homeOcc ? homeOcc.userId : null,
        claimedByUsername: homeOcc ? (usernameMap.get(homeOcc.userId) || null) : null,
        createdAt: '',
      },
      awayClub: (!r.away_club_id || r.away_club_id === 'TBD') ? null : {
        id: r.away_club_id,
        name: r.away_name || r.away_club_id,
        shortName: r.away_short || r.away_club_id,
        country: r.away_country || '',
        leagueId: r.away_league || '',
        logoUrl: r.away_logo || '',
        active: true,
        isTaken: Boolean(awayOcc),
        claimedByUserId: awayOcc ? awayOcc.userId : null,
        claimedByUsername: awayOcc ? (usernameMap.get(awayOcc.userId) || null) : null,
        createdAt: '',
      },
      homeOwnerId: homeOcc ? homeOcc.userId : r.home_owner_id,
      awayOwnerId: awayOcc ? awayOcc.userId : r.away_owner_id,
      homeUser,
      awayUser,
      activeMatchday,
      isPlayable,
      userSubmission,
      opponentSubmission,
      scheduledAt: r.scheduled_at,
      status: r.status,
      homeScore: r.home_score !== null && r.home_score !== undefined ? r.home_score : undefined,
      awayScore: r.away_score !== null && r.away_score !== undefined ? r.away_score : undefined,
      winnerClubId: r.winner_club_id || undefined,
      resultConfirmedAt: r.result_confirmed_at || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });

  const enrichedFallback = await enrichFixturesWithAuthoritativeOwners(fallbackFixtures, filter.seasonId || 'season-2026-27');

  if (cacheKey && enrichedFallback.length > 0) {
    setInCache(cacheKey, enrichedFallback, 30000);
    lastKnownGoodFixtures.set(cacheKey, enrichedFallback);
  }
  return enrichedFallback;
}

export interface AdminFixturesQueryOptions {
  seasonId?: string;
  competitionId?: string;
  status?: string;
  matchday?: number;
  clubId?: string;
  userId?: string;
  search?: string;
  limit?: number; // default 25
  cursor?: string; // fixture doc id of last item from previous page
}

export interface AdminFixturesPageResult {
  fixtures: Fixture[];
  total: number;
  hasMore: boolean;
  nextCursor?: string;
  limit: number;
  source: 'firestore' | 'cache' | 'sqlite' | 'redis_fresh' | 'redis_stale' | 'memory' | string;
  degraded: boolean;
  stale: boolean;
  errorCode?: string;
  generatedAt: string;
}

export function executeAdminFixturesPagedFallback(options: AdminFixturesQueryOptions, pageSize: number): AdminFixturesPageResult {
  const conditions: string[] = ['1=1'];
  const params: any[] = [];

  if (options.competitionId) {
    conditions.push('f.competition_id = ?');
    params.push(options.competitionId);
  } else if (options.seasonId) {
    conditions.push('f.season_id = ?');
    params.push(options.seasonId);
  }
  if (options.status) {
    conditions.push('f.status = ?');
    params.push(options.status);
  }
  if (options.matchday) {
    conditions.push('f.matchday = ?');
    params.push(options.matchday);
  }

  const whereStr = conditions.join(' AND ');
  const countRow = queryGet<{ count: number }>(`SELECT COUNT(*) as count FROM fixtures f WHERE ${whereStr}`, params);
  const total = countRow?.count || 0;

  let querySql = `
    SELECT f.*,
           hc.name as home_name, hc.short_name as home_short, hc.country as home_country, hc.league_id as home_league, hc.logo_url as home_logo,
           ac.name as away_name, ac.short_name as away_short, ac.country as away_country, ac.league_id as away_league, ac.logo_url as away_logo
    FROM fixtures f
    LEFT JOIN clubs hc ON f.home_club_id = hc.id
    LEFT JOIN clubs ac ON f.away_club_id = ac.id
    WHERE ${whereStr}
  `;
  const queryParams = [...params];

  if (options.cursor) {
    querySql += ' AND f.id > ?';
    queryParams.push(options.cursor);
  }

  querySql += ' ORDER BY f.id ASC LIMIT ?';
  queryParams.push(pageSize + 1);

  const rows = queryAll<any>(querySql, queryParams);
  const hasMore = rows.length > pageSize;
  const pageRows = rows.slice(0, pageSize);
  const nextCursor = hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : undefined;

  const fixtures: Fixture[] = pageRows.map((r) => ({
    id: r.id,
    competitionId: r.competition_id,
    seasonId: r.season_id,
    matchday: r.matchday,
    homeClubId: r.home_club_id,
    awayClubId: r.away_club_id,
    homeScore: r.home_score,
    awayScore: r.away_score,
    status: r.status as MatchStatus,
    scheduledAt: r.scheduled_at,
    homeClub: {
      id: r.home_club_id,
      name: r.home_name || r.home_club_id,
      shortName: r.home_short || r.home_club_id.substring(0, 3).toUpperCase(),
      country: r.home_country || 'England',
      leagueId: r.home_league || 'league-premier-league',
      logoUrl: r.home_logo || '',
      active: true,
      createdAt: r.created_at || new Date().toISOString(),
    },
    awayClub: {
      id: r.away_club_id,
      name: r.away_name || r.away_club_id,
      shortName: r.away_short || r.away_club_id.substring(0, 3).toUpperCase(),
      country: r.away_country || 'England',
      leagueId: r.away_league || 'league-premier-league',
      logoUrl: r.away_logo || '',
      active: true,
      createdAt: r.created_at || new Date().toISOString(),
    },
    createdAt: r.created_at || new Date().toISOString(),
    updatedAt: r.updated_at || new Date().toISOString(),
  }));

  return {
    fixtures,
    total,
    hasMore,
    nextCursor,
    limit: pageSize,
    source: 'sqlite',
    degraded: true,
    stale: true,
    generatedAt: new Date().toISOString(),
  };
}

export async function getAdminFixturesPagedFirestore(options: AdminFixturesQueryOptions = {}): Promise<AdminFixturesPageResult> {
  const result = await getAdminFixturesFromReadModel({
    seasonId: options.seasonId,
    competitionId: options.competitionId,
    status: options.status,
    matchday: options.matchday,
    clubId: options.clubId,
    userId: options.userId,
    search: options.search,
    cursor: options.cursor,
    limit: options.limit,
  });

  return {
    fixtures: result.fixtures,
    total: result.total,
    hasMore: result.hasMore,
    nextCursor: result.nextCursor,
    limit: result.limit,
    source: result.source,
    degraded: result.degraded,
    stale: result.stale,
    errorCode: result.degraded ? 'ADMIN_FIXTURES_DEGRADED' : undefined,
    generatedAt: result.generatedAt,
  };
}

export async function getFixtureByIdFirestore(fixtureId: string, currentUserId?: string): Promise<Fixture | null> {
  const cacheKey = `firestore:fixture:${fixtureId}:${currentUserId || 'anon'}`;
  const cached = getFromCache<Fixture>(cacheKey);
  if (cached) return cached;

  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();
      trackFirestoreRead(COLLECTIONS.FIXTURES, 1, 'getFixtureByIdFirestore');
      const doc = await db.collection(COLLECTIONS.FIXTURES).doc(fixtureId).get();
      if (doc.exists) {
        firestoreCircuitBreaker.recordSuccess();
        const r = doc.data() as FirestoreFixtureDoc;

        // Enrich with home and away clubs using SEED_CLUB_MAP (0 Firestore reads!)
        const homeSeed = SEED_CLUB_MAP.get(r.homeClubId);
        const awaySeed = SEED_CLUB_MAP.get(r.awayClubId);

        const { clubOccupancyMap, usernameMap, userMap } = await getActiveOccupanciesForSeason(r.seasonId || 'season-2026-27');
        const homeOcc = clubOccupancyMap.get(r.homeClubId);
        const homeUser = homeOcc ? (userMap?.get(homeOcc.userId) || { id: homeOcc.userId, username: usernameMap.get(homeOcc.userId) || '', displayName: usernameMap.get(homeOcc.userId) || '' }) : null;
        const awayOcc = clubOccupancyMap.get(r.awayClubId);
        const awayUser = awayOcc ? (userMap?.get(awayOcc.userId) || { id: awayOcc.userId, username: usernameMap.get(awayOcc.userId) || '', displayName: usernameMap.get(awayOcc.userId) || '' }) : null;

        let comp = compOverrideMap.get(r.competitionId);
        if (!comp && r.competitionId) {
          try {
            const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(r.competitionId).get();
            if (compDoc.exists) {
              comp = compDoc.data() as FirestoreCompetitionDoc;
              compOverrideMap.set(r.competitionId, comp);
            }
          } catch {}
        }

        const compLocks = await getCompetitionMatchdayLocksFirestore(r.seasonId || 'season-2026-27', r.competitionId);
        const preloadedLock = compLocks[r.matchday] || null;

        const { isPlayable, activeMatchday } = checkFixturePlayability(
          r.competitionId,
          r.seasonId,
          r.matchday,
          r.status,
          r.homeClubId,
          r.awayClubId,
          comp,
          preloadedLock
        );

        // Fetch user/opponent submissions if currentUserId is provided
        let userSubmission: any = undefined;
        let opponentSubmission: any = undefined;
        try {
          const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', '==', fixtureId).get();
          if (!subsSnap.empty) {
            for (const sDoc of subsSnap.docs) {
              const sData = sDoc.data();
              const subObj = {
                id: sDoc.id,
                fixtureId: sData.fixtureId,
                userId: sData.submittedByUserId,
                submittedByUserId: sData.submittedByUserId,
                clubId: sData.clubId,
                homeScore: sData.homeScore,
                awayScore: sData.awayScore,
                proofUrl: sData.proofUrl || null,
                createdAt: sData.createdAt,
              };
              if (currentUserId && sData.submittedByUserId === currentUserId) {
                userSubmission = subObj;
              } else if (currentUserId) {
                opponentSubmission = subObj;
              }
            }
          }
        } catch {}

        const fix: Fixture = {
          id: doc.id,
          seasonId: r.seasonId,
          competitionId: r.competitionId,
          competitionName: r.competitionName || r.competitionId,
          matchday: r.matchday,
          roundName: r.roundName,
          homeClubId: (!r.homeClubId || r.homeClubId === 'TBD') ? null : r.homeClubId,
          awayClubId: (!r.awayClubId || r.awayClubId === 'TBD') ? null : r.awayClubId,
          homeClub: (!r.homeClubId || r.homeClubId === 'TBD') ? null : {
            id: r.homeClubId,
            name: homeSeed?.name || r.homeClubId,
            shortName: homeSeed?.shortName || r.homeClubId,
            country: homeSeed?.country || '',
            leagueId: homeSeed?.leagueId || '',
            logoUrl: homeSeed?.logoUrl || '',
            active: true,
            isTaken: Boolean(homeOcc),
            claimedByUserId: homeOcc ? homeOcc.userId : null,
            claimedByUsername: homeOcc ? (usernameMap.get(homeOcc.userId) || null) : null,
            createdAt: '',
          },
          awayClub: (!r.awayClubId || r.awayClubId === 'TBD') ? null : {
            id: r.awayClubId,
            name: awaySeed?.name || r.awayClubId,
            shortName: awaySeed?.shortName || r.awayClubId,
            country: awaySeed?.country || '',
            leagueId: awaySeed?.leagueId || '',
            logoUrl: awaySeed?.logoUrl || '',
            active: true,
            isTaken: Boolean(awayOcc),
            claimedByUserId: awayOcc ? awayOcc.userId : null,
            claimedByUsername: awayOcc ? (usernameMap.get(awayOcc.userId) || null) : null,
            createdAt: '',
          },
          sourceFixtureId: r.sourceFixtureId || null,
          sourceWinnerSlot: r.sourceWinnerSlot || null,
          homeSourceFixtureId: r.homeSourceFixtureId || null,
          awaySourceFixtureId: r.awaySourceFixtureId || null,
          homeSourceWinnerSlot: r.homeSourceWinnerSlot || null,
          awaySourceWinnerSlot: r.awaySourceWinnerSlot || null,
          homeOwnerId: homeOcc ? homeOcc.userId : r.homeOwnerId,
          awayOwnerId: awayOcc ? awayOcc.userId : r.awayOwnerId,
          homeUser,
          awayUser,
          activeMatchday,
          isPlayable,
          userSubmission,
          opponentSubmission,
          scheduledAt: r.scheduledAt,
          status: r.status as any,
          homeScore: r.homeScore ?? undefined,
          awayScore: r.awayScore ?? undefined,
          winnerClubId: r.winnerClubId ?? undefined,
          resultConfirmedAt: r.resultConfirmedAt ?? undefined,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };

        const [enriched] = await enrichFixturesWithAuthoritativeOwners([fix], r.seasonId || 'season-2026-27');
        setInCache(cacheKey, enriched, 30000);
        return enriched;
      }
    } catch (err: any) {
      firestoreCircuitBreaker.recordFailure(err);
      recordFallbackUsage();
      console.warn('[FIRESTORE FALLBACK] getFixtureByIdFirestore:', err.message);
    }
  } else {
    recordFallbackUsage();
  }

  // SQLite fallback
  const r = queryGet<any>(
    `SELECT f.*,
            hc.name as home_name, hc.short_name as home_short, hc.country as home_country, hc.league_id as home_league, hc.logo_url as home_logo,
            ac.name as away_name, ac.short_name as away_short, ac.country as away_country, ac.league_id as away_league, ac.logo_url as away_logo
     FROM fixtures f
     LEFT JOIN clubs hc ON f.home_club_id = hc.id
     LEFT JOIN clubs ac ON f.away_club_id = ac.id
     WHERE f.id = ?`,
    [fixtureId]
  );
  if (!r) return null;

  const { clubOccupancyMap, usernameMap, userMap } = await getActiveOccupanciesForSeason(r.season_id || 'season-2026-27');
  const homeOcc = clubOccupancyMap.get(r.home_club_id);
  const homeUser = homeOcc ? (userMap?.get(homeOcc.userId) || { id: homeOcc.userId, username: usernameMap.get(homeOcc.userId) || '', displayName: usernameMap.get(homeOcc.userId) || '' }) : null;
  const awayOcc = clubOccupancyMap.get(r.away_club_id);
  const awayUser = awayOcc ? (userMap?.get(awayOcc.userId) || { id: awayOcc.userId, username: usernameMap.get(awayOcc.userId) || '', displayName: usernameMap.get(awayOcc.userId) || '' }) : null;

  let userSubmission: any = undefined;
  let opponentSubmission: any = undefined;
  try {
    const localSubs = queryAll<any>('SELECT * FROM result_submissions WHERE fixture_id = ?', [fixtureId]);
    for (const s of localSubs) {
      const sub = {
        id: s.id,
        fixtureId: s.fixture_id,
        userId: s.submitted_by_user_id,
        submittedByUserId: s.submitted_by_user_id,
        clubId: s.club_id,
        homeScore: s.home_score,
        awayScore: s.away_score,
        proofUrl: s.proof_url || null,
        createdAt: s.created_at,
      };
      if (currentUserId && s.submitted_by_user_id === currentUserId) {
        userSubmission = sub;
      } else if (currentUserId && s.submitted_by_user_id !== currentUserId) {
        opponentSubmission = sub;
      }
    }
  } catch {}

  const compLocks = await getCompetitionMatchdayLocksFirestore(r.season_id || 'season-2026-27', r.competition_id);
  const preloadedLock = compLocks[r.matchday] || null;

  const comp = compOverrideMap.get(r.competition_id);
  const { isPlayable, activeMatchday } = checkFixturePlayability(
    r.competition_id,
    r.season_id,
    r.matchday,
    r.status,
    r.home_club_id,
    r.away_club_id,
    comp,
    preloadedLock
  );

  const fallbackFix: Fixture = {
    id: r.id,
    seasonId: r.season_id,
    competitionId: r.competition_id,
    competitionName: r.competition_name || r.competition_id,
    matchday: r.matchday,
    roundName: r.round_name,
    homeClubId: (!r.home_club_id || r.home_club_id === 'TBD') ? null : r.home_club_id,
    awayClubId: (!r.away_club_id || r.away_club_id === 'TBD') ? null : r.away_club_id,
    homeClub: (!r.home_club_id || r.home_club_id === 'TBD') ? null : {
      id: r.home_club_id,
      name: r.home_name || r.home_club_id,
      shortName: r.home_short || r.home_club_id,
      country: r.home_country || '',
      leagueId: r.home_league || '',
      logoUrl: r.home_logo || '',
      active: true,
      isTaken: Boolean(homeOcc),
      claimedByUserId: homeOcc ? homeOcc.userId : null,
      claimedByUsername: homeOcc ? (usernameMap.get(homeOcc.userId) || null) : null,
      createdAt: '',
    },
    awayClub: (!r.away_club_id || r.away_club_id === 'TBD') ? null : {
      id: r.away_club_id,
      name: r.away_name || r.away_club_id,
      shortName: r.away_short || r.away_club_id,
      country: r.away_country || '',
      leagueId: r.away_league || '',
      logoUrl: r.away_logo || '',
      active: true,
      isTaken: Boolean(awayOcc),
      claimedByUserId: awayOcc ? awayOcc.userId : null,
      claimedByUsername: awayOcc ? (usernameMap.get(awayOcc.userId) || null) : null,
      createdAt: '',
    },
    sourceFixtureId: r.source_fixture_id || null,
    sourceWinnerSlot: r.source_winner_slot || null,
    homeOwnerId: homeOcc ? homeOcc.userId : r.home_owner_id,
    awayOwnerId: awayOcc ? awayOcc.userId : r.away_owner_id,
    homeUser,
    awayUser,
    activeMatchday,
    isPlayable,
    userSubmission,
    opponentSubmission,
    scheduledAt: r.scheduled_at,
    status: r.status,
    homeScore: r.home_score !== null && r.home_score !== undefined ? r.home_score : undefined,
    awayScore: r.away_score !== null && r.away_score !== undefined ? r.away_score : undefined,
    winnerClubId: r.winner_club_id || undefined,
    resultConfirmedAt: r.result_confirmed_at || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };

  const [enrichedFallback] = await enrichFixturesWithAuthoritativeOwners([fallbackFix], r.season_id || 'season-2026-27');
  setInCache(cacheKey, enrichedFallback, 30000);
  return enrichedFallback;
}

// ----------------------------------------------------
// COMPETITION PARTICIPANTS
// ----------------------------------------------------

export async function getCompetitionParticipantsFirestore(competitionId: string): Promise<any[]> {
  const cacheKey = `firestore:participants:${competitionId}`;
  const cached = getFromCache<any[]>(cacheKey);
  if (cached) return cached;

  try {
    const db = getFirestoreDb();
    const snap = await db
      .collection(COLLECTIONS.COMPETITION_PARTICIPANTS)
      .where('competitionId', '==', competitionId)
      .orderBy('seedNumber', 'asc')
      .get();
    trackFirestoreRead(COLLECTIONS.COMPETITION_PARTICIPANTS, snap.docs.length, 'getCompetitionParticipantsFirestore');

    if (!snap.empty) {
      const participants = snap.docs.map((d) => {
        const data = d.data() as FirestoreCompetitionParticipantDoc;
        const club = SEED_CLUBS.find((c) => c.id === data.clubId);
        return {
          id: d.id,
          competitionId: data.competitionId,
          clubId: data.clubId,
          clubName: club?.name || data.clubId,
          shortName: club?.shortName || data.clubId,
          clubLogoUrl: club?.logoUrl || '',
          ownerUserId: data.ownerUserId,
          ownerUsername: data.ownerUsername,
          sourceCompetitionId: data.sourceCompetitionId,
          sourceCompetitionName: data.sourceCompetitionName,
          sourcePosition: data.sourcePosition,
          qualificationReason: data.qualificationReason,
          seedNumber: data.seedNumber,
          createdAt: data.createdAt,
        };
      });
      setInCache(cacheKey, participants, 300000);
      return participants;
    }

    // Fallback: check SQLite competition_participants
    const sqliteParts = queryAll<any>(
      `SELECT cp.*, c.name as club_name, c.short_name, c.logo_url
       FROM competition_participants cp
       JOIN clubs c ON cp.club_id = c.id
       WHERE cp.competition_id = ?
       ORDER BY cp.seed_number ASC`,
      [competitionId]
    );

    const parts = sqliteParts.map((p) => ({
      id: p.id,
      competitionId: p.competition_id,
      clubId: p.club_id,
      clubName: p.club_name,
      shortName: p.short_name,
      clubLogoUrl: p.logo_url,
      ownerUserId: p.owner_user_id,
      sourceCompetitionId: p.source_competition_id,
      sourcePosition: p.source_position,
      qualificationReason: p.qualification_reason,
      seedNumber: p.seed_number,
      createdAt: p.created_at,
    }));

    setInCache(cacheKey, parts, 300000);
    return parts;
  } catch (err: any) {
    console.warn('[FIRESTORE] getCompetitionParticipantsFirestore error:', err.message);
    return [];
  }
}

// ----------------------------------------------------
// PERSISTENT FIXTURE GENERATION
// ----------------------------------------------------

export async function generateCompetitionFixturesFirestore(
  competitionId: string,
  options: { force?: boolean } = {}
): Promise<{ generated: number; matchdays: number }> {
  const db = getFirestoreDb();
  const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
  // Test-only local fallback: the isolated regression suite intentionally uses
  // the SQLite seed without provisioning an in-memory Firestore mirror. Keep
  // production authoritative (missing Firestore documents still fail closed),
  // but synthesize the seed competition/participants for that explicit mode.
  let fallbackSeedCompetition: (typeof SEED_COMPETITIONS)[number] | undefined;
  if (!compDoc.exists && process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true') {
    fallbackSeedCompetition = SEED_COMPETITIONS.find((candidate) => candidate.id === competitionId);
  }
  if (!compDoc.exists && !fallbackSeedCompetition) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }

  const comp = (compDoc.exists
    ? compDoc.data()
    : {
        id: fallbackSeedCompetition!.id,
        seasonId: fallbackSeedCompetition!.seasonId,
        leagueId: fallbackSeedCompetition!.leagueId,
        name: fallbackSeedCompetition!.name,
        type: fallbackSeedCompetition!.type,
        formatConfig: fallbackSeedCompetition!.formatConfig,
      }) as FirestoreCompetitionDoc;

  if (!compDoc.exists && fallbackSeedCompetition) {
    await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).set(
      {
        id: fallbackSeedCompetition.id,
        seasonId: fallbackSeedCompetition.seasonId,
        leagueId: fallbackSeedCompetition.leagueId,
        name: fallbackSeedCompetition.name,
        type: fallbackSeedCompetition.type,
        formatConfig: fallbackSeedCompetition.formatConfig,
      },
      { merge: true },
    );
  }

  // Check existing fixtures
  const existingSnap = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', competitionId).get();
  if (!existingSnap.empty && !options.force) {
    const matchdays = new Set(existingSnap.docs.map((d) => d.data().matchday)).size;
    return { generated: existingSnap.size, matchdays };
  }

  // 1. Fetch participating clubs
  let clubIds: string[] = [];
  const partSnap = await db
    .collection(COLLECTIONS.COMPETITION_PARTICIPANTS)
    .where('competitionId', '==', competitionId)
    .orderBy('seedNumber', 'asc')
    .get();

  if (!partSnap.empty) {
    clubIds = partSnap.docs.map((d) => (d.data() as FirestoreCompetitionParticipantDoc).clubId);
  } else if (comp.leagueId) {
    const leagueClubsSnap = await db
      .collection(COLLECTIONS.CLUBS)
      .where('leagueId', '==', comp.leagueId)
      .where('isActive', '==', true)
      .get();
    clubIds = leagueClubsSnap.docs.map((d) => d.id).sort();
  }

  if (clubIds.length < 2 && fallbackSeedCompetition) {
    clubIds = SEED_CLUBS
      .filter((club) => club.leagueId === fallbackSeedCompetition!.leagueId)
      .map((club) => club.id)
      .sort();
  }

  if (clubIds.length < 2) {
    throw new Error(`Not enough clubs (${clubIds.length}) to generate fixtures for ${comp.name}.`);
  }

  const generatedFixtures: Array<{
    id: string;
    competitionId: string;
    competitionName: string;
    seasonId: string;
    matchday: number;
    roundName: string;
    homeClubId: string;
    awayClubId: string;
    scheduledAt: string;
    status: string;
    createdAt: string;
    updatedAt: string;
  }> = [];

  const startDate = new Date('2026-08-15T15:00:00.000Z');
  const now = new Date().toISOString();
  let totalRounds = 0;

  if (comp.type === 'EUROPEAN_LEAGUE_PHASE' || competitionId.includes('ucl') || competitionId.includes('uel')) {
    // 32-Team Swiss-Style 8-Matchday League Phase Schedule
    const europeanSchedule = generateEuropean32LeaguePhaseSchedule(clubIds);
    totalRounds = 8;

    for (const match of europeanSchedule) {
      const matchDate = new Date(startDate.getTime() + (match.matchday - 1) * 7 * 24 * 60 * 60 * 1000).toISOString();
      const homeSlug = match.homeClubId.replace('club-', '');
      const awaySlug = match.awayClubId.replace('club-', '');
      const id = `fix-${competitionId}-md${match.matchday}-${homeSlug}-vs-${awaySlug}`;

      generatedFixtures.push({
        id,
        competitionId,
        competitionName: comp.name,
        seasonId: comp.seasonId,
        matchday: match.matchday,
        roundName: `Matchday ${match.matchday}`,
        homeClubId: match.homeClubId,
        awayClubId: match.awayClubId,
        scheduledAt: matchDate,
        status: 'SCHEDULED',
        createdAt: now,
        updatedAt: now,
      });
    }
  } else {
    // Single Round Robin for Domestic Leagues (19 matchdays for 20 teams, 17 matchdays for 18 teams)
    const teams = [...clubIds];
    if (teams.length % 2 !== 0) {
      teams.push('BYE');
    }

    const numTeams = teams.length;
    const numRounds = numTeams - 1;
    const halfSize = numTeams / 2;
    totalRounds = numRounds;

    for (let round = 0; round < numRounds; round++) {
      const matchday = round + 1;
      const matchDate = new Date(startDate.getTime() + round * 7 * 24 * 60 * 60 * 1000).toISOString();

      for (let i = 0; i < halfSize; i++) {
        const home = teams[i];
        const away = teams[numTeams - 1 - i];

        if (home !== 'BYE' && away !== 'BYE') {
          const isAlternate = (round + i) % 2 === 1;
          const actualHome = isAlternate ? away : home;
          const actualAway = isAlternate ? home : away;

          const homeSlug = actualHome.replace('club-', '');
          const awaySlug = actualAway.replace('club-', '');
          const id = `fix-${competitionId}-md${matchday}-${homeSlug}-vs-${awaySlug}`;

          generatedFixtures.push({
            id,
            competitionId,
            competitionName: comp.name,
            seasonId: comp.seasonId,
            matchday,
            roundName: `Matchday ${matchday}`,
            homeClubId: actualHome,
            awayClubId: actualAway,
            scheduledAt: matchDate,
            status: 'SCHEDULED',
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      // Rotate teams (keep index 0 fixed)
      teams.splice(1, 0, teams.pop()!);
    }
  }

  // 3. Never regenerate a competition that already contains user activity.
  // New fixtures are written before obsolete scheduled fixtures are removed, so
  // an interrupted deployment cannot leave the competition empty.
  const toDeleteSnap = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', competitionId).get();
  const protectedStatuses = new Set(['CONFIRMED', 'DISPUTED', 'PENDING_CONFIRMATION', 'AWAITING_RESULT', 'PLAYING']);
  const protectedFixture = toDeleteSnap.docs.find((doc) => protectedStatuses.has((doc.data() as FirestoreFixtureDoc).status));
  if (protectedFixture) {
    throw new Error(`FIXTURE_REGENERATION_BLOCKED: fixture '${protectedFixture.id}' contains protected match activity.`);
  }

  // 4. Batch write all new fixtures
  const batchSize = 400;
  for (let i = 0; i < generatedFixtures.length; i += batchSize) {
    const chunk = generatedFixtures.slice(i, i + batchSize);
    const batch = db.batch();
    for (const fix of chunk) {
      const ref = db.collection(COLLECTIONS.FIXTURES).doc(fix.id);
      batch.set(ref, fix);
    }
    await batch.commit();
  }

  const generatedIds = new Set(generatedFixtures.map((fixture) => fixture.id));
  const obsoleteDocs = toDeleteSnap.docs.filter((doc) => !generatedIds.has(doc.id));
  for (let i = 0; i < obsoleteDocs.length; i += batchSize) {
    const chunk = obsoleteDocs.slice(i, i + batchSize);
    const batch = db.batch();
    chunk.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  // 5. Verification step: verify count persisted in Firestore
  let verifySnap = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', competitionId).get();
  if (verifySnap.size !== generatedFixtures.length) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    verifySnap = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', competitionId).get();
  }
  if (verifySnap.size !== generatedFixtures.length) {
    throw new Error(
      `FIXTURE_PERSISTENCE_FAILED: Expected ${generatedFixtures.length} fixtures, but Firestore has ${verifySnap.size}.`
    );
  }

  // 6. Update competition document in Firestore with matchday timer & persistent status
  const nextOpenAt = new Date(Date.now() + 30 * 3600 * 1000).toISOString();
  await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).update({
    status: 'active',
    hasFixtures: true,
    fixtureCount: verifySnap.size,
    fixturesCount: verifySnap.size,
    generationStatus: 'generated',
    currentMatchday: 1,
    totalMatchdays: totalRounds,
    isMatchdayOpen: true,
    matchdayOpenedAt: now,
    matchdayDurationHours: 30,
    nextMatchdayOpenAt: nextOpenAt,
    adminOverrideStatus: 'AUTO',
    updatedAt: now,
  });

  // Also sync to SQLite for offline resilience
  try {
    for (const fix of generatedFixtures) {
      queryRun(
        `INSERT OR REPLACE INTO fixtures (id, competition_id, season_id, matchday, round_name, home_club_id, away_club_id, scheduled_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fix.id,
          fix.competitionId,
          fix.seasonId,
          fix.matchday,
          fix.roundName,
          fix.homeClubId,
          fix.awayClubId,
          fix.scheduledAt,
          fix.status,
          fix.createdAt,
          fix.updatedAt,
        ]
      );
    }
  } catch (sqliteErr) {
    console.warn('[SQLITE SYNC] Fixtures sync warning:', sqliteErr);
  }

  invalidateFirestoreCache('firestore:comp');
  return { generated: verifySnap.size, matchdays: totalRounds };
}

// ----------------------------------------------------
// MATCHDAY LOCK ISOLATION ENGINE
// Key Format: `${seasonId}:${competitionId}:${matchday}`
// Strictly isolates lock state per competition and per matchday
// ----------------------------------------------------

export function getMatchdayLockKey(seasonId: string, competitionId: string, matchday: number): string {
  return `${seasonId}:${competitionId}:${matchday}`;
}

const matchdayLocksCache = new Map<string, FirestoreMatchdayLockDoc>();

export function invalidateMatchdayLockCache(seasonId: string, competitionId: string, matchday?: number): void {
  if (matchday !== undefined) {
    const key = getMatchdayLockKey(seasonId, competitionId, matchday);
    matchdayLocksCache.delete(key);
    serverCache.delete(`lock:${key}`);
  } else {
    const prefix = `${seasonId}:${competitionId}:`;
    for (const k of Array.from(matchdayLocksCache.keys())) {
      if (k.startsWith(prefix)) {
        matchdayLocksCache.delete(k);
        serverCache.delete(`lock:${k}`);
      }
    }
  }
}

export function ensureMatchdayLocksTable(): void {
  try {
    queryRun(`
      CREATE TABLE IF NOT EXISTS matchday_locks (
        id TEXT PRIMARY KEY,
        season_id TEXT NOT NULL,
        competition_id TEXT NOT NULL,
        matchday INTEGER NOT NULL,
        override_status TEXT NOT NULL,
        is_open INTEGER NOT NULL,
        is_locked INTEGER NOT NULL,
        duration_hours INTEGER,
        opened_at TEXT,
        locked_at TEXT,
        expires_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_matchday_locks_lookup
      ON matchday_locks(season_id, competition_id, matchday);
    `);
  } catch (err: any) {
    console.error(' [DB] ensureMatchdayLocksTable error:', err?.message);
  }
}

export async function getCompetitionMatchdayLocksFirestore(
  seasonId: string,
  competitionId: string
): Promise<Record<number, FirestoreMatchdayLockDoc>> {
  const result: Record<number, FirestoreMatchdayLockDoc> = {};
  try {
    const rows = queryAll<any>(
      'SELECT * FROM matchday_locks WHERE season_id = ? AND competition_id = ? ORDER BY matchday ASC',
      [seasonId, competitionId]
    );
    for (const row of rows) {
      const lockDoc: FirestoreMatchdayLockDoc = {
        id: row.id,
        seasonId: row.season_id,
        competitionId: row.competition_id,
        matchday: row.matchday,
        overrideStatus: row.override_status,
        isOpen: Boolean(row.is_open),
        isLocked: Boolean(row.is_locked),
        durationHours: row.duration_hours || undefined,
        openedAt: row.opened_at || undefined,
        lockedAt: row.locked_at || undefined,
        expiresAt: row.expires_at || undefined,
        updatedAt: row.updated_at,
      };
      result[row.matchday] = lockDoc;
      matchdayLocksCache.set(row.id, lockDoc);
    }
  } catch {}
  return result;
}

export async function getMatchdayLockFirestore(
  seasonId: string,
  competitionId: string,
  matchday: number
): Promise<FirestoreMatchdayLockDoc | null> {
  const key = getMatchdayLockKey(seasonId, competitionId, matchday);
  if (matchdayLocksCache.has(key)) {
    return matchdayLocksCache.get(key)!;
  }

  // Check Firestore
  try {
    const db = getFirestoreDb();
    const docRef = db.collection(COLLECTIONS.MATCHDAY_LOCKS).doc(key);
    const snap = await docRef.get();
    if (snap.exists) {
      const data = snap.data() as FirestoreMatchdayLockDoc;
      matchdayLocksCache.set(key, data);
      return data;
    }
  } catch {}

  // Check SQLite strictly scoped to seasonId, competitionId, and matchday
  try {
    const row = queryGet<any>(
      'SELECT * FROM matchday_locks WHERE season_id = ? AND competition_id = ? AND matchday = ?',
      [seasonId, competitionId, matchday]
    );
    if (row) {
      const data: FirestoreMatchdayLockDoc = {
        id: row.id,
        seasonId: row.season_id,
        competitionId: row.competition_id,
        matchday: row.matchday,
        overrideStatus: row.override_status,
        isOpen: Boolean(row.is_open),
        isLocked: Boolean(row.is_locked),
        durationHours: row.duration_hours || undefined,
        openedAt: row.opened_at || undefined,
        lockedAt: row.locked_at || undefined,
        expiresAt: row.expires_at || undefined,
        updatedAt: row.updated_at,
      };
      matchdayLocksCache.set(key, data);
      return data;
    }
  } catch {}

  return null;
}

export async function setMatchdayLockFirestore(
  seasonId: string,
  competitionId: string,
  matchday: number,
  params: {
    overrideStatus: 'AUTO' | 'FORCE_OPEN' | 'FORCE_LOCKED' | 'PAUSED';
    durationHours?: number;
    adminUserId?: string;
  }
): Promise<FirestoreMatchdayLockDoc> {
  const key = getMatchdayLockKey(seasonId, competitionId, matchday);
  const now = new Date().toISOString();
  const durationHours = params.durationHours || 30;
  const expiresAt = params.overrideStatus === 'FORCE_OPEN' || params.overrideStatus === 'AUTO'
    ? new Date(Date.now() + durationHours * 3600 * 1000).toISOString()
    : undefined;

  const isOpen = params.overrideStatus === 'FORCE_OPEN' || params.overrideStatus === 'AUTO';
  const isLocked = params.overrideStatus === 'FORCE_LOCKED' || params.overrideStatus === 'PAUSED';

  const lockDoc: FirestoreMatchdayLockDoc = {
    id: key,
    seasonId,
    competitionId,
    matchday,
    overrideStatus: params.overrideStatus,
    isOpen,
    isLocked,
    durationHours,
    openedAt: isOpen ? now : undefined,
    lockedAt: isLocked ? now : undefined,
    expiresAt,
    updatedAt: now,
    updatedByUserId: params.adminUserId,
  };

  // 1. Update in-memory cache strictly for this lock key
  matchdayLocksCache.set(key, lockDoc);

  // 2. Persist in Firestore
  try {
    const db = getFirestoreDb();
    await db.collection(COLLECTIONS.MATCHDAY_LOCKS).doc(key).set(lockDoc, { merge: true });
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] setMatchdayLockFirestore:', err.message);
  }

  // 3. Persist in SQLite strictly scoped
  try {
    queryRun(
      `INSERT INTO matchday_locks (id, season_id, competition_id, matchday, override_status, is_open, is_locked, duration_hours, opened_at, locked_at, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         override_status = excluded.override_status,
         is_open = excluded.is_open,
         is_locked = excluded.is_locked,
         duration_hours = excluded.duration_hours,
         opened_at = excluded.opened_at,
         locked_at = excluded.locked_at,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at
       WHERE matchday_locks.season_id = excluded.season_id
         AND matchday_locks.competition_id = excluded.competition_id
         AND matchday_locks.matchday = excluded.matchday`,
      [
        key,
        seasonId,
        competitionId,
        matchday,
        params.overrideStatus,
        isOpen ? 1 : 0,
        isLocked ? 1 : 0,
        durationHours,
        lockDoc.openedAt || null,
        lockDoc.lockedAt || null,
        lockDoc.expiresAt || null,
        now,
      ]
    );
  } catch {}

  // 4. Update competition doc if this matchday is the current active matchday
  try {
    const existingComp = compOverrideMap.get(competitionId);
    if (!existingComp || existingComp.currentMatchday === matchday || !existingComp.currentMatchday) {
      compOverrideMap.set(competitionId, {
        ...existingComp,
        adminOverrideStatus: params.overrideStatus,
        isMatchdayOpen: isOpen,
      });

      const db = getFirestoreDb();
      await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).update({
        adminOverrideStatus: params.overrideStatus,
        isMatchdayOpen: isOpen,
        updatedAt: now,
      }).catch(() => {});
    }
  } catch {}

  // Invalidate ONLY this modified competition/matchday lock and cache
  invalidateMatchdayLockCache(seasonId, competitionId, matchday);
  serverCache.delete(`firestore:comp:${competitionId}`);
  serverCache.delete(`firestore:competitions:${seasonId}`);
  serverCache.delete(`firestore:fixtures:${competitionId}`);
  return lockDoc;
}

export function isMatchdayPlayableKey(
  seasonId: string,
  competitionId: string,
  matchday: number,
  compState?: { currentMatchday?: number; adminOverrideStatus?: string; isMatchdayOpen?: boolean; type?: string }
): boolean {
  const key = getMatchdayLockKey(seasonId, competitionId, matchday);
  const lock = matchdayLocksCache.get(key);

  if (lock) {
    if (lock.overrideStatus === 'FORCE_OPEN') return true;
    if (lock.overrideStatus === 'FORCE_LOCKED' || lock.overrideStatus === 'PAUSED' || lock.isLocked) return false;
    if (lock.isOpen === false) return false;
    if (lock.isOpen === true) return true;
  }

  // Isolated competition-level fallback
  const activeMatchday = compState?.currentMatchday || 1;
  const adminStatus = compState?.adminOverrideStatus || 'AUTO';
  const isMatchdayOpen = compState?.isMatchdayOpen !== false;
  const compType =
    compState?.type ||
    (competitionId.includes('cup') ||
    competitionId.includes('pokal') ||
    competitionId.includes('rey') ||
    competitionId.includes('italia')
      ? 'KNOCKOUT'
      : 'LEAGUE');
  const isKnockout =
    compType === 'KNOCKOUT' ||
    compType === 'SUPER_CUP' ||
    compType === 'EUROPEAN_KNOCKOUT';

  if (adminStatus === 'FORCE_LOCKED' || adminStatus === 'PAUSED') return false;
  if (isKnockout) {
    return true;
  }

  if (adminStatus === 'FORCE_OPEN') return matchday === activeMatchday;
  return isMatchdayOpen && matchday === activeMatchday;
}

export async function assertMatchdayPlayableFirestore(
  seasonId: string,
  competitionId: string,
  matchday: number
): Promise<void> {
  const key = getMatchdayLockKey(seasonId, competitionId, matchday);
  const lock = await getMatchdayLockFirestore(seasonId, competitionId, matchday);

  if (lock) {
    if (lock.overrideStatus === 'FORCE_LOCKED' || lock.overrideStatus === 'PAUSED' || lock.isLocked || lock.isOpen === false) {
      const err: any = new Error(`MATCHDAY_LOCKED: Matchday ${matchday} for competition '${competitionId}' is locked by tournament administration.`);
      err.code = 'MATCHDAY_LOCKED';
      err.statusCode = 403;
      throw err;
    }
    if (lock.overrideStatus === 'FORCE_OPEN' || lock.isOpen === true) {
      return; // Allowed!
    }
  }

  // Check competition-level state for this specific competition
  let comp = compOverrideMap.get(competitionId);
  if (!comp || !comp.type) {
    try {
      const db = getFirestoreDb();
      const doc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
      if (doc.exists) {
        const docData = doc.data() as FirestoreCompetitionDoc;
        comp = { ...comp, ...docData };
        compOverrideMap.set(competitionId, comp);
      }
    } catch {}
  }

  if (!comp || !comp.type) {
    try {
      const row = queryGet<any>('SELECT * FROM competitions WHERE id = ?', [competitionId]);
      if (row) {
        comp = {
          ...comp,
          id: row.id,
          seasonId: row.season_id,
          name: row.name,
          type: row.type,
          currentMatchday: comp?.currentMatchday || 1,
        };
        compOverrideMap.set(competitionId, comp);
      }
    } catch {}
  }

  const activeMatchday = comp?.currentMatchday || 1;
  const adminStatus = comp?.adminOverrideStatus || 'AUTO';
  const isMatchdayOpen = comp?.isMatchdayOpen !== false;
  const compType =
    comp?.type ||
    (competitionId.includes('cup') ||
    competitionId.includes('pokal') ||
    competitionId.includes('rey') ||
    competitionId.includes('italia')
      ? 'KNOCKOUT'
      : 'LEAGUE');
  const isKnockout =
    compType === 'KNOCKOUT' ||
    compType === 'SUPER_CUP' ||
    compType === 'EUROPEAN_KNOCKOUT';

  if (adminStatus === 'FORCE_LOCKED' || adminStatus === 'PAUSED') {
    const err: any = new Error(`MATCHDAY_LOCKED: Submissions for competition '${competitionId}' are locked by tournament administration.`);
    err.code = 'MATCHDAY_LOCKED';
    err.statusCode = 403;
    throw err;
  }

  // Knockout/Cup competitions: rounds are event-driven bracket stages.
  // Unless explicitly locked by an administrator, matches with determined clubs are playable.
  if (isKnockout) {
    return;
  }

  if (adminStatus === 'FORCE_OPEN') {
    if (matchday === activeMatchday) {
      return;
    }
    const err: any = new Error(`MATCHDAY_LOCKED: Matchday ${matchday} is locked. Admin open is active only for Matchday ${activeMatchday} in competition '${competitionId}'.`);
    err.code = 'MATCHDAY_LOCKED';
    err.statusCode = 403;
    throw err;
  }

  if (matchday !== activeMatchday) {
    const err: any = new Error(`MATCHDAY_LOCKED: Matchday ${matchday} is locked. Only active Matchday ${activeMatchday} is open for competition '${competitionId}'.`);
    err.code = 'MATCHDAY_LOCKED';
    err.statusCode = 403;
    throw err;
  }
}

// ----------------------------------------------------
// COMPETITION MATCHDAY MANAGEMENT (ISOLATED)
// ----------------------------------------------------

export async function advanceCompetitionMatchdayFirestore(
  competitionId: string,
  options: { durationHours?: number; seasonId?: string } = {}
): Promise<{ success: boolean; currentMatchday: number; totalMatchdays: number; isMatchdayOpen: boolean; nextMatchdayOpenAt: string }> {
  const db = getFirestoreDb();
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  const compDoc = await compRef.get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }

  const comp = compDoc.data() as FirestoreCompetitionDoc;
  const seasonId = options.seasonId || comp.seasonId || 'season-2026-27';
  const currentMd = comp.currentMatchday || 1;
  const totalMd = comp.totalMatchdays || 19;
  const nextMd = Math.min(totalMd, currentMd + 1);
  const durationHours = options.durationHours || comp.matchdayDurationHours || 30;
  const now = new Date().toISOString();
  const nextOpenAt = new Date(Date.now() + durationHours * 3600 * 1000).toISOString();

  await compRef.update({
    currentMatchday: nextMd,
    isMatchdayOpen: true,
    matchdayOpenedAt: now,
    matchdayDurationHours: durationHours,
    nextMatchdayOpenAt: nextOpenAt,
    adminOverrideStatus: 'AUTO',
    updatedAt: now,
  });

  const existingOverride = compOverrideMap.get(competitionId) || {};
  compOverrideMap.set(competitionId, {
    ...existingOverride,
    currentMatchday: nextMd,
    isMatchdayOpen: true,
    adminOverrideStatus: 'AUTO',
  });

  // Automatically update the lock for the new matchday isolated to this competition
  await setMatchdayLockFirestore(seasonId, competitionId, nextMd, {
    overrideStatus: 'AUTO',
    durationHours,
  });

  invalidateFirestoreCache('firestore:comp');
  return {
    success: true,
    currentMatchday: nextMd,
    totalMatchdays: totalMd,
    isMatchdayOpen: true,
    nextMatchdayOpenAt: nextOpenAt,
  };
}

export async function setCompetitionMatchdayOverrideFirestore(
  competitionId: string,
  overrideStatus: 'AUTO' | 'FORCE_OPEN' | 'FORCE_LOCKED' | 'PAUSED',
  options?: { matchday?: number; seasonId?: string; durationHours?: number; adminUserId?: string }
): Promise<{ success: boolean; adminOverrideStatus: string; isMatchdayOpen: boolean; matchdayLock?: FirestoreMatchdayLockDoc }> {
  const db = getFirestoreDb();
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  const compDoc = await compRef.get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }

  const comp = compDoc.data() as FirestoreCompetitionDoc;
  const seasonId = options?.seasonId || comp.seasonId || 'season-2026-27';
  const targetMatchday = options?.matchday || comp.currentMatchday || 1;
  const now = new Date().toISOString();
  const isMatchdayOpen = overrideStatus === 'FORCE_OPEN' || overrideStatus === 'AUTO';

  // Set the isolated matchday lock for this exact `${seasonId}:${competitionId}:${targetMatchday}`
  const lockDoc = await setMatchdayLockFirestore(seasonId, competitionId, targetMatchday, {
    overrideStatus,
    durationHours: options?.durationHours,
    adminUserId: options?.adminUserId,
  });

  // Only update competition top-level status if targetMatchday matches currentMatchday
  if (targetMatchday === (comp.currentMatchday || 1)) {
    await compRef.update({
      adminOverrideStatus: overrideStatus,
      isMatchdayOpen,
      updatedAt: now,
    });

    const existingOverride = compOverrideMap.get(competitionId) || {};
    compOverrideMap.set(competitionId, {
      ...existingOverride,
      adminOverrideStatus: overrideStatus,
      isMatchdayOpen,
    });
  }

  // Invalidate ONLY this modified competition/matchday lock
  invalidateMatchdayLockCache(seasonId, competitionId, targetMatchday);
  serverCache.delete(`firestore:comp:${competitionId}`);
  serverCache.delete(`firestore:competitions:${seasonId}`);
  serverCache.delete(`firestore:fixtures:${competitionId}`);
  return {
    success: true,
    adminOverrideStatus: overrideStatus,
    isMatchdayOpen,
    matchdayLock: lockDoc,
  };
}

export async function openCompetitionMatchdayNowFirestore(
  competitionId: string,
  durationHours = 30,
  matchday?: number,
  seasonId = 'season-2026-27'
): Promise<{ success: boolean; currentMatchday: number; isMatchdayOpen: boolean; nextMatchdayOpenAt: string }> {
  const db = getFirestoreDb();
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  const compDoc = await compRef.get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }

  const comp = compDoc.data() as FirestoreCompetitionDoc;
  const targetMd = matchday || comp.currentMatchday || 1;
  const now = new Date().toISOString();
  const nextOpenAt = new Date(Date.now() + durationHours * 3600 * 1000).toISOString();

  await setMatchdayLockFirestore(seasonId, competitionId, targetMd, {
    overrideStatus: 'FORCE_OPEN',
    durationHours,
  });

  if (targetMd === (comp.currentMatchday || 1)) {
    await compRef.update({
      isMatchdayOpen: true,
      matchdayOpenedAt: now,
      matchdayDurationHours: durationHours,
      nextMatchdayOpenAt: nextOpenAt,
      adminOverrideStatus: 'AUTO',
      updatedAt: now,
    });

    const existingOverride = compOverrideMap.get(competitionId) || {};
    compOverrideMap.set(competitionId, {
      ...existingOverride,
      isMatchdayOpen: true,
      adminOverrideStatus: 'AUTO',
    });
  }

  invalidateFirestoreCache('firestore:comp');
  return {
    success: true,
    currentMatchday: targetMd,
    isMatchdayOpen: true,
    nextMatchdayOpenAt: nextOpenAt,
  };
}

export async function setCompetitionMatchdayTimerFirestore(
  competitionId: string,
  params: { currentMatchday?: number; durationHours?: number; nextOpenAt?: string; overrideStatus?: 'AUTO' | 'FORCE_OPEN' | 'FORCE_LOCKED' | 'PAUSED'; seasonId?: string }
): Promise<{ success: boolean; competitionId: string }> {
  const db = getFirestoreDb();
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  const compDoc = await compRef.get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }

  const comp = compDoc.data() as FirestoreCompetitionDoc;
  const seasonId = params.seasonId || comp.seasonId || 'season-2026-27';
  const now = new Date().toISOString();
  const updates: Partial<FirestoreCompetitionDoc> = {
    updatedAt: now,
  };

  if (params.currentMatchday !== undefined) updates.currentMatchday = params.currentMatchday;
  if (params.durationHours !== undefined) updates.matchdayDurationHours = params.durationHours;
  if (params.nextOpenAt !== undefined) updates.nextMatchdayOpenAt = params.nextOpenAt;
  if (params.overrideStatus !== undefined) {
    updates.adminOverrideStatus = params.overrideStatus;
    updates.isMatchdayOpen = params.overrideStatus === 'FORCE_OPEN' || params.overrideStatus === 'AUTO';
  }

  await compRef.update(updates);

  const existingOverride = compOverrideMap.get(competitionId) || {};
  compOverrideMap.set(competitionId, {
    ...existingOverride,
    ...updates,
  });

  if (params.overrideStatus !== undefined) {
    const md = params.currentMatchday || comp.currentMatchday || 1;
    await setMatchdayLockFirestore(seasonId, competitionId, md, {
      overrideStatus: params.overrideStatus,
      durationHours: params.durationHours,
    });
  }

  invalidateFirestoreCache('firestore:comp');
  return { success: true, competitionId };
}

// ----------------------------------------------------
// ACTIVE CLUB OWNERSHIP / MANAGER RESOLUTION ENGINE
// Authoritative ownership lookup following strict priority:
// 1. active club_memberships for: seasonId + clubId
// 2. active_occupancies_cache if appropriate
// 3. existing valid participant/ownership snapshot as fallback
// 4. null only when the club is genuinely unclaimed
// ----------------------------------------------------

export interface AuthoritativeClubOwner {
  userId: string;
  telegramId?: string;
  username: string | null;
  displayName: string;
  firstName?: string;
  lastName?: string;
}

export function computeManagerDisplayName(user?: {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
} | null): string {
  if (user?.username) {
    const clean = user.username.replace(/^@+/, '').trim();
    if (clean) return `@${clean}`;
  }
  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
  if (fullName) return fullName;
  if (user?.firstName?.trim()) return user.firstName.trim();
  if (user?.displayName && user.displayName.trim() && user.displayName.trim() !== 'User kerak') {
    return user.displayName.trim();
  }
  return 'Telegram user';
}

export function resolveOwnerUserRecord(
  ownerUserId: string,
  hint?: { username?: string | null; displayName?: string | null; firstName?: string | null; lastName?: string | null; telegramId?: string | null }
): AuthoritativeClubOwner {
  if (!ownerUserId) {
    return { userId: '', username: null, displayName: 'User kerak' };
  }

  // 1. Check in-memory user cache
  const cached = getFromCache<User>(`firestore:user:${ownerUserId}`);
  if (cached) {
    const cleanUname = cached.username ? cached.username.replace(/^@+/, '').trim() : null;
    const dispName = computeManagerDisplayName({
      username: cleanUname,
      firstName: cached.firstName,
      lastName: cached.lastName,
    });
    return {
      userId: cached.id || ownerUserId,
      telegramId: cached.telegramId || '',
      username: cleanUname,
      displayName: dispName,
      firstName: cached.firstName,
      lastName: cached.lastName,
    };
  }

  // 2. Query SQLite users table supporting legacy ID formats safely
  try {
    const cleanNumeric = ownerUserId.replace(/^user-/, '');
    const userRow = queryGet<any>(
      `SELECT id, telegram_id, username, first_name, last_name
       FROM users
       WHERE id = ? OR telegram_id = ? OR id = ? OR ('user-' || telegram_id) = ?
       LIMIT 1`,
      [ownerUserId, ownerUserId, `user-${cleanNumeric}`, ownerUserId]
    );

    if (userRow) {
      const cleanUname = userRow.username ? userRow.username.replace(/^@+/, '').trim() : null;
      const dispName = computeManagerDisplayName({
        username: cleanUname,
        firstName: userRow.first_name,
        lastName: userRow.last_name,
      });
      return {
        userId: userRow.id || ownerUserId,
        telegramId: userRow.telegram_id || (cleanNumeric !== ownerUserId ? cleanNumeric : ''),
        username: cleanUname,
        displayName: dispName,
        firstName: userRow.first_name,
        lastName: userRow.last_name,
      };
    }
  } catch {}

  // 3. Fallback using hint from membership/occupancy or minimal representation
  const hintUname = hint?.username ? hint.username.replace(/^@+/, '').trim() : null;
  const dispName = computeManagerDisplayName({
    username: hintUname,
    firstName: hint?.firstName,
    lastName: hint?.lastName,
    displayName: hint?.displayName,
  });

  const numericTg = /^\d+$/.test(ownerUserId) ? ownerUserId : (ownerUserId.startsWith('user-') && /^\d+$/.test(ownerUserId.slice(5)) ? ownerUserId.slice(5) : '');

  return {
    userId: ownerUserId,
    telegramId: hint?.telegramId || numericTg || '',
    username: hintUname,
    displayName: dispName,
    firstName: hint?.firstName || undefined,
    lastName: hint?.lastName || undefined,
  };
}

export async function resolveClubOwnersForSeason(
  seasonId = 'season-2026-27',
  clubIds?: string[]
): Promise<Map<string, AuthoritativeClubOwner>> {
  const ownersMap = new Map<string, AuthoritativeClubOwner>();

  // PRIORITY 0: Redis clubsWithOwners read model (fresh or LKG)
  try {
    const { redisGetFresh, redisGetLkg, ReadModelKeys } = await import('../readModel/readModelStore');
    const clubsRes = (await redisGetFresh<any[]>(ReadModelKeys.clubsWithOwners(seasonId))) ||
                     (await redisGetLkg<any[]>(ReadModelKeys.clubsWithOwners(seasonId)));
    if (clubsRes && Array.isArray(clubsRes.data) && clubsRes.data.length > 0) {
      for (const club of clubsRes.data) {
        if (club.ownerUserId && !ownersMap.has(club.id)) {
          const uname = club.ownerUsername ? club.ownerUsername.replace(/^@+/, '').trim() : null;
          ownersMap.set(club.id, {
            userId: club.ownerUserId,
            username: uname,
            displayName: uname ? `@${uname}` : `User #${club.ownerUserId}`,
          });
        }
      }
      if (ownersMap.size > 0 && (!clubIds || clubIds.length === 0 || clubIds.every((id) => ownersMap.has(id)))) {
        return ownersMap;
      }
    }
  } catch {}

  // PRIORITY 1: active club_memberships for: seasonId + clubId
  // 1a. SQLite club_memberships
  try {
    const rows = queryAll<any>(
      `SELECT cm.club_id, cm.user_id, cm.status,
              u.id as u_id, u.telegram_id as u_tg, u.username as u_uname, u.first_name as u_fname, u.last_name as u_lname
       FROM club_memberships cm
       LEFT JOIN users u ON (
         cm.user_id = u.id OR
         cm.user_id = u.telegram_id OR
         cm.user_id = ('user-' || u.telegram_id) OR
         ('user-' || cm.user_id) = u.id
       )
       WHERE cm.season_id = ? AND cm.status = 'active'`,
      [seasonId]
    );
    for (const r of rows) {
      if (r.club_id && r.user_id && !ownersMap.has(r.club_id)) {
        const cleanUname = r.u_uname ? r.u_uname.replace(/^@+/, '').trim() : null;
        const dispName = computeManagerDisplayName({
          username: cleanUname,
          firstName: r.u_fname,
          lastName: r.u_lname,
        });
        ownersMap.set(r.club_id, {
          userId: r.u_id || r.user_id,
          telegramId: r.u_tg || (/^\d+$/.test(r.user_id) ? r.user_id : (r.user_id.startsWith('user-') ? r.user_id.slice(5) : '')),
          username: cleanUname,
          displayName: dispName,
          firstName: r.u_fname,
          lastName: r.u_lname,
        });
      }
    }
  } catch {}

  // If SQLite club_memberships satisfies request, return immediately without Firestore fan-out
  if (ownersMap.size > 0 && (!clubIds || clubIds.length === 0 || clubIds.every((id) => ownersMap.has(id)))) {
    return ownersMap;
  }

  // 1b. Firestore club_memberships (authoritative Firestore lookup only when SQLite miss)
  try {
    const db = getFirestoreDb();
    if (db && firestoreCircuitBreaker.canExecute()) {
      const memSnap = await db
        .collection(COLLECTIONS.CLUB_MEMBERSHIPS)
        .where('seasonId', '==', seasonId)
        .where('status', '==', 'active')
        .get();
      trackFirestoreRead(COLLECTIONS.CLUB_MEMBERSHIPS, memSnap.docs.length, 'resolveClubOwnersForSeason:memberships');

      if (!memSnap.empty) {
        for (const doc of memSnap.docs) {
          const data = doc.data() as FirestoreClubMembershipDoc;
          if (data.clubId && data.userId && !ownersMap.has(data.clubId)) {
            const owner = resolveOwnerUserRecord(data.userId);
            ownersMap.set(data.clubId, owner);
          }
        }
      }
    }
  } catch {}

  // PRIORITY 2: active_occupancies_cache if appropriate
  // 2a. SQLite active_occupancies_cache
  try {
    const occRows = queryAll<any>(
      `SELECT aoc.club_id, aoc.user_id, aoc.username, aoc.display_name, aoc.status,
              u.id as u_id, u.telegram_id as u_tg, u.username as u_uname, u.first_name as u_fname, u.last_name as u_lname
       FROM active_occupancies_cache aoc
       LEFT JOIN users u ON (
         aoc.user_id = u.id OR
         aoc.user_id = u.telegram_id OR
         aoc.user_id = ('user-' || u.telegram_id) OR
         ('user-' || aoc.user_id) = u.id
       )
       WHERE aoc.season_id = ? AND aoc.status = 'active'`,
      [seasonId]
    );
    for (const r of occRows) {
      if (r.club_id && r.user_id && !ownersMap.has(r.club_id)) {
        const cleanUname = (r.u_uname || r.username) ? (r.u_uname || r.username).replace(/^@+/, '').trim() : null;
        const dispName = computeManagerDisplayName({
          username: cleanUname,
          firstName: r.u_fname,
          lastName: r.u_lname,
          displayName: r.display_name,
        });
        ownersMap.set(r.club_id, {
          userId: r.u_id || r.user_id,
          telegramId: r.u_tg || (/^\d+$/.test(r.user_id) ? r.user_id : (r.user_id.startsWith('user-') ? r.user_id.slice(5) : '')),
          username: cleanUname,
          displayName: dispName,
          firstName: r.u_fname,
          lastName: r.u_lname,
        });
      }
    }
  } catch {}

  // 2b. Dynamic active occupancies from Firestore / memory snapshot
  try {
    const { clubOccupancyMap, usernameMap, userMap } = await getActiveOccupanciesForSeason(seasonId);
    for (const [clubId, occ] of clubOccupancyMap.entries()) {
      if (occ?.userId && !ownersMap.has(clubId)) {
        const u = userMap.get(occ.userId);
        const rawUname = usernameMap.get(occ.userId) || u?.username || null;
        const cleanUname = rawUname ? rawUname.replace(/^@+/, '').trim() : null;
        const dispName = computeManagerDisplayName({
          username: cleanUname,
          displayName: u?.displayName,
        });
        ownersMap.set(clubId, {
          userId: occ.userId,
          username: cleanUname,
          displayName: dispName,
        });
      }
    }
  } catch (err: any) {
    console.warn('[RESOLVE_OWNERS] Error from active occupancies:', err.message);
  }

  // PRIORITY 3: existing valid participant/ownership snapshot as fallback
  // 3a. SQLite competition_participants
  try {
    const partRows = queryAll<any>(
      `SELECT cp.club_id, cp.owner_user_id,
              u.id as u_id, u.telegram_id as u_tg, u.username as u_uname, u.first_name as u_fname, u.last_name as u_lname
       FROM competition_participants cp
       LEFT JOIN users u ON (
         cp.owner_user_id = u.id OR
         cp.owner_user_id = u.telegram_id OR
         cp.owner_user_id = ('user-' || u.telegram_id) OR
         ('user-' || cp.owner_user_id) = u.id
       )
       WHERE (cp.season_id = ? OR cp.season_id IS NULL) AND cp.owner_user_id IS NOT NULL AND cp.owner_user_id != ''`,
      [seasonId]
    );
    for (const r of partRows) {
      if (r.club_id && r.owner_user_id && !ownersMap.has(r.club_id)) {
        const cleanUname = r.u_uname ? r.u_uname.replace(/^@+/, '').trim() : null;
        const dispName = computeManagerDisplayName({
          username: cleanUname,
          firstName: r.u_fname,
          lastName: r.u_lname,
        });
        ownersMap.set(r.club_id, {
          userId: r.u_id || r.owner_user_id,
          telegramId: r.u_tg || '',
          username: cleanUname,
          displayName: dispName,
          firstName: r.u_fname,
          lastName: r.u_lname,
        });
      }
    }
  } catch {}

  // 3b. SEED_CLUBS fallback for clubs with initial ownerUserId
  try {
    for (const seed of SEED_CLUBS) {
      if ((seed as any).ownerUserId && !ownersMap.has(seed.id)) {
        const owner = resolveOwnerUserRecord((seed as any).ownerUserId);
        ownersMap.set(seed.id, owner);
      }
    }
  } catch {}

  // PRIORITY 4: null only when the club is genuinely unclaimed
  return ownersMap;
}

export async function enrichFixturesWithAuthoritativeOwners(
  fixtures: Fixture[],
  seasonId = 'season-2026-27'
): Promise<Fixture[]> {
  if (!fixtures || fixtures.length === 0) return fixtures;

  const clubIds = new Set<string>();
  for (const f of fixtures) {
    if (f.homeClubId && f.homeClubId !== 'TBD') clubIds.add(f.homeClubId);
    if (f.awayClubId && f.awayClubId !== 'TBD') clubIds.add(f.awayClubId);
  }

  const ownersMap = await resolveClubOwnersForSeason(seasonId, Array.from(clubIds));

  return fixtures.map((f) => {
    const homeOwner = f.homeClubId ? (ownersMap.get(f.homeClubId) || null) : null;
    const awayOwner = f.awayClubId ? (ownersMap.get(f.awayClubId) || null) : null;

    const homeUser: FixtureUserInfo | null = homeOwner ? {
      id: homeOwner.userId,
      userId: homeOwner.userId,
      telegramId: homeOwner.telegramId,
      username: homeOwner.username ? `@${homeOwner.username.replace(/^@+/, '')}` : '',
      displayName: homeOwner.displayName,
    } : null;

    const awayUser: FixtureUserInfo | null = awayOwner ? {
      id: awayOwner.userId,
      userId: awayOwner.userId,
      telegramId: awayOwner.telegramId,
      username: awayOwner.username ? `@${awayOwner.username.replace(/^@+/, '')}` : '',
      displayName: awayOwner.displayName,
    } : null;

    const homeOwnerNormalized: FixtureOwnerInfo | null = homeOwner ? {
      userId: homeOwner.userId,
      telegramId: homeOwner.telegramId,
      username: homeOwner.username ? homeOwner.username.replace(/^@+/, '') : null,
      displayName: homeOwner.displayName,
    } : null;

    const awayOwnerNormalized: FixtureOwnerInfo | null = awayOwner ? {
      userId: awayOwner.userId,
      telegramId: awayOwner.telegramId,
      username: awayOwner.username ? awayOwner.username.replace(/^@+/, '') : null,
      displayName: awayOwner.displayName,
    } : null;

    const homeOwnerId = homeOwner ? homeOwner.userId : undefined;
    const awayOwnerId = awayOwner ? awayOwner.userId : undefined;

    const homeClub = f.homeClub ? {
      ...f.homeClub,
      isTaken: Boolean(homeOwner),
      claimedByUserId: homeOwner?.userId || null,
      claimedByUsername: homeOwner?.username || null,
      managerUsername: homeOwner?.username || undefined,
      owner: homeOwner ? {
        userId: homeOwner.userId,
        username: homeOwner.username || '',
        firstName: homeOwner.displayName,
        claimedAt: f.homeClub.owner?.claimedAt || new Date().toISOString(),
      } : null,
    } : f.homeClub;

    const awayClub = f.awayClub ? {
      ...f.awayClub,
      isTaken: Boolean(awayOwner),
      claimedByUserId: awayOwner?.userId || null,
      claimedByUsername: awayOwner?.username || null,
      managerUsername: awayOwner?.username || undefined,
      owner: awayOwner ? {
        userId: awayOwner.userId,
        username: awayOwner.username || '',
        firstName: awayOwner.displayName,
        claimedAt: f.awayClub.owner?.claimedAt || new Date().toISOString(),
      } : null,
    } : f.awayClub;

    return {
      ...f,
      homeOwnerId,
      awayOwnerId,
      homeUser,
      awayUser,
      homeOwner: homeOwnerNormalized,
      awayOwner: awayOwnerNormalized,
      homeClub,
      awayClub,
    };
  });
}

export async function enrichStandingsWithActiveOwners(
  rows: StandingsRow[],
  seasonId = 'season-2026-27'
): Promise<StandingsRow[]> {
  if (!rows || rows.length === 0) return rows;
  try {
    const clubIds = rows.map((r) => r.clubId);
    const ownersMap = await resolveClubOwnersForSeason(seasonId, clubIds);

    return rows.map((row) => {
      const owner = ownersMap.get(row.clubId);
      if (owner) {
        return {
          ...row,
          managerUserId: owner.userId || row.managerUserId,
          managerUsername: owner.username || row.managerUsername,
        };
      }
      return row;
    });
  } catch (err: any) {
    console.warn('[ENRICH_STANDINGS] Error enriching standings:', err.message);
    return rows;
  }
}

// ----------------------------------------------------
// STANDINGS CALCULATION & PRE-AGGREGATION (FIRESTORE)
// ----------------------------------------------------

export function computeAndSortStandings(
  clubs: Array<{ id: string; name: string; shortName: string; logoUrl?: string; managerUserId?: string; managerUsername?: string }>,
  confirmedFixtures: Array<{ homeClubId: string; awayClubId: string; homeScore: number; awayScore: number }>,
  formatConfig: any
): StandingsRow[] {
  const pointsForWin = formatConfig.pointsForWin ?? 3;
  const pointsForDraw = formatConfig.pointsForDraw ?? 1;
  const pointsForLoss = formatConfig.pointsForLoss ?? 0;
  const tieBreakers: string[] = formatConfig.tieBreakers ?? ['points', 'goalDifference', 'goalsFor', 'headToHead'];

  const statsMap = new Map<string, any>();
  for (const c of clubs) {
    statsMap.set(c.id, {
      clubId: c.id,
      clubName: c.name,
      shortName: c.shortName,
      logoUrl: c.logoUrl,
      managerUserId: c.managerUserId,
      managerUsername: c.managerUsername,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      form: [] as Array<'W' | 'D' | 'L'>,
    });
  }

  for (const fix of confirmedFixtures) {
    const home = statsMap.get(fix.homeClubId);
    const away = statsMap.get(fix.awayClubId);
    const hScore = fix.homeScore ?? 0;
    const aScore = fix.awayScore ?? 0;

    if (home) {
      home.played += 1;
      home.goalsFor += hScore;
      home.goalsAgainst += aScore;
      if (hScore > aScore) {
        home.won += 1;
        home.points += pointsForWin;
        home.form.push('W');
      } else if (hScore === aScore) {
        home.drawn += 1;
        home.points += pointsForDraw;
        home.form.push('D');
      } else {
        home.lost += 1;
        home.points += pointsForLoss;
        home.form.push('L');
      }
    }

    if (away) {
      away.played += 1;
      away.goalsFor += aScore;
      away.goalsAgainst += hScore;
      if (aScore > hScore) {
        away.won += 1;
        away.points += pointsForWin;
        away.form.push('W');
      } else if (aScore === hScore) {
        away.drawn += 1;
        away.points += pointsForDraw;
        away.form.push('D');
      } else {
        away.lost += 1;
        away.points += pointsForLoss;
        away.form.push('L');
      }
    }
  }

  const rows = Array.from(statsMap.values()).map((row) => {
    row.goalDifference = row.goalsFor - row.goalsAgainst;
    row.form = row.form.slice(-5);
    return row;
  });

  function getH2HPoints(clubAId: string, clubBId: string): number {
    let pts = 0;
    for (const f of confirmedFixtures) {
      const hs = f.homeScore ?? 0;
      const as = f.awayScore ?? 0;
      if (f.homeClubId === clubAId && f.awayClubId === clubBId) {
        if (hs > as) pts += pointsForWin;
        else if (hs === as) pts += pointsForDraw;
      } else if (f.homeClubId === clubBId && f.awayClubId === clubAId) {
        if (as > hs) pts += pointsForWin;
        else if (as === hs) pts += pointsForDraw;
      }
    }
    return pts;
  }

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;

    for (const criteria of tieBreakers) {
      if (criteria === 'goalDifference') {
        if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
      } else if (criteria === 'goalsFor') {
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      } else if (criteria === 'headToHead') {
        const h2hA = getH2HPoints(a.clubId, b.clubId);
        const h2hB = getH2HPoints(b.clubId, a.clubId);
        if (h2hB !== h2hA) return h2hB - h2hA;
      }
    }

    return (a.clubName || '').localeCompare(b.clubName || '');
  });

  return rows.map((r, index) => ({
    position: index + 1,
    clubId: r.clubId,
    clubName: r.clubName,
    shortName: r.shortName,
    logoUrl: r.logoUrl,
    managerUserId: r.managerUserId || undefined,
    managerUsername: r.managerUsername || null,
    played: r.played,
    won: r.won,
    drawn: r.drawn,
    lost: r.lost,
    goalsFor: r.goalsFor,
    goalsAgainst: r.goalsAgainst,
    goalDifference: r.goalDifference,
    points: r.points,
    form: r.form,
  }));
}

function fallbackCalculateStandings(competitionId: string): StandingsRow[] {
  try {
    const { refreshMaterializedStandingsForCompetition } = require('../db/sqliteStandings');
    const standings = refreshMaterializedStandingsForCompetition(competitionId);
    if (standings && standings.length > 0) {
      return standings;
    }
  } catch {}

  const comp = queryGet<any>('SELECT * FROM competitions WHERE id = ?', [competitionId]);
  if (!comp) return [];

  let formatConfig: any = {};
  if (comp.format_config_json) {
    try {
      formatConfig = JSON.parse(comp.format_config_json);
    } catch {
      formatConfig = {};
    }
  }

  let clubs: Array<any> = [];
  if (comp.league_id) {
    clubs = queryAll<any>('SELECT * FROM clubs WHERE league_id = ? AND active = 1', [comp.league_id]);
  } else {
    clubs = queryAll<any>(
      `SELECT c.* FROM competition_participants cp
       JOIN clubs c ON cp.club_id = c.id
       WHERE cp.competition_id = ?`,
      [competitionId]
    );
  }

  const confirmedFixtures = queryAll<any>(
    `SELECT * FROM fixtures WHERE competition_id = ? AND status = 'CONFIRMED' AND home_score IS NOT NULL AND away_score IS NOT NULL`,
    [competitionId]
  );

  const compSeasonId = comp?.season_id || 'season-2026-27';
  let ownersMap = new Map<string, { userId: string; username: string }>();
  try {
    const memRows = queryAll<any>(
      `SELECT cm.club_id, cm.user_id, u.username, u.first_name
       FROM club_memberships cm
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE cm.season_id = ? AND cm.status = 'active'`,
      [compSeasonId]
    );
    for (const r of memRows) {
      ownersMap.set(r.club_id, { userId: r.user_id, username: r.username || r.first_name || r.user_id });
    }
  } catch {}

  const clubList = clubs.map((c) => {
    const owner = ownersMap.get(c.id);
    return {
      id: c.id,
      name: c.name,
      shortName: c.short_name,
      logoUrl: c.logo_url,
      managerUserId: owner?.userId,
      managerUsername: owner?.username,
    };
  });

  const fixtureList = confirmedFixtures.map((f) => ({
    homeClubId: f.home_club_id,
    awayClubId: f.away_club_id,
    homeScore: f.home_score ?? 0,
    awayScore: f.away_score ?? 0,
  }));

  return computeAndSortStandings(clubList, fixtureList, formatConfig);
}

export async function getCompetitionStandingsFirestore(
  competitionId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<StandingsRow[]> {
  const seedComp = SEED_COMPETITIONS.find((c) => c.id === competitionId);
  const seasonId = seedComp?.seasonId || 'season-2026-27';
  const cacheKey = `firestore:standings:${competitionId}`;
  if (!options.forceRefresh) {
    const cached = getFromCache<StandingsRow[]>(cacheKey);
    if (cached) {
      return await enrichStandingsWithActiveOwners(cached, seasonId);
    }
  }

  try {
    const db = getFirestoreDb();
    trackFirestoreRead(COLLECTIONS.STANDINGS, 1, 'getCompetitionStandingsFirestore');
    const docRef = db.collection(COLLECTIONS.STANDINGS).doc(competitionId);
    const docSnap = await docRef.get();

    if (docSnap.exists) {
      const data = docSnap.data() as FirestoreStandingsDoc;
      if (Array.isArray(data.rows) && data.rows.length > 0) {
        const enriched = await enrichStandingsWithActiveOwners(data.rows, seasonId);
        setInCache(cacheKey, enriched, 300000); // 5 min cache
        return enriched;
      }
    }

    // Materialized document does not exist yet -> calculate and enrich
    const rawRows = fallbackCalculateStandings(competitionId);
    const enriched = await enrichStandingsWithActiveOwners(rawRows, seasonId);
    setInCache(cacheKey, enriched, 300000);
    return enriched;
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getCompetitionStandingsFirestore:', err.message);
    const rawRows = fallbackCalculateStandings(competitionId);
    const enriched = await enrichStandingsWithActiveOwners(rawRows, seasonId);
    setInCache(cacheKey, enriched, 300000);
    return enriched;
  }
}

export async function rebuildCompetitionStandingsFirestore(competitionId: string): Promise<StandingsRow[]> {
  const cacheKey = `firestore:standings:${competitionId}`;
  try {
    const db = getFirestoreDb();
    const seedComp = SEED_COMPETITIONS.find((c) => c.id === competitionId);
    const formatConfig = seedComp?.formatConfig || {};
    const leagueId = seedComp?.leagueId;

    let seedClubs: any[] = [];
    if (leagueId) {
      seedClubs = SEED_CLUBS.filter((c) => c.leagueId === leagueId);
    } else {
      // European or Cup tournament: resolve from competition_participants
      const partSnap = await db
        .collection(COLLECTIONS.COMPETITION_PARTICIPANTS)
        .where('competitionId', '==', competitionId)
        .orderBy('seedNumber', 'asc')
        .get();

      if (!partSnap.empty) {
        const participantClubIds = partSnap.docs.map(
          (d) => (d.data() as FirestoreCompetitionParticipantDoc).clubId
        );
        seedClubs = participantClubIds.map((cid) => {
          const club = SEED_CLUBS.find((c) => c.id === cid);
          return club || { id: cid, name: cid, shortName: cid, logoUrl: '' };
        });
      } else {
        // Fallback: check SQLite competition_participants
        const sqlParts = queryAll<any>(
          `SELECT cp.club_id, c.name, c.short_name, c.logo_url
           FROM competition_participants cp
           JOIN clubs c ON cp.club_id = c.id
           WHERE cp.competition_id = ?
           ORDER BY cp.seed_number ASC`,
          [competitionId]
        );
        if (sqlParts.length > 0) {
          seedClubs = sqlParts.map((p) => ({
            id: p.club_id,
            name: p.name,
            shortName: p.short_name,
            logoUrl: p.logo_url,
          }));
        } else {
          seedClubs = SEED_CLUBS;
        }
      }
    }

    // 1. Fetch only CONFIRMED fixtures for this competition
    const fixSnap = await db
      .collection(COLLECTIONS.FIXTURES)
      .where('competitionId', '==', competitionId)
      .where('status', '==', 'CONFIRMED')
      .get();
    trackFirestoreRead(
      COLLECTIONS.FIXTURES,
      fixSnap.empty ? 1 : fixSnap.docs.length,
      'rebuildCompetitionStandingsFirestore'
    );

    const seasonId = seedComp?.seasonId || 'season-2026-27';
    const ownersMap = await resolveClubOwnersForSeason(seasonId, seedClubs.map((c) => c.id));

    const confirmedFixtures = fixSnap.docs
      .map((d) => d.data() as FirestoreFixtureDoc)
      .filter((f) => f.homeScore !== null && f.homeScore !== undefined && f.awayScore !== null && f.awayScore !== undefined)
      .map((f) => ({
        homeClubId: f.homeClubId,
        awayClubId: f.awayClubId,
        homeScore: f.homeScore ?? 0,
        awayScore: f.awayScore ?? 0,
      }));

    const rankedRows = computeAndSortStandings(
      seedClubs.map((c) => {
        const owner = ownersMap.get(c.id);
        return {
          id: c.id,
          name: c.name,
          shortName: c.shortName,
          logoUrl: c.logoUrl,
          managerUserId: owner?.userId,
          managerUsername: owner?.username,
        };
      }),
      confirmedFixtures,
      formatConfig
    );

    const now = new Date().toISOString();
    const standingsDoc: FirestoreStandingsDoc = {
      competitionId,
      seasonId,
      updatedAt: now,
      rows: rankedRows,
      confirmedFixtureIds: fixSnap.docs.map((d) => d.id),
      totalPlayed: confirmedFixtures.length,
    };

    // Save materialized standings document
    await db.collection(COLLECTIONS.STANDINGS).doc(competitionId).set(standingsDoc);

    // Update in-memory cache
    setInCache(cacheKey, rankedRows, 300000);
    return rankedRows;
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] rebuildCompetitionStandingsFirestore:', err.message);
    const rawRows = fallbackCalculateStandings(competitionId);
    const enriched = await enrichStandingsWithActiveOwners(rawRows);
    setInCache(cacheKey, enriched, 300000);
    return enriched;
  }
}

export async function calculateCompetitionStandingsFirestore(competitionId: string): Promise<StandingsRow[]> {
  return getCompetitionStandingsFirestore(competitionId);
}

// ----------------------------------------------------
// RESULT SUBMISSIONS & CONSENSUS (FIRESTORE)
// ----------------------------------------------------

export async function submitFixtureResultFirestore(
  userId: string,
  fixtureId: string,
  homeScore: number,
  awayScore: number,
  proofUrl?: string
): Promise<Fixture> {
  assertNoSyntheticIdsInProduction('submitFixtureResultFirestore', [userId, fixtureId]);
  guardAgainstTestEntityCreation('submission', fixtureId, userId);

  if (!Number.isInteger(homeScore) || homeScore < 0 || homeScore > 99 || !Number.isInteger(awayScore) || awayScore < 0 || awayScore > 99) {
    throw new Error('Scores must be integers between 0 and 99.');
  }

  const db = getFirestoreDb();
  const now = new Date().toISOString();
  const submissionId = `sub-${fixtureId}-${userId}`;

  const executeFallbackSubmit = async (): Promise<Fixture> => {
    console.log('[RESULT_SUBMISSION_FALLBACK] Executing resilient durable fallback persistence for fixture:', fixtureId);
    const row = queryGet<any>('SELECT * FROM fixtures WHERE id = ?', [fixtureId]);
    if (!row) {
      throw new Error(`Fixture with ID '${fixtureId}' not found.`);
    }

    // Isolated competition-specific matchday lock check FIRST
    await assertMatchdayPlayableFirestore(row.season_id || 'season-2026-27', row.competition_id, row.matchday);

    if (row.status === 'CONFIRMED') {
      throw new Error('This match result is already CONFIRMED and cannot be modified.');
    }
    if (row.home_club_id === 'TBD' || row.away_club_id === 'TBD' || !row.home_club_id || !row.away_club_id) {
      const err: any = new Error('This match has undetermined participants (TBD) and cannot be played yet.');
      err.code = 'FIXTURE_NOT_READY';
      err.statusCode = 400;
      throw err;
    }

    // Verify ownership via snapshot or SQLite
    let userClubId: string | null = null;
    const localOccClubId = getUserOccupiedClubIdLocally(row.season_id || 'season-2026-27', userId);
    if (localOccClubId && (localOccClubId === row.home_club_id || localOccClubId === row.away_club_id)) {
      userClubId = localOccClubId;
    } else {
      const memRow =
        queryGet<any>('SELECT * FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = "active"', [
          userId,
          row.season_id,
        ]) ||
        queryGet<any>('SELECT * FROM season_league_clubs WHERE owner_user_id = ? AND season_id = ?', [
          userId,
          row.season_id,
        ]);
      userClubId = memRow?.club_id || memRow?.clubId;
    }

    if (!userClubId || (userClubId !== row.home_club_id && userClubId !== row.away_club_id)) {
      throw new Error('You do not own either the home or away club in this fixture.');
    }

    const existingSubs = queryAll<any>('SELECT * FROM result_submissions WHERE fixture_id = ?', [fixtureId]);
    const otherSub = existingSubs.find((s) => s.submitted_by_user_id !== userId);
    let newStatus = 'PENDING_CONFIRMATION';
    let confirmedHomeScore: number | null = null;
    let confirmedAwayScore: number | null = null;
    let winnerClubId: string | null = null;
    let confirmedAt: string | null = null;

    if (otherSub) {
      if (otherSub.home_score === homeScore && otherSub.away_score === awayScore) {
        newStatus = 'CONFIRMED';
        confirmedHomeScore = homeScore;
        confirmedAwayScore = awayScore;
        confirmedAt = now;
        if (confirmedHomeScore > confirmedAwayScore) winnerClubId = row.home_club_id;
        else if (confirmedAwayScore > confirmedHomeScore) winnerClubId = row.away_club_id;
      } else {
        newStatus = 'DISPUTED';
      }
    }

    const mutationId = `sub_${fixtureId}_${userId}`;
    const mutationPayload = {
      fixtureId,
      userId,
      userClubId,
      homeScore,
      awayScore,
      proofUrl: proofUrl || null,
      submissionId,
      seasonId: row.season_id || 'season-2026-27',
      competitionId: row.competition_id,
      homeClubId: row.home_club_id,
      awayClubId: row.away_club_id,
      matchday: row.matchday,
      isConfirmation: newStatus === 'CONFIRMED',
      resultingStatus: newStatus,
      confirmedHomeScore,
      confirmedAwayScore,
      winnerClubId,
      confirmedAt,
      createdAt: now,
    };

    // 1. MUST persist to durable Redis outbox FIRST
    await enqueueDurableOutboxMutation({
      mutationId,
      entityType: 'RESULT_SUBMISSION',
      entityId: fixtureId,
      operation: 'SUBMIT_RESULT',
      userId,
      seasonId: row.season_id || 'season-2026-27',
      competitionId: row.competition_id,
      payload: mutationPayload,
      createdAt: now,
    });

    // 2. Only after Redis persistence succeeds: update local SQLite/read model
    queryRun(
      `INSERT OR REPLACE INTO result_submissions (id, fixture_id, submitted_by_user_id, club_id, home_score, away_score, proof_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [submissionId, fixtureId, userId, userClubId, homeScore, awayScore, proofUrl || null, now]
    );

    queryRun(
      `UPDATE fixtures SET status = ?, home_score = ?, away_score = ?, winner_club_id = ?, result_confirmed_at = ?, updated_at = ? WHERE id = ?`,
      [newStatus, confirmedHomeScore, confirmedAwayScore, winnerClubId, confirmedAt, now, fixtureId]
    );

    invalidateFirestoreCache('firestore:fixtures');
    invalidateFirestoreCache('firestore:comp');
    const fallbackFixture = (await getFixtureByIdFirestore(fixtureId, userId))!;
    if (fallbackFixture) {
      (fallbackFixture as any).pendingSync = true;
    }
    return fallbackFixture;
  };

  if (!firestoreCircuitBreaker.canExecute()) {
    recordFallbackUsage();
    return await executeFallbackSubmit();
  }

  try {
    const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
    trackFirestoreRead(COLLECTIONS.FIXTURES, 1, 'submitFixtureResultFirestore:fixture');
    const fixDoc = await fixRef.get();
    if (!fixDoc.exists) {
      throw new Error(`Fixture with ID '${fixtureId}' not found.`);
    }

    const fixture = fixDoc.data() as FirestoreFixtureDoc;

    // Authoritative Server-Side Isolated Matchday Lock Check FIRST
    if (fixture.competitionId && fixture.matchday) {
      await assertMatchdayPlayableFirestore(
        fixture.seasonId || 'season-2026-27',
        fixture.competitionId,
        fixture.matchday
      );
    }

    if (fixture.status === 'CONFIRMED') {
      throw new Error('This match result is already CONFIRMED and cannot be modified.');
    }
    if (fixture.homeClubId === 'TBD' || fixture.awayClubId === 'TBD' || !fixture.homeClubId || !fixture.awayClubId) {
      const err: any = new Error('This match has undetermined participants (TBD) and cannot be played yet.');
      err.code = 'FIXTURE_NOT_READY';
      err.statusCode = 400;
      throw err;
    }

    const membershipRef = db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${fixture.seasonId}_${userId}`);
    const subRef = db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc(submissionId);
    const submissionsQuery = db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', '==', fixtureId);
    const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(`disp-${fixtureId}`);

    type ConsensusResult = {
      fixture: FirestoreFixtureDoc;
      userClubId: string;
      newStatus: string;
      confirmedHomeScore: number | null;
      confirmedAwayScore: number | null;
      winnerClubId: string | null;
      confirmedAt: string | null;
    };

    // Submission, consensus, dispute and fixture state are one serializable unit.
    // Firestore retries this callback when either participant submits concurrently.
    const consensus = await db.runTransaction(async (transaction): Promise<ConsensusResult> => {
      const [txFixDoc, userMemDoc, allSubsSnap] = await Promise.all([
        transaction.get(fixRef),
        transaction.get(membershipRef),
        transaction.get(submissionsQuery),
      ]);

      if (!txFixDoc.exists) throw new Error(`Fixture with ID '${fixtureId}' not found.`);
      const currentFixture = txFixDoc.data() as FirestoreFixtureDoc;
      if (currentFixture.status === 'CONFIRMED') {
        throw new Error('This match result is already CONFIRMED and cannot be modified.');
      }
      if (!currentFixture.homeClubId || !currentFixture.awayClubId || currentFixture.homeClubId === 'TBD' || currentFixture.awayClubId === 'TBD') {
        const err: any = new Error('This match has undetermined participants (TBD) and cannot be played yet.');
        err.code = 'FIXTURE_NOT_READY';
        err.statusCode = 400;
        throw err;
      }
      if (!userMemDoc.exists || userMemDoc.data()?.status !== 'active') {
        throw new Error('You do not own either the home or away club in this fixture.');
      }

      const userClubId = userMemDoc.data()!.clubId;
      if (userClubId !== currentFixture.homeClubId && userClubId !== currentFixture.awayClubId) {
        throw new Error('You do not own either the home or away club in this fixture.');
      }

      const currentSubmission: FirestoreResultSubmissionDoc = {
        id: submissionId,
        fixtureId,
        submittedByUserId: userId,
        clubId: userClubId,
        homeScore,
        awayScore,
        proofUrl: proofUrl || null,
        createdAt: now,
      };

      // Keep at most one effective submission per participating club. The current
      // owner submission wins over any historical submission for the same club.
      const byClub = new Map<string, FirestoreResultSubmissionDoc>();
      for (const doc of allSubsSnap.docs) {
        const submission = doc.data() as FirestoreResultSubmissionDoc;
        if (submission.clubId === currentFixture.homeClubId || submission.clubId === currentFixture.awayClubId) {
          byClub.set(submission.clubId, submission);
        }
      }
      byClub.set(userClubId, currentSubmission);

      const homeSubmission = byClub.get(currentFixture.homeClubId);
      const awaySubmission = byClub.get(currentFixture.awayClubId);
      let newStatus = 'PENDING_CONFIRMATION';
      let confirmedHomeScore: number | null = null;
      let confirmedAwayScore: number | null = null;
      let winnerClubId: string | null = null;
      let confirmedAt: string | null = null;

      if (homeSubmission && awaySubmission) {
        if (homeSubmission.homeScore === awaySubmission.homeScore && homeSubmission.awayScore === awaySubmission.awayScore) {
          newStatus = 'CONFIRMED';
          confirmedHomeScore = homeSubmission.homeScore;
          confirmedAwayScore = homeSubmission.awayScore;
          confirmedAt = now;
          if (confirmedHomeScore > confirmedAwayScore) winnerClubId = currentFixture.homeClubId;
          else if (confirmedAwayScore > confirmedHomeScore) winnerClubId = currentFixture.awayClubId;
          transaction.set(disputeRef, {
            id: `disp-${fixtureId}`,
            fixtureId,
            seasonId: currentFixture.seasonId,
            homeSubmissionId: homeSubmission.id,
            awaySubmissionId: awaySubmission.id,
            status: 'CANCELLED',
            resolutionNotes: 'Both participants submitted the same score.',
            resolvedAt: now,
            createdAt: now,
          }, { merge: true });
        } else {
          newStatus = 'DISPUTED';
          transaction.set(disputeRef, {
            id: `disp-${fixtureId}`,
            fixtureId,
            seasonId: currentFixture.seasonId,
            homeSubmissionId: homeSubmission.id,
            awaySubmissionId: awaySubmission.id,
            status: 'OPEN',
            createdAt: now,
          }, { merge: true });
        }
      }

      transaction.set(subRef, currentSubmission);
      transaction.update(fixRef, {
        status: newStatus,
        homeScore: confirmedHomeScore,
        awayScore: confirmedAwayScore,
        winnerClubId,
        resultConfirmedAt: confirmedAt,
        updatedAt: now,
      });

      return { fixture: currentFixture, userClubId, newStatus, confirmedHomeScore, confirmedAwayScore, winnerClubId, confirmedAt };
    });

    const { userClubId, newStatus, confirmedHomeScore, confirmedAwayScore, winnerClubId, confirmedAt } = consensus;
    trackFirestoreRead(COLLECTIONS.USER_MEMBERSHIPS, 1, 'submitFixtureResultFirestore:membership');
    trackFirestoreRead(COLLECTIONS.RESULT_SUBMISSIONS, 1, 'submitFixtureResultFirestore:allSubs');
    trackFirestoreWrite(COLLECTIONS.RESULT_SUBMISSIONS, 1, 'submitFixtureResultFirestore:setSubmission');
    trackFirestoreWrite(COLLECTIONS.FIXTURES, 1, 'submitFixtureResultFirestore:updateStatus');
    if (newStatus === 'DISPUTED') trackFirestoreWrite(COLLECTIONS.DISPUTES, 1, 'submitFixtureResultFirestore:dispute');

    // Mark circuit breaker success
    firestoreCircuitBreaker.recordSuccess();

    // Also persist in SQLite for offline resilience
    try {
      queryRun(
        `INSERT OR REPLACE INTO result_submissions (id, fixture_id, submitted_by_user_id, club_id, home_score, away_score, proof_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [submissionId, fixtureId, userId, userClubId, homeScore, awayScore, proofUrl || null, now]
      );
      queryRun(
        `UPDATE fixtures SET status = ?, home_score = ?, away_score = ?, winner_club_id = ?, result_confirmed_at = ?, updated_at = ? WHERE id = ?`,
        [newStatus, confirmedHomeScore, confirmedAwayScore, winnerClubId, confirmedAt, now, fixtureId]
      );
    } catch (sqliteErr) {
      console.warn('[SQLITE_SYNC] Non-blocking SQLite sync error on result submit:', sqliteErr);
    }

    if (newStatus === 'CONFIRMED' && winnerClubId) {
      try {
        const { advanceKnockoutWinnerFirestore } = await import('../tournament/knockoutEngine');
        await advanceKnockoutWinnerFirestore(fixtureId);
      } catch (err) {
        console.warn('[KNOCKOUT_ADVANCE] Non-blocking advance error:', err);
      }
    }

    if (newStatus === 'CONFIRMED' && consensus.fixture.competitionId) {
      try {
        await rebuildCompetitionStandingsFirestore(consensus.fixture.competitionId);
      } catch (standingsErr) {
        console.warn('[STANDINGS_UPDATE] Non-blocking standings update error on confirmation:', standingsErr);
      }
    }

    invalidateFirestoreCache('firestore:fixtures');
    invalidateFirestoreCache('firestore:comp');

    return (await getFixtureByIdFirestore(fixtureId, userId))!;
  } catch (firestoreErr: any) {
    const errMsg = firestoreErr?.message || String(firestoreErr);
    console.error(`[RESULT_SUBMISSION] Firestore operation failed: ${errMsg}`);

    // If error is user-validation error, rethrow directly
    if (
      errMsg.includes('not found') ||
      errMsg.includes('already CONFIRMED') ||
      errMsg.includes('MATCHDAY_LOCKED') ||
      errMsg.includes('locked') ||
      errMsg.includes('paused') ||
      errMsg.includes('do not own') ||
      errMsg.includes('undetermined participants') ||
      errMsg.includes('Scores must be')
    ) {
      throw firestoreErr;
    }

    // For quota, network, or server-level Firestore failure: execute resilient SQLite fallback
    firestoreCircuitBreaker.recordFailure(firestoreErr);
    recordFallbackUsage();
    return await executeFallbackSubmit();
  }
}

export interface DomesticFixtureValidation {
  leagueId: string;
  competitionId: string;
  name: string;
  clubCount: number;
  expectedMatchdays: number;
  actualMatchdays: number;
  expectedFixtureCount: number;
  actualFixtureCount: number;
  duplicatePairCount: number;
  reverseFixtureCount: number;
  invalidMatchdays: number;
  confirmedResultsCount: number;
  pendingResultsCount: number;
  isValid: boolean;
  issues: string[];
}

export interface FixtureValidationReport {
  timestamp: string;
  allValid: boolean;
  leagues: DomesticFixtureValidation[];
  summary: {
    totalClubs: number;
    expectedTotalFixtures: number;
    actualTotalFixtures: number;
    totalConfirmed: number;
    totalPending: number;
  };
}

export async function validateDomesticFixturesFirestore(seasonId = 'season-2026-27'): Promise<FixtureValidationReport> {
  const domesticComps = [
    { competitionId: 'comp-premier-league-2026', leagueId: 'league-premier-league', name: 'Premier League', expectedTeams: 20, expectedMDs: 19, expectedFixtures: 190 },
    { competitionId: 'comp-la-liga-2026', leagueId: 'league-la-liga', name: 'La Liga', expectedTeams: 20, expectedMDs: 19, expectedFixtures: 190 },
    { competitionId: 'comp-serie-a-2026', leagueId: 'league-serie-a', name: 'Serie A', expectedTeams: 20, expectedMDs: 19, expectedFixtures: 190 },
    { competitionId: 'comp-bundesliga-2026', leagueId: 'league-bundesliga', name: 'Bundesliga', expectedTeams: 18, expectedMDs: 17, expectedFixtures: 153 },
    { competitionId: 'comp-ligue-1-2026', leagueId: 'league-ligue-1', name: 'Ligue 1', expectedTeams: 18, expectedMDs: 17, expectedFixtures: 153 },
  ];

  const results: DomesticFixtureValidation[] = [];
  let allValid = true;
  let totalConfirmed = 0;
  let totalPending = 0;
  let actualTotalFixtures = 0;
  let expectedTotalFixtures = 0;
  let totalClubs = 0;

  for (const item of domesticComps) {
    const clubCount = SEED_CLUBS.filter((c) => c.leagueId === item.leagueId).length || item.expectedTeams;
    totalClubs += clubCount;
    expectedTotalFixtures += item.expectedFixtures;

    const fixtures = await getFixturesFirestore({ competitionId: item.competitionId, seasonId });
    actualTotalFixtures += fixtures.length;

    const matchdaySet = new Set<number>();
    const directedPairs = new Set<string>();
    const undirectedPairs = new Set<string>();
    let duplicatePairCount = 0;
    let reverseFixtureCount = 0;
    let invalidMatchdays = 0;
    let confirmedCount = 0;
    let pendingCount = 0;
    const issues: string[] = [];

    for (const f of fixtures) {
      if (f.matchday < 1 || f.matchday > item.expectedMDs) {
        invalidMatchdays++;
      }
      matchdaySet.add(f.matchday);

      const directedKey = `${f.homeClubId}->${f.awayClubId}`;
      const undirectedKey = [f.homeClubId, f.awayClubId].sort().join(' <-> ');

      if (directedPairs.has(directedKey)) {
        duplicatePairCount++;
      } else {
        directedPairs.add(directedKey);
      }

      if (undirectedPairs.has(undirectedKey)) {
        reverseFixtureCount++;
      } else {
        undirectedPairs.add(undirectedKey);
      }

      if (f.status === 'CONFIRMED') confirmedCount++;
      else if (f.status === 'PENDING_CONFIRMATION' || f.status === 'AWAITING_RESULT') pendingCount++;
    }

    totalConfirmed += confirmedCount;
    totalPending += pendingCount;

    if (fixtures.length !== item.expectedFixtures) {
      issues.push(`Expected ${item.expectedFixtures} fixtures, found ${fixtures.length}.`);
    }
    if (matchdaySet.size !== item.expectedMDs && fixtures.length > 0) {
      issues.push(`Expected ${item.expectedMDs} matchdays, found ${matchdaySet.size}.`);
    }
    if (duplicatePairCount > 0) {
      issues.push(`Found ${duplicatePairCount} duplicate fixture pairs.`);
    }
    if (reverseFixtureCount > 0) {
      issues.push(`Found ${reverseFixtureCount} reverse fixture pairs (double round-robin).`);
    }
    if (invalidMatchdays > 0) {
      issues.push(`Found ${invalidMatchdays} fixtures with invalid matchdays (outside 1..${item.expectedMDs}).`);
    }

    const isValid = issues.length === 0 && fixtures.length === item.expectedFixtures;
    if (!isValid) allValid = false;

    results.push({
      leagueId: item.leagueId,
      competitionId: item.competitionId,
      name: item.name,
      clubCount,
      expectedMatchdays: item.expectedMDs,
      actualMatchdays: matchdaySet.size,
      expectedFixtureCount: item.expectedFixtures,
      actualFixtureCount: fixtures.length,
      duplicatePairCount,
      reverseFixtureCount,
      invalidMatchdays,
      confirmedResultsCount: confirmedCount,
      pendingResultsCount: pendingCount,
      isValid,
      issues,
    });
  }

  return {
    timestamp: new Date().toISOString(),
    allValid,
    leagues: results,
    summary: {
      totalClubs,
      expectedTotalFixtures,
      actualTotalFixtures,
      totalConfirmed,
      totalPending,
    },
  };
}

// ----------------------------------------------------
// USERS & TELEGRAM AUTH (FIRESTORE)
// ----------------------------------------------------

export function getCanonicalTelegramUserId(telegramId: string | number): string {
  const raw = String(telegramId).trim();
  const cleanId = raw.startsWith('user-') ? raw.slice(5) : raw;
  return `user-${cleanId}`;
}

export async function verifyUserClubConsistency(
  userId: string,
  seasonId = 'season-2026-27'
): Promise<{
  isConsistent: boolean;
  userMembershipClubId: string | null;
  clubOccupancyUserId: string | null;
  error?: string;
}> {
  const db = getFirestoreDb();
  const userMemRef = db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userId}`);
  const userMemDoc = await userMemRef.get();

  let userMembershipClubId: string | null = null;
  if (userMemDoc.exists && userMemDoc.data()?.status === 'active') {
    userMembershipClubId = userMemDoc.data()!.clubId;
  }

  if (!userMembershipClubId) {
    return {
      isConsistent: true,
      userMembershipClubId: null,
      clubOccupancyUserId: null,
    };
  }

  const clubOccRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${userMembershipClubId}`);
  const clubOccDoc = await clubOccRef.get();

  let clubOccupancyUserId: string | null = null;
  if (clubOccDoc.exists && clubOccDoc.data()?.status === 'active') {
    clubOccupancyUserId = clubOccDoc.data()!.userId;
  }

  if (clubOccupancyUserId !== userId) {
    const error = `DATA_INTEGRITY_MISMATCH: user_memberships/${seasonId}_${userId} claims club '${userMembershipClubId}', but club_occupancies/${seasonId}_${userMembershipClubId} has userId '${clubOccupancyUserId}'.`;
    console.warn(`[INTEGRITY] ${error}`);
    return {
      isConsistent: false,
      userMembershipClubId,
      clubOccupancyUserId,
      error,
    };
  }

  return {
    isConsistent: true,
    userMembershipClubId,
    clubOccupancyUserId,
  };
}

export async function getOrCreateTelegramUserFirestore(tgUser: {
  id: number | string;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}): Promise<User> {
  const rawId = String(tgUser.id).trim();
  const telegramId = rawId.startsWith('user-') ? rawId.slice(5) : rawId;
  const docId = getCanonicalTelegramUserId(telegramId);
  const username = tgUser.username || `tg_${telegramId}`;
  const firstName = tgUser.first_name || 'Player';
  const lastName = tgUser.last_name || '';
  const photoUrl = tgUser.photo_url || '';

  const adminIds = (process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map((s) => s.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);

  const isAdmin = adminIds.includes(telegramId.toLowerCase()) || adminIds.includes(username.toLowerCase());
  const now = new Date().toISOString();

  try {
    const db = getFirestoreDb();
    const userDocRef = db.collection(COLLECTIONS.USERS).doc(docId);
    const userDoc = await userDocRef.get();
    trackFirestoreRead(COLLECTIONS.USERS, 1, 'getOrCreateTelegramUserFirestore');

    if (!userDoc.exists) {
      const newUser: FirestoreUserDoc = {
        id: docId,
        telegramId,
        username,
        firstName,
        lastName,
        photoUrl,
        isAdmin,
        isSuspended: false,
        createdAt: now,
        updatedAt: now,
      };
      await userDocRef.set(newUser);
      trackFirestoreWrite(COLLECTIONS.USERS, 1, 'getOrCreateTelegramUserFirestore:create');
      
      const createdUser: User = {
        id: docId,
        telegramId,
        username,
        firstName,
        lastName,
        photoUrl,
        isAdmin,
        isSuspended: false,
        createdAt: now,
        updatedAt: now,
      };
      setInCache(`firestore:user:${docId}`, createdUser, 300000);
      return createdUser;
    } else {
      const existing = userDoc.data() as FirestoreUserDoc;
      const updatedAdmin = Boolean(existing.isAdmin || isAdmin);
      const changed =
        existing.username !== username ||
        existing.firstName !== firstName ||
        (lastName && (existing.lastName || '') !== lastName) ||
        (photoUrl && (existing.photoUrl || '') !== photoUrl) ||
        Boolean(existing.isAdmin) !== updatedAdmin;

      if (changed) {
        await userDocRef.update({
          username,
          firstName,
          lastName: lastName || existing.lastName || '',
          photoUrl: photoUrl || existing.photoUrl || '',
          isAdmin: updatedAdmin,
          updatedAt: now,
        });
        trackFirestoreWrite(COLLECTIONS.USERS, 1, 'getOrCreateTelegramUserFirestore:update');
      }

      const returnedUser: User = {
        id: existing.id || docId,
        telegramId: existing.telegramId || telegramId,
        username: changed ? username : (existing.username || username),
        firstName: changed ? firstName : (existing.firstName || firstName),
        lastName: changed ? (lastName || existing.lastName || '') : (existing.lastName || ''),
        photoUrl: changed ? (photoUrl || existing.photoUrl || '') : (existing.photoUrl || ''),
        isAdmin: updatedAdmin,
        isSuspended: Boolean(existing.isSuspended),
        createdAt: existing.createdAt || now,
        updatedAt: changed ? now : (existing.updatedAt || now),
      };
      setInCache(`firestore:user:${docId}`, returnedUser, 300000);
      return returnedUser;
    }
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getOrCreateTelegramUserFirestore:', err.message);
  }

  // SQLite fallback
  const existingUser = queryGet<any>('SELECT * FROM users WHERE id = ?', [docId]);
  if (!existingUser) {
    queryRun(
      `INSERT INTO users (id, telegram_id, username, first_name, last_name, photo_url, is_admin, is_suspended, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [docId, telegramId, username, firstName, lastName, photoUrl, isAdmin ? 1 : 0, now, now]
    );
  } else {
    queryRun(
      `UPDATE users SET username = ?, first_name = ?, last_name = ?, photo_url = ?, is_admin = ?, updated_at = ? WHERE id = ?`,
      [username, firstName, lastName, photoUrl || existingUser.photo_url || '', (existingUser.is_admin || isAdmin) ? 1 : 0, now, docId]
    );
  }

  return {
    id: docId,
    telegramId,
    username,
    firstName,
    lastName,
    photoUrl,
    isAdmin,
    isSuspended: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** Privileged authorization never uses profile cache or SQLite fallback.
 * One document read, no collection scan. Fail closed on missing/unavailable state.
 */
export async function getAuthoritativeUserForAuthorization(userId: string): Promise<User | null> {
  trackFirestoreRead(COLLECTIONS.USERS, 1, 'adminAuthorization');
  const doc = await getFirestoreDb().collection(COLLECTIONS.USERS).doc(userId).get();
  if (!doc.exists) return null;
  const data = doc.data() as FirestoreUserDoc;
  return { id: doc.id, telegramId: data.telegramId || '', username: data.username || '',
    firstName: data.firstName || '', lastName: data.lastName || '', photoUrl: data.photoUrl || '',
    isAdmin: data.isAdmin === true, isSuspended: data.isSuspended === true,
    createdAt: data.createdAt || '', updatedAt: data.updatedAt || '' };
}

export async function getUserByIdFirestore(userId: string): Promise<User | null> {
  const cacheKey = `firestore:user:${userId}`;
  const cached = getFromCache<User>(cacheKey);
  if (cached) return cached;

  try {
    const db = getFirestoreDb();
    trackFirestoreRead(COLLECTIONS.USERS, 1, 'getUserByIdFirestore');
    const doc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (doc.exists) {
      const data = doc.data() as FirestoreUserDoc;
      const user: User = {
        id: doc.id,
        telegramId: data.telegramId || '',
        username: data.username || '',
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        photoUrl: data.photoUrl || '',
        isAdmin: Boolean(data.isAdmin),
        isSuspended: Boolean(data.isSuspended),
        createdAt: data.createdAt || '',
        updatedAt: data.updatedAt || '',
      };
      setInCache(cacheKey, user, 300000); // 5 min cache for user profiles
      return user;
    }
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getUserByIdFirestore:', err.message);
  }

  // SQLite fallback
  const row = queryGet<any>('SELECT * FROM users WHERE id = ?', [userId]);
  if (!row) return null;
  const user: User = {
    id: row.id,
    telegramId: row.telegram_id || '',
    username: row.username || '',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    photoUrl: row.photo_url || '',
    isAdmin: Boolean(row.is_admin),
    isSuspended: Boolean(row.is_suspended),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
  setInCache(cacheKey, user, 300000);
  return user;
}

export async function getOrCreateDevUserFirestore(devUserId: string): Promise<User> {
  const now = new Date().toISOString();
  const isAdmin = devUserId.includes('admin');

  try {
    const db = getFirestoreDb();
    const docRef = db.collection(COLLECTIONS.USERS).doc(devUserId);
    const doc = await docRef.get();

    if (doc.exists) {
      return doc.data() as User;
    }

    const newUser: FirestoreUserDoc = {
      id: devUserId,
      telegramId: devUserId.replace(/\D/g, '') || '999',
      username: devUserId.replace('user-', ''),
      firstName: devUserId.includes('admin') ? 'Admin' : 'Dev User',
      lastName: 'Tester',
      photoUrl: '',
      isAdmin,
      isSuspended: false,
      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(newUser);
    return newUser;
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getOrCreateDevUserFirestore:', err.message);
    const existing = queryGet<any>('SELECT * FROM users WHERE id = ?', [devUserId]);
    if (existing) {
      return {
        id: existing.id,
        telegramId: existing.telegram_id,
        username: existing.username,
        firstName: existing.first_name,
        lastName: existing.last_name,
        photoUrl: existing.photo_url || '',
        isAdmin: Boolean(existing.is_admin),
        isSuspended: Boolean(existing.is_suspended),
        createdAt: existing.created_at,
        updatedAt: existing.updated_at,
      };
    }
    const newUser = {
      id: devUserId,
      telegramId: devUserId.replace(/\D/g, '') || '999',
      username: devUserId.replace('user-', ''),
      firstName: devUserId.includes('admin') ? 'Admin' : 'Dev User',
      lastName: 'Tester',
      photoUrl: '',
      isAdmin,
      isSuspended: false,
      createdAt: now,
      updatedAt: now,
    };
    queryRun(
      `INSERT OR REPLACE INTO users (id, telegram_id, username, first_name, last_name, photo_url, is_admin, is_suspended, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [newUser.id, newUser.telegramId, newUser.username, newUser.firstName, newUser.lastName, newUser.photoUrl, isAdmin ? 1 : 0, now, now]
    );
    return newUser;
  }
}

// ----------------------------------------------------
// ADMIN & DISPUTES (FIRESTORE)
// ----------------------------------------------------

export async function reopenFixtureFirestore(
  adminUserId: string,
  fixtureId: string,
  notes?: string,
  options?: { authoritativeOnly?: boolean }
): Promise<{ success: boolean; fixtureId: string; authoritative?: boolean; isFallback?: boolean; pendingSync?: boolean }> {
  assertNoSyntheticIdsInProduction('reopenFixtureFirestore', [adminUserId, fixtureId]);
  const now = new Date().toISOString();

  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
      const fixDoc = await fixRef.get();
      if (!fixDoc.exists) {
        throw new Error(`Fixture '${fixtureId}' not found.`);
      }

      // Reset fixture to SCHEDULED
      await fixRef.update({
        status: 'SCHEDULED',
        homeScore: null,
        awayScore: null,
        winnerClubId: null,
        resultConfirmedAt: null,
        updatedAt: now,
      });

      // Delete all result submissions for this fixture
      const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', '==', fixtureId).get();
      const deleteBatch = db.batch();
      for (const doc of subsSnap.docs) {
        deleteBatch.delete(doc.ref);
      }

      // Resolve or delete disputes
      const dispSnap = await db.collection(COLLECTIONS.DISPUTES).where('fixtureId', '==', fixtureId).get();
      for (const doc of dispSnap.docs) {
        deleteBatch.delete(doc.ref);
      }

      await deleteBatch.commit();

      // Rebuild standings if fixture belonged to a competition
      if (fixDoc.data()?.competitionId) {
        try {
          await rebuildCompetitionStandingsFirestore(fixDoc.data()!.competitionId);
        } catch (standingsErr) {
          console.warn('[STANDINGS_UPDATE] Non-blocking standings update error on reopen:', standingsErr);
        }
      }

      // Audit log (deterministic ID prevents duplicate on replay)
      const auditId = `audit_reopen_${fixtureId}`;
      await db.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId).set({
        id: auditId,
        actorUserId: adminUserId,
        action: 'REOPEN_FIXTURE',
        entityType: 'fixture',
        entityId: fixtureId,
        notes: notes || null,
        createdAt: now,
      }, { merge: true });

      invalidateFirestoreCache();
      return { success: true, fixtureId, authoritative: true, isFallback: false };
    } catch (err: any) {
      if (options?.authoritativeOnly) {
        throw err;
      }
      firestoreCircuitBreaker.recordFailure(err);
      recordFallbackUsage();
      console.warn('[FIRESTORE FALLBACK] reopenFixtureFirestore:', err.message);
    }
  } else {
    if (options?.authoritativeOnly) {
      throw new Error('CIRCUIT_OPEN: Firestore circuit breaker is OPEN. Authoritative write cannot execute.');
    }
    recordFallbackUsage();
  }

  // Durable Redis Outbox & SQLite Fallback
  const localFix = queryGet<any>('SELECT * FROM fixtures WHERE id = ?', [fixtureId]);
  const mutationId = `admin_reject_${fixtureId}`;

  // 1. MUST persist to durable Redis outbox FIRST
  await enqueueDurableOutboxMutation({
    mutationId,
    entityType: 'ADMIN_DECISION',
    entityId: fixtureId,
    operation: 'ADMIN_REJECT_RESULT',
    adminUserId,
    userId: adminUserId,
    seasonId: localFix?.season_id || 'season-2026-27',
    competitionId: localFix?.competition_id,
    payload: {
      adminUserId,
      fixtureId,
      notes: notes || 'Rejected by tournament administrator (offline queued)',
      seasonId: localFix?.season_id || 'season-2026-27',
      competitionId: localFix?.competition_id,
    },
    createdAt: now,
  });

  // 2. Only after Redis persistence succeeds, update local SQLite
  queryRun(
    `UPDATE fixtures 
     SET status = 'SCHEDULED', home_score = NULL, away_score = NULL, winner_club_id = NULL, result_confirmed_at = NULL, updated_at = ? 
     WHERE id = ?`,
    [now, fixtureId]
  );
  queryRun('DELETE FROM result_submissions WHERE fixture_id = ?', [fixtureId]);
  queryRun('DELETE FROM disputes WHERE fixture_id = ?', [fixtureId]);

  return { success: true, fixtureId, pendingSync: true, authoritative: false, isFallback: true };
}

export async function resolveDisputeFirestore(
  adminUserId: string,
  disputeId: string,
  params: {
    action: 'CONFIRM_HOME_SUBMISSION' | 'CONFIRM_AWAY_SUBMISSION' | 'MANUAL_SCORE' | 'CANCEL_MATCH';
    manualHomeScore?: number;
    manualAwayScore?: number;
    notes?: string;
  }
): Promise<{ success: boolean; dispute: any }> {
  const db = getFirestoreDb();
  const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(disputeId);
  const disputeDoc = await disputeRef.get();
  if (!disputeDoc.exists) {
    throw new Error(`Dispute '${disputeId}' not found.`);
  }

  const dispData = disputeDoc.data() as FirestoreDisputeDoc;
  const fixtureRef = db.collection(COLLECTIONS.FIXTURES).doc(dispData.fixtureId);
  const fixtureDoc = await fixtureRef.get();
  if (!fixtureDoc.exists) {
    throw new Error(`Fixture '${dispData.fixtureId}' not found.`);
  }

  const fixture = fixtureDoc.data() as FirestoreFixtureDoc;
  const now = new Date().toISOString();

  let newHomeScore: number | null = null;
  let newAwayScore: number | null = null;
  let winnerClubId: string | null = null;
  let newStatus = 'CONFIRMED';

  if (params.action === 'MANUAL_SCORE') {
    newHomeScore = params.manualHomeScore ?? 0;
    newAwayScore = params.manualAwayScore ?? 0;
    if (newHomeScore > newAwayScore) winnerClubId = fixture.homeClubId;
    else if (newAwayScore > newHomeScore) winnerClubId = fixture.awayClubId;
  } else if (params.action === 'CANCEL_MATCH') {
    newStatus = 'POSTPONED';
  }

  await fixtureRef.update({
    status: newStatus,
    homeScore: newHomeScore,
    awayScore: newAwayScore,
    winnerClubId,
    resultConfirmedAt: now,
    updatedAt: now,
  });

  if (newStatus === 'CONFIRMED' && winnerClubId) {
    try {
      const { advanceKnockoutWinnerFirestore } = await import('../tournament/knockoutEngine');
      await advanceKnockoutWinnerFirestore(dispData.fixtureId);
    } catch (err) {
      console.warn('[KNOCKOUT_ADVANCE] Non-blocking advance error on dispute resolution:', err);
    }
  }

  if (fixture.competitionId) {
    try {
      await rebuildCompetitionStandingsFirestore(fixture.competitionId);
    } catch (standingsErr) {
      console.warn('[STANDINGS_UPDATE] Non-blocking standings update error on dispute resolution:', standingsErr);
    }
  }

  const updatedDispute = {
    ...dispData,
    status: 'RESOLVED',
    resolvedByUserId: adminUserId,
    resolutionNotes: params.notes || null,
    resolvedAt: now,
  };

  await disputeRef.update(updatedDispute);

  const auditId = `audit_resolve_dispute_${disputeId}`;
  await db.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId).set({
    id: auditId,
    actorUserId: adminUserId,
    action: 'RESOLVE_DISPUTE',
    entityType: 'dispute',
    entityId: disputeId,
    notes: params.notes || null,
    createdAt: now,
  }, { merge: true });

  return { success: true, dispute: updatedDispute };
}

export function getLocalDisputes(status = 'OPEN', limitCount = 50): Dispute[] {
  try {
    let sql = 'SELECT * FROM disputes';
    const params: any[] = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limitCount);
    const rows = queryAll<any>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      fixtureId: r.fixture_id,
      seasonId: r.season_id,
      status: r.status as any,
      resolvedByUserId: r.resolved_by_user_id || undefined,
      resolutionNotes: r.resolution_notes || undefined,
      resolvedAt: r.resolved_at || undefined,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

export async function getDisputesFirestore(status = 'OPEN', limitCount = 50): Promise<Dispute[]> {
  const cacheKey = `firestore:disputes:${status}:${limitCount}`;
  const cached = getFromCache<Dispute[]>(cacheKey);
  if (cached) return cached;

  if (!firestoreCircuitBreaker.canExecute()) {
    recordFallbackUsage();
    return getLocalDisputes(status, limitCount);
  }

  try {
    const db = getFirestoreDb();
    let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.DISPUTES);
    if (status) {
      query = query.where('status', '==', status);
    }
    if (limitCount > 0) {
      query = query.limit(limitCount);
    }
    const snap = await query.get();
    trackFirestoreRead(
      COLLECTIONS.DISPUTES,
      snap.empty ? 1 : snap.docs.length,
      'getDisputesFirestore'
    );
    firestoreCircuitBreaker.recordSuccess();

    const disputes: Dispute[] = [];
    const fixtureIds = Array.from(new Set(snap.docs.map((d) => (d.data() as FirestoreDisputeDoc).fixtureId).filter(Boolean)));
    const fixturesMap = new Map<string, Fixture>();

    // BATCH fetch referenced fixtures in chunks of 30 instead of N+1 individual queries
    for (let i = 0; i < fixtureIds.length; i += 30) {
      const chunk = fixtureIds.slice(i, i + 30);
      try {
        const fSnap = await db.collection(COLLECTIONS.FIXTURES).where(FirebaseFirestore.FieldPath.documentId(), 'in', chunk).get();
        trackFirestoreRead(COLLECTIONS.FIXTURES, fSnap.empty ? 1 : fSnap.docs.length, 'getDisputesFirestore:fixturesBatch');
        for (const doc of fSnap.docs) {
          const fData = doc.data() as FirestoreFixtureDoc;
          const homeClubSeed = SEED_CLUB_MAP.get(fData.homeClubId);
          const awayClubSeed = SEED_CLUB_MAP.get(fData.awayClubId);

          const homeClub: Club = {
            id: fData.homeClubId,
            name: homeClubSeed?.name || fData.homeClubId,
            shortName: homeClubSeed?.shortName || fData.homeClubId.substring(0, 3).toUpperCase(),
            country: homeClubSeed?.country || 'England',
            leagueId: homeClubSeed?.leagueId || 'league-premier-league',
            logoUrl: homeClubSeed?.logoUrl || '',
            active: true,
            createdAt: new Date().toISOString(),
          };

          const awayClub: Club = {
            id: fData.awayClubId,
            name: awayClubSeed?.name || fData.awayClubId,
            shortName: awayClubSeed?.shortName || fData.awayClubId.substring(0, 3).toUpperCase(),
            country: awayClubSeed?.country || 'England',
            leagueId: awayClubSeed?.leagueId || 'league-premier-league',
            logoUrl: awayClubSeed?.logoUrl || '',
            active: true,
            createdAt: new Date().toISOString(),
          };

          fixturesMap.set(doc.id, {
            id: doc.id,
            competitionId: fData.competitionId,
            seasonId: fData.seasonId,
            matchday: fData.matchday,
            homeClubId: fData.homeClubId,
            awayClubId: fData.awayClubId,
            homeScore: fData.homeScore,
            awayScore: fData.awayScore,
            status: fData.status as MatchStatus,
            scheduledAt: fData.scheduledAt,
            homeClub,
            awayClub,
            createdAt: fData.createdAt || new Date().toISOString(),
            updatedAt: fData.updatedAt || new Date().toISOString(),
          });
        }
      } catch (err: any) {
        console.warn('Batch fixture fetch error in getDisputesFirestore:', err.message);
      }
    }

    for (const doc of snap.docs) {
      const data = doc.data() as FirestoreDisputeDoc;
      const fixture = fixturesMap.get(data.fixtureId);
      let mappedStatus: 'OPEN' | 'RESOLVED' | 'DISMISSED' = 'OPEN';
      if (data.status === 'RESOLVED') mappedStatus = 'RESOLVED';
      else if (data.status === 'CANCELLED') mappedStatus = 'DISMISSED';

      disputes.push({
        id: doc.id,
        fixtureId: data.fixtureId,
        seasonId: data.seasonId,
        status: mappedStatus,
        resolvedByUserId: data.resolvedByUserId,
        resolutionNotes: data.resolutionNotes,
        resolvedAt: data.resolvedAt,
        createdAt: data.createdAt,
        fixture: fixture || undefined,
      });
    }

    setInCache(cacheKey, disputes, 30000); // 30s cache
    return disputes;
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    return getLocalDisputes(status, limitCount);
  }
}

export interface AdminUsersQueryOptions {
  limit?: number;
  cursor?: string;
  page?: number;
  role?: 'ADMIN' | 'PLAYER' | 'ALL' | string;
  status?: 'ACTIVE' | 'SUSPENDED' | 'ALL' | string;
  search?: string;
}

export interface AdminUsersPageResult {
  users: User[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  nextCursor?: string;
  source: string;
  degraded: boolean;
  stale: boolean;
}

export async function getAdminUsersPagedFirestore(options: AdminUsersQueryOptions = {}): Promise<AdminUsersPageResult> {
  const pageSize = Math.min(Math.max(options.limit || 25, 1), 50);
  const page = Math.max(options.page || 1, 1);
  const role = (options.role || 'ALL').toUpperCase();
  const status = (options.status || 'ALL').toUpperCase();
  const search = (options.search || '').trim();

  // PRIORITY 1: SQLite local read model / cache
  try {
    const conditions: string[] = ['1=1'];
    const params: any[] = [];
    if (role === 'ADMIN') {
      conditions.push('u.is_admin = 1');
    } else if (role === 'PLAYER') {
      conditions.push('(u.is_admin = 0 OR u.is_admin IS NULL)');
    }
    if (status === 'SUSPENDED') {
      conditions.push('u.is_suspended = 1');
    } else if (status === 'ACTIVE') {
      conditions.push('(u.is_suspended = 0 OR u.is_suspended IS NULL)');
    }
    if (search) {
      conditions.push('(u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.telegram_id LIKE ? OR u.id LIKE ?)');
      const sParam = `%${search}%`;
      params.push(sParam, sParam, sParam, sParam, sParam);
    }
    const whereClause = conditions.join(' AND ');
    const countRow = queryGet<{ count: number }>(`SELECT COUNT(*) as count FROM users u WHERE ${whereClause}`, params);
    const total = countRow?.count ?? 0;

    if (total > 0 || search || role !== 'ALL' || status !== 'ALL') {
      const offset = (page - 1) * pageSize;
      const rows = queryAll<any>(
        `SELECT * FROM users u WHERE ${whereClause} ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?`,
        [...params, pageSize + 1, offset]
      );
      const hasMore = rows.length > pageSize;
      const pageRows = rows.slice(0, pageSize);
      const nextCursor = hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : undefined;
      const users: User[] = pageRows.map((r) => ({
        id: r.id,
        telegramId: r.telegram_id,
        username: r.username,
        firstName: r.first_name,
        lastName: r.last_name,
        photoUrl: r.photo_url,
        isAdmin: Boolean(r.is_admin),
        isSuspended: Boolean(r.is_suspended),
        createdAt: r.created_at || new Date().toISOString(),
        updatedAt: r.updated_at || new Date().toISOString(),
      }));
      return {
        users,
        total,
        page,
        limit: pageSize,
        hasMore,
        nextCursor,
        source: 'sqlite',
        degraded: false,
        stale: false,
      };
    }
  } catch {}

  // PRIORITY 2: Bounded Firestore pagination (reads <= 25 docs, max 50)
  const db = getFirestoreDb();
  if (db && firestoreCircuitBreaker.canExecute()) {
    try {
      let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.USERS);
      if (role === 'ADMIN') {
        query = query.where('isAdmin', '==', true);
      } else if (role === 'PLAYER') {
        query = query.where('isAdmin', '==', false);
      }
      if (status === 'SUSPENDED') {
        query = query.where('isSuspended', '==', true);
      } else if (status === 'ACTIVE') {
        query = query.where('isSuspended', '==', false);
      }
      query = query.orderBy('createdAt', 'desc');

      if (options.cursor) {
        const cursorDoc = await db.collection(COLLECTIONS.USERS).doc(options.cursor).get();
        trackFirestoreRead(COLLECTIONS.USERS, 1, 'getAdminUsersPagedFirestore:cursor');
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      query = query.limit(pageSize + 1);
      const snap = await query.get();
      trackFirestoreRead(COLLECTIONS.USERS, snap.docs.length, 'getAdminUsersPagedFirestore');

      const docs = snap.docs;
      const hasMore = docs.length > pageSize;
      const pageDocs = docs.slice(0, pageSize);
      const nextCursor = hasMore && pageDocs.length > 0 ? pageDocs[pageDocs.length - 1].id : undefined;

      const users: User[] = pageDocs.map((d) => {
        const data = d.data() as FirestoreUserDoc;
        return {
          id: d.id,
          telegramId: data.telegramId,
          username: data.username,
          firstName: data.firstName,
          lastName: data.lastName,
          photoUrl: data.photoUrl,
          isAdmin: Boolean(data.isAdmin),
          isSuspended: Boolean(data.isSuspended),
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      });

      return {
        users,
        total: users.length,
        page,
        limit: pageSize,
        hasMore,
        nextCursor,
        source: 'firestore_paged',
        degraded: false,
        stale: false,
      };
    } catch (err: any) {
      firestoreCircuitBreaker.recordFailure(err);
    }
  }

  return {
    users: [],
    total: 0,
    page,
    limit: pageSize,
    hasMore: false,
    source: 'empty_fallback',
    degraded: true,
    stale: true,
  };
}

export async function getAllUsersFirestore(): Promise<User[]> {
  const paged = await getAdminUsersPagedFirestore({ limit: 50, page: 1 });
  return paged.users;
}

export async function getAuditLogsFirestore(limit = 50): Promise<AuditLog[]> {
  const cacheKey = `firestore:audit_logs:${limit}`;
  const cached = getFromCache<AuditLog[]>(cacheKey);
  if (cached) return cached;

  const db = getFirestoreDb();
  const snap = await db
    .collection(COLLECTIONS.AUDIT_LOGS)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  trackFirestoreRead(
    COLLECTIONS.AUDIT_LOGS,
    snap.empty ? 1 : snap.docs.length,
    'getAuditLogsFirestore'
  );

  const logs = snap.docs.map((d) => {
    const data = d.data() as FirestoreAuditLogDoc;
    let parsedOld: any = undefined;
    let parsedNew: any = undefined;
    try {
      if (data.oldValueJson) parsedOld = JSON.parse(data.oldValueJson);
    } catch {
      parsedOld = data.oldValueJson;
    }
    try {
      if (data.newValueJson) parsedNew = JSON.parse(data.newValueJson);
    } catch {
      parsedNew = data.newValueJson;
    }

    return {
      id: d.id,
      actorUserId: data.actorUserId,
      actorUsername: data.actorUsername,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      oldValue: parsedOld,
      newValue: parsedNew,
      ipAddress: data.ipAddress || undefined,
      notes: (data as any).notes || undefined,
      createdAt: data.createdAt,
    };
  });

  setInCache(cacheKey, logs, 20000); // 20s cache
  return logs;
}

export async function createAuditLogFirestore(
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  oldValue?: any,
  newValue?: any,
  ipAddress?: string,
  actorUsername?: string,
  notes?: string,
  customAuditId?: string
): Promise<void> {
  const db = getFirestoreDb();
  const now = new Date().toISOString();
  const auditId = customAuditId || `audit_${action}_${entityType}_${entityId}`;
  try {
    await db.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId).set({
      id: auditId,
      actorUserId,
      actorUsername: actorUsername || null,
      action,
      entityType,
      entityId,
      oldValueJson: oldValue ? JSON.stringify(oldValue) : null,
      newValueJson: newValue ? JSON.stringify(newValue) : null,
      ipAddress: ipAddress || null,
      notes: notes || null,
      createdAt: now,
    }, { merge: true });
    trackFirestoreWrite(COLLECTIONS.AUDIT_LOGS, 1, 'createAuditLogFirestore');
  } catch (err: any) {
    console.warn('[FIRESTORE AUDIT LOG WARN]:', err.message);
  }

  // Also log to SQLite for local consistency
  try {
    queryRun(
      `INSERT OR REPLACE INTO audit_logs (id, actor_user_id, actor_username, action, entity_type, entity_id, old_value_json, new_value_json, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auditId,
        actorUserId,
        actorUsername || '',
        action,
        entityType,
        entityId,
        oldValue ? JSON.stringify(oldValue) : null,
        newValue ? JSON.stringify(newValue) : null,
        ipAddress || null,
        now,
      ]
    );
  } catch {
    // ignore
  }
}

export async function createNotificationFirestore(
  userId: string,
  type: string,
  title: string,
  message: string,
  data?: Record<string, unknown>,
  customNotificationId?: string
): Promise<void> {
  const now = new Date().toISOString();
  const notifId = customNotificationId || `notif_${type}_${userId}_${String(data?.fixtureId || data?.clubId || 'gen')}`;
  try {
    const db = getFirestoreDb();
    await db.collection(COLLECTIONS.NOTIFICATIONS).doc(notifId).set({
      id: notifId,
      userId,
      type,
      title,
      message,
      data: data || null,
      isRead: false,
      createdAt: now,
    }, { merge: true });
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] createNotificationFirestore:', err.message);
    queryRun(
      `INSERT OR REPLACE INTO notifications (id, user_id, type, title, message, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [notifId, userId, type, title, message, now]
    );
  }
}

export async function getUserNotificationsFirestore(userId: string, limit = 30): Promise<Notification[]> {
  const cacheKey = `firestore:notifications:${userId}:${limit}`;
  const cached = getFromCache<Notification[]>(cacheKey);
  if (cached) return cached;

  const validTypes: Array<Notification['type']> = [
    'MATCH_SCHEDULED',
    'RESULT_SUBMITTED',
    'RESULT_CONFIRMED',
    'DISPUTE_OPENED',
    'DISPUTE_RESOLVED',
    'CLUB_ASSIGNED',
    'NEXT_ROUND_MATCH',
    'QUALIFICATION_CONFIRMED',
    'COMPETITION_UPDATE',
    'SYSTEM',
  ];

  try {
    const db = getFirestoreDb();
    const snap = await db
      .collection(COLLECTIONS.NOTIFICATIONS)
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    trackFirestoreRead(
      COLLECTIONS.NOTIFICATIONS,
      snap.empty ? 1 : snap.docs.length,
      'getUserNotificationsFirestore'
    );

    const notifications: Notification[] = snap.docs.map((d) => {
      const data = d.data() as any;
      const notifData = data.data || {};
      const notifType = validTypes.includes(data.type) ? data.type : (data.type || 'SYSTEM');
      return {
        id: d.id,
        userId: data.userId,
        type: notifType,
        title: data.title,
        message: data.message,
        fixtureId: data.fixtureId || notifData.fixtureId || undefined,
        entityType: data.entityType || notifData.entityType || undefined,
        entityId: data.entityId || notifData.entityId || undefined,
        isRead: Boolean(data.isRead),
        createdAt: data.createdAt,
      };
    });

    setInCache(cacheKey, notifications, 30000);
    return notifications;
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getUserNotificationsFirestore:', err.message);
    const rows = queryAll<any>(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit]
    );
    const fallbackNotifs: Notification[] = rows.map((r) => {
      const notifType = validTypes.includes(r.type) ? r.type : (r.type || 'SYSTEM');
      return {
        id: r.id,
        userId: r.user_id,
        type: notifType,
        title: r.title,
        message: r.message,
        fixtureId: r.fixture_id || undefined,
        isRead: Boolean(r.is_read),
        createdAt: r.created_at,
      };
    });
    setInCache(cacheKey, fallbackNotifs, 30000);
    return fallbackNotifs;
  }
}

export async function markSingleNotificationReadFirestore(userId: string, notificationId: string): Promise<void> {
  const now = new Date().toISOString();
  invalidateFirestoreCache(`firestore:notifications:${userId}`);

  // 1. Verify ownership locally if notification exists in SQLite
  const localNotif = queryGet<{ user_id: string }>('SELECT user_id FROM notifications WHERE id = ?', [notificationId]);
  if (localNotif && localNotif.user_id !== userId) {
    throw new Error(`OWNERSHIP_MISMATCH: User '${userId}' does not own notification '${notificationId}'.`);
  }

  // 2. Check and update Firestore authoritatively if accessible
  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();
      const docRef = db.collection(COLLECTIONS.NOTIFICATIONS).doc(notificationId);
      const doc = await docRef.get();
      if (doc.exists) {
        if (doc.data()?.userId !== userId) {
          throw new Error(`OWNERSHIP_MISMATCH: User '${userId}' does not own notification '${notificationId}'.`);
        }
        await docRef.update({ isRead: true, readAt: now });
        try {
          queryRun(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id = ?`, [userId, notificationId]);
        } catch {}
        firestoreCircuitBreaker.recordSuccess();
        return;
      }
    } catch (err: any) {
      if (err.message?.includes('OWNERSHIP_MISMATCH')) {
        throw err;
      }
      console.warn('[FIRESTORE FALLBACK] markSingleNotificationReadFirestore:', err.message);
      firestoreCircuitBreaker.recordFailure(err);
    }
  }

  // 3. Fallback: update local SQLite only for matching user and enqueue mutation
  try {
    queryRun(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id = ?`, [userId, notificationId]);
  } catch {}

  enqueueMutation({
    mutationId: `notif_read_${notificationId}_${userId}`,
    entityType: 'NOTIFICATION_READ',
    entityId: notificationId,
    operation: 'MARK_READ',
    payload: { userId, notificationId, readAt: now },
    createdAt: now,
  });
}

export async function markNotificationsReadFirestore(userId: string): Promise<void> {
  const now = new Date().toISOString();
  invalidateFirestoreCache(`firestore:notifications:${userId}`);

  try {
    queryRun(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [userId]);
  } catch {}

  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();
      const snap = await db
        .collection(COLLECTIONS.NOTIFICATIONS)
        .where('userId', '==', userId)
        .where('isRead', '==', false)
        .get();

      if (!snap.empty) {
        const batch = db.batch();
        snap.docs.forEach((doc) => batch.update(doc.ref, { isRead: true, readAt: now }));
        await batch.commit();
        firestoreCircuitBreaker.recordSuccess();
        return;
      }
    } catch (err: any) {
      console.warn('[FIRESTORE FALLBACK] markNotificationsReadFirestore:', err.message);
      firestoreCircuitBreaker.recordFailure(err);
    }
  }

  enqueueMutation({
    mutationId: `notif_read_all_${userId}_${Date.now()}`,
    entityType: 'NOTIFICATION_READ_ALL',
    entityId: userId,
    operation: 'MARK_ALL_READ',
    payload: { userId, readAt: now },
    createdAt: now,
  });
}

/**
 * Synchronizes canonical 2026/27 club crest URLs and league logos to Firestore.
 * Performs a safe non-destructive merge to preserve ownership, occupancies, and memberships.
 */
export async function syncFirestoreClubCrests(): Promise<{
  updatedClubs: number;
  updatedLeagues: number;
  totalClubs: number;
}> {
  try {
    const db = getFirestoreDb();
    let updatedClubs = 0;
    let updatedLeagues = 0;

    // 1. Sync Leagues in batch
    const leagueBatch = db.batch();
    for (const league of SEED_LEAGUES) {
      const ref = db.collection(COLLECTIONS.LEAGUES).doc(league.id);
      leagueBatch.set(
        ref,
        {
          id: league.id,
          name: league.name,
          country: league.country,
          tier: league.tier,
          logo: league.logoUrl,
          logoUrl: league.logoUrl,
        },
        { merge: true }
      );
      updatedLeagues++;
    }
    await leagueBatch.commit();

    // 2. Sync 96 Clubs in batches of 400 with safe merge
    const chunkSize = 400;
    for (let i = 0; i < SEED_CLUBS.length; i += chunkSize) {
      const chunk = SEED_CLUBS.slice(i, i + chunkSize);
      const batch = db.batch();
      for (const club of chunk) {
        const ref = db.collection(COLLECTIONS.CLUBS).doc(club.id);
        batch.set(
          ref,
          {
            id: club.id,
            name: club.name,
            shortName: club.shortName,
            country: club.country,
            leagueId: club.leagueId,
            logo: club.logoUrl,
            logoUrl: club.logoUrl,
            isActive: true,
          },
          { merge: true }
        );
        updatedClubs++;
      }
      await batch.commit();
    }

    // 3. Invalidate server in-memory TTL cache
    invalidateFirestoreCache();

    console.log(
      `[FIRESTORE SYNC] Synchronized ${updatedClubs} club crests and ${updatedLeagues} league logos to Firestore.`
    );
    return { updatedClubs, updatedLeagues, totalClubs: SEED_CLUBS.length };
  } catch (err: any) {
    console.error('[FIRESTORE SYNC ERROR] Failed to sync club crests to Firestore:', err.message);
    throw err;
  }
}

// ----------------------------------------------------
// ADMIN CLUB & RESULT MANAGEMENT (FIRESTORE)
// ----------------------------------------------------

export async function adminReleaseClubFirestore(
  adminUserId: string,
  clubId: string,
  seasonId = 'season-2026-27',
  options?: { authoritativeOnly?: boolean }
): Promise<{ success: boolean; message: string; club: Club; authoritative?: boolean; isFallback?: boolean }> {
  assertNoSyntheticIdsInProduction('adminReleaseClubFirestore', [adminUserId, clubId, seasonId]);
  const now = new Date().toISOString();
  try {
    const db = getFirestoreDb();
    const clubRef = db.collection(COLLECTIONS.CLUBS).doc(clubId);
    const clubOccRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`);
    
    const clubOccDoc = await clubOccRef.get();
    const previousUserId = clubOccDoc.exists ? clubOccDoc.data()?.userId : null;

    const batch = db.batch();

    // Release club occupancy
    batch.set(clubOccRef, {
      clubId,
      userId: null,
      seasonId,
      status: 'released',
      releasedByUserId: adminUserId,
      releasedAt: now,
      updatedAt: now,
    }, { merge: true });

    // Release user membership if existed
    if (previousUserId) {
      const userMemRef = db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${previousUserId}`);
      batch.set(userMemRef, {
        status: 'released',
        releasedAt: now,
        updatedAt: now,
      }, { merge: true });
    }

    // Update club record
    batch.update(clubRef, {
      isTaken: false,
      claimedByUserId: null,
      updatedAt: now,
    });

    // Record audit log
    const auditRef = db.collection(COLLECTIONS.AUDIT_LOGS).doc();
    batch.set(auditRef, {
      actorUserId: adminUserId,
      action: 'ADMIN_RELEASE_CLUB',
      entityType: 'club',
      entityId: clubId,
      notes: `Admin released ownership from previous user '${previousUserId || 'none'}'`,
      createdAt: now,
    });

    await batch.commit();

    invalidateFirestoreCache();
    const updatedClub = await getClubByIdFirestore(clubId, seasonId);
    return {
      success: true,
      message: `Club '${updatedClub?.name || clubId}' has been released and is now available.`,
      club: updatedClub!,
      authoritative: true,
      isFallback: false,
    };
  } catch (err: any) {
    if (options?.authoritativeOnly || isHostedEnvironment()) {
      throw err;
    }
    console.warn('[FIRESTORE FALLBACK] adminReleaseClubFirestore:', err.message);
  }

  // SQLite fallback sync
  try {
    queryRun(
      "UPDATE club_memberships SET status = 'released', updated_at = ? WHERE club_id = ? AND season_id = ? AND status = 'active'",
      [now, clubId, seasonId]
    );
  } catch {
    // ignore
  }

  invalidateFirestoreCache();
  const updatedClub = await getClubByIdFirestore(clubId, seasonId);
  return {
    success: true,
    message: `Club '${updatedClub?.name || clubId}' has been released and is now available.`,
    club: updatedClub!,
    authoritative: false,
    isFallback: true,
  };
}

export async function adminAssignClubFirestore(
  adminUserId: string,
  clubId: string,
  targetUserId: string,
  seasonId = 'season-2026-27',
  options?: { authoritativeOnly?: boolean }
): Promise<{ success: boolean; message: string; club: Club; authoritative?: boolean; isFallback?: boolean }> {
  assertNoSyntheticIdsInProduction('adminAssignClubFirestore', [adminUserId, clubId, targetUserId, seasonId]);
  const now = new Date().toISOString();
  try {
    const db = getFirestoreDb();
    const clubRef = db.collection(COLLECTIONS.CLUBS).doc(clubId);
    const clubDoc = await clubRef.get();
    if (!clubDoc.exists && process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true') {
      const seedClub = SEED_CLUBS.find((candidate) => candidate.id === clubId);
      if (seedClub) {
        await clubRef.set({
          id: seedClub.id,
          name: seedClub.name,
          shortName: seedClub.shortName,
          leagueId: seedClub.leagueId,
          country: seedClub.country,
          logo: seedClub.logoUrl,
          isActive: true,
          createdAt: now,
        }, { merge: true });
      }
    }
    const hydratedClubDoc = await clubRef.get();
    if (!hydratedClubDoc.exists) {
      throw new ClubNotFoundError(`Club with ID '${clubId}' not found.`);
    }

    const clubOccRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`);
    const userMemRef = db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${targetUserId}`);
    const membershipRef = db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${clubId}`);

    // If target user already owns a different club, release that club first
    const existingUserMem = await userMemRef.get();
    if (existingUserMem.exists && existingUserMem.data()?.status === 'active') {
      const prevClubId = existingUserMem.data()!.clubId;
      if (prevClubId && prevClubId !== clubId) {
        const prevOccRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${prevClubId}`);
        const prevClubRef = db.collection(COLLECTIONS.CLUBS).doc(prevClubId);
        await prevOccRef.set({ status: 'released', updatedAt: now }, { merge: true });
        await prevClubRef.update({ isTaken: false, claimedByUserId: null, updatedAt: now });
      }
    }

    const batch = db.batch();

    batch.set(clubOccRef, {
      clubId,
      userId: targetUserId,
      seasonId,
      status: 'active',
      claimedAt: now,
      updatedAt: now,
    });

    batch.set(userMemRef, {
      userId: targetUserId,
      clubId,
      seasonId,
      status: 'active',
      claimedAt: now,
      updatedAt: now,
    });

    batch.set(membershipRef, {
      id: `cm-${seasonId}-${clubId}`,
      seasonId,
      clubId,
      userId: targetUserId,
      claimedAt: now,
      status: 'active',
      updatedAt: now,
    });

    batch.update(clubRef, {
      isTaken: true,
      claimedByUserId: targetUserId,
      updatedAt: now,
    });

    const auditRef = db.collection(COLLECTIONS.AUDIT_LOGS).doc();
    batch.set(auditRef, {
      actorUserId: adminUserId,
      action: 'ADMIN_ASSIGN_CLUB',
      entityType: 'club',
      entityId: clubId,
      notes: `Admin assigned club to user '${targetUserId}'`,
      createdAt: now,
    });

    await batch.commit();

    invalidateFirestoreCache();
    const updatedClub = await getClubByIdFirestore(clubId, seasonId);
    return {
      success: true,
      message: `Club '${updatedClub?.name || clubId}' assigned to player '${targetUserId}'.`,
      club: updatedClub!,
      authoritative: true,
      isFallback: false,
    };
  } catch (err: any) {
    if (options?.authoritativeOnly || isHostedEnvironment()) {
      throw err;
    }
    console.warn('[FIRESTORE FALLBACK] adminAssignClubFirestore:', err.message);
  }

  // SQLite fallback sync
  try {
    queryRun(
      "UPDATE club_memberships SET status = 'released', updated_at = ? WHERE user_id = ? AND season_id = ? AND status = 'active'",
      [now, targetUserId, seasonId]
    );
    queryRun(
      `INSERT OR REPLACE INTO club_memberships (id, season_id, club_id, user_id, claimed_at, status, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      [`cm-${seasonId}-${clubId}`, seasonId, clubId, targetUserId, now, now]
    );
  } catch {
    // ignore
  }

  invalidateFirestoreCache();
  const updatedClub = await getClubByIdFirestore(clubId, seasonId);
  return {
    success: true,
    message: `Club '${updatedClub?.name || clubId}' assigned to player '${targetUserId}'.`,
    club: updatedClub!,
    authoritative: false,
    isFallback: true,
  };
}

export function getLocalPendingResults(seasonId: string, limitCount = 50): {
  pendingFixtures: (Fixture & { submissions: any[] })[];
  total: number;
} {
  try {
    const rows = queryAll<any>(
      `SELECT * FROM fixtures WHERE season_id = ? AND status IN ('PENDING_CONFIRMATION', 'DISPUTED') ORDER BY matchday ASC LIMIT ?`,
      [seasonId, limitCount]
    );
    const fixturesWithSubmissions = rows.map((r) => {
      const homeSeed = SEED_CLUB_MAP.get(r.home_club_id);
      const awaySeed = SEED_CLUB_MAP.get(r.away_club_id);
      const subRows = queryAll<any>(
        `SELECT * FROM result_submissions WHERE fixture_id = ? ORDER BY created_at ASC`,
        [r.id]
      );
      const submissions = subRows.map((s) => ({
        id: s.id,
        submittedByUserId: s.submitted_by_user_id,
        submitterUsername: s.submitted_by_user_id,
        submitterName: s.submitted_by_user_id,
        clubId: s.club_id,
        homeScore: s.home_score,
        awayScore: s.away_score,
        proofUrl: s.proof_url,
        createdAt: s.created_at,
        status: 'PENDING_SYNC',
      }));

      return {
        id: r.id,
        seasonId: r.season_id,
        competitionId: r.competition_id,
        competitionName: r.competition_id,
        matchday: r.matchday,
        roundName: r.round_name,
        homeClubId: (!r.home_club_id || r.home_club_id === 'TBD') ? null : r.home_club_id,
        awayClubId: (!r.away_club_id || r.away_club_id === 'TBD') ? null : r.away_club_id,
        homeClub: (!r.home_club_id || r.home_club_id === 'TBD') ? null : {
          id: r.home_club_id,
          name: homeSeed?.name || r.home_club_id,
          shortName: homeSeed?.shortName || r.home_club_id,
          country: homeSeed?.country || '',
          leagueId: homeSeed?.leagueId || '',
          logoUrl: homeSeed?.logoUrl || '',
          active: true,
          createdAt: '',
        },
        awayClub: (!r.away_club_id || r.away_club_id === 'TBD') ? null : {
          id: r.away_club_id,
          name: awaySeed?.name || r.away_club_id,
          shortName: awaySeed?.shortName || r.away_club_id,
          country: awaySeed?.country || '',
          leagueId: awaySeed?.leagueId || '',
          logoUrl: awaySeed?.logoUrl || '',
          active: true,
          createdAt: '',
        },
        homeOwnerId: r.home_owner_id,
        awayOwnerId: r.away_owner_id,
        scheduledAt: r.scheduled_at,
        status: r.status as any,
        homeScore: r.home_score ?? undefined,
        awayScore: r.away_score ?? undefined,
        winnerClubId: r.winner_club_id ?? undefined,
        resultConfirmedAt: r.result_confirmed_at ?? undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        submissions,
      };
    });

    return {
      pendingFixtures: fixturesWithSubmissions,
      total: fixturesWithSubmissions.length,
    };
  } catch (err: any) {
    console.warn('[LOCAL_PENDING_FALLBACK] Error loading local pending fixtures:', err.message);
    return { pendingFixtures: [], total: 0 };
  }
}

export async function adminApproveFixtureResultFirestore(
  adminUserId: string,
  fixtureId: string,
  homeScore: number,
  awayScore: number,
  notes?: string,
  options?: { authoritativeOnly?: boolean }
): Promise<{ success: boolean; message: string; fixture: Fixture; authoritative?: boolean; isFallback?: boolean; pendingSync?: boolean }> {
  assertNoSyntheticIdsInProduction('adminApproveFixtureResultFirestore', [adminUserId, fixtureId]);
  const now = new Date().toISOString();
  let winnerClubId: string | null = null;

  if (firestoreCircuitBreaker.canExecute()) {
    try {
      const db = getFirestoreDb();
      const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
      const fixDoc = await fixRef.get();
      if (!fixDoc.exists) {
        throw new Error(`Fixture '${fixtureId}' not found.`);
      }

      const fixture = fixDoc.data() as FirestoreFixtureDoc;
      if (homeScore > awayScore) winnerClubId = fixture.homeClubId;
      else if (awayScore > homeScore) winnerClubId = fixture.awayClubId;

      await fixRef.update({
        status: 'CONFIRMED',
        homeScore,
        awayScore,
        winnerClubId,
        resultConfirmedAt: now,
        updatedAt: now,
      });

      // Resolve any open disputes on this fixture
      const disputesSnap = await db.collection(COLLECTIONS.DISPUTES).where('fixtureId', '==', fixtureId).get();
      for (const d of disputesSnap.docs) {
        await d.ref.update({
          status: 'RESOLVED',
          resolvedByUserId: adminUserId,
          resolutionNotes: notes || 'Approved by tournament administrator',
          resolvedAt: now,
        });
      }

      // Knockout advancement if applicable
      if (winnerClubId) {
        try {
          const { advanceKnockoutWinnerFirestore } = await import('../tournament/knockoutEngine');
          await advanceKnockoutWinnerFirestore(fixtureId);
        } catch (err) {
          console.warn('[KNOCKOUT_ADVANCE] Non-blocking advance error on admin approval:', err);
        }
      }

      // Standings update if applicable
      if (fixture.competitionId) {
        try {
          await rebuildCompetitionStandingsFirestore(fixture.competitionId);
        } catch (standingsErr) {
          console.warn('[STANDINGS_UPDATE] Non-blocking standings update error on admin approval:', standingsErr);
        }
      }

      // Audit log (deterministic ID prevents duplicate on replay)
      const auditId = `audit_approve_${fixtureId}`;
      await db.collection(COLLECTIONS.AUDIT_LOGS).doc(auditId).set({
        id: auditId,
        actorUserId: adminUserId,
        action: 'ADMIN_APPROVE_RESULT',
        entityType: 'fixture',
        entityId: fixtureId,
        notes: notes || `Admin confirmed result ${homeScore}-${awayScore}`,
        createdAt: now,
      }, { merge: true });

      invalidateFirestoreCache();
      const updatedFixture = await getFixtureByIdFirestore(fixtureId);
      return {
        success: true,
        message: `Match result (${homeScore} - ${awayScore}) confirmed and standings updated.`,
        fixture: updatedFixture!,
        authoritative: true,
        isFallback: false,
      };
    } catch (err: any) {
      if (options?.authoritativeOnly) {
        throw err;
      }
      firestoreCircuitBreaker.recordFailure(err);
      recordFallbackUsage();
      console.warn('[FIRESTORE FALLBACK] adminApproveFixtureResultFirestore:', err.message);
    }
  } else {
    if (options?.authoritativeOnly) {
      throw new Error('CIRCUIT_OPEN: Firestore circuit breaker is OPEN. Authoritative write cannot execute.');
    }
    recordFallbackUsage();
  }

  // Durable Redis Outbox & SQLite Fallback
  const localFix = queryGet<any>('SELECT * FROM fixtures WHERE id = ?', [fixtureId]);
  if (!localFix) {
    throw new Error(`Fixture '${fixtureId}' not found in local database.`);
  }

  if (homeScore > awayScore) winnerClubId = localFix.home_club_id;
  else if (awayScore > homeScore) winnerClubId = localFix.away_club_id;

  const mutationId = `admin_approve_${fixtureId}`;
  // 1. MUST persist to durable Redis outbox FIRST
  await enqueueDurableOutboxMutation({
    mutationId,
    entityType: 'ADMIN_DECISION',
    entityId: fixtureId,
    operation: 'ADMIN_APPROVE_RESULT',
    adminUserId,
    userId: adminUserId,
    seasonId: localFix.season_id || 'season-2026-27',
    competitionId: localFix.competition_id,
    payload: {
      adminUserId,
      fixtureId,
      homeScore,
      awayScore,
      notes: notes || 'Approved by tournament administrator (offline queued)',
      seasonId: localFix.season_id || 'season-2026-27',
      competitionId: localFix.competition_id,
      winnerClubId,
    },
    createdAt: now,
  });

  // 2. Only after Redis persistence succeeds, update local SQLite
  queryRun(
    `UPDATE fixtures 
     SET status = 'CONFIRMED', home_score = ?, away_score = ?, winner_club_id = ?, result_confirmed_at = ?, updated_at = ? 
     WHERE id = ?`,
    [homeScore, awayScore, winnerClubId, now, now, fixtureId]
  );

  queryRun(
    `UPDATE disputes 
     SET status = 'RESOLVED', resolved_by_user_id = ?, resolution_notes = ?, resolved_at = ? 
     WHERE fixture_id = ?`,
    [adminUserId, notes || 'Approved by tournament administrator (offline queued)', now, fixtureId]
  );

  const updatedFixture = await getFixtureByIdFirestore(fixtureId);
  return {
    success: true,
    message: `Match result (${homeScore} - ${awayScore}) confirmed locally (queued for background sync).`,
    fixture: updatedFixture!,
    pendingSync: true,
    authoritative: false,
    isFallback: true,
  };
}

export async function getPendingResultsFirestore(seasonId = 'season-2026-27'): Promise<{
  pendingFixtures: (Fixture & { submissions: any[] })[];
  total: number;
}> {
  const cacheKey = `firestore:admin_pending_results:${seasonId}`;
  const cached = getFromCache<{ pendingFixtures: (Fixture & { submissions: any[] })[]; total: number }>(cacheKey);
  if (cached) return cached;

  if (!firestoreCircuitBreaker.canExecute()) {
    recordFallbackUsage();
    return getLocalPendingResults(seasonId);
  }

  try {
    const db = getFirestoreDb();
    const [pendingSnap, disputedSnap] = await Promise.all([
      db.collection(COLLECTIONS.FIXTURES)
        .where('seasonId', '==', seasonId)
        .where('status', '==', 'PENDING_CONFIRMATION')
        .get(),
      db.collection(COLLECTIONS.FIXTURES)
        .where('seasonId', '==', seasonId)
        .where('status', '==', 'DISPUTED')
        .get(),
    ]);

    const fixReads =
      (pendingSnap.empty ? 1 : pendingSnap.docs.length) +
      (disputedSnap.empty ? 1 : disputedSnap.docs.length);
    trackFirestoreRead(COLLECTIONS.FIXTURES, fixReads, 'getPendingResultsFirestore:fixtures');

    const allDocs = [...pendingSnap.docs, ...disputedSnap.docs];
    if (allDocs.length === 0) {
      const emptyResult = { pendingFixtures: [], total: 0 };
      setInCache(cacheKey, emptyResult, 30000);
      return emptyResult;
    }

    const fixtureIds = allDocs.map((d) => d.id);
    const submissionsMap = new Map<string, any[]>();

    // Batch query submissions in chunks of 30 fixtureIds
    for (let i = 0; i < fixtureIds.length; i += 30) {
      const chunk = fixtureIds.slice(i, i + 30);
      const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', 'in', chunk).get();
      trackFirestoreRead(
        COLLECTIONS.RESULT_SUBMISSIONS,
        subsSnap.empty ? 1 : subsSnap.docs.length,
        'getPendingResultsFirestore:submissions'
      );
      for (const subDoc of subsSnap.docs) {
        const subData = subDoc.data();
        const arr = submissionsMap.get(subData.fixtureId) || [];
        arr.push({
          id: subDoc.id,
          submittedByUserId: subData.submittedByUserId,
          submitterUsername: subData.submittedByUserId,
          submitterName: subData.submittedByUserId,
          clubId: subData.clubId,
          homeScore: subData.homeScore,
          awayScore: subData.awayScore,
          proofUrl: subData.proofUrl,
          createdAt: subData.createdAt,
        });
        submissionsMap.set(subData.fixtureId, arr);
      }
    }

    const fixturesWithSubmissions = allDocs.map((doc) => {
      const r = doc.data() as FirestoreFixtureDoc;
      const homeSeed = SEED_CLUB_MAP.get(r.homeClubId);
      const awaySeed = SEED_CLUB_MAP.get(r.awayClubId);
      const submissions = submissionsMap.get(doc.id) || [];

      return {
        id: doc.id,
        seasonId: r.seasonId,
        competitionId: r.competitionId,
        competitionName: r.competitionName || r.competitionId,
        matchday: r.matchday,
        roundName: r.roundName,
        homeClubId: (!r.homeClubId || r.homeClubId === 'TBD') ? null : r.homeClubId,
        awayClubId: (!r.awayClubId || r.awayClubId === 'TBD') ? null : r.awayClubId,
        homeClub: (!r.homeClubId || r.homeClubId === 'TBD') ? null : {
          id: r.homeClubId,
          name: homeSeed?.name || r.homeClubId,
          shortName: homeSeed?.shortName || r.homeClubId,
          country: homeSeed?.country || '',
          leagueId: homeSeed?.leagueId || '',
          logoUrl: homeSeed?.logoUrl || '',
          active: true,
          createdAt: '',
        },
        awayClub: (!r.awayClubId || r.awayClubId === 'TBD') ? null : {
          id: r.awayClubId,
          name: awaySeed?.name || r.awayClubId,
          shortName: awaySeed?.shortName || r.awayClubId,
          country: awaySeed?.country || '',
          leagueId: awaySeed?.leagueId || '',
          logoUrl: awaySeed?.logoUrl || '',
          active: true,
          createdAt: '',
        },
        homeOwnerId: r.homeOwnerId,
        awayOwnerId: r.awayOwnerId,
        scheduledAt: r.scheduledAt,
        status: r.status as any,
        homeScore: r.homeScore ?? undefined,
        awayScore: r.awayScore ?? undefined,
        winnerClubId: r.winnerClubId ?? undefined,
        resultConfirmedAt: r.resultConfirmedAt ?? undefined,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        submissions,
      };
    });

    const result = {
      pendingFixtures: fixturesWithSubmissions,
      total: fixturesWithSubmissions.length,
    };
    setInCache(cacheKey, result, 30000);
    return result;
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    recordFallbackUsage();
    console.warn('[FIRESTORE FALLBACK] getPendingResultsFirestore:', err.message);
    return getLocalPendingResults(seasonId);
  }
}

// ----------------------------------------------------
// PRODUCTION CONSOLE: ADMIN MATCH & USER MANAGEMENT
// ----------------------------------------------------

export async function adminEditFixtureResultFirestore(
  adminUserId: string,
  adminUsername: string,
  fixtureId: string,
  params: {
    homeScore: number;
    awayScore: number;
    status?: string;
    notes?: string;
  }
): Promise<{ success: boolean; message: string; fixture: Fixture }> {
  if (params.homeScore < 0 || params.awayScore < 0) {
    throw new Error('Scores must be non-negative integers.');
  }
  const now = new Date().toISOString();
  const db = getFirestoreDb();
  const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  const fixDoc = await fixRef.get();
  if (!fixDoc.exists) {
    throw new Error(`Fixture '${fixtureId}' not found.`);
  }

  const existing = fixDoc.data() as FirestoreFixtureDoc;
  const oldScore = {
    homeScore: existing.homeScore,
    awayScore: existing.awayScore,
    status: existing.status,
    winnerClubId: existing.winnerClubId,
  };

  let winnerClubId: string | null = null;
  if (params.homeScore > params.awayScore) winnerClubId = existing.homeClubId;
  else if (params.awayScore > params.homeScore) winnerClubId = existing.awayClubId;

  const targetStatus = params.status || 'CONFIRMED';

  await fixRef.update({
    status: targetStatus,
    homeScore: params.homeScore,
    awayScore: params.awayScore,
    winnerClubId,
    resultConfirmedAt: targetStatus === 'CONFIRMED' ? now : null,
    updatedAt: now,
  });

  // Also update SQLite
  try {
    queryRun(
      `UPDATE fixtures 
       SET status = ?, home_score = ?, away_score = ?, winner_club_id = ?, result_confirmed_at = ?, updated_at = ? 
       WHERE id = ?`,
      [
        targetStatus,
        params.homeScore,
        params.awayScore,
        winnerClubId,
        targetStatus === 'CONFIRMED' ? now : null,
        now,
        fixtureId,
      ]
    );
  } catch (err: any) {
    console.warn('[SQLITE UPDATE FIXTURE]:', err.message);
  }

  // Knockout advancement if applicable
  if (winnerClubId && targetStatus === 'CONFIRMED') {
    try {
      const { advanceKnockoutWinnerFirestore } = await import('../tournament/knockoutEngine');
      await advanceKnockoutWinnerFirestore(fixtureId);
    } catch (err) {
      console.warn('[KNOCKOUT_ADVANCE]:', err);
    }
  }

  // Rebuild standings
  if (existing.competitionId) {
    try {
      await rebuildCompetitionStandingsFirestore(existing.competitionId);
    } catch (err) {
      console.warn('[STANDINGS_REBUILD]:', err);
    }
  }

  // Audit log
  const actionName = (existing.status === 'CONFIRMED' || existing.homeScore != null)
    ? 'ADMIN_EDIT_RESULT'
    : 'ADMIN_SET_RESULT';

  await createAuditLogFirestore(
    adminUserId,
    actionName,
    'fixture',
    fixtureId,
    oldScore,
    { homeScore: params.homeScore, awayScore: params.awayScore, winnerClubId, status: targetStatus },
    undefined,
    adminUsername,
    params.notes || `Admin set result ${params.homeScore}-${params.awayScore}`
  );

  invalidateFirestoreCache();
  const updated = await getFixtureByIdFirestore(fixtureId);
  return {
    success: true,
    message: `Result updated to ${params.homeScore}-${params.awayScore} (${targetStatus}) and standings recalculated.`,
    fixture: updated!,
  };
}

export async function adminDeleteFixtureResultFirestore(
  adminUserId: string,
  adminUsername: string,
  fixtureId: string,
  options?: {
    deleteSubmissions?: boolean;
    notes?: string;
  }
): Promise<{ success: boolean; message: string; fixture: Fixture }> {
  const now = new Date().toISOString();
  const db = getFirestoreDb();
  const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  const fixDoc = await fixRef.get();
  if (!fixDoc.exists) {
    throw new Error(`Fixture '${fixtureId}' not found.`);
  }

  const existing = fixDoc.data() as FirestoreFixtureDoc;
  const oldScore = {
    homeScore: existing.homeScore,
    awayScore: existing.awayScore,
    status: existing.status,
    winnerClubId: existing.winnerClubId,
  };

  await fixRef.update({
    status: 'SCHEDULED',
    homeScore: null,
    awayScore: null,
    winnerClubId: null,
    resultConfirmedAt: null,
    updatedAt: now,
  });

  // Update SQLite
  try {
    queryRun(
      `UPDATE fixtures 
       SET status = 'SCHEDULED', home_score = NULL, away_score = NULL, winner_club_id = NULL, result_confirmed_at = NULL, updated_at = ? 
       WHERE id = ?`,
      [now, fixtureId]
    );
  } catch (err: any) {
    console.warn('[SQLITE DELETE RESULT]:', err.message);
  }

  // Delete submissions if requested
  if (options?.deleteSubmissions) {
    try {
      const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', '==', fixtureId).get();
      const batch = db.batch();
      subsSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      queryRun('DELETE FROM result_submissions WHERE fixture_id = ?', [fixtureId]);
    } catch (err: any) {
      console.warn('[DELETE SUBMISSIONS]:', err.message);
    }
  }

  // Rebuild standings
  if (existing.competitionId) {
    try {
      await rebuildCompetitionStandingsFirestore(existing.competitionId);
    } catch (err) {
      console.warn('[STANDINGS_REBUILD]:', err);
    }
  }

  await createAuditLogFirestore(
    adminUserId,
    'ADMIN_DELETE_RESULT',
    'fixture',
    fixtureId,
    oldScore,
    { status: 'SCHEDULED', homeScore: null, awayScore: null },
    undefined,
    adminUsername,
    options?.notes || 'Admin deleted match result and reset status to SCHEDULED'
  );

  invalidateFirestoreCache();
  const updated = await getFixtureByIdFirestore(fixtureId);
  return {
    success: true,
    message: 'Match result deleted and status reset to SCHEDULED. Standings recalculated.',
    fixture: updated!,
  };
}

export async function adminDeleteFixtureFirestore(
  adminUserId: string,
  adminUsername: string,
  fixtureId: string,
  reason: string
): Promise<{ success: boolean; message: string }> {
  if (!reason || reason.trim().length < 3) {
    throw new Error('A reason of at least 3 characters is required to delete a fixture.');
  }
  const db = getFirestoreDb();
  const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  const fixDoc = await fixRef.get();
  if (!fixDoc.exists) {
    throw new Error(`Fixture '${fixtureId}' not found.`);
  }

  const existing = fixDoc.data() as FirestoreFixtureDoc;
  const snapshot = { ...existing, id: fixtureId };

  // Delete fixture document
  await fixRef.delete();

  // Delete associated submissions and disputes
  try {
    const [subsSnap, dispSnap] = await Promise.all([
      db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', '==', fixtureId).get(),
      db.collection(COLLECTIONS.DISPUTES).where('fixtureId', '==', fixtureId).get(),
    ]);
    const batch = db.batch();
    subsSnap.docs.forEach((d) => batch.delete(d.ref));
    dispSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch (err: any) {
    console.warn('[DELETE SUBMISSIONS/DISPUTES]:', err.message);
  }

  // SQLite delete
  try {
    queryRun('DELETE FROM fixtures WHERE id = ?', [fixtureId]);
    queryRun('DELETE FROM result_submissions WHERE fixture_id = ?', [fixtureId]);
    queryRun('DELETE FROM disputes WHERE fixture_id = ?', [fixtureId]);
  } catch (err: any) {
    console.warn('[SQLITE DELETE FIXTURE]:', err.message);
  }

  // Rebuild standings if was confirmed
  if (existing.competitionId && existing.status === 'CONFIRMED') {
    try {
      await rebuildCompetitionStandingsFirestore(existing.competitionId);
    } catch (err) {
      console.warn('[STANDINGS_REBUILD]:', err);
    }
  }

  await createAuditLogFirestore(
    adminUserId,
    'ADMIN_DELETE_FIXTURE',
    'fixture',
    fixtureId,
    snapshot,
    null,
    undefined,
    adminUsername,
    reason
  );

  invalidateFirestoreCache();
  return {
    success: true,
    message: `Fixture '${fixtureId}' deleted successfully.`,
  };
}

export async function adminSetUserAdminFirestore(
  adminUserId: string,
  adminUsername: string,
  targetUserId: string,
  isAdmin: boolean
): Promise<{ success: boolean; message: string; user: User }> {
  const db = getFirestoreDb();
  const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    throw new Error(`User '${targetUserId}' not found.`);
  }

  const userData = userDoc.data() as FirestoreUserDoc;

  // Protection: Prevent removing the last admin
  if (!isAdmin) {
    const allUsers = await getAllUsersFirestore();
    const adminCount = allUsers.filter((u) => u.isAdmin).length;
    if (adminCount <= 1 && userData.isAdmin) {
      throw new Error('PROTECTION_ERROR: Cannot remove the last administrator from the system.');
    }
  }

  const now = new Date().toISOString();
  await userRef.update({
    isAdmin,
    updatedAt: now,
  });

  // Update SQLite
  try {
    queryRun('UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?', [isAdmin ? 1 : 0, now, targetUserId]);
  } catch (err: any) {
    console.warn('[SQLITE USER ADMIN UPDATE]:', err.message);
  }

  await createAuditLogFirestore(
    adminUserId,
    isAdmin ? 'ADMIN_MAKE_ADMIN' : 'ADMIN_REMOVE_ADMIN',
    'user',
    targetUserId,
    { isAdmin: userData.isAdmin },
    { isAdmin },
    undefined,
    adminUsername,
    `Admin changed role of @${userData.username || targetUserId} to ${isAdmin ? 'ADMIN' : 'PLAYER'}`
  );

  invalidateFirestoreCache();

  const updatedUser: User = {
    id: targetUserId,
    telegramId: userData.telegramId,
    username: userData.username,
    firstName: userData.firstName,
    lastName: userData.lastName,
    photoUrl: userData.photoUrl,
    isAdmin,
    isSuspended: Boolean(userData.isSuspended),
    createdAt: userData.createdAt,
    updatedAt: now,
  };

  return {
    success: true,
    message: `@${userData.username || targetUserId} is now ${isAdmin ? 'an Administrator' : 'a Standard Player'}.`,
    user: updatedUser,
  };
}

export async function adminSetUserSuspensionFirestore(
  adminUserId: string,
  adminUsername: string,
  targetUserId: string,
  isSuspended: boolean,
  reason?: string
): Promise<{ success: boolean; message: string; user: User }> {
  const db = getFirestoreDb();
  const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    throw new Error(`User '${targetUserId}' not found.`);
  }

  const userData = userDoc.data() as FirestoreUserDoc;

  // Cannot suspend oneself
  if (targetUserId === adminUserId && isSuspended) {
    throw new Error('PROTECTION_ERROR: You cannot suspend your own administrative account.');
  }

  const now = new Date().toISOString();
  await userRef.update({
    isSuspended,
    updatedAt: now,
  });

  // Update SQLite
  try {
    queryRun('UPDATE users SET is_suspended = ?, updated_at = ? WHERE id = ?', [isSuspended ? 1 : 0, now, targetUserId]);
  } catch (err: any) {
    console.warn('[SQLITE USER SUSPEND UPDATE]:', err.message);
  }

  await createAuditLogFirestore(
    adminUserId,
    isSuspended ? 'ADMIN_SUSPEND_USER' : 'ADMIN_UNSUSPEND_USER',
    'user',
    targetUserId,
    { isSuspended: Boolean(userData.isSuspended) },
    { isSuspended },
    undefined,
    adminUsername,
    reason || (isSuspended ? 'User account suspended by administrator' : 'User account reinstated')
  );

  invalidateFirestoreCache();

  const updatedUser: User = {
    id: targetUserId,
    telegramId: userData.telegramId,
    username: userData.username,
    firstName: userData.firstName,
    lastName: userData.lastName,
    photoUrl: userData.photoUrl,
    isAdmin: Boolean(userData.isAdmin),
    isSuspended,
    createdAt: userData.createdAt,
    updatedAt: now,
  };

  return {
    success: true,
    message: `@${userData.username || targetUserId} has been ${isSuspended ? 'suspended' : 'unsuspended'}.`,
    user: updatedUser,
  };
}

export async function adminDeleteUserFirestore(
  adminUserId: string,
  adminUsername: string,
  targetUserId: string,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  const db = getFirestoreDb();
  const userRef = db.collection(COLLECTIONS.USERS).doc(targetUserId);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    throw new Error(`User '${targetUserId}' not found.`);
  }

  const userData = userDoc.data() as FirestoreUserDoc;

  // Protection: Cannot delete yourself or the last admin
  if (targetUserId === adminUserId) {
    throw new Error('PROTECTION_ERROR: You cannot delete your own administrative account.');
  }
  if (userData.isAdmin) {
    const allUsers = await getAllUsersFirestore();
    const adminCount = allUsers.filter((u) => u.isAdmin).length;
    if (adminCount <= 1) {
      throw new Error('PROTECTION_ERROR: Cannot delete the last administrator.');
    }
  }

  const now = new Date().toISOString();
  const userSnapshot = { ...userData, id: targetUserId };

  // 1. Release active club occupancies
  try {
    const occSnap = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).where('userId', '==', targetUserId).get();
    const batch = db.batch();
    for (const d of occSnap.docs) {
      const data = d.data();
      batch.update(d.ref, {
        userId: null,
        status: 'released',
        releasedAt: now,
        releasedByUserId: adminUserId,
        updatedAt: now,
      });
      if (data.clubId) {
        const clubRef = db.collection(COLLECTIONS.CLUBS).doc(data.clubId);
        batch.update(clubRef, {
          isTaken: false,
          claimedByUserId: null,
          updatedAt: now,
        });
      }
    }

    // Release memberships
    const memSnap = await db.collection(COLLECTIONS.USER_MEMBERSHIPS).where('userId', '==', targetUserId).get();
    for (const d of memSnap.docs) {
      batch.update(d.ref, {
        status: 'released',
        releasedAt: now,
        updatedAt: now,
      });
    }

    // Delete personal notifications
    const notifSnap = await db.collection(COLLECTIONS.NOTIFICATIONS).where('userId', '==', targetUserId).get();
    for (const d of notifSnap.docs) {
      batch.delete(d.ref);
    }

    // Delete user document
    batch.delete(userRef);
    await batch.commit();
  } catch (err: any) {
    console.warn('[DELETE USER FIRESTORE BATCH]:', err.message);
  }

  // SQLite updates
  try {
    queryRun("UPDATE club_memberships SET status = 'released', updated_at = ? WHERE user_id = ?", [now, targetUserId]);
    queryRun('DELETE FROM notifications WHERE user_id = ?', [targetUserId]);
    queryRun('DELETE FROM users WHERE id = ?', [targetUserId]);
  } catch (err: any) {
    console.warn('[SQLITE DELETE USER]:', err.message);
  }

  // Record audit log
  await createAuditLogFirestore(
    adminUserId,
    'ADMIN_DELETE_USER',
    'user',
    targetUserId,
    userSnapshot,
    null,
    undefined,
    adminUsername,
    reason || `User @${userData.username || targetUserId} deleted safely`
  );

  invalidateFirestoreCache();

  return {
    success: true,
    message: `User @${userData.username || targetUserId} deleted safely. Historical fixtures and results remain intact.`,
  };
}

export function getLocalSubmissions(filter?: { fixtureId?: string; userId?: string; limit?: number }): any[] {
  try {
    let sql = 'SELECT * FROM result_submissions WHERE 1=1';
    const params: any[] = [];
    if (filter?.fixtureId) {
      sql += ' AND fixture_id = ?';
      params.push(filter.fixtureId);
    }
    if (filter?.userId) {
      sql += ' AND submitted_by_user_id = ?';
      params.push(filter.userId);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(filter?.limit || 100);
    const rows = queryAll<any>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      fixtureId: r.fixture_id,
      submittedByUserId: r.submitted_by_user_id,
      clubId: r.club_id,
      homeScore: r.home_score,
      awayScore: r.away_score,
      proofUrl: r.proof_url || null,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

export async function adminGetUserDetailFirestore(targetUserId: string): Promise<any> {
  let user: User | null = null;
  try {
    user = await getUserByIdFirestore(targetUserId);
  } catch {}

  if (!user) {
    const localUser = queryGet<any>('SELECT * FROM users WHERE id = ?', [targetUserId]);
    if (localUser) {
      user = {
        id: localUser.id,
        telegramId: localUser.telegram_id,
        username: localUser.username,
        firstName: localUser.first_name,
        lastName: localUser.last_name || '',
        photoUrl: localUser.photo_url || '',
        isAdmin: Boolean(localUser.is_admin),
        isSuspended: Boolean(localUser.is_suspended),
        createdAt: localUser.created_at,
        updatedAt: localUser.updated_at,
      };
    }
  }
  if (!user) {
    throw new Error(`User '${targetUserId}' not found.`);
  }

  const activeClub = await getUserActiveClubFirestore(targetUserId, 'season-2026-27');

  // Fetch memberships
  let memberships: any[] = [];
  try {
    if (firestoreCircuitBreaker.canExecute()) {
      const db = getFirestoreDb();
      const memSnap = await db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).where('userId', '==', targetUserId).get();
      memberships = memSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } else {
      memberships = queryAll<any>('SELECT * FROM club_memberships WHERE user_id = ?', [targetUserId]);
    }
  } catch {
    try {
      memberships = queryAll<any>('SELECT * FROM club_memberships WHERE user_id = ?', [targetUserId]);
    } catch {}
  }

  // Fetch submissions
  let submissions: any[] = [];
  try {
    submissions = await adminGetResultSubmissionsFirestore({ userId: targetUserId, limit: 30 });
  } catch {}

  // Fetch recent audit logs for this user
  let auditLogs: any[] = [];
  try {
    if (firestoreCircuitBreaker.canExecute()) {
      const db = getFirestoreDb();
      const auditSnap = await db
        .collection(COLLECTIONS.AUDIT_LOGS)
        .where('entityId', '==', targetUserId)
        .limit(20)
        .get();
      auditLogs = auditSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  } catch {}

  return {
    user,
    activeClub,
    memberships,
    submissionsCount: submissions.length,
    recentSubmissions: submissions,
    auditLogs,
    notificationsCount: 0,
  };
}

export async function adminGetResultSubmissionsFirestore(filter?: {
  fixtureId?: string;
  userId?: string;
  limit?: number;
}): Promise<any[]> {
  if (!firestoreCircuitBreaker.canExecute()) {
    return getLocalSubmissions(filter);
  }

  try {
    const db = getFirestoreDb();
    let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.RESULT_SUBMISSIONS);
    if (filter?.fixtureId) {
      query = query.where('fixtureId', '==', filter.fixtureId);
    }
    if (filter?.userId) {
      query = query.where('submittedByUserId', '==', filter.userId);
    }
    query = query.limit(filter?.limit || 100);

    const snap = await query.get();
    trackFirestoreRead(
      COLLECTIONS.RESULT_SUBMISSIONS,
      snap.empty ? 1 : snap.docs.length,
      'adminGetResultSubmissionsFirestore'
    );
    const submissions: any[] = [];
    for (const doc of snap.docs) {
      const data = doc.data();
      submissions.push({
        id: doc.id,
        fixtureId: data.fixtureId,
        submittedByUserId: data.submittedByUserId || data.userId,
        clubId: data.clubId,
        homeScore: data.homeScore,
        awayScore: data.awayScore,
        proofUrl: data.proofUrl || null,
        createdAt: data.createdAt,
      });
    }
    return submissions;
  } catch (err: any) {
    firestoreCircuitBreaker.recordFailure(err);
    return getLocalSubmissions(filter);
  }
}

export async function adminDeleteResultSubmissionFirestore(
  adminUserId: string,
  adminUsername: string,
  submissionId: string,
  notes?: string
): Promise<{ success: boolean; message: string }> {
  const db = getFirestoreDb();
  const subRef = db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc(submissionId);
  const subDoc = await subRef.get();
  if (!subDoc.exists) {
    throw new Error(`Submission '${submissionId}' not found.`);
  }

  const subData = subDoc.data();
  await subRef.delete();

  try {
    queryRun('DELETE FROM result_submissions WHERE id = ?', [submissionId]);
  } catch {}

  await createAuditLogFirestore(
    adminUserId,
    'ADMIN_DELETE_SUBMISSION',
    'submission',
    submissionId,
    subData,
    null,
    undefined,
    adminUsername,
    notes || 'Admin deleted invalid score submission'
  );

  return {
    success: true,
    message: `Result submission '${submissionId}' has been deleted.`,
  };
}
