export interface LeagueAdmissionState {
  enabled: boolean;
  activeLeagueId: string | null;
  leagueOverrides?: Record<string, boolean>;
}

// Explicit per-league controls take precedence over the optional admission queue.
export function isLeagueSelectionOpen(status: LeagueAdmissionState | null, leagueId: string): boolean {
  if (!status) return false;
  const override = status.leagueOverrides?.[leagueId];
  return typeof override === 'boolean' ? override : !status.enabled || status.activeLeagueId === leagueId;
}
