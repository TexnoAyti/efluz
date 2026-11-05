import { PREPARED_TIE_RULES, PREPARED_DOMESTIC_CUPS, PREPARED_UEFA_COMPETITIONS } from '../content/season2Rules';
import { SEASON_TWO_ROSTERS } from '../content/season2Rosters';
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
  ].map(league => {
    const roster = SEASON_TWO_ROSTERS[league.id];
    if (!roster || roster.clubs.length !== roster.expectedClubCount) throw new Error(`Invalid season-two roster: ${league.id}`);
    return {
      ...league,
      competitionId: league.id.replace(/^league-/, 'comp-') + '-2027',
      roster,
      rankingRule: PREPARED_TIE_RULES[league.id],
      format: {
        type: 'ROUND_ROBIN' as const,
        homeAndAway: true,
        totalTeams: roster.clubs.length,
        totalMatchdays: (roster.clubs.length - 1) * 2,
        totalFixtures: roster.clubs.length * (roster.clubs.length - 1),
        points: { win: 3, draw: 1, loss: 0 },
      },
    };
  }),
  domesticCups: PREPARED_DOMESTIC_CUPS,
  europeanCompetitions: PREPARED_UEFA_COMPETITIONS,
  internationalCompetitions: [
    {
      id: 'comp-asian-champions-league-2027',
      name: 'Osiyo Chempionlar ligasi',
      group: 'ASIA',
      status: 'PREPARATION',
      registrationOpen: false,
      sourceSeasonId: 'season-2027-28',
      qualification: {
        // EFL grouping includes Turkey by the organizer's choice.
        sourceLeagueIds: ['league-uzbekistan-superliga', 'league-saudi-pro-league', 'league-j1', 'league-turkey-super-lig'],
        slotsByLeague: {
          'league-uzbekistan-superliga': 8,
          'league-saudi-pro-league': 8,
          'league-j1': 8,
          'league-turkey-super-lig': 8,
        },
        totalTeams: 32,
        selection: 'TOP_RANKED',
        fromPosition: 1,
      },
      format: {
        templateCompetitionId: 'comp-champions-league-2026',
        type: 'LEAGUE_PHASE',
        config: { leaguePhaseTeams: 32, matchesPerTeam: 8, directQualifiers: 8, playoffTeams: 16, knockoutTeams: 16 },
      },
    },
  ],
  pendingDecisions: ['CUP_PARTICIPANTS', 'FINAL_RULE_VERIFICATION', 'UEFA_ACCESS_LIST', 'START_DATE', 'RUNTIME_TRANSITION', 'ACTIVATION'],
} as const;

export function getSeasonPreparation(sourceSeasonId: string) {
  return sourceSeasonId === EFL_SECOND_SEASON.sourceSeasonId ? EFL_SECOND_SEASON : null;
}
