import { Firestore, FieldValue } from 'firebase-admin/firestore';
import { getFirestoreDb } from './admin';
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
// SEASONS & LEAGUES
// ----------------------------------------------------

export async function getActiveSeasonFirestore(): Promise<Season | null> {
  const db = getFirestoreDb();
  const snap = await db.collection(COLLECTIONS.SEASONS).where('status', '==', 'ACTIVE').limit(1).get();
  if (snap.empty) {
    // Fallback: search season-2026-27
    const doc = await db.collection(COLLECTIONS.SEASONS).doc('season-2026-27').get();
    if (doc.exists) {
      const data = doc.data() as FirestoreSeasonDoc;
      return {
        id: doc.id,
        name: data.name,
        status: (data.status?.toLowerCase() as SeasonStatus) || 'active',
        startDate: data.startDate,
        endDate: data.endDate,
        createdAt: data.createdAt,
      };
    }
    return null;
  }
  const doc = snap.docs[0];
  const data = doc.data() as FirestoreSeasonDoc;
  return {
    id: doc.id,
    name: data.name,
    status: (data.status?.toLowerCase() as SeasonStatus) || 'active',
    startDate: data.startDate,
    endDate: data.endDate,
    createdAt: data.createdAt,
  };
}

export async function getAllSeasonsFirestore(): Promise<Season[]> {
  const db = getFirestoreDb();
  const snap = await db.collection(COLLECTIONS.SEASONS).get();
  return snap.docs.map((doc) => {
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
}

export async function getAllLeaguesFirestore(): Promise<League[]> {
  const db = getFirestoreDb();
  const snap = await db.collection(COLLECTIONS.LEAGUES).orderBy('tier', 'asc').get();
  return snap.docs.map((doc) => {
    const data = doc.data() as FirestoreLeagueDoc;
    return {
      id: doc.id,
      name: data.name,
      country: data.country,
      tier: data.tier,
      logoUrl: data.logo,
      createdAt: data.createdAt,
    };
  });
}

// ----------------------------------------------------
// CLUBS & MEMBERSHIPS (ATOMIC CLAIMING)
// ----------------------------------------------------

export async function getClubsByLeagueFirestore(
  leagueId: string,
  seasonId = 'season-2026-27',
  currentUserId?: string
): Promise<Club[]> {
  const db = getFirestoreDb();

  // 1. Fetch clubs in this league
  const clubsSnap = await db
    .collection(COLLECTIONS.CLUBS)
    .where('leagueId', '==', leagueId)
    .where('isActive', '==', true)
    .get();

  // 2. Fetch all active occupancies and memberships for this season
  const [occupanciesSnap, membershipsSnap] = await Promise.all([
    db
      .collection(COLLECTIONS.CLUB_OCCUPANCIES)
      .where('seasonId', '==', seasonId)
      .where('status', '==', 'active')
      .get(),
    db
      .collection(COLLECTIONS.CLUB_MEMBERSHIPS)
      .where('seasonId', '==', seasonId)
      .where('status', '==', 'active')
      .get(),
  ]);

  const clubOccupancyMap = new Map<string, { userId: string }>();

  // Occupancies collection is primary source
  for (const doc of occupanciesSnap.docs) {
    const data = doc.data();
    if (data.clubId && data.userId) {
      clubOccupancyMap.set(data.clubId, { userId: data.userId });
    }
  }

  // Memberships collection as fallback/supplement
  for (const doc of membershipsSnap.docs) {
    const m = doc.data() as FirestoreClubMembershipDoc;
    if (m.clubId && m.userId && !clubOccupancyMap.has(m.clubId)) {
      clubOccupancyMap.set(m.clubId, { userId: m.userId });
    }
  }

  // 3. Look up user details for manager usernames directly by document ID
  const userIds = Array.from(new Set(Array.from(clubOccupancyMap.values()).map((o) => o.userId)));
  const usernameMap = new Map<string, string>();
  if (userIds.length > 0) {
    const userDocPromises = userIds.map((uid) => db.collection(COLLECTIONS.USERS).doc(uid).get());
    const userDocs = await Promise.all(userDocPromises);
    for (const uDoc of userDocs) {
      if (uDoc.exists) {
        const uData = uDoc.data() as FirestoreUserDoc;
        usernameMap.set(uDoc.id, uData.username || uData.firstName || uDoc.id);
      }
    }
  }

  const clubs: Club[] = clubsSnap.docs.map((doc) => {
    const data = doc.data() as FirestoreClubDoc;
    const occupancy = clubOccupancyMap.get(doc.id);
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
      id: doc.id,
      name: data.name,
      shortName: data.shortName,
      leagueId: data.leagueId,
      country: data.country,
      logoUrl: data.logo,
      active: data.isActive,
      createdAt: data.createdAt,
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

  return clubs.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAvailableClubsFirestore(
  seasonId = 'season-2026-27',
  currentUserId?: string
): Promise<Club[]> {
  const db = getFirestoreDb();

  // 1. Fetch all active clubs
  const clubsSnap = await db.collection(COLLECTIONS.CLUBS).where('isActive', '==', true).get();

  // 2. Fetch all active occupancies
  const [occupanciesSnap, membershipsSnap] = await Promise.all([
    db
      .collection(COLLECTIONS.CLUB_OCCUPANCIES)
      .where('seasonId', '==', seasonId)
      .where('status', '==', 'active')
      .get(),
    db
      .collection(COLLECTIONS.CLUB_MEMBERSHIPS)
      .where('seasonId', '==', seasonId)
      .where('status', '==', 'active')
      .get(),
  ]);

  const occupiedClubIds = new Set<string>();
  for (const doc of occupanciesSnap.docs) {
    const data = doc.data();
    if (data.clubId) occupiedClubIds.add(data.clubId);
  }
  for (const doc of membershipsSnap.docs) {
    const data = doc.data();
    if (data.clubId) occupiedClubIds.add(data.clubId);
  }

  // Filter for unoccupied clubs
  const availableClubs: Club[] = [];
  for (const doc of clubsSnap.docs) {
    if (!occupiedClubIds.has(doc.id)) {
      const data = doc.data() as FirestoreClubDoc;
      availableClubs.push({
        id: doc.id,
        name: data.name,
        shortName: data.shortName,
        leagueId: data.leagueId,
        country: data.country,
        logoUrl: data.logo,
        active: data.isActive,
        createdAt: data.createdAt,
        isTaken: false,
        isCurrentUserClub: false,
        occupancy: {
          status: 'available',
        },
      });
    }
  }

  return availableClubs.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getClubByIdFirestore(
  clubId: string,
  seasonId = 'season-2026-27',
  currentUserId?: string
): Promise<Club | null> {
  const db = getFirestoreDb();
  const doc = await db.collection(COLLECTIONS.CLUBS).doc(clubId).get();
  if (!doc.exists) return null;

  const data = doc.data() as FirestoreClubDoc;

  // Check occupancy from club_occupancies or club_memberships
  let occUserId: string | null = null;
  const occDoc = await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_${clubId}`).get();
  if (occDoc.exists && occDoc.data()?.status === 'active') {
    occUserId = occDoc.data()!.userId;
  } else {
    const memDoc = await db.collection(COLLECTIONS.CLUB_MEMBERSHIPS).doc(`${seasonId}_${clubId}`).get();
    if (memDoc.exists && memDoc.data()?.status === 'active') {
      occUserId = memDoc.data()!.userId;
    } else {
      const userMemSnap = await db
        .collection(COLLECTIONS.USER_MEMBERSHIPS)
        .where('seasonId', '==', seasonId)
        .where('clubId', '==', clubId)
        .where('status', '==', 'active')
        .limit(1)
        .get();
      if (!userMemSnap.empty) {
        occUserId = userMemSnap.docs[0].data().userId;
      }
    }
  }

  let isTaken = false;
  let managerUsername: string | undefined;
  let isCurrentUserClub = false;

  if (occUserId) {
    isTaken = true;
    isCurrentUserClub = Boolean(currentUserId && currentUserId === occUserId);
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(occUserId).get();
    if (userDoc.exists) {
      managerUsername = (userDoc.data() as FirestoreUserDoc).username;
    }
  }

  const occupancyStatus: 'owned' | 'occupied' | 'available' = isCurrentUserClub
    ? 'owned'
    : isTaken
    ? 'occupied'
    : 'available';

  return {
    id: doc.id,
    name: data.name,
    shortName: data.shortName,
    leagueId: data.leagueId,
    country: data.country,
    logoUrl: data.logo,
    active: data.isActive,
    createdAt: data.createdAt,
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
}

export async function getUserActiveClubFirestore(userId: string, seasonId = 'season-2026-27'): Promise<Club | null> {
  const db = getFirestoreDb();

  // 1. Try USER_MEMBERSHIPS doc (${seasonId}_${userId})
  const userMemDoc = await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${userId}`).get();
  if (userMemDoc.exists && userMemDoc.data()?.status === 'active') {
    const clubId = userMemDoc.data()!.clubId;
    return getClubByIdFirestore(clubId, seasonId, userId);
  }

  // 2. Query CLUB_OCCUPANCIES for this user in this season
  const occSnap = await db
    .collection(COLLECTIONS.CLUB_OCCUPANCIES)
    .where('userId', '==', userId)
    .where('seasonId', '==', seasonId)
    .where('status', '==', 'active')
    .limit(1)
    .get();

  if (!occSnap.empty) {
    const clubId = occSnap.docs[0].data().clubId;
    return getClubByIdFirestore(clubId, seasonId, userId);
  }

  // 3. Query CLUB_MEMBERSHIPS for this user in this season
  const memSnap = await db
    .collection(COLLECTIONS.CLUB_MEMBERSHIPS)
    .where('userId', '==', userId)
    .where('seasonId', '==', seasonId)
    .where('status', '==', 'active')
    .limit(1)
    .get();

  if (!memSnap.empty) {
    const clubId = memSnap.docs[0].data().clubId;
    return getClubByIdFirestore(clubId, seasonId, userId);
  }

  // 4. Fallback check CLUBS collection
  const clubSnap = await db
    .collection(COLLECTIONS.CLUBS)
    .where('claimedByUserId', '==', userId)
    .limit(1)
    .get();

  if (!clubSnap.empty) {
    return getClubByIdFirestore(clubSnap.docs[0].id, seasonId, userId);
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

  return claimResult;
}

// ----------------------------------------------------
// COMPETITIONS & FIXTURES
// ----------------------------------------------------

export async function getAllCompetitionsFirestore(seasonId = 'season-2026-27'): Promise<Competition[]> {
  const db = getFirestoreDb();
  let snap = await db
    .collection(COLLECTIONS.COMPETITIONS)
    .where('seasonId', '==', seasonId)
    .get();

  if (snap.empty) {
    snap = await db.collection(COLLECTIONS.COMPETITIONS).get();
  }

  const competitions = await Promise.all(
    snap.docs.map(async (doc) => {
      const data = doc.data() as FirestoreCompetitionDoc;
      const fixturesSnap = await db
        .collection(COLLECTIONS.FIXTURES)
        .where('competitionId', '==', doc.id)
        .get();

      const fixturesCount = fixturesSnap.size;
      const hasFixtures = fixturesCount > 0;
      const generationStatus: 'generated' | 'not_generated' = hasFixtures ? 'generated' : 'not_generated';

      let totalTeams = 0;
      if (data.leagueId) {
        const clubsInLeagueSnap = await db
          .collection(COLLECTIONS.CLUBS)
          .where('leagueId', '==', data.leagueId)
          .where('isActive', '==', true)
          .get();
        totalTeams = clubsInLeagueSnap.size;
      } else {
        const participantsSnap = await db
          .collection(COLLECTIONS.COMPETITION_PARTICIPANTS)
          .where('competitionId', '==', doc.id)
          .get();
        totalTeams = participantsSnap.size || data.formatConfig?.maxTeams || 0;
      }

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
        createdAt: data.createdAt,
      };
    })
  );

  return competitions;
}

export async function getCompetitionByIdFirestore(competitionId: string): Promise<Competition | null> {
  const db = getFirestoreDb();
  const doc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
  if (!doc.exists) return null;
  const data = doc.data() as FirestoreCompetitionDoc;

  const fixturesSnap = await db
    .collection(COLLECTIONS.FIXTURES)
    .where('competitionId', '==', doc.id)
    .get();

  const fixturesCount = fixturesSnap.size;
  const hasFixtures = fixturesCount > 0;
  const generationStatus: 'generated' | 'not_generated' = hasFixtures ? 'generated' : 'not_generated';

  let totalTeams = 0;
  if (data.leagueId) {
    const clubsInLeagueSnap = await db
      .collection(COLLECTIONS.CLUBS)
      .where('leagueId', '==', data.leagueId)
      .where('isActive', '==', true)
      .get();
    totalTeams = clubsInLeagueSnap.size;
  } else {
    const participantsSnap = await db
      .collection(COLLECTIONS.COMPETITION_PARTICIPANTS)
      .where('competitionId', '==', doc.id)
      .get();
    totalTeams = participantsSnap.size || data.formatConfig?.maxTeams || 0;
  }

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
    createdAt: data.createdAt,
  };
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
  const db = getFirestoreDb();
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

  // Batch load clubs for enrichment
  const clubIds = new Set<string>();
  for (const f of docs) {
    if (f.homeClubId && f.homeClubId !== 'TBD') clubIds.add(f.homeClubId);
    if (f.awayClubId && f.awayClubId !== 'TBD') clubIds.add(f.awayClubId);
  }

  const clubMap = new Map<string, FirestoreClubDoc>();
  if (clubIds.size > 0) {
    const clubsSnap = await db.collection(COLLECTIONS.CLUBS).get();
    for (const cDoc of clubsSnap.docs) {
      if (clubIds.has(cDoc.id)) {
        clubMap.set(cDoc.id, cDoc.data() as FirestoreClubDoc);
      }
    }
  }

  return docs.map((r) => {
    const homeClubData = clubMap.get(r.homeClubId);
    const awayClubData = clubMap.get(r.awayClubId);

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
        name: homeClubData?.name || (r.homeClubId === 'TBD' ? 'TBD' : r.homeClubId),
        shortName: homeClubData?.shortName || (r.homeClubId === 'TBD' ? 'TBD' : r.homeClubId),
        country: homeClubData?.country || '',
        leagueId: homeClubData?.leagueId || '',
        logoUrl: homeClubData?.logo || '',
        active: true,
        createdAt: '',
      },
      awayClub: {
        id: r.awayClubId || 'TBD',
        name: awayClubData?.name || (r.awayClubId === 'TBD' ? 'TBD' : r.awayClubId),
        shortName: awayClubData?.shortName || (r.awayClubId === 'TBD' ? 'TBD' : r.awayClubId),
        country: awayClubData?.country || '',
        leagueId: awayClubData?.leagueId || '',
        logoUrl: awayClubData?.logo || '',
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
}

export async function getFixtureByIdFirestore(fixtureId: string, currentUserId?: string): Promise<Fixture | null> {
  const db = getFirestoreDb();
  const doc = await db.collection(COLLECTIONS.FIXTURES).doc(fixtureId).get();
  if (!doc.exists) return null;

  const r = doc.data() as FirestoreFixtureDoc;

  // Enrich with home and away clubs
  const homeDoc = await db.collection(COLLECTIONS.CLUBS).doc(r.homeClubId).get();
  const awayDoc = await db.collection(COLLECTIONS.CLUBS).doc(r.awayClubId).get();
  const homeClubData = homeDoc.exists ? (homeDoc.data() as FirestoreClubDoc) : null;
  const awayClubData = awayDoc.exists ? (awayDoc.data() as FirestoreClubDoc) : null;

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
      name: homeClubData?.name || r.homeClubId,
      shortName: homeClubData?.shortName || r.homeClubId,
      country: homeClubData?.country || '',
      leagueId: homeClubData?.leagueId || '',
      logoUrl: homeClubData?.logo || '',
      active: true,
      createdAt: '',
    },
    awayClub: {
      id: r.awayClubId || 'TBD',
      name: awayClubData?.name || r.awayClubId,
      shortName: awayClubData?.shortName || r.awayClubId,
      country: awayClubData?.country || '',
      leagueId: awayClubData?.leagueId || '',
      logoUrl: awayClubData?.logo || '',
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

  // 2. Generate Berger Round Robin Matches
  const teams = [...clubIds];
  if (teams.length % 2 !== 0) {
    teams.push('BYE');
  }

  const numTeams = teams.length;
  const numRounds = numTeams - 1;
  const halfSize = numTeams / 2;

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

  // Leg 1 (Matchdays 1 to numRounds)
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

  // Leg 2 (Return Fixtures: Reverse Home/Away)
  const totalRounds = numRounds * 2;
  for (let round = 0; round < numRounds; round++) {
    const matchday = numRounds + round + 1;
    const matchDate = new Date(startDate.getTime() + (numRounds + round) * 7 * 24 * 60 * 60 * 1000).toISOString();

    const leg1Matches = generatedFixtures.filter((f) => f.matchday === round + 1);
    for (const leg1 of leg1Matches) {
      const homeSlug = leg1.awayClubId.replace('club-', '');
      const awaySlug = leg1.homeClubId.replace('club-', '');
      const id = `fix-${competitionId}-md${matchday}-${homeSlug}-vs-${awaySlug}`;

      generatedFixtures.push({
        id,
        competitionId,
        competitionName: comp.name,
        seasonId: comp.seasonId,
        matchday,
        roundName: `Matchday ${matchday}`,
        homeClubId: leg1.awayClubId, // Reversed
        awayClubId: leg1.homeClubId, // Reversed
        scheduledAt: matchDate,
        status: 'SCHEDULED',
        createdAt: now,
        updatedAt: now,
      });
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
    // Allow Firestore collection index to settle
    await new Promise((resolve) => setTimeout(resolve, 600));
    verifySnap = await db.collection(COLLECTIONS.FIXTURES).where('competitionId', '==', competitionId).get();
  }
  if (verifySnap.size !== generatedFixtures.length) {
    throw new Error(
      `FIXTURE_PERSISTENCE_FAILED: Expected ${generatedFixtures.length} fixtures, but Firestore has ${verifySnap.size}.`
    );
  }

  // 6. Update competition document in Firestore with persistent status
  await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).update({
    status: 'active',
    hasFixtures: true,
    fixtureCount: verifySnap.size,
    fixturesCount: verifySnap.size,
    generationStatus: 'generated',
    updatedAt: now,
  });

  return { generated: verifySnap.size, matchdays: totalRounds };
}

// ----------------------------------------------------
// STANDINGS CALCULATION (FIRESTORE)
// ----------------------------------------------------

export async function calculateCompetitionStandingsFirestore(competitionId: string): Promise<StandingsRow[]> {
  const db = getFirestoreDb();
  const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
  if (!compDoc.exists) return [];

  const comp = compDoc.data() as FirestoreCompetitionDoc;
  const formatConfig = comp.formatConfig || {};
  const pointsForWin = formatConfig.pointsForWin ?? 3;
  const pointsForDraw = formatConfig.pointsForDraw ?? 1;
  const pointsForLoss = formatConfig.pointsForLoss ?? 0;
  const tieBreakers = formatConfig.tieBreakers ?? ['points', 'goalDifference', 'goalsFor', 'headToHead'];

  // 1. Fetch participating clubs
  let clubs: Array<{ id: string; name: string; shortName: string; logoUrl: string; managerUsername?: string }> = [];

  const partSnap = await db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS).where('competitionId', '==', competitionId).get();
  if (!partSnap.empty) {
    const clubIds = partSnap.docs.map((d) => (d.data() as FirestoreCompetitionParticipantDoc).clubId);
    const clubsSnap = await db.collection(COLLECTIONS.CLUBS).where('id', 'in', clubIds.slice(0, 30)).get();
    clubs = clubsSnap.docs.map((d) => {
      const c = d.data() as FirestoreClubDoc;
      return { id: d.id, name: c.name, shortName: c.shortName, logoUrl: c.logo };
    });
  } else if (comp.leagueId) {
    const clubsSnap = await db.collection(COLLECTIONS.CLUBS).where('leagueId', '==', comp.leagueId).where('isActive', '==', true).get();
    clubs = clubsSnap.docs.map((d) => {
      const c = d.data() as FirestoreClubDoc;
      return { id: d.id, name: c.name, shortName: c.shortName, logoUrl: c.logo };
    });
  }

  // 2. Fetch confirmed fixtures
  const fixSnap = await db
    .collection(COLLECTIONS.FIXTURES)
    .where('competitionId', '==', competitionId)
    .where('status', '==', 'CONFIRMED')
    .get();

  const confirmedFixtures = fixSnap.docs.map((d) => d.data() as FirestoreFixtureDoc);

  // 3. Calculate rows
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

  // Sort standings
  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.clubName.localeCompare(b.clubName);
  });

  return rows.map((r, index) => ({
    position: index + 1,
    clubId: r.clubId,
    clubName: r.clubName,
    shortName: r.shortName,
    logoUrl: r.logoUrl,
    managerUsername: r.managerUsername,
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

  return (await getFixtureByIdFirestore(fixtureId, userId))!;
}

// ----------------------------------------------------
// USERS & TELEGRAM AUTH (FIRESTORE)
// ----------------------------------------------------

export async function getOrCreateTelegramUserFirestore(tgUser: {
  id: number | string;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}): Promise<User> {
  const db = getFirestoreDb();
  const telegramId = String(tgUser.id);
  const docId = `user-${telegramId}`;
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
  if (!verifyDoc.exists) {
    throw new Error(`USER_PERSISTENCE_FAILED: Failed to verify persisted user document at '${COLLECTIONS.USERS}/${docId}' in Firestore.`);
  }

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

export async function getUserByIdFirestore(userId: string): Promise<User | null> {
  const db = getFirestoreDb();
  const doc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
  if (!doc.exists) return null;
  const data = doc.data() as FirestoreUserDoc;
  return {
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
}

export async function getOrCreateDevUserFirestore(devUserId: string): Promise<User> {
  const db = getFirestoreDb();
  const now = new Date().toISOString();
  const docRef = db.collection(COLLECTIONS.USERS).doc(devUserId);
  const doc = await docRef.get();

  if (doc.exists) {
    return doc.data() as User;
  }

  const isAdmin = devUserId.includes('admin');
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
  const db = getFirestoreDb();
  const now = new Date().toISOString();
  await db.collection(COLLECTIONS.NOTIFICATIONS).add({
    userId,
    type,
    title,
    message,
    data: data || null,
    isRead: false,
    createdAt: now,
  });
}

export async function getUserNotificationsFirestore(userId: string, limit = 20): Promise<Notification[]> {
  const db = getFirestoreDb();
  const snap = await db
    .collection(COLLECTIONS.NOTIFICATIONS)
    .where('userId', '==', userId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  const validTypes: Array<Notification['type']> = [
    'MATCH_SCHEDULED',
    'RESULT_SUBMITTED',
    'RESULT_CONFIRMED',
    'DISPUTE_OPENED',
    'DISPUTE_RESOLVED',
    'SYSTEM',
  ];

  return snap.docs.map((d) => {
    const data = d.data() as FirestoreNotificationDoc;
    const notifType = validTypes.includes(data.type as any) ? (data.type as Notification['type']) : 'SYSTEM';
    return {
      id: d.id,
      userId: data.userId,
      type: notifType,
      title: data.title,
      message: data.message,
      isRead: data.isRead,
      createdAt: data.createdAt,
    };
  });
}

export async function markNotificationsReadFirestore(userId: string): Promise<void> {
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
}

