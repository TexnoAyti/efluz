import { EFL_SECOND_SEASON } from '../../lib/seasonPreparation';
import { generateRoundRobinSchedule } from '../tournament/fixtureEngine';

/** Preview only: no DB imports, activation, ownership copying or real-world results. */
export function previewPreparedLeagueSchedule(leagueId: string) {
  const league = EFL_SECOND_SEASON.leagues.find(item => item.id === leagueId);
  if (!league) return null;
  const fixtures = generateRoundRobinSchedule(league.roster.clubs.map(club => club.id), {
    homeAndAway: league.format.homeAndAway,
  });
  return {
    seasonId: EFL_SECOND_SEASON.id,
    competitionId: league.competitionId,
    leagueId: league.id,
    status: 'PREPARATION',
    persisted: false,
    scheduleKind: 'EFL_DRAFT',
    realSeason: league.roster.realSeason,
    totalMatchdays: league.format.totalMatchdays,
    fixtures,
  };
}
