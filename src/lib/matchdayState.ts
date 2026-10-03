export interface MatchdayGate {
  overrideStatus?: string;
  isOpen?: boolean;
  isLocked?: boolean;
  expiresAt?: string | null;
}

export interface MatchdayControlOverview {
  competitionId: string;
  currentMatchday: number;
  updatedAt: string | null;
  totalMatchdays: number;
  rounds: { matchday: number; isOpen: boolean; deadlineAt: string | null; fixtureCount: number; unfinished: { id: string; status: string }[] }[];
}
export type MatchdayControlAction = 'SELECT' | 'OPEN' | 'LOCK' | 'EXTEND' | 'RESTART';

// null means no explicit round rule: the competition's active round applies.
export function resolveMatchdayGate(lock?: MatchdayGate | null, now = Date.now()): boolean | null {
  if (!lock) return null;
  if (lock.overrideStatus === 'FORCE_LOCKED' || lock.overrideStatus === 'PAUSED' || lock.isLocked || lock.isOpen === false) return false;
  if (lock.expiresAt && (!Number.isFinite(Date.parse(lock.expiresAt)) || Date.parse(lock.expiresAt) <= now)) return false;
  if (lock.overrideStatus === 'FORCE_OPEN' || lock.isOpen === true) return true;
  return null;
}
