import {
  submitFixtureResultFirestore,
} from '../firebase/firestoreStore';
import { Fixture } from '../../types';

export class ResultSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResultSubmissionError';
  }
}

export async function submitFixtureResult(
  userId: string,
  fixtureId: string,
  homeScore: number,
  awayScore: number,
  proofUrl?: string
): Promise<Fixture> {
  try {
    return await submitFixtureResultFirestore(userId, fixtureId, homeScore, awayScore, proofUrl);
  } catch (err: any) {
    throw new ResultSubmissionError(err.message || 'Failed to submit fixture result');
  }
}
