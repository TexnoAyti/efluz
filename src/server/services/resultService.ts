import {
  submitFixtureResultFirestore,
} from '../firebase/firestoreStore';
import { Fixture } from '../../types';
import { notifySmartResultLifecycle } from './smartNotificationService';

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
    const fixture = await submitFixtureResultFirestore(userId, fixtureId, homeScore, awayScore, proofUrl);

    // Smart Telegram delivery is best-effort and quota-independent. Never let a
    // notification failure make a successfully persisted match result fail.
    try {
      await notifySmartResultLifecycle(fixture, userId);
    } catch (notificationError: any) {
      console.warn('[SMART_NOTIFY] Result lifecycle notification failed:', notificationError?.message || notificationError);
    }

    return fixture;
  } catch (err: any) {
    throw new ResultSubmissionError(err.message || 'Failed to submit fixture result');
  }
}
