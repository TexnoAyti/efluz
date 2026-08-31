import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { getFirestoreDb } from './admin';
import { queryAll, queryGet, queryRun, dbTransaction } from '../db';
import { SEED_CLUBS, SEED_LEAGUES } from '../db/seed';

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
  readsByCollection: Record<string, number>;
  readsByFunction: Record<string, number>;
  cacheHits: number;
  cacheMisses: number;
  startedAt: string;
}

const readMetrics: ReadMetrics = {
  sessionReads: 0,
  readsByCollection: {},
  readsByFunction: {},
  cacheHits: 0,
  cacheMisses: 0,
  startedAt: new Date().toISOString(),
};

export function trackFirestoreRead(collectionName: string, count = 1, caller = 'unknown') {
  readMetrics.sessionReads += count;
  readMetrics.readsByCollection[collectionName] = (readMetrics.readsByCollection[collectionName] || 0) + count;
  readMetrics.readsByFunction[caller] = (readMetrics.readsByFunction[caller] || 0) + count;
}

export function getReadMetrics(): ReadMetrics {
  return {
    sessionReads: readMetrics.sessionReads,
    readsByCollection: { ...readMetrics.readsByCollection },
    readsByFunction: { ...readMetrics.readsByFunction },
    cacheHits: readMetrics.cacheHits,
    cacheMisses: readMetrics.cacheMisses,
    startedAt: readMetrics.startedAt,
  };
}

export function resetReadMetrics(): void {
  readMetrics.sessionReads = 0;
  readMetrics.readsByCollection = {};
  readMetrics.readsByFunction = {};
  readMetrics.cacheHits = 0;
  readMetrics.cacheMisses = 0;
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

function getFromCache<T>(key: string): T | null {
  const entry = serverCache.get(key);
  if (entry && Date.now() - entry.timestamp < entry.ttlMs) {
    readMetrics.cacheHits++;
    return entry.data as T;
  }
  readMetrics.cacheMisses++;
  return null;
}

function setInCache<T>(key: string, data: T, ttlMs = 60000) {
  serverCache.set(key, {
    data,
    timestamp: Date.now(),
    ttlMs,
  });
}

// ----------------------------------------------------
// SEASONS & LEAGUES
// ----------------------------------------------------

export async function getActiveSeasonFirestore(): Promise<Season | null> {
  const cacheKey = 'firestore:active_season';
  const cached = getFromCache<Season>(cacheKey);
  if (cached) return cached;

  try {
    const db = getFirestoreDb();
    trackFirestoreRead(COLLECTIONS.SEASONS, 1, 'getActiveSeasonFirestore');
    const snap = await db.collection(COLLECTIONS.SEASONS).where('status', '==', 'ACTIVE').limit(1).get();
    if (snap.empty) {
      // Fallback: search season-2026-27
      trackFirestoreRead(COLLECTIONS.SEASONS, 1, 'getActiveSeasonFirestore');
      const doc = await db.collection(COLLECTIONS.SEASONS).doc('season-2026-27').get();
      if (doc.exists) {
        const data = doc.data() as FirestoreSeasonDoc;
        const res: Season = {
          id: doc.id,
          name: data.name,
          status: (data.status?.toLowerCase() as SeasonStatus) || 'active',
          startDate: data.startDate,
          endDate: data.endDate,
          createdAt: data.createdAt,
        };
        setInCache(cacheKey, res, 600000); // 10 min cache
        return res;
      }
      return null;
    }
    const doc = snap.docs[0];
    const data = doc.data() as FirestoreSeasonDoc;
    const res: Season = {
      id: doc.id,
      name: data.name,
      status: (data.status?.toLowerCase() as SeasonStatus) || 'active',
      startDate: data.startDate,
      endDate: data.endDate,
      createdAt: data.createdAt,
    };
    setInCache(cacheKey, res, 600000);
    return res;
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getActiveSeasonFirestore:', err.message);
    const row = queryGet<any>("SELECT * FROM seasons WHERE status = 'active' OR id = 'season-2026-27' LIMIT 1");
    if (row) {
      const res: Season = {
        id: row.id,
        name: row.name,
        status: (row.status?.toLowerCase() as SeasonStatus) || 'active',
        startDate: row.start_date,
        endDate: row.end_date,
        createdAt: row.created_at,
      };
      setInCache(cacheKey, res, 600000);
      return res;
    }
    return null;
  }
}

export async function getAllSeasonsFirestore(): Promise<Season[]> {
  const cacheKey = 'firestore:all_seasons';
  const cached = getFromCache<Season[]>(cacheKey);
  if (cached) return cached;

  try {
    const db = getFirestoreDb();
    trackFirestoreRead(COLLECTIONS.SEASONS, 1, 'getAllSeasonsFirestore');
    const snap = await db.collection(COLLECTIONS.SEASONS).get();
    const res = snap.docs.map((doc) => {
      const data = doc.data() as FirestoreSeasonDoc;
      return {
        id: doc.id,
        name: data.name,
        status: (data.status?.toLowerCase() as SeasonStatus) || 'active',
        startDate: data.startDate,
        endDate: data.endDate,
        createdAt: data.createdAt,
      };
    });
    setInCache(cacheKey, res, 600000);
    return res;
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getAllSeasonsFirestore:', err.message);
    const rows = queryAll<any>('SELECT * FROM seasons');
    const res: Season[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: (row.status?.toLowerCase() as SeasonStatus) || 'active',
      startDate: row.start_date,
      endDate: row.end_date,
      createdAt: row.created_at,
    }));
    setInCache(cacheKey, res, 600000);
    return res;
  }
}

