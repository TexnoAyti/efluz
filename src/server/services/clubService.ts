import { queryAll, queryGet, queryRun, dbTransaction } from '../db';
import { Club } from '../../types';

export class ClubConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClubConflictError';
  }
}

export class ClubNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClubNotFoundError';
  }
}

export function getClubsByLeague(leagueId: string, seasonId: string): Club[] {
  const clubs = queryAll<any>(
    `SELECT
        c.*,
        l.id AS league_id,
        l.name AS league_name,
        slc.season_id,
        slc.is_active,
        u.username AS owner_username,
        u.first_name AS owner_first_name,
        cm.user_id AS owner_user_id,
        cm.claimed_at
    FROM season_league_clubs slc
    JOIN clubs c
        ON c.id = slc.club_id
    JOIN leagues l
        ON l.id = slc.league_id
    LEFT JOIN club_memberships cm
        ON cm.club_id = c.id
        AND cm.season_id = slc.season_id
        AND cm.status = 'active'
    LEFT JOIN users u
        ON u.id = cm.user_id
    WHERE
        slc.season_id = ?
        AND slc.league_id = ?
        AND slc.is_active = 1
    ORDER BY c.name;`,
    [seasonId, leagueId]
  );

  return clubs.map((c) => ({
    id: c.id,
    name: c.name,
    shortName: c.short_name,
    country: c.country,
    leagueId: c.league_id,
    leagueName: c.league_name,
    logoUrl: c.logo_url,
    active: Boolean(c.active),
    claimedByUserId: c.owner_user_id || null,
    claimedByUsername: c.owner_username || null,
    owner: c.owner_user_id
      ? {
          userId: c.owner_user_id,
          username: c.owner_username || 'Unknown',
          firstName: c.owner_first_name || 'Player',
          claimedAt: c.claimed_at,
        }
      : null,
    createdAt: c.created_at,
  }));
}

export function getAvailableClubs(seasonId: string): Club[] {
  const clubs = queryAll<any>(
    `SELECT
        c.*,
        l.id AS league_id,
        l.name AS league_name,
        slc.season_id,
        slc.is_active,
        u.username AS owner_username,
        u.first_name AS owner_first_name,
        cm.user_id AS owner_user_id,
        cm.claimed_at
    FROM season_league_clubs slc
    JOIN clubs c
        ON c.id = slc.club_id
    JOIN leagues l
        ON l.id = slc.league_id
    LEFT JOIN club_memberships cm
        ON cm.club_id = c.id
        AND cm.season_id = slc.season_id
        AND cm.status = 'active'
    LEFT JOIN users u
        ON u.id = cm.user_id
    WHERE
        slc.season_id = ?
        AND slc.is_active = 1
    ORDER BY c.name;`,
    [seasonId]
  );

  return clubs.map((c) => ({
    id: c.id,
    name: c.name,
    shortName: c.short_name,
    country: c.country,
    leagueId: c.league_id,
    leagueName: c.league_name,
    logoUrl: c.logo_url,
    active: Boolean(c.active),
    claimedByUserId: c.owner_user_id || null,
    claimedByUsername: c.owner_username || null,
    owner: c.owner_user_id
      ? {
          userId: c.owner_user_id,
          username: c.owner_username || 'Unknown',
          firstName: c.owner_first_name || 'Player',
          claimedAt: c.claimed_at,
        }
      : null,
    createdAt: c.created_at,
  }));
}

export function getClubById(clubId: string, seasonId: string): Club | null {
  const c = queryGet<any>(
    `SELECT c.*,
            l.id as league_id,
            l.name as league_name,
            cm.user_id as owner_user_id,
            u.username as owner_username,
            u.first_name as owner_first_name,
            cm.claimed_at
     FROM clubs c
     LEFT JOIN leagues l ON c.league_id = l.id
     LEFT JOIN club_memberships cm ON c.id = cm.club_id AND cm.season_id = ? AND cm.status = 'active'
     LEFT JOIN users u ON cm.user_id = u.id
     WHERE c.id = ?`,
    [seasonId, clubId]
  );

  if (!c) return null;

  return {
    id: c.id,
    name: c.name,
    shortName: c.short_name,
    country: c.country,
    leagueId: c.league_id,
    logoUrl: c.logo_url,
    active: Boolean(c.active),
    claimedByUserId: c.owner_user_id || null,
    claimedByUsername: c.owner_username || null,
    owner: c.owner_user_id
      ? {
          userId: c.owner_user_id,
          username: c.owner_username || 'Unknown',
          firstName: c.owner_first_name || 'Player',
          claimedAt: c.claimed_at,
        }
      : null,
    createdAt: c.created_at,
  };
}

export function getUserActiveClub(userId: string, seasonId: string): Club | null {
  const membership = queryGet<{ club_id: string }>(
    'SELECT club_id FROM club_memberships WHERE user_id = ? AND season_id = ? AND status = "active"',
    [userId, seasonId]
  );

  if (!membership) return null;
  return getClubById(membership.club_id, seasonId);
}

/**
 * Atomic Club Claim with Database-enforced Unique Constraint & Transactional Locking
 */
export function claimClubAtomic(userId: string, clubId: string, seasonId: string): { success: boolean; club: Club } {
  return dbTransaction(() => {
    // 1. Verify club exists and is an active top-flight member for this season
    const club = queryGet<{ id: string; name: string }>(
      `SELECT c.id, c.name 
       FROM season_league_clubs slc
       JOIN clubs c ON slc.club_id = c.id
       WHERE slc.club_id = ? AND slc.season_id = ? AND slc.is_active = 1`,
      [clubId, seasonId]
    );
    if (!club) {
      throw new ClubNotFoundError(`Club with ID '${clubId}' is not an active top-flight club in season '${seasonId}'.`);
    }

    // 2. Check if user already owns a club in this season
    const existingUserClub = queryGet<{ club_id: string; name: string }>(
      `SELECT cm.club_id, c.name
       FROM club_memberships cm
       JOIN clubs c ON cm.club_id = c.id
       WHERE cm.user_id = ? AND cm.season_id = ? AND cm.status = 'active'`,
      [userId, seasonId]
    );

    if (existingUserClub) {
      if (existingUserClub.club_id === clubId) {
        // Already owns this exact club
        const fullClub = getClubById(clubId, seasonId)!;
        return { success: true, club: fullClub };
      }
      throw new ClubConflictError(
        `You have already selected '${existingUserClub.name}' for this season. Club selection is locked and cannot be changed.`
      );
    }

    // 3. Check if club is already occupied in this season
    const existingOwner = queryGet<{ user_id: string; username: string }>(
      `SELECT cm.user_id, u.username
       FROM club_memberships cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.club_id = ? AND cm.season_id = ? AND cm.status = 'active'`,
      [clubId, seasonId]
    );

    if (existingOwner) {
      throw new ClubConflictError(
        `'${club.name}' has already been claimed by @${existingOwner.username || 'another player'}.`
      );
    }

    // 4. Insert membership record (Protected by UNIQUE(season_id, club_id) constraint in SQLite)
    const membershipId = `cm-${seasonId}-${clubId}`;
    const now = new Date().toISOString();

    try {
      queryRun(
        'INSERT INTO club_memberships (id, season_id, club_id, user_id, claimed_at, status) VALUES (?, ?, ?, ?, ?, "active")',
        [membershipId, seasonId, clubId, userId, now]
      );
    } catch (err: any) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        throw new ClubConflictError(`'${club.name}' has just been claimed by another player.`);
      }
      throw err;
    }

    const fullClub = getClubById(clubId, seasonId)!;
    return { success: true, club: fullClub };
  });
}
