export type OwnedClubRef = { id: string; leagueId: string };

/** One club is free. An active season pass permits one more in another league. */
export function checkClubClaimLimit(
  ownedClubs: OwnedClubRef[],
  candidate: OwnedClubRef,
  premiumActive: boolean
): 'ALREADY_OWNED' | 'SAME_LEAGUE' | 'LIMIT_REACHED' | 'ALLOWED' {
  if (ownedClubs.some((club) => club.id === candidate.id)) return 'ALREADY_OWNED';
  if (ownedClubs.some((club) => club.leagueId === candidate.leagueId)) return 'SAME_LEAGUE';
  if (ownedClubs.length >= (premiumActive ? 2 : 1)) return 'LIMIT_REACHED';
  return 'ALLOWED';
}
