import { PREPARED_TIE_RULES, PREPARED_DOMESTIC_CUPS, PREPARED_UEFA_COMPETITIONS, PREPARED_SUPER_CUPS } from '../content/season2Rules';
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
        homeAndAway: false,
        totalTeams: roster.clubs.length,
        totalMatchdays: roster.clubs.length - 1,
        totalFixtures: roster.clubs.length * (roster.clubs.length - 1) / 2,
        points: { win: 3, draw: 1, loss: 0 },
      },
    };
  }),
  domesticCups: PREPARED_DOMESTIC_CUPS,
  superCups: PREPARED_SUPER_CUPS,
  europeanCompetitions: PREPARED_UEFA_COMPETITIONS,
  // Asian international qualification is deferred until its single-source
  // league (Uzbekistan Superligasi) format is agreed. No phantom clubs or
  // qualifying slots are generated from removed leagues.
  internationalCompetitions: [],
  pendingDecisions: ['UEFA_ACCESS_LIST', 'START_DATE', 'RUNTIME_TRANSITION', 'ACTIVATION'],
} as const;

export function getSeasonPreparation(sourceSeasonId: string) {
  return sourceSeasonId === EFL_SECOND_SEASON.sourceSeasonId ? EFL_SECOND_SEASON : null;
}
