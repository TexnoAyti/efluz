import type { User } from '../types';
export const ADMIN_LEAGUES = [
  { id: 'league-premier-league', name: 'Premier League', competitionId: 'comp-premier-league-2026' },
  { id: 'league-la-liga', name: 'La Liga', competitionId: 'comp-la-liga-2026' },
  { id: 'league-serie-a', name: 'Serie A', competitionId: 'comp-serie-a-2026' },
  { id: 'league-bundesliga', name: 'Bundesliga', competitionId: 'comp-bundesliga-2026' },
  { id: 'league-ligue-1', name: 'Ligue 1', competitionId: 'comp-ligue-1-2026' },
];
export function isLeagueAdmin(user: Pick<User, 'adminPermissions'>): boolean {
  return user.adminPermissions != null && user.adminPermissions.scope !== 'ALL';
}
export function permittedAdminLeagues(user: Pick<User, 'adminPermissions'>) {
  const permissions = user.adminPermissions;
  if (!isLeagueAdmin(user)) return ADMIN_LEAGUES;
  return ADMIN_LEAGUES.filter(league => Array.isArray(permissions?.leagueIds) && permissions.scope === 'LEAGUES' && permissions.leagueIds.includes(league.id));
}
