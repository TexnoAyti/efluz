/** Season-specific withdrawal. Retain stored clubs/results for history and recovery. */
export const CURRENT_SEASON_ID = 'season-2026-27';
const WITHDRAWN_COMPETITIONS = new Set([
  'comp-ligue-1-2026', 'comp-coupe-de-france-2026',
  'comp-trophee-champions-2026', 'comp-trophee-des-champions-2026',
]);
// Season 1 is now a residual competition season: only Super Cups and
// European competitions remain visible/playable. Season 2 is the active
// domestic-league registration/competition season.
const CURRENT_SEASON_ALLOWED_COMPETITIONS = new Set([
  'comp-community-shield-2026', 'comp-supercopa-espana-2026',
  'comp-supercoppa-italiana-2026', 'comp-dfl-supercup-2026',
  'comp-uefa-super-cup-2026', 'comp-champions-league-2026',
  'comp-europa-league-2026',
]);
export function isSeasonLeagueEnabled(leagueId: string | undefined, seasonId = CURRENT_SEASON_ID): boolean {
  // No Season 1 domestic-league selection remains open after rollover.
  return seasonId !== CURRENT_SEASON_ID && Boolean(leagueId);
}
/** Existing Season 1 owners remain readable for account, match and history views. */
export function isSeasonLeagueAccountVisible(leagueId: string | undefined, seasonId = CURRENT_SEASON_ID): boolean {
  return Boolean(leagueId) && (seasonId === CURRENT_SEASON_ID || isSeasonLeagueEnabled(leagueId, seasonId));
}
export function isSeasonCompetitionEnabled(competitionId: string | undefined, seasonId = CURRENT_SEASON_ID): boolean {
  // EFL/Carabao Cup was removed from the official calendar in every season.
  // Apply at read time too: older durable/client snapshots can still contain it.
  if (/efl[-_ ]?cup|carabao/i.test(competitionId || '')) return false;
  if (/conference|(?:^|[-_])uecl(?:[-_]|$)/i.test(competitionId || '')) return false;
  if (seasonId === CURRENT_SEASON_ID) return CURRENT_SEASON_ALLOWED_COMPETITIONS.has(competitionId || '');
  return !WITHDRAWN_COMPETITIONS.has(competitionId || '');
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
    new Error('1-mavsum ligalari yopilgan. 2-mavsumdan klub tanlang.'),
    {code: 'LEAGUE_WITHDRAWN', status: 409, statusCode: 409});
}