export async function getAllLeaguesFirestore(): Promise<League[]> {
  const cacheKey = 'firestore:all_leagues';
  const cached = getFromCache<League[]>(cacheKey);
  if (cached) return cached;

  // Use canonical SEED_LEAGUES directly to avoid burning Firestore read quota on static metadata
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
    const db = getFirestoreDb();

    // 1. Get static clubs for this league from SEED_CLUBS (zero Firestore reads!)
    const staticLeagueClubs = SEED_CLUBS.filter((c) => c.leagueId === leagueId);

    // 2. Fetch all active occupancies for this season in ONE single query (1 read)
    trackFirestoreRead(COLLECTIONS.CLUB_OCCUPANCIES, 1, 'getClubsByLeagueFirestore');
    const occupanciesSnap = await db
      .collection(COLLECTIONS.CLUB_OCCUPANCIES)
      .where('seasonId', '==', seasonId)
      .where('status', '==', 'active')
      .get();

    const clubOccupancyMap = new Map<string, { userId: string }>();
    for (const doc of occupanciesSnap.docs) {
      const data = doc.data();
      if (data.clubId && data.userId) {
        clubOccupancyMap.set(data.clubId, { userId: data.userId });
      }
    }

    // 3. Batch user display names from cached user map or batch read (0 N+1 reads)
    const userIds = Array.from(new Set(Array.from(clubOccupancyMap.values()).map((o) => o.userId)));
    const usernameMap = new Map<string, string>();
    if (userIds.length > 0) {
      // Check cached user profiles first
      const missingUserIds: string[] = [];
      for (const uid of userIds) {
        const cachedUser = getFromCache<User>(`firestore:user:${uid}`);
        if (cachedUser) {
          usernameMap.set(uid, cachedUser.username || cachedUser.firstName || uid);
        } else {
          missingUserIds.push(uid);
        }
      }

      if (missingUserIds.length > 0) {
        // Batch query missing users in chunks of 30
        for (let i = 0; i < missingUserIds.length; i += 30) {
          const chunk = missingUserIds.slice(i, i + 30);
          trackFirestoreRead(COLLECTIONS.USERS, 1, 'getClubsByLeagueFirestore:users');
          const usersSnap = await db.collection(COLLECTIONS.USERS).where('id', 'in', chunk).get().catch(() => null);
          if (usersSnap) {
            for (const uDoc of usersSnap.docs) {
              const uData = uDoc.data() as FirestoreUserDoc;
              const uname = uData.username || uData.firstName || uDoc.id;
              usernameMap.set(uDoc.id, uname);
              setInCache(`firestore:user:${uDoc.id}`, {
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
              }, 300000);
            }
          }
        }
      }
    }

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
    const db = getFirestoreDb();
    trackFirestoreRead(COLLECTIONS.CLUB_OCCUPANCIES, 1, 'getAvailableClubsFirestore');
    const occupanciesSnap = await db
      .collection(COLLECTIONS.CLUB_OCCUPANCIES)
      .where('seasonId', '==', seasonId)
      .where('status', '==', 'active')
      .get();

    const occupiedClubIds = new Set<string>();
    for (const doc of occupanciesSnap.docs) {
      const data = doc.data();
      if (data.clubId) occupiedClubIds.add(data.clubId);
    }

    // Filter from SEED_CLUBS directly (0 extra reads)
    const availableClubs: Club[] = SEED_CLUBS.filter((c) => !occupiedClubIds.has(c.id)).map((seed) => ({
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
  const cached = getFromCache<Club>(cacheKey);
  if (cached) return cached;

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

export async function getAllCompetitionsFirestore(seasonId = 'season-2026-27'): Promise<Competition[]> {
  const cacheKey = `firestore:competitions:${seasonId}`;
  const cached = getFromCache<Competition[]>(cacheKey);
  if (cached && cached.length > 0) return cached;

  try {
    const db = getFirestoreDb();
    trackFirestoreRead(COLLECTIONS.COMPETITIONS, 1, 'getAllCompetitionsFirestore');
    let snap = await db
      .collection(COLLECTIONS.COMPETITIONS)
      .where('seasonId', '==', seasonId)
      .get();

    if (snap.empty) {
      snap = await db.collection(COLLECTIONS.COMPETITIONS).get();
    }

    const validDocs = snap.docs.filter((doc) => {
      const data = doc.data() as FirestoreCompetitionDoc;
      const isObsolete =
        doc.id.includes('trophee-des-champions') ||
        doc.id.includes('conference-league') ||
        doc.id.includes('uecl') ||
        data.name?.toLowerCase().includes('conference league') ||
        data.name?.toLowerCase().includes('trophée des champions') ||
        data.name?.toLowerCase().includes('trophee des champions');

      return !isObsolete;
    });

    const competitions: Competition[] = validDocs.map((doc) => {
      const data = doc.data() as FirestoreCompetitionDoc;
      const fixturesCount = data.fixturesCount ?? data.fixtureCount ?? (data.hasFixtures ? 1 : 0);
      const hasFixtures = Boolean(data.hasFixtures || fixturesCount > 0);
      const generationStatus: 'generated' | 'not_generated' = hasFixtures ? 'generated' : 'not_generated';

      let totalTeams = 0;
      if (data.leagueId) {
        totalTeams = SEED_CLUBS.filter((c) => c.leagueId === data.leagueId).length || 20;
      } else {
        totalTeams = data.formatConfig?.maxTeams || 32;
      }

      const totalMatchdays = data.totalMatchdays || (data.leagueId ? (data.leagueId.includes('bundesliga') || data.leagueId.includes('ligue-1') ? 17 : 19) : 8);

      return {
        id: doc.id,
        seasonId: data.seasonId,
        leagueId: data.leagueId,
        name: data.name,
        type: data.type as any,
        scheduleMode: data.scheduleMode as any,
        status: (hasFixtures ? 'active' : data.status) as any,
        totalTeams,
        hasFixtures,
        fixtureCount: fixturesCount,
        fixturesCount,
        generationStatus,
        formatConfig: data.formatConfig || {},
        currentMatchday: data.currentMatchday || 1,
        totalMatchdays,
        isMatchdayOpen: data.isMatchdayOpen !== false,
        matchdayOpenedAt: data.matchdayOpenedAt,
        matchdayDurationHours: data.matchdayDurationHours || 30,
        nextMatchdayOpenAt: data.nextMatchdayOpenAt,
        adminOverrideStatus: data.adminOverrideStatus || 'AUTO',
        createdAt: data.createdAt,
      };
    });

    if (competitions.length > 0) {
      setInCache(cacheKey, competitions, 60000);
    }
    return competitions;
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getAllCompetitionsFirestore:', err.message);
    const rows = queryAll<any>('SELECT * FROM competitions WHERE season_id = ?', [seasonId]);
    const competitions: Competition[] = rows
      .filter((r) => !r.id.includes('conference-league') && !r.id.includes('trophee'))
      .map((r) => {
        let formatConfig: any = {};
        try {
          formatConfig = JSON.parse(r.format_config_json || '{}');
        } catch {}
        const fixtures = queryAll<any>('SELECT id FROM fixtures WHERE competition_id = ?', [r.id]);
        const hasFixtures = fixtures.length > 0;
        return {
          id: r.id,
          seasonId: r.season_id,
          leagueId: r.league_id,
          name: r.name,
          type: r.type,
          scheduleMode: r.schedule_mode,
          status: hasFixtures ? 'active' : r.status,
          totalTeams: formatConfig.totalTeams || (r.league_id ? SEED_CLUBS.filter((c) => c.leagueId === r.league_id).length : 20),
          hasFixtures,
          fixtureCount: fixtures.length,
          fixturesCount: fixtures.length,
          generationStatus: hasFixtures ? 'generated' : 'not_generated',
          formatConfig,
          currentMatchday: 1,
          totalMatchdays: r.league_id ? (r.league_id.includes('bundesliga') || r.league_id.includes('ligue-1') ? 17 : 19) : 8,
          isMatchdayOpen: true,
          matchdayDurationHours: 30,
          adminOverrideStatus: 'AUTO',
          createdAt: r.created_at,
        };
      });
    if (competitions.length > 0) {
      setInCache(cacheKey, competitions, 60000);
    }
    return competitions;
  }
}

export async function getCompetitionByIdFirestore(competitionId: string): Promise<Competition | null> {
  const cacheKey = `firestore:comp_id:${competitionId}`;
  const cached = getFromCache<Competition>(cacheKey);
  if (cached) return cached;

  try {
    const db = getFirestoreDb();
    const doc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
    if (!doc.exists) return null;
    const data = doc.data() as FirestoreCompetitionDoc;

    const fixturesCount = data.fixturesCount ?? data.fixtureCount ?? (data.hasFixtures ? 1 : 0);
    const hasFixtures = Boolean(data.hasFixtures || fixturesCount > 0);
    const generationStatus: 'generated' | 'not_generated' = hasFixtures ? 'generated' : 'not_generated';

    let totalTeams = 0;
    if (data.leagueId) {
      totalTeams = SEED_CLUBS.filter((c) => c.leagueId === data.leagueId).length || 20;
    } else {
      totalTeams = data.formatConfig?.maxTeams || 32;
    }

    const totalMatchdays = data.totalMatchdays || (data.leagueId ? (data.leagueId.includes('bundesliga') || data.leagueId.includes('ligue-1') ? 17 : 19) : 8);

    const result: Competition = {
      id: doc.id,
      seasonId: data.seasonId,
      leagueId: data.leagueId,
      name: data.name,
      type: data.type as any,
      scheduleMode: data.scheduleMode as any,
      status: (hasFixtures ? 'active' : data.status) as any,
      totalTeams,
      hasFixtures,
      fixtureCount: fixturesCount,
      fixturesCount,
      generationStatus,
      formatConfig: data.formatConfig || {},
      currentMatchday: data.currentMatchday || 1,
      totalMatchdays,
      isMatchdayOpen: data.isMatchdayOpen !== false,
      matchdayOpenedAt: data.matchdayOpenedAt,
      matchdayDurationHours: data.matchdayDurationHours || 30,
      nextMatchdayOpenAt: data.nextMatchdayOpenAt,
      adminOverrideStatus: data.adminOverrideStatus || 'AUTO',
      createdAt: data.createdAt,
    };

    setInCache(cacheKey, result, 30000);
    return result;
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getCompetitionByIdFirestore:', err.message);
    const r = queryGet<any>('SELECT * FROM competitions WHERE id = ?', [competitionId]);
    if (!r) return null;
    let formatConfig: any = {};
    try {
      formatConfig = JSON.parse(r.format_config_json || '{}');
    } catch {}
    const fixtures = queryAll<any>('SELECT id FROM fixtures WHERE competition_id = ?', [r.id]);
    const hasFixtures = fixtures.length > 0;
    const result: Competition = {
      id: r.id,
      seasonId: r.season_id,
      leagueId: r.league_id,
      name: r.name,
      type: r.type,
      scheduleMode: r.schedule_mode,
      status: hasFixtures ? 'active' : r.status,
      totalTeams: formatConfig.totalTeams || (r.league_id ? SEED_CLUBS.filter((c) => c.leagueId === r.league_id).length : 20),
      hasFixtures,
      fixtureCount: fixtures.length,
      fixturesCount: fixtures.length,
      generationStatus: hasFixtures ? 'generated' : 'not_generated',
      formatConfig,
      currentMatchday: 1,
      totalMatchdays: r.league_id ? (r.league_id.includes('bundesliga') || r.league_id.includes('ligue-1') ? 17 : 19) : 8,
      isMatchdayOpen: true,
      matchdayDurationHours: 30,
      adminOverrideStatus: 'AUTO',
      createdAt: r.created_at,
    };
    setInCache(cacheKey, result, 30000);
    return result;
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

  const isCacheableCompQuery =
    Boolean(filter.competitionId) && !targetClubId && !filter.userId;
  const cacheKey = isCacheableCompQuery
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
      // Perform parallel queries for home and away fixtures
      const [homeSnap, awaySnap] = await Promise.all([
        db
          .collection(COLLECTIONS.FIXTURES)
          .where('homeClubId', '==', targetClubId)
          .get(),
        db
          .collection(COLLECTIONS.FIXTURES)
          .where('awayClubId', '==', targetClubId)
          .get(),
      ]);

      const docMap = new Map<string, FirestoreFixtureDoc>();
      homeSnap.docs.forEach((d) => docMap.set(d.id, d.data() as FirestoreFixtureDoc));
      awaySnap.docs.forEach((d) => docMap.set(d.id, d.data() as FirestoreFixtureDoc));

      docs = Array.from(docMap.values());

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
      docs = snap.docs.map((d) => d.data() as FirestoreFixtureDoc);
    }

    // Sort by matchday asc, scheduledAt asc
    docs.sort((a, b) => a.matchday - b.matchday || new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

    if (filter.limit && filter.limit > 0) {
      docs = docs.slice(0, filter.limit);
    }

    // Map club data using SEED_CLUB_MAP instantly
    const fixtures: Fixture[] = docs.map((r) => {
      const homeSeed = SEED_CLUB_MAP.get(r.homeClubId);
      const awaySeed = SEED_CLUB_MAP.get(r.awayClubId);

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
      };
    });

    if (cacheKey && fixtures.length > 0) {
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

    const rows = queryAll<any>(sql, params);
    const fallbackFixtures = rows.map((r) => ({
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
    }));

    if (cacheKey && fallbackFixtures.length > 0) {
      setInCache(cacheKey, fallbackFixtures, 30000);
    }
    return fallbackFixtures;
  }
}

export async function getFixtureByIdFirestore(fixtureId: string, currentUserId?: string): Promise<Fixture | null> {
  const cacheKey = `firestore:fixture:${fixtureId}`;
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

  // 3. Purge all existing fixtures for this competition before writing new ones
  const toDeleteSnap = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', competitionId).get();
  if (!toDeleteSnap.empty) {
    const batchSize = 400;
    for (let i = 0; i < toDeleteSnap.docs.length; i += batchSize) {
      const chunk = toDeleteSnap.docs.slice(i, i + batchSize);
      const batch = db.batch();
      chunk.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
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
    const docRef = db.collection(COLLECTIONS.STANDINGS).doc(competitionId);
    const docSnap = await docRef.get();

    if (docSnap.exists) {
      const data = docSnap.data() as FirestoreStandingsDoc;
      if (Array.isArray(data.rows) && data.rows.length > 0) {
        setInCache(cacheKey, data.rows, 60000);
        return data.rows;
      }
    }

    // Materialized document does not exist yet -> rebuild it
    const rows = await rebuildCompetitionStandingsFirestore(competitionId);
    setInCache(cacheKey, rows, 60000);
    return rows;
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getCompetitionStandingsFirestore:', err.message);
    const rows = fallbackCalculateStandings(competitionId);
    setInCache(cacheKey, rows, 60000);
    return rows;
  }
}

export async function rebuildCompetitionStandingsFirestore(competitionId: string): Promise<StandingsRow[]> {
  const cacheKey = `firestore:standings:${competitionId}`;
  try {
    const db = getFirestoreDb();
    const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
    if (!compDoc.exists) {
      return fallbackCalculateStandings(competitionId);
    }

    const comp = compDoc.data() as FirestoreCompetitionDoc;
    const seasonId = comp.seasonId || 'season-2026-27';
    const formatConfig = comp.formatConfig || {};

    // 1. Fetch participating clubs
    let clubs: Array<{ id: string; name: string; shortName: string; logoUrl: string; managerUsername?: string }> = [];

    const partSnap = await db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where('competitionId', '==', competitionId).get();
    if (!partSnap.empty) {
      const parts = partSnap.docs.map((d) => d.data() as FirestoreCompetitionParticipantDoc);
      const clubIds = parts.map((p) => p.clubId);
      const clubsSnap = await db.collection(COLLECTIONS.CLUBS).where('id', 'in', clubIds.slice(0, 30)).get();
      const clubMap = new Map(clubsSnap.docs.map((d) => [d.id, d.data() as FirestoreClubDoc]));

      clubs = parts.map((p) => {
        const c = clubMap.get(p.clubId);
        return {
          id: p.clubId,
          name: c?.name || p.clubId,
          shortName: c?.shortName || p.clubId.substring(0, 4).toUpperCase(),
          logoUrl: c?.logo || '',
          managerUsername: p.ownerUsername || c?.managerUsername,
        };
      });
    } else if (comp.leagueId) {
      const clubsSnap = await db.collection(COLLECTIONS.CLUBS).where('leagueId', '==', comp.leagueId).where('isActive', '==', true).get();
      clubs = clubsSnap.docs.map((d) => {
        const c = d.data() as FirestoreClubDoc;
        return {
          id: d.id,
          name: c.name,
          shortName: c.shortName,
          logoUrl: c.logo,
          managerUsername: c.managerUsername,
        };
      });
    }

    // 2. Fetch confirmed fixtures
    const fixSnap = await db
      .collection(COLLECTIONS.FIXTURES)
      .where('competitionId', '==', competitionId)
      .where('status', '==', 'CONFIRMED')
      .get();

    const confirmedFixtures = fixSnap.docs
      .map((d) => d.data() as FirestoreFixtureDoc)
      .filter((f) => f.homeScore !== null && f.homeScore !== undefined && f.awayScore !== null && f.awayScore !== undefined)
      .map((f) => ({
        homeClubId: f.homeClubId,
        awayClubId: f.awayClubId,
        homeScore: f.homeScore ?? 0,
        awayScore: f.awayScore ?? 0,
      }));

    const rankedRows = computeAndSortStandings(clubs, confirmedFixtures, formatConfig);

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
    setInCache(cacheKey, rankedRows, 60000);
    return rankedRows;
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] rebuildCompetitionStandingsFirestore:', err.message);
    const rows = fallbackCalculateStandings(competitionId);
    setInCache(cacheKey, rows, 60000);
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
  const db = getFirestoreDb();

  if (!Number.isInteger(homeScore) || homeScore < 0 || !Number.isInteger(awayScore) || awayScore < 0) {
    throw new Error('Scores must be non-negative integers.');
  }

  const fixRef = db.collection(COLLECTIONS.FIXTURES).doc(fixtureId);
  const fixDoc = await fixRef.get();
  if (!fixDoc.exists) {
    throw new Error(`Fixture with ID '${fixtureId}' not found.`);
  }

  const fixture = fixDoc.data() as FirestoreFixtureDoc;
  if (fixture.status === 'CONFIRMED') {
    throw new Error('This match result is already CONFIRMED and cannot be modified.');
  }

  // Enforce Competition Matchday Timer Lock
  if (fixture.competitionId && fixture.matchday) {
    const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(fixture.competitionId).get().catch(() => null);
    if (compDoc && compDoc.exists) {
      const compData = compDoc.data() as FirestoreCompetitionDoc;
      const currentMd = compData.currentMatchday || 1;
      const override = compData.adminOverrideStatus || 'AUTO';

      if (override === 'FORCE_LOCKED' || override === 'PAUSED') {
        throw new Error(`Matchday submissions for ${compData.name} are currently paused or locked by tournament administration.`);
      }

      if (override !== 'FORCE_OPEN') {
        if (fixture.matchday > currentMd) {
          const nextOpen = compData.nextMatchdayOpenAt ? new Date(compData.nextMatchdayOpenAt) : null;
          let unlockMsg = '';
          if (nextOpen && nextOpen.getTime() > Date.now()) {
            const diffMin = Math.round((nextOpen.getTime() - Date.now()) / (60 * 1000));
            const hours = Math.floor(diffMin / 60);
            const mins = diffMin % 60;
            unlockMsg = ` Unlocks in ${hours > 0 ? `${hours}h ` : ''}${mins}m.`;
          }
          throw new Error(`Matchday ${fixture.matchday} is locked. Current active matchday is Matchday ${currentMd}.${unlockMsg}`);
        }
      }
    }
  }

  // Verify ownership
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

  const now = new Date().toISOString();
  const submissionId = `sub-${fixtureId}-${userId}`;
  const subRef = db.collection(COLLECTIONS.RESULT_SUBMISSIONS).doc(submissionId);

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

  await fixRef.update({
    status: newStatus,
    homeScore: confirmedHomeScore,
    awayScore: confirmedAwayScore,
    winnerClubId,
    resultConfirmedAt: confirmedAt,
    updatedAt: now,
  });

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

  invalidateFirestoreCache('firestore:comp');
  return (await getFixtureByIdFirestore(fixtureId, userId))!;
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
  const db = getFirestoreDb();
  let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.DISPUTES);
  if (status) {
    query = query.where('status', '==', status);
  }
  const snap = await query.get();
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

  return disputes;
}

export async function getAllUsersFirestore(): Promise<User[]> {
  const db = getFirestoreDb();
  const snap = await db.collection(COLLECTIONS.USERS).orderBy('createdAt', 'desc').get();
  return snap.docs.map((d) => {
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
}

export async function getAuditLogsFirestore(limit = 50): Promise<AuditLog[]> {
  const db = getFirestoreDb();
  const snap = await db
    .collection(COLLECTIONS.AUDIT_LOGS)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snap.docs.map((d) => {
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

    return snap.docs.map((d) => {
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
  } catch (err: any) {
    console.warn('[FIRESTORE FALLBACK] getUserNotificationsFirestore:', err.message);
    const rows = queryAll<any>(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit]
    );
    return rows.map((r) => {
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
    trackFirestoreRead(COLLECTIONS.FIXTURES, 2, 'getPendingResultsFirestore:fixtures');
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
      trackFirestoreRead(COLLECTIONS.RESULT_SUBMISSIONS, 1, 'getPendingResultsFirestore:submissions');
      const subsSnap = await db.collection(COLLECTIONS.RESULT_SUBMISSIONS).where('fixtureId', 'in', chunk).get();
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



