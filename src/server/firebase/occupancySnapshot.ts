import { queryAll, queryRun, isDatabaseInitialized } from '../db';
import { SEED_CLUBS } from '../db/seed';

export interface OccupancyRecord {
  clubId: string;
  seasonId: string;
  status: 'active';
  claimedByUserId: string;
  claimedAt?: string;
  username?: string;
  displayName?: string;
  updatedAt: string;
}

// In-memory persistent mirror of active season occupancy snapshot
const memoryOccupancySnapshot = new Map<string, OccupancyRecord>(); // key: `${seasonId}_${clubId}`

export function updateOccupancyRecord(record: OccupancyRecord): void {
  const key = `${record.seasonId}_${record.clubId}`;
  memoryOccupancySnapshot.set(key, record);

  try {
    queryRun(
      `INSERT OR REPLACE INTO active_occupancies_cache 
       (club_id, season_id, user_id, username, display_name, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        record.clubId,
        record.seasonId,
        record.claimedByUserId,
        record.username || null,
        record.displayName || null,
        record.status,
        record.updatedAt,
      ]
    );
  } catch {
    // Non-blocking SQLite persistence
  }
}

export function removeOccupancyRecord(seasonId: string, clubId: string): void {
  const key = `${seasonId}_${clubId}`;
  memoryOccupancySnapshot.delete(key);

  try {
    queryRun(
      `DELETE FROM active_occupancies_cache WHERE season_id = ? AND club_id = ?`,
      [seasonId, clubId]
    );
  } catch {}
}

export function getLocalOccupancySnapshot(seasonId = 'season-2026-27'): OccupancyRecord[] {
  // If memory has entries for this season, return them
  const memRecords: OccupancyRecord[] = [];
  for (const [k, v] of memoryOccupancySnapshot.entries()) {
    if (k.startsWith(`${seasonId}_`)) {
      memRecords.push(v);
    }
  }

  if (memRecords.length > 0) {
    return memRecords;
  }

  // Otherwise hydrate from SQLite active_occupancies_cache or club_memberships
  if (!isDatabaseInitialized()) {
    return memRecords;
  }
  try {
    const cachedRows = queryAll<any>(
      `SELECT club_id, season_id, user_id, username, display_name, status, updated_at
       FROM active_occupancies_cache
       WHERE season_id = ? AND status = 'active'`,
      [seasonId]
    );

    if (cachedRows.length > 0) {
      for (const r of cachedRows) {
        const rec: OccupancyRecord = {
          clubId: r.club_id,
          seasonId: r.season_id,
          status: 'active',
          claimedByUserId: r.user_id,
          username: r.username || undefined,
          displayName: r.display_name || undefined,
          updatedAt: r.updated_at,
        };
        memoryOccupancySnapshot.set(`${seasonId}_${r.club_id}`, rec);
        memRecords.push(rec);
      }
      return memRecords;
    }

    // Baseline fallback: check club_memberships directly
    const memRows = queryAll<any>(
      `SELECT cm.club_id, cm.season_id, cm.user_id, u.username, u.first_name, u.last_name, cm.claimed_at as updated_at
       FROM club_memberships cm
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE cm.season_id = ? AND cm.status = 'active'`,
      [seasonId]
    );

    for (const r of memRows) {
      const displayName = `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.username || r.user_id;
      const rec: OccupancyRecord = {
        clubId: r.club_id,
        seasonId: r.season_id,
        status: 'active',
        claimedByUserId: r.user_id,
        username: r.username || undefined,
        displayName,
        updatedAt: r.updated_at || new Date().toISOString(),
      };
      memoryOccupancySnapshot.set(`${seasonId}_${r.club_id}`, rec);
      memRecords.push(rec);
    }
  } catch (err) {
    console.warn('[OCCUPANCY_SNAPSHOT] SQLite hydration error:', err);
  }

  return memRecords;
}

export function syncOccupanciesFromFirestoreDocs(
  seasonId: string,
  occupancies: Array<{ clubId: string; userId: string; username?: string; displayName?: string }>
): void {
  const now = new Date().toISOString();
  for (const occ of occupancies) {
    updateOccupancyRecord({
      clubId: occ.clubId,
      seasonId,
      status: 'active',
      claimedByUserId: occ.userId,
      username: occ.username,
      displayName: occ.displayName,
      updatedAt: now,
    });
  }
}

export function isClubOccupiedLocally(seasonId: string, clubId: string): boolean {
  const snapshot = getLocalOccupancySnapshot(seasonId);
  return snapshot.some((r) => r.clubId === clubId);
}

export function loadSnapshotFromFile(): void {
  try {
    getLocalOccupancySnapshot('season-2026-27');
  } catch (err: any) {
    console.warn('[OCCUPANCY_SNAPSHOT] Load error:', err.message);
  }
}

export function getUserOccupiedClubIdLocally(seasonId: string, userId: string): string | null {
  const snapshot = getLocalOccupancySnapshot(seasonId);
  const found = snapshot.find((r) => r.claimedByUserId === userId);
  return found ? found.clubId : null;
}

export function getClubOccupantUserIdLocally(seasonId: string, clubId: string): string | null {
  const snapshot = getLocalOccupancySnapshot(seasonId);
  const found = snapshot.find((r) => r.clubId === clubId);
  return found ? found.claimedByUserId : null;
}
