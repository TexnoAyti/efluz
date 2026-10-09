import {
  getClubsByLeagueFirestore,
  getAvailableClubsFirestore,
  getClubByIdFirestore,
  getUserActiveClubFirestore,
  claimClubAtomicFirestore,
  ClubConflictError,
  ClubNotFoundError,
} from '../firebase/firestoreStore';
import { Club } from '../../types';

export { ClubConflictError, ClubNotFoundError };

/**
 * Service wrapper for fetching clubs by league (authoritative Firestore source of truth)
 */
export async function getClubsByLeague(
  leagueId: string,
  seasonId = 'season-2026-27',
  currentUserId?: string
): Promise<Club[]> {
  return await getClubsByLeagueFirestore(leagueId, seasonId, currentUserId);
}

/**
 * Service wrapper for fetching available clubs (authoritative Firestore source of truth)
 */
export async function getAvailableClubs(
  seasonId = 'season-2026-27',
  currentUserId?: string
): Promise<Club[]> {
  return await getAvailableClubsFirestore(seasonId, currentUserId);
}

/**
 * Service wrapper for fetching a club by ID with occupancy metadata (Firestore)
 */
export async function getClubById(
  clubId: string,
  seasonId = 'season-2026-27',
  currentUserId?: string
): Promise<Club | null> {
  return await getClubByIdFirestore(clubId, seasonId, currentUserId);
}

/**
 * Service wrapper for getting user's active club in the specified season (Firestore)
 */
export async function getUserActiveClub(
  userId: string,
  seasonId = 'season-2026-27'
): Promise<Club | null> {
  return await getUserActiveClubFirestore(userId, seasonId);
}

/**
 * Atomic Club Claim with Firestore Transaction Locking
 * Guarantees 1 user = max 1 club per season AND 1 club = max 1 user per season.
 */
export async function claimClubAtomic(
  userId: string,
  clubId: string,
  seasonId = 'season-2026-27'
): Promise<{ success: boolean; club: Club }> {
  return await claimClubAtomicFirestore(userId, clubId, seasonId);
}
