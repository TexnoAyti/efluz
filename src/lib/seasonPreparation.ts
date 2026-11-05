import { CURRENT_SEASON_ID } from './seasonParticipationPolicy';

/** Planning data only. Never seed active leagues, owners, fixtures or standings from this catalog. */
export const EFL_SECOND_SEASON = {
  id: 'season-2027-28',
  number: 2,
  sourceSeasonId: CURRENT_SEASON_ID,
  status: 'PREPARATION',
  registrationOpen: false,
  startDate: null,
  leagues: [
    { id: 'league-premier-league', name: 'Premier League', country: 'England', flag: '🇬🇧', group: 'EUROPE', change: 'CONTINUING' },
    { id: 'league-la-liga', name: 'La Liga', country: 'Spain', flag: '🇪🇸', group: 'EUROPE', change: 'CONTINUING' },
    { id: 'league-serie-a', name: 'Serie A', country: 'Italy', flag: '🇮🇹', group: 'EUROPE', change: 'CONTINUING' },
    { id: 'league-bundesliga', name: 'Bundesliga', country: 'Germany', flag: '🇩🇪', group: 'EUROPE', change: 'CONTINUING' },
    { id: 'league-ligue-1', name: 'Ligue 1', country: 'France', flag: '🇫🇷', group: 'EUROPE', change: 'OPENING' },
    { id: 'league-uzbekistan-superliga', name: 'O‘zbekiston Superligasi', country: 'Uzbekistan', flag: '🇺🇿', group: 'ASIA', change: 'OPENING' },
    { id: 'league-saudi-pro-league', name: 'Saudi Pro League', country: 'Saudi Arabia', flag: '🇸🇦', group: 'ASIA', change: 'OPENING' },
    { id: 'league-j1', name: 'J1 League', country: 'Japan', flag: '🇯🇵', group: 'ASIA', change: 'OPENING' },
    // EFL competition grouping follows the organizer's season plan.
    { id: 'league-turkey-super-lig', name: 'Süper Lig', country: 'Turkey', flag: '🇹🇷', group: 'ASIA', change: 'OPENING' },
  ],
  pendingDecisions: ['CLUB_ROSTERS', 'TEAM_COUNTS', 'FORMAT', 'QUALIFICATION', 'START_DATE'],
} as const;

export function getSeasonPreparation(sourceSeasonId: string) {
  return sourceSeasonId === EFL_SECOND_SEASON.sourceSeasonId ? EFL_SECOND_SEASON : null;
}
