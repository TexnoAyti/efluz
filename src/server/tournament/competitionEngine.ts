import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS, FirestoreCompetitionDoc } from '../firebase/collections';
import { generateKnockoutBracket, advanceKnockoutWinner } from './knockoutEngine';
import { calculateCompetitionStandingsFirestore, generateCompetitionFixturesFirestore } from '../firebase/firestoreStore';
import { evaluateSeasonQualifications } from './qualificationEngine';

export class CompetitionEngine {
  /**
   * Generates fixtures for any competition type (LEAGUE, KNOCKOUT, SUPER_CUP, EUROPEAN) in Firestore
   */
  static async generateSchedule(competitionId: string, options: { force?: boolean } = {}) {
    const db = getFirestoreDb();
    const compDoc = await db.collection(COLLECTIONS.COMPETITIONS).doc(competitionId).get();
    if (!compDoc.exists) {
      throw new Error(`Competition '${competitionId}' not found.`);
    }
    const comp = compDoc.data() as FirestoreCompetitionDoc;

    if (comp.type === 'LEAGUE' || comp.type === 'EUROPEAN_LEAGUE_PHASE') {
      return await generateCompetitionFixturesFirestore(competitionId, options);
    } else if (comp.type === 'KNOCKOUT' || comp.type === 'SUPER_CUP' || comp.type === 'EUROPEAN_KNOCKOUT') {
      return await generateKnockoutBracket(competitionId, options);
    } else {
      throw new Error(`Unsupported competition type '${comp.type}'`);
    }
  }

  /**
   * Retrieves or computes official standings for a competition in Firestore
   */
  static async getStandings(competitionId: string) {
    return await calculateCompetitionStandingsFirestore(competitionId);
  }

  /**
   * Advances tournament state upon match confirmation in Firestore
   */
  static async handleMatchConfirmed(fixtureId: string) {
    return await advanceKnockoutWinner(fixtureId);
  }

  /**
   * Evaluates end-of-season European qualifications and supercup participants in Firestore
   */
  static async evaluateQualifications(seasonId: string) {
    return await evaluateSeasonQualifications(seasonId);
  }
}
