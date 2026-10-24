/** Season-specific withdrawal. Retain stored clubs/results for history and recovery. */
export const CURRENT_SEASON_ID = 'season-2026-27';
const WITHDRAWN_COMPETITIONS = new Set([
  'comp-ligue-1-2026', 'comp-coupe-de-france-2026',
  'comp-trophee-champions-2026', 'comp-trophee-des-champions-2026',
]);
export function isSeasonLeagueEnabled(leagueId: string | undefined, seasonId = CURRENT_SEASON_ID): boolean {
  return seasonId !== CURRENT_SEASON_ID || !['league-ligue-1', 'league-ligue1'].includes(leagueId || '');
}
export function isSeasonCompetitionEnabled(competitionId: string | undefined, seasonId = CURRENT_SEASON_ID): boolean {
  return seasonId !== CURRENT_SEASON_ID || !WITHDRAWN_COMPETITIONS.has(competitionId || '');
}
export function filterSeasonFixtures<T extends { competitionId?: string; seasonId?: string }>(fixtures: T[], seasonId = CURRENT_SEASON_ID): T[] {
  return fixtures.filter(f => isSeasonCompetitionEnabled(f.competitionId, f.seasonId || seasonId));
}
export function assertSeasonCompetitionEnabled(competitionId: string, seasonId = CURRENT_SEASON_ID): void {
  if (!isSeasonCompetitionEnabled(competitionId, seasonId)) throw Object.assign(
    new Error('Bu turnir joriy mavsumdan olib tashlangan.'),
    {code: 'COMPETITION_WITHDRAWN', status: 409, statusCode: 409});
}
export function assertSeasonLeagueEnabled(leagueId: string | undefined, seasonId = CURRENT_SEASON_ID): void {
  if (!isSeasonLeagueEnabled(leagueId, seasonId)) throw Object.assign(
    new Error('Ligue 1 bu mavsumda yopilgan. Boshqa ligadan klub tanlang.'),
    {code: 'LEAGUE_WITHDRAWN', status: 409, statusCode: 409});
}
