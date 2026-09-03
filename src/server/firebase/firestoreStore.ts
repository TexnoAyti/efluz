import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { getFirestoreDb } from './admin';
import { queryAll, queryGet, queryRun, dbTransaction } from '../db';
import { SEED_CLUBS, SEED_LEAGUES, SEED_COMPETITIONS, SEED_SEASONS, SEED_SEASON } from '../db/seed';

const SEED_CLUB_MAP = new Map<string, (typeof SEED_CLUBS)[0]>(
  SEED_CLUBS.map((c) => [c.id, c])
);
import { generateEuropean32LeaguePhaseSchedule } from '../tournament/fixtureEngine';
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
} from './collections';
import {
  Club,
  Competition,
  Fixture,
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

export interface ReadMetrics {
  sessionReads: number;
  sessionWrites: number;
  readsByCollection: Record<string, number>;
  readsByFunction: Record<string, number>;
  cacheHits: number;
  cacheMisses: number;
  fallbackCount: number;
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

  return {
    sessionReads: readMetrics.sessionReads,
    sessionWrites: readMetrics.sessionWrites,
    readsByCollection: { ...readMetrics.readsByCollection },
    readsByFunction: { ...readMetrics.readsByFunction },
    cacheHits: readMetrics.cacheHits,
    cacheMisses: readMetrics.cacheMisses,
    fallbackCount: readMetrics.fallbackCount,
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

export function getFromCache<T>(key: string): T | null {
  const entry = serverCache.get(key);
  if (entry && Date.now() - entry.timestamp < entry.ttlMs) {
    readMetrics.cacheHits++;
    return entry.data as T;
  }
  readMetrics.cacheMisses++;
  return null;
}

export function setInCache<T>(key: string, data: T, ttlMs = 60000) {
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

  try {
    const db = getFirestoreDb();
    const occupanciesSnap = await db
      .collection(COLLECTIONS.CLUB_OCCUPANCIES)
      .where('seasonId', '==', seasonId)
      .where('status', '==', 'active')
      .get();

    trackFirestoreRead(
      COLLECTIONS.CLUB_OCCUPANCIES,
      occupanciesSnap.empty ? 1 : occupanciesSnap.docs.length,
      'getActiveOccupanciesForSeason'
    );

    const clubOccupancyMap = new Map<string, { userId: string }>();
    for (const doc of occupanciesSnap.docs) {
      const data = doc.data();
      if (data.clubId && data.userId) {
        clubOccupancyMap.set(data.clubId, { userId: data.userId });
      }
    }

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
              usersSnap.empty ? 1 : usersSnap.docs.length,
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
    console.warn('[FIRESTORE FALLBACK] getActiveOccupanciesForSeason:', err.message);
    const rows = queryAll<any>(
      `SELECT cm.club_id, cm.user_id, u.username as manager_username, u.first_name, u.last_name
       FROM club_memberships cm
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE cm.season_id = ? AND cm.status = 'active'`,
      [seasonId]
    );
    const clubOccupancyMap = new Map<string, { userId: string }>();
    const usernameMap = new Map<string, string>();
    const userMap = new Map<string, { id: string; username: string; displayName: string }>();
    for (const r of rows) {
      clubOccupancyMap.set(r.club_id, { userId: r.user_id });
      if (r.manager_username) {
        usernameMap.set(r.user_id, r.manager_username);
      }
      const displayName = `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.manager_username || r.user_id;
      userMap.set(r.user_id, { id: r.user_id, username: r.manager_username || '', displayName });
    }
    const result: SeasonOccupancyInfo = { clubOccupancyMap, usernameMap, userMap };
    setInCache(cacheKey, result, 60000);
    return result;
  }
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
      setInCache(cacheKey, sortedClubs, 60000); // 60s cache
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

  try {
    const db = getFirestoreDb();
    trackFirestoreRead(COLLECTIONS.CLUB_OCCUPANCIES, 1, 'getClubByIdFirestore');
    const occDoc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`).get().catch(() => null);

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
    console.warn('[FIRESTORE FALLBACK] getClubByIdFirestore:', err.message);
  }

  // SQLite fallback
  const r = queryGet<any>(
    `SELECT c.*, cm.user_id as claimed_by_user_id, u.username as manager_username
     FROM clubs c
     LEFT JOIN club_memberships cm ON c.id = cm.club_id AND cm.season_id = ? AND cm.status = 'active'
     LEFT JOIN users u ON cm.user_id = u.id
     WHERE c.id = ?`,
    [seasonId, clubId]
  );
  if (!r) return null;
  const isTaken = Boolean(r.claimed_by_user_id);
  const isCurrentUserClub = Boolean(currentUserId && r.claimed_by_user_id === currentUserId);
  const fallbackRes: Club = {
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

  try {
    const db = getFirestoreDb();

    // 1. Try USER_MEMBERSHIPS doc (${seasonId}_${userId}) - exactly 1 read
    trackFirestoreRead(COLLECTIONS.USER_MEMBERSHIPS, 1, 'getUserActiveClubFirestore');
    const userMemDoc = await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userId}`).get().catch(() => null);
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
    console.warn('[FIRESTORE FALLBACK] getUserActiveClubFirestore:', err.message);
  }

  // SQLite fallback
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
  seasonId = 'season-2026-27'
): Promise<{ success: boolean; club: Club }> {
  try {
    const db = getFirestoreDb();

    const claimResult = await db.runTransaction(async (transaction) => {
      const now = new Date().toISOString();
      const userMemRef = db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userId}`);
      const clubOccRef = db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`);
      const membershipRef = db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${clubId}`);
      const clubRef = db.collection(COLLECTIONS.CLUBS).doc(clubId);

      // 1. Read club existence
      const clubDoc = await transaction.get(clubRef);
      if (!clubDoc.exists) {
        throw new ClubNotFoundError(`Club with ID '${clubId}' does not exist.`);
      }
      const clubData = clubDoc.data() as FirestoreClubDoc;

      // 2. Read user's existing membership for this season
      const userMemDoc = await transaction.get(userMemRef);
      if (userMemDoc.exists) {
        const userMemData = userMemDoc.data();
        if (userMemData && userMemData.status === 'active') {
          if (userMemData.clubId === clubId) {
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
      const clubOccDoc = await transaction.get(clubOccRef);
      if (clubOccDoc.exists) {
        const clubOccData = clubOccDoc.data();
        if (clubOccData && clubOccData.status === 'active' && clubOccData.userId !== userId) {
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
    const verifyOcc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`).get();
    if (!verifyOcc.exists || verifyOcc.data()?.status !== 'active') {
      throw new Error(`OCCUPANCY_PERSISTENCE_FAILED: Failed to verify club occupancy record at '${COLLECTIONS.CLUB_OCCUPANCIES}/${seasonId}_${clubId}'.`);
    }

    invalidateFirestoreCache();
    return claimResult;
  } catch (err: any) {
    if (err instanceof ClubConflictError || err instanceof ClubNotFoundError) {
      throw err;
    }
    console.warn('[FIRESTORE FALLBACK] claimClubAtomicFirestore:', err.message);

    // Atomic SQLite claim
    dbTransaction(() => {
      const club = queryGet<any>('SELECT * FROM clubs WHERE id = ?', [clubId]);
      if (!club) {
        throw new ClubNotFoundError(`Club with ID '${clubId}' does not exist.`);
      }

      const existingMem = queryGet<any>(
        "SELECT * FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = 'active'",
        [userId, seasonId]
      );
      if (existingMem) {
        if (existingMem.club_id === clubId) {
          return;
        }
        throw new ClubConflictError(
          'Your club selection is locked for this season. You have already claimed another club.',
          'CLUB_SELECTION_LOCKED'
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

      const now = new Date().toISOString();
      const memId = `cm-${seasonId}-${clubId}`;
      queryRun(
        `INSERT OR REPLACE INTO club_memberships (id, season_id, club_id, user_id, claimed_at, status, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        [memId, seasonId, clubId, userId, now, now]
      );

      invalidateFirestoreCache();
    });

    const c = await getClubByIdFirestore(clubId, seasonId, userId);
    return { success: true, club: c! };
  }
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
    return !c.id.includes('trophee-des-champions') && !c.id.includes('conference-league') && !c.id.includes('uecl');
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

    const fixtures: Fixture[] = docs.map((r) => {
      const homeSeed = SEED_CLUB_MAP.get(r.homeClubId);
      const awaySeed = SEED_CLUB_MAP.get(r.awayClubId);

      const comp = compMap.get(r.competitionId);
      const activeMatchday = comp?.currentMatchday || 1;
      const adminStatus = comp?.adminOverrideStatus || 'AUTO';
      const isMatchdayOpen = comp?.isMatchdayOpen !== false;
      const isPlayableMatchday = adminStatus === 'FORCE_OPEN' || (isMatchdayOpen && r.matchday === activeMatchday);
      const isPlayable = isPlayableMatchday && adminStatus !== 'FORCE_LOCKED' && adminStatus !== 'PAUSED' && r.status !== 'CONFIRMED';

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
        homeClubId: r.homeClubId,
        awayClubId: r.awayClubId,
        homeClub: {
          id: r.homeClubId || 'TBD',
          name: homeSeed?.name || (r.homeClubId === 'TBD' ? 'TBD' : r.homeClubId),
          shortName: homeSeed?.shortName || (r.homeClubId === 'TBD' ? 'TBD' : r.homeClubId),
          country: homeSeed?.country || '',
          leagueId: homeSeed?.leagueId || '',
          logoUrl: homeSeed?.logoUrl || '',
          active: true,
          isTaken: Boolean(homeOcc),
          claimedByUserId: homeOcc ? homeOcc.userId : null,
          claimedByUsername: homeOcc ? (usernameMap.get(homeOcc.userId) || null) : null,
          createdAt: '',
        },
        awayClub: {
          id: r.awayClubId || 'TBD',
          name: awaySeed?.name || (r.awayClubId === 'TBD' ? 'TBD' : r.awayClubId),
          shortName: awaySeed?.shortName || (r.awayClubId === 'TBD' ? 'TBD' : r.awayClubId),
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

    if (cacheKey) {
      setInCache(cacheKey, fixtures, 30000);
    }
    return fixtures;
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getFixturesFirestore:', err.message);

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
    const fallbackFixtures = rows.map((r) => {
      const comp = compOverrideMap.get(r.competition_id);
      const activeMatchday = comp?.currentMatchday || 1;
      const adminStatus = comp?.adminOverrideStatus || 'AUTO';
      const isMatchdayOpen = comp?.isMatchdayOpen !== false;
      const isPlayableMatchday = adminStatus === 'FORCE_OPEN' || (isMatchdayOpen && r.matchday === activeMatchday);
      const isPlayable = isPlayableMatchday && adminStatus !== 'FORCE_LOCKED' && adminStatus !== 'PAUSED' && r.status !== 'CONFIRMED';

      const homeOcc = clubOccupancyMap.get(r.home_club_id);
      const homeUser = homeOcc ? (userMap?.get(homeOcc.userId) || { id: homeOcc.userId, username: usernameMap.get(homeOcc.userId) || '', displayName: usernameMap.get(homeOcc.userId) || '' }) : null;

      const awayOcc = clubOccupancyMap.get(r.away_club_id);
      const awayUser = awayOcc ? (userMap?.get(awayOcc.userId) || { id: awayOcc.userId, username: usernameMap.get(awayOcc.userId) || '', displayName: usernameMap.get(awayOcc.userId) || '' }) : null;

      return {
        id: r.id,
        seasonId: r.season_id,
        competitionId: r.competition_id,
        competitionName: r.competition_name || r.competition_id,
        matchday: r.matchday,
        roundName: r.round_name,
        homeClubId: r.home_club_id,
        awayClubId: r.away_club_id,
        homeClub: {
          id: r.home_club_id || 'TBD',
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
        awayClub: {
          id: r.away_club_id || 'TBD',
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

    if (cacheKey) {
      setInCache(cacheKey, fallbackFixtures, 30000);
    }
    return fallbackFixtures;
  }
}

export async function getFixtureByIdFirestore(fixtureId: string, currentUserId?: string): Promise<Fixture | null> {
  const cacheKey = `firestore:fixture:${fixtureId}:${currentUserId || 'anon'}`;
  const cached = getFromCache<Fixture>(cacheKey);
  if (cached) return cached;

  try {
    const db = getFirestoreDb();
    trackFirestoreRead(COLLECTIONS.FIXTURES, 1, 'getFixtureByIdFirestore');
    const doc = await db.collection(COLLECTIONS.FIXTURES).doc(fixtureId).get();
    if (doc.exists) {
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

      const activeMatchday = comp?.currentMatchday || 1;
      const adminStatus = comp?.adminOverrideStatus || 'AUTO';
      const isMatchdayOpen = comp?.isMatchdayOpen !== false;
      const isPlayableMatchday = adminStatus === 'FORCE_OPEN' || (isMatchdayOpen && r.matchday === activeMatchday);
      const isPlayable = isPlayableMatchday && adminStatus !== 'FORCE_LOCKED' && adminStatus !== 'PAUSED' && r.status !== 'CONFIRMED';

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
        id: r.id,
        seasonId: r.seasonId,
        competitionId: r.competitionId,
        competitionName: r.competitionName || r.competitionId,
        matchday: r.matchday,
        roundName: r.roundName,
        homeClubId: r.homeClubId,
        awayClubId: r.awayClubId,
        homeClub: {
          id: r.homeClubId || 'TBD',
          name: homeSeed?.name || (r.homeClubId === 'TBD' ? 'TBD' : r.homeClubId),
          shortName: homeSeed?.shortName || (r.homeClubId === 'TBD' ? 'TBD' : r.homeClubId),
          country: homeSeed?.country || '',
          leagueId: homeSeed?.leagueId || '',
          logoUrl: homeSeed?.logoUrl || '',
          active: true,
          isTaken: Boolean(homeOcc),
          claimedByUserId: homeOcc ? homeOcc.userId : null,
          claimedByUsername: homeOcc ? (usernameMap.get(homeOcc.userId) || null) : null,
          createdAt: '',
        },
        awayClub: {
          id: r.awayClubId || 'TBD',
          name: awaySeed?.name || (r.awayClubId === 'TBD' ? 'TBD' : r.awayClubId),
          shortName: awaySeed?.shortName || (r.awayClubId === 'TBD' ? 'TBD' : r.awayClubId),
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

      setInCache(cacheKey, fix, 30000);
      return fix;
    }
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getFixtureByIdFirestore:', err.message);
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
  return {
    id: r.id,
    seasonId: r.season_id,
    competitionId: r.competition_id,
    competitionName: r.competition_name || r.competition_id,
    matchday: r.matchday,
    roundName: r.round_name,
    homeClubId: r.home_club_id,
    awayClubId: r.away_club_id,
    homeClub: {
      id: r.home_club_id || 'TBD',
      name: r.home_name || r.home_club_id,
      shortName: r.home_short || r.home_club_id,
      country: r.home_country || '',
      leagueId: r.home_league || '',
      logoUrl: r.home_logo || '',
      active: true,
      createdAt: '',
    },
    awayClub: {
      id: r.away_club_id || 'TBD',
      name: r.away_name || r.away_club_id,
      shortName: r.away_short || r.away_club_id,
      country: r.away_country || '',
      leagueId: r.away_league || '',
      logoUrl: r.away_logo || '',
      active: true,
      createdAt: '',
    },
    homeOwnerId: r.home_owner_id,
    awayOwnerId: r.away_owner_id,
    scheduledAt: r.scheduled_at,
    status: r.status,
    homeScore: r.home_score !== null && r.home_score !== undefined ? r.home_score : undefined,
    awayScore: r.away_score !== null && r.away_score !== undefined ? r.away_score : undefined,
    winnerClubId: r.winner_club_id || undefined,
    resultConfirmedAt: r.result_confirmed_at || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
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
    trackFirestoreRead(COLLECTIONS.COMPETITION_PARTICIPANTS, 1, 'getCompetitionParticipantsFirestore');
    const snap = await db
      .collection(COLLECTIONS.COMPETITION_PARTICIPANTS)
      .where('competitionId', '==', competitionId)
      .orderBy('seedNumber', 'asc')
      .get();

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
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }

  const comp = compDoc.data() as FirestoreCompetitionDoc;

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

  // 3. Purge all existing fixtures for this competition before writing new ones (while preserving confirmed results)
  const toDeleteSnap = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', competitionId).get();
  const confirmedMap = new Map<
    string,
    {
      homeScore: number;
      awayScore: number;
      winnerClubId?: string | null;
      resultConfirmedAt?: string | null;
    }
  >();

  if (!toDeleteSnap.empty) {
    for (const doc of toDeleteSnap.docs) {
      const data = doc.data() as FirestoreFixtureDoc;
      if (data.status === 'CONFIRMED' && data.homeScore !== null && data.homeScore !== undefined) {
        confirmedMap.set(`${data.homeClubId}->${data.awayClubId}`, {
          homeScore: data.homeScore,
          awayScore: data.awayScore ?? 0,
          winnerClubId: data.winnerClubId,
          resultConfirmedAt: data.resultConfirmedAt,
        });
      }
    }

    const batchSize = 400;
    for (let i = 0; i < toDeleteSnap.docs.length; i += batchSize) {
      const chunk = toDeleteSnap.docs.slice(i, i + batchSize);
      const batch = db.batch();
      chunk.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
  }

  // If any confirmed match existed between the two clubs, preserve the confirmed score
  for (const fix of generatedFixtures) {
    const key = `${fix.homeClubId}->${fix.awayClubId}`;
    const revKey = `${fix.awayClubId}->${fix.homeClubId}`;
    if (confirmedMap.has(key)) {
      const match = confirmedMap.get(key)!;
      (fix as any).status = 'CONFIRMED';
      (fix as any).homeScore = match.homeScore;
      (fix as any).awayScore = match.awayScore;
      (fix as any).winnerClubId = match.winnerClubId;
      (fix as any).resultConfirmedAt = match.resultConfirmedAt;
    } else if (confirmedMap.has(revKey)) {
      const match = confirmedMap.get(revKey)!;
      (fix as any).status = 'CONFIRMED';
      (fix as any).homeScore = match.awayScore;
      (fix as any).awayScore = match.homeScore;
      (fix as any).winnerClubId = match.winnerClubId;
      (fix as any).resultConfirmedAt = match.resultConfirmedAt;
    }
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
// COMPETITION MATCHDAY MANAGEMENT
// ----------------------------------------------------

export async function advanceCompetitionMatchdayFirestore(
  competitionId: string,
  options: { durationHours?: number } = {}
): Promise<{ success: boolean; currentMatchday: number; totalMatchdays: number; isMatchdayOpen: boolean; nextMatchdayOpenAt: string }> {
  const db = getFirestoreDb();
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  const compDoc = await compRef.get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }

  const comp = compDoc.data() as FirestoreCompetitionDoc;
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
  overrideStatus: 'AUTO' | 'FORCE_OPEN' | 'FORCE_LOCKED' | 'PAUSED'
): Promise<{ success: boolean; adminOverrideStatus: string; isMatchdayOpen: boolean }> {
  const db = getFirestoreDb();
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  const compDoc = await compRef.get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }

  const now = new Date().toISOString();
  const isMatchdayOpen = overrideStatus === 'FORCE_OPEN' || overrideStatus === 'AUTO';

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

  invalidateFirestoreCache('firestore:comp');
  return {
    success: true,
    adminOverrideStatus: overrideStatus,
    isMatchdayOpen,
  };
}

export async function openCompetitionMatchdayNowFirestore(
  competitionId: string,
  durationHours = 30
): Promise<{ success: boolean; currentMatchday: number; isMatchdayOpen: boolean; nextMatchdayOpenAt: string }> {
  const db = getFirestoreDb();
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  const compDoc = await compRef.get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }

  const comp = compDoc.data() as FirestoreCompetitionDoc;
  const now = new Date().toISOString();
  const nextOpenAt = new Date(Date.now() + durationHours * 3600 * 1000).toISOString();

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

  invalidateFirestoreCache('firestore:comp');
  return {
    success: true,
    currentMatchday: comp.currentMatchday || 1,
    isMatchdayOpen: true,
    nextMatchdayOpenAt: nextOpenAt,
  };
}

export async function setCompetitionMatchdayTimerFirestore(
  competitionId: string,
  params: { currentMatchday?: number; durationHours?: number; nextOpenAt?: string; overrideStatus?: 'AUTO' | 'FORCE_OPEN' | 'FORCE_LOCKED' | 'PAUSED' }
): Promise<{ success: boolean; competitionId: string }> {
  const db = getFirestoreDb();
  const compRef = db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId);
  const compDoc = await compRef.get();
  if (!compDoc.exists) {
    throw new Error(`Competition '${competitionId}' not found.`);
  }

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

  invalidateFirestoreCache('firestore:comp');
  return { success: true, competitionId };
}

// ----------------------------------------------------
// STANDINGS CALCULATION & PRE-AGGREGATION (FIRESTORE)
// ----------------------------------------------------

export function computeAndSortStandings(
  clubs: Array<{ id: string; name: string; shortName: string; logoUrl?: string; managerUsername?: string }>,
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

  const clubList = clubs.map((c) => ({
    id: c.id,
    name: c.name,
    shortName: c.short_name,
    logoUrl: c.logo_url,
    managerUsername: undefined,
  }));

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
  const cacheKey = `firestore:standings:${competitionId}`;
  if (!options.forceRefresh) {
    const cached = getFromCache<StandingsRow[]>(cacheKey);
    if (cached) return cached;
  }

  try {
    const db = getFirestoreDb();
    trackFirestoreRead(COLLECTIONS.STANDINGS, 1, 'getCompetitionStandingsFirestore');
    const docRef = db.collection(COLLECTIONS.STANDINGS).doc(competitionId);
    const docSnap = await docRef.get();

    if (docSnap.exists) {
      const data = docSnap.data() as FirestoreStandingsDoc;
      if (Array.isArray(data.rows) && data.rows.length > 0) {
        setInCache(cacheKey, data.rows, 300000); // 5 min cache
        return data.rows;
      }
    }

    // Materialized document does not exist yet -> return default initial standings (0 extra Firestore reads)
    // Standings are materialized only on match confirmation or explicit admin rebuild
    const rows = fallbackCalculateStandings(competitionId);
    setInCache(cacheKey, rows, 300000);
    return rows;
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getCompetitionStandingsFirestore:', err.message);
    const rows = fallbackCalculateStandings(competitionId);
    setInCache(cacheKey, rows, 300000);
    return rows;
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
      seedClubs.map((c) => ({
        id: c.id,
        name: c.name,
        shortName: c.shortName,
        logoUrl: c.logoUrl,
        managerUsername: undefined,
      })),
      confirmedFixtures,
      formatConfig
    );

    const now = new Date().toISOString();
    const standingsDoc: FirestoreStandingsDoc = {
      competitionId,
      seasonId: seedComp?.seasonId || 'season-2026-27',
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
    const rows = fallbackCalculateStandings(competitionId);
    setInCache(cacheKey, rows, 300000);
    return rows;
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
  if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
    throw new Error('Scores must be non-negative integers.');
  }

  const db = getFirestoreDb();
  const now = new Date().toISOString();
  const submissionId = `sub-${fixtureId}-${userId}`;

  try {
    const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
    trackFirestoreRead(COLLECTIONS.FIXTURES, 1, 'submitFixtureResultFirestore:fixture');
    const fixDoc = await fixRef.get();
    if (!fixDoc.exists) {
      throw new Error(`Fixture with ID '${fixtureId}' not found.`);
    }

    const fixture = fixDoc.data() as FirestoreFixtureDoc;
    if (fixture.status === 'CONFIRMED') {
      throw new Error('This match result is already CONFIRMED and cannot be modified.');
    }

    // Authoritative Server-Side Matchday Lock Check
    if (fixture.competitionId && fixture.matchday) {
      let override = compOverrideMap.get(fixture.competitionId);
      if (!override) {
        trackFirestoreRead(COLLECTIONS.COMPETITIONS, 1, 'submitFixtureResultFirestore:compLockCheck');
        const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(fixture.competitionId).get();
        if (compDoc.exists) {
          override = compDoc.data() as FirestoreCompetitionDoc;
          compOverrideMap.set(fixture.competitionId, override);
        }
      }

      if (override) {
        const activeMatchday = override.currentMatchday || 1;
        const adminStatus = override.adminOverrideStatus || 'AUTO';
        const isMatchdayOpen = override.isMatchdayOpen !== false;

        if (adminStatus === 'FORCE_LOCKED' || adminStatus === 'PAUSED') {
          const err: any = new Error(`MATCHDAY_LOCKED: Matchday submissions for this competition are currently locked by tournament administration.`);
          err.code = 'MATCHDAY_LOCKED';
          err.statusCode = 403;
          throw err;
        }

        if (adminStatus !== 'FORCE_OPEN') {
          if (!isMatchdayOpen) {
            const err: any = new Error(`MATCHDAY_LOCKED: Matchday ${activeMatchday} is currently closed.`);
            err.code = 'MATCHDAY_LOCKED';
            err.statusCode = 403;
            throw err;
          }

          if (fixture.matchday !== activeMatchday) {
            const err: any = new Error(`MATCHDAY_LOCKED: Matchday ${fixture.matchday} is locked. Only active Matchday ${activeMatchday} is open for submissions.`);
            err.code = 'MATCHDAY_LOCKED';
            err.statusCode = 403;
            throw err;
          }
        }
      }
    }

    // Verify ownership
    trackFirestoreRead(COLLECTIONS.USER_MEMBERSHIPS, 1, 'submitFixtureResultFirestore:membership');
    const userMemDoc = await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${fixture.seasonId}_${userId}`).get();
    if (!userMemDoc.exists || userMemDoc.data()?.status !== 'active') {
      throw new Error('You do not own either the home or away club in this fixture.');
    }

    const userClubId = userMemDoc.data()!.clubId;
    const isHome = userClubId === fixture.homeClubId;
    const isAway = userClubId === fixture.awayClubId;

    if (!isHome && !isAway) {
      throw new Error('You do not own either the home or away club in this fixture.');
    }

    // Write submission idempotently
    const subRef = db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc(submissionId);
    trackFirestoreWrite(COLLECTIONS.RESULT_SUBMISSIONS, 1, 'submitFixtureResultFirestore:setSubmission');
    await subRef.set({
      id: submissionId,
      fixtureId,
      submittedByUserId: userId,
      clubId: userClubId,
      homeScore,
      awayScore,
      proofUrl: proofUrl || null,
      createdAt: now,
    });

    // Evaluate all submissions for fixture
    trackFirestoreRead(COLLECTIONS.RESULT_SUBMISSIONS, 1, 'submitFixtureResultFirestore:allSubs');
    const allSubsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', '==', fixtureId).get();
    const allSubs = allSubsSnap.docs.map((d) => d.data() as FirestoreResultSubmissionDoc);

    let newStatus = allSubs.length === 1 ? 'PENDING_CONFIRMATION' : 'AWAITING_RESULT';
    let confirmedHomeScore: number | null = null;
    let confirmedAwayScore: number | null = null;
    let winnerClubId: string | null = null;
    let confirmedAt: string | null = null;

    if (allSubs.length >= 2) {
      const [sub1, sub2] = allSubs;
      if (sub1.homeScore === sub2.homeScore && sub1.awayScore === sub2.awayScore) {
        newStatus = 'CONFIRMED';
        confirmedHomeScore = sub1.homeScore;
        confirmedAwayScore = sub1.awayScore;
        confirmedAt = now;
        if (confirmedHomeScore > confirmedAwayScore) winnerClubId = fixture.homeClubId;
        else if (confirmedAwayScore > confirmedHomeScore) winnerClubId = fixture.awayClubId;
      } else {
        newStatus = 'DISPUTED';
        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(`disp-${fixtureId}`);
        trackFirestoreWrite(COLLECTIONS.DISPUTES, 1, 'submitFixtureResultFirestore:dispute');
        await disputeRef.set({
          id: `disp-${fixtureId}`,
          fixtureId,
          seasonId: fixture.seasonId,
          homeSubmissionId: sub1.id,
          awaySubmissionId: sub2.id,
          status: 'OPEN',
          createdAt: now,
        });
      }
    } else {
      newStatus = 'PENDING_CONFIRMATION';
    }

    trackFirestoreWrite(COLLECTIONS.FIXTURES, 1, 'submitFixtureResultFirestore:updateStatus');
    await fixRef.update({
      status: newStatus,
      homeScore: confirmedHomeScore,
      awayScore: confirmedAwayScore,
      winnerClubId,
      resultConfirmedAt: confirmedAt,
      updatedAt: now,
    });

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

    if (newStatus === 'CONFIRMED' && fixture.competitionId) {
      try {
        await rebuildCompetitionStandingsFirestore(fixture.competitionId);
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
      errMsg.includes('locked') ||
      errMsg.includes('paused') ||
      errMsg.includes('do not own') ||
      errMsg.includes('Scores must be')
    ) {
      throw firestoreErr;
    }

    // For quota, network, or server-level Firestore failure: execute resilient SQLite fallback
    try {
      console.log('[RESULT_SUBMISSION_FALLBACK] Executing SQLite fallback persistence for fixture:', fixtureId);
      const row = queryGet<any>('SELECT * FROM fixtures WHERE id = ?', [fixtureId]);
      if (!row) {
        throw firestoreErr;
      }

      const memRow =
        queryGet<any>('SELECT * FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = "active"', [
          userId,
          row.season_id,
        ]) ||
        queryGet<any>('SELECT * FROM season_league_clubs WHERE owner_user_id = ? AND season_id = ?', [
          userId,
          row.season_id,
        ]);

      const userClubId = memRow?.club_id || memRow?.clubId;
      if (!userClubId || (userClubId !== row.home_club_id && userClubId !== row.away_club_id)) {
        throw firestoreErr;
      }

      queryRun(
        `INSERT OR REPLACE INTO result_submissions (id, fixture_id, submitted_by_user_id, club_id, home_score, away_score, proof_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [submissionId, fixtureId, userId, userClubId, homeScore, awayScore, proofUrl || null, now]
      );

      const existingSubs = queryAll<any>('SELECT * FROM result_submissions WHERE fixture_id = ?', [fixtureId]);
      let newStatus = existingSubs.length === 1 ? 'PENDING_CONFIRMATION' : 'AWAITING_RESULT';
      let confirmedHomeScore: number | null = null;
      let confirmedAwayScore: number | null = null;
      let winnerClubId: string | null = null;
      let confirmedAt: string | null = null;

      if (existingSubs.length >= 2) {
        const [sub1, sub2] = existingSubs;
        if (sub1.home_score === sub2.home_score && sub1.away_score === sub2.away_score) {
          newStatus = 'CONFIRMED';
          confirmedHomeScore = sub1.home_score;
          confirmedAwayScore = sub1.away_score;
          confirmedAt = now;
          if (confirmedHomeScore > confirmedAwayScore) winnerClubId = row.home_club_id;
          else if (confirmedAwayScore > confirmedHomeScore) winnerClubId = row.away_club_id;
        } else {
          newStatus = 'DISPUTED';
        }
      }

      queryRun(
        `UPDATE fixtures SET status = ?, home_score = ?, away_score = ?, winner_club_id = ?, result_confirmed_at = ?, updated_at = ? WHERE id = ?`,
        [newStatus, confirmedHomeScore, confirmedAwayScore, winnerClubId, confirmedAt, now, fixtureId]
      );

      invalidateFirestoreCache('firestore:fixtures');
      return (await getFixtureByIdFirestore(fixtureId, userId))!;
    } catch (fallbackErr: any) {
      console.error('[RESULT_SUBMISSION_FALLBACK] SQLite fallback failed:', fallbackErr);
      throw firestoreErr;
    }
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
    } else {
      const existing = userDoc.data() as FirestoreUserDoc;
      const updatedAdmin = existing.isAdmin || isAdmin;

      await userDocRef.update({
        username,
        firstName,
        lastName,
        photoUrl: photoUrl || existing.photoUrl || '',
        isAdmin: updatedAdmin,
        updatedAt: now,
      });
    }

    // Read-after-write verification to guarantee persistence in Firestore
    const verifyDoc = await userDocRef.get();
    if (verifyDoc.exists) {
      const persisted = verifyDoc.data() as FirestoreUserDoc;
      return {
        id: persisted.id || docId,
        telegramId: persisted.telegramId || telegramId,
        username: persisted.username || username,
        firstName: persisted.firstName || firstName,
        lastName: persisted.lastName || lastName,
        photoUrl: persisted.photoUrl || photoUrl,
        isAdmin: Boolean(persisted.isAdmin),
        isSuspended: Boolean(persisted.isSuspended),
        createdAt: persisted.createdAt || now,
        updatedAt: persisted.updatedAt || now,
      };
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
  notes?: string
): Promise<{ success: boolean; fixtureId: string }> {
  const db = getFirestoreDb();
  const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  const fixDoc = await fixRef.get();
  if (!fixDoc.exists) {
    throw new Error(`Fixture '${fixtureId}' not found.`);
  }

  const now = new Date().toISOString();

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

  // Audit log
  await db.collection(COLLECTIONS.AUDIT_LOGS).add({
    actorUserId: adminUserId,
    action: 'REOPEN_FIXTURE',
    entityType: 'fixture',
    entityId: fixtureId,
    notes: notes || null,
    createdAt: now,
  });

  return { success: true, fixtureId };
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

  await db.collection(COLLECTIONS.AUDIT_LOGS).add({
    actorUserId: adminUserId,
    action: 'RESOLVE_DISPUTE',
    entityType: 'dispute',
    entityId: disputeId,
    notes: params.notes || null,
    createdAt: now,
  });

  return { success: true, dispute: updatedDispute };
}

export async function getDisputesFirestore(status = 'OPEN'): Promise<Dispute[]> {
  const cacheKey = `firestore:disputes:${status}`;
  const cached = getFromCache<Dispute[]>(cacheKey);
  if (cached) return cached;

  const db = getFirestoreDb();
  let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.DISPUTES);
  if (status) {
    query = query.where('status', '==', status);
  }
  const snap = await query.get();
  trackFirestoreRead(
    COLLECTIONS.DISPUTES,
    snap.empty ? 1 : snap.docs.length,
    'getDisputesFirestore'
  );
  const disputes: Dispute[] = [];

  for (const doc of snap.docs) {
    const data = doc.data() as FirestoreDisputeDoc;
    const fixture = await getFixtureByIdFirestore(data.fixtureId);
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

  setInCache(cacheKey, disputes, 20000); // 20s cache
  return disputes;
}

export async function getAllUsersFirestore(): Promise<User[]> {
  const cacheKey = 'firestore:all_users';
  const cached = getFromCache<User[]>(cacheKey);
  if (cached) return cached;

  const db = getFirestoreDb();
  const snap = await db.collection(COLLECTIONS.USERS).orderBy('createdAt', 'desc').get();
  trackFirestoreRead(
    COLLECTIONS.USERS,
    snap.empty ? 1 : snap.docs.length,
    'getAllUsersFirestore'
  );
  const users = snap.docs.map((d) => {
    const data = d.data() as FirestoreUserDoc;
    return {
      id: d.id,
      telegramId: data.telegramId,
      username: data.username,
      firstName: data.firstName,
      lastName: data.lastName,
      photoUrl: data.photoUrl,
      isAdmin: data.isAdmin,
      isSuspended: data.isSuspended,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  });
  setInCache(cacheKey, users, 30000); // 30s cache
  return users;
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
  ipAddress?: string
): Promise<void> {
  const db = getFirestoreDb();
  const now = new Date().toISOString();
  await db.collection(COLLECTIONS.AUDIT_LOGS).add({
    actorUserId,
    action,
    entityType,
    entityId,
    oldValueJson: oldValue ? JSON.stringify(oldValue) : null,
    newValueJson: newValue ? JSON.stringify(newValue) : null,
    ipAddress: ipAddress || null,
    createdAt: now,
  });
  trackFirestoreWrite(COLLECTIONS.AUDIT_LOGS, 1, 'createAuditLogFirestore');
}

export async function createNotificationFirestore(
  userId: string,
  type: string,
  title: string,
  message: string,
  data?: Record<string, unknown>
): Promise<void> {
  const now = new Date().toISOString();
  try {
    const db = getFirestoreDb();
    await db.collection(COLLECTIONS.NOTIFICATIONS).add({
      userId,
      type,
      title,
      message,
      data: data || null,
      isRead: false,
      createdAt: now,
    });
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] createNotificationFirestore:', err.message);
    const notifId = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    queryRun(
      `INSERT INTO notifications (id, user_id, type, title, message, is_read, created_at)
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
  try {
    const db = getFirestoreDb();
    const docRef = db.collection(COLLECTIONS.NOTIFICATIONS).doc(notificationId);
    const doc = await docRef.get();
    if (doc.exists && doc.data()?.userId === userId) {
      await docRef.update({ isRead: true });
    }
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] markSingleNotificationReadFirestore:', err.message);
    queryRun(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id = ?`, [userId, notificationId]);
  }
}

export async function markNotificationsReadFirestore(userId: string): Promise<void> {
  try {
    const db = getFirestoreDb();
    const snap = await db
      .collection(COLLECTIONS.NOTIFICATIONS)
      .where('userId', '==', userId)
      .where('isRead', '==', false)
      .get();

    if (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.update(doc.ref, { isRead: true }));
      await batch.commit();
    }
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] markNotificationsReadFirestore:', err.message);
    queryRun(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`, [userId]);
  }
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
  seasonId = 'season-2026-27'
): Promise<{ success: boolean; message: string; club: Club }> {
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
  } catch (err: any) {
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
  };
}

export async function adminAssignClubFirestore(
  adminUserId: string,
  clubId: string,
  targetUserId: string,
  seasonId = 'season-2026-27'
): Promise<{ success: boolean; message: string; club: Club }> {
  const now = new Date().toISOString();
  try {
    const db = getFirestoreDb();
    const clubRef = db.collection(COLLECTIONS.CLUBS).doc(clubId);
    const clubDoc = await clubRef.get();
    if (!clubDoc.exists) {
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
  } catch (err: any) {
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
  };
}

export async function adminApproveFixtureResultFirestore(
  adminUserId: string,
  fixtureId: string,
  homeScore: number,
  awayScore: number,
  notes?: string
): Promise<{ success: boolean; message: string; fixture: Fixture }> {
  const db = getFirestoreDb();
  const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  const fixDoc = await fixRef.get();
  if (!fixDoc.exists) {
    throw new Error(`Fixture '${fixtureId}' not found.`);
  }

  const fixture = fixDoc.data() as FirestoreFixtureDoc;
  const now = new Date().toISOString();

  let winnerClubId: string | null = null;
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

  // Audit log
  await db.collection(COLLECTIONS.AUDIT_LOGS).add({
    actorUserId: adminUserId,
    action: 'ADMIN_APPROVE_RESULT',
    entityType: 'fixture',
    entityId: fixtureId,
    notes: notes || `Admin confirmed result ${homeScore}-${awayScore}`,
    createdAt: now,
  });

  invalidateFirestoreCache();
  const updatedFixture = await getFixtureByIdFirestore(fixtureId);
  return {
    success: true,
    message: `Match result (${homeScore} - ${awayScore}) confirmed and standings updated.`,
    fixture: updatedFixture!,
  };
}

export async function getPendingResultsFirestore(seasonId = 'season-2026-27'): Promise<{
  pendingFixtures: (Fixture & { submissions: any[] })[];
  total: number;
}> {
  const cacheKey = `firestore:admin_pending_results:${seasonId}`;
  const cached = getFromCache<{ pendingFixtures: (Fixture & { submissions: any[] })[]; total: number }>(cacheKey);
  if (cached) return cached;

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
        homeClubId: r.homeClubId,
        awayClubId: r.awayClubId,
        homeClub: {
          id: r.homeClubId || 'TBD',
          name: homeSeed?.name || (r.homeClubId === 'TBD' ? 'TBD' : r.homeClubId),
          shortName: homeSeed?.shortName || (r.homeClubId === 'TBD' ? 'TBD' : r.homeClubId),
          country: homeSeed?.country || '',
          leagueId: homeSeed?.leagueId || '',
          logoUrl: homeSeed?.logoUrl || '',
          active: true,
          createdAt: '',
        },
        awayClub: {
          id: r.awayClubId || 'TBD',
          name: awaySeed?.name || (r.awayClubId === 'TBD' ? 'TBD' : r.awayClubId),
          shortName: awaySeed?.shortName || (r.awayClubId === 'TBD' ? 'TBD' : r.awayClubId),
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
    console.warn('[FIRESTORE FALLBACK] getPendingResultsFirestore:', err.message);
    return { pendingFixtures: [], total: 0 };
  }
}



