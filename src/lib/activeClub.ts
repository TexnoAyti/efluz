import { Club, Fixture } from '../types';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const key = (userId: string, seasonId: string) => `efl:active-club:v1:${userId}:${seasonId}`;

export function resolveActiveClub(clubs: Club[], fallback: Club | null, userId: string, seasonId: string, storage?: PreferenceStorage): Club | null {
  try {
    const saved = storage?.getItem(key(userId, seasonId));
    const selected = clubs.find((club) => club.id === saved);
    if (selected) return selected;
    if (saved) storage?.removeItem(key(userId, seasonId));
  } catch { /* Storage can be disabled in a WebView. */ }
  return clubs.find((club) => club.id === fallback?.id) || clubs[0] || null;
}

export function saveActiveClub(clubId: string, userId: string, seasonId: string, storage?: PreferenceStorage): void {
  try { storage?.setItem(key(userId, seasonId), clubId); } catch { /* Switching still works without storage. */ }
}

export function fixturesForClub(fixtures: Fixture[], clubId?: string): Fixture[] {
  if (!clubId) return [];
  return fixtures.filter((fixture) => fixture.homeClubId === clubId || fixture.awayClubId === clubId || fixture.homeClub?.id === clubId || fixture.awayClub?.id === clubId);
}
