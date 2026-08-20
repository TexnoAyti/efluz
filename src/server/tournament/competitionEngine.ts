import { queryGet, queryAll } from '../db';
import { generateRoundRobinSchedule, calculateMatchdayDate } from './fixtureEngine';
import { generateKnockoutBracket, advanceKnockoutWinner } from './knockoutEngine';
import { calculateCompetitionStandings } from './standingsEngine';
import { evaluateSeasonQualifications } from './qualificationEngine';
import { generateCompetitionFixtures } from '../services/fixtureService';

export class CompetitionEngine {
  /**
   * Generates fixtures for any competition type (LEAGUE, KNOCKOUT, SUPER_CUP, EUROPEAN)
   */
  static generateSchedule(competitionId: string) {
    const comp = queryGet<any>('SELECT * FROM competitions WHERE id = ?', [competitionId]);
    if (!comp) {
      throw new Error(`Competition '${competitionId}' not found.`);
    }

    if (comp.type === 'LEAGUE' || comp.type === 'EUROPEAN_LEAGUE_PHASE') {
      return generateCompetitionFixtures(competitionId);
    } else if (comp.type === 'KNOCKOUT' || comp.type === 'SUPER_CUP' || comp.type === 'EUROPEAN_KNOCKOUT') {
      return generateKnockoutBracket(competitionId);
    } else {
      throw new Error(`Unsupported competition type '${comp.type}'`);
    }
  }

  /**
   * Retrieves or computes official standings for a competition
   */
  static getStandings(competitionId: string) {
    return calculateCompetitionStandings(competitionId);
  }

  /**
   * Advances tournament state upon match confirmation
   */
  static handleMatchConfirmed(fixtureId: string) {
    return advanceKnockoutWinner(fixtureId);
  }

  /**
   * Evaluates end-of-season European qualifications and supercup participants
   */
  static evaluateQualifications(seasonId: string) {
    return evaluateSeasonQualifications(seasonId);
  }
}
