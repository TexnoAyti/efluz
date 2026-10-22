import { TOP5_CLUBS } from '../constants/top5Clubs';
import type { api } from './api';
import type { Club } from '../types';

// Club identity is public catalog data. Ownership and season statistics still
// come from the club page; search must not wait for those private lookups.
export function initialSearchClubs(): Club[] {
  return TOP5_CLUBS.map(club => ({ ...club, active: true, createdAt: '' }));
}

export function findSearchClubs(clubs: Club[], query: string): Club[] {
  const text = query.trim().toLowerCase();
  if (!text) return [];
  return clubs.filter(club => club.name.toLowerCase().includes(text) || club.shortName?.toLowerCase().includes(text)).slice(0, 5);
}

export async function loadSearchClubs(
  client: Pick<typeof api, 'getLeagues' | 'getLeagueClubs'>,
  seasonId: string,
  onUpdate: (clubs: Club[]) => void,
): Promise<void> {
  const index = new Map(initialSearchClubs().map(club => [club.id, club]));
  onUpdate([...index.values()]);
  const { leagues } = await client.getLeagues();
  await Promise.allSettled(leagues.map(async league => {
    const { clubs } = await client.getLeagueClubs(league.id, seasonId);
    for (const club of clubs) index.set(club.id, club);
    onUpdate([...index.values()]);
  }));
}
