import { queryAll, queryRun } from '../db';
import { SEED_CLUBS } from '../db/seed';
import { LEGACY_TEST_USER_IDS } from '../auth/telegramAuth';

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

const memoryOccupancySnapshot = new Map<string, OccupancyRecord>();

export function updateOccupancyRecord(record: OccupancyRecord): void {
  if (LEGACY_TEST_USER_IDS.has(record.claimedByUserId)) return;
  const key = `${record.seasonId}_${record.clubId}`;
  memoryOccupancySnapshot.set(key, record);
  try {
    queryRun(`INSERT OR REPLACE INTO active_occupancies_cache
      (club_id, season_id, user_id, username, display_name, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [record.clubId, record.seasonId, record.claimedByUserId, record.username || null, record.displayName || null, record.status, record.updatedAt]);
  } catch {}
}

export function removeOccupancyRecord(seasonId: string, clubId: string): void {
  memoryOccupancySnapshot.delete(`${seasonId}_${clubId}`);
  try { queryRun('DELETE FROM active_occupancies_cache WHERE season_id = ? AND club_id = ?', [seasonId, clubId]); } catch {}
}

export function getLocalOccupancySnapshot(seasonId = 'season-2026-27'): OccupancyRecord[] {
  const memRecords = Array.from(memoryOccupancySnapshot.entries())
    .filter(([k]) => k.startsWith(`${seasonId}_`))
    .map(([, v]) => v)
    .filter((v) => !LEGACY_TEST_USER_IDS.has(v.claimedByUserId));
  if (memRecords.length > 0) return memRecords;

  try {
    const cachedRows = queryAll<any>(`SELECT club_id, season_id, user_id, username, display_name, status, updated_at
      FROM active_occupancies_cache WHERE season_id = ? AND status = 'active'`, [seasonId]);
    if (cachedRows.length > 0) {
      const filtered = cachedRows.filter((r) => !LEGACY_TEST_USER_IDS.has(String(r.user_id)));
      for (const r of filtered) {
        const rec: OccupancyRecord = { clubId: r.club_id, seasonId: r.season_id, status: 'active', claimedByUserId: r.user_id, username: r.username || undefined, displayName: r.display_name || undefined, updatedAt: r.updated_at };
        memoryOccupancySnapshot.set(`${seasonId}_${r.club_id}`, rec);
        memRecords.push(rec);
      }
      if (filtered.length > 0) return filtered.map((r) => ({ clubId: r.club_id, seasonId: r.season_id, status: 'active', claimedByUserId: r.user_id, username: r.username || undefined, displayName: r.display_name || undefined, updatedAt: r.updated_at }));
    }

    const memRows = queryAll<any>(`SELECT cm.club_id, cm.season_id, cm.user_id, u.username, u.first_name, u.last_name, cm.claimed_at as updated_at
      FROM club_memberships cm LEFT JOIN users u ON cm.user_id = u.id
      WHERE cm.season_id = ? AND cm.status = 'active'`, [seasonId]);
    for (const r of memRows) {
      if (LEGACY_TEST_USER_IDS.has(String(r.user_id))) continue;
      const displayName = `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.username || r.user_id;
      const rec: OccupancyRecord = { clubId: r.club_id, seasonId: r.season_id, status: 'active', claimedByUserId: r.user_id, username: r.username || undefined, displayName, updatedAt: r.updated_at || new Date().toISOString() };
      memoryOccupancySnapshot.set(`${seasonId}_${r.club_id}`, rec);
      memRecords.push(rec);
    }
  } catch (err) { console.warn('[OCCUPANCY_SNAPSHOT] SQLite hydration error:', err); }
  return memRecords;
}

export function syncOccupanciesFromFirestoreDocs(seasonId: string, occupancies: Array<{ clubId: string; userId: string; username?: string; displayName?: string }>): void {
  const now = new Date().toISOString();
  for (const occ of occupancies) {
    if (LEGACY_TEST_USER_IDS.has(String(occ.userId))) continue;
    updateOccupancyRecord({ clubId: occ.clubId, seasonId, status: 'active', claimedByUserId: occ.userId, username: occ.username, displayName: occ.displayName, updatedAt: now });
  }
}

export function isClubOccupiedLocally(seasonId: string, clubId: string): boolean { return getLocalOccupancySnapshot(seasonId).some((r) => r.clubId === clubId); }
export function loadSnapshotFromFile(): void { try { getLocalOccupancySnapshot('season-2026-27'); } catch {} }
export function getUserOccupiedClubIdLocally(seasonId: string, userId: string): string | null { const found = getLocalOccupancySnapshot(seasonId).find((r) => r.claimedByUserId === userId); return found?.clubId || null; }
export function getClubOccupantUserIdLocally(seasonId: string, clubId: string): string | null { const found = getLocalOccupancySnapshot(seasonId).find((r) => r.clubId === clubId); return found?.claimedByUserId || null; }
