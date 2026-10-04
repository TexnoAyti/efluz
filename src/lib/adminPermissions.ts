import type { User } from '../types';
export const ADMIN_LEAGUES = [
  { id: 'league-premier-league', name: 'Premier League', competitionId: 'comp-premier-league-2026', cupCompetitionId: 'comp-fa-cup-2026' },
  { id: 'league-la-liga', name: 'La Liga', competitionId: 'comp-la-liga-2026', cupCompetitionId: 'comp-copa-del-rey-2026' },
  { id: 'league-serie-a', name: 'Serie A', competitionId: 'comp-serie-a-2026', cupCompetitionId: 'comp-coppa-italia-2026' },
  { id: 'league-bundesliga', name: 'Bundesliga', competitionId: 'comp-bundesliga-2026', cupCompetitionId: 'comp-dfb-pokal-2026' },
  { id: 'league-ligue-1', name: 'Ligue 1', competitionId: 'comp-ligue-1-2026', cupCompetitionId: 'comp-coupe-de-france-2026' },
];
export function isLeagueAdmin(user: Pick<User, 'adminPermissions'>): boolean {
  return user.adminPermissions != null && user.adminPermissions.scope !== 'ALL';
}
export function permittedAdminLeagues(user: Pick<User, 'adminPermissions'>) {
  const permissions = user.adminPermissions;
  if (!isLeagueAdmin(user)) return ADMIN_LEAGUES;
  return ADMIN_LEAGUES.filter(league => Array.isArray(permissions?.leagueIds) && permissions.scope === 'LEAGUES' && permissions.leagueIds.includes(league.id));
}

export const MAIN_ADMIN_TELEGRAM_ID = '5209126900';
export function canUseDangerZone(user?: Pick<User, 'id' | 'telegramId' | 'isAdmin' | 'isSuspended'> | null): boolean {
  return Boolean(user?.isAdmin && !user.isSuspended && String(user.telegramId) === MAIN_ADMIN_TELEGRAM_ID && user.id === `user-${MAIN_ADMIN_TELEGRAM_ID}`);
}
export function permittedAdminCompetitionIds(user: Pick<User, 'adminPermissions'>): string[] {
  return permittedAdminLeagues(user).flatMap(league => [league.competitionId, league.cupCompetitionId]);
}
