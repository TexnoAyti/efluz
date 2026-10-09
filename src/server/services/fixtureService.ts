import {
  generateCompetitionFixturesFirestore,
  getFixturesFirestore,
  getFixtureByIdFirestore,
} from '../firebase/firestoreStore';
import { Fixture } from '../../types';

export async function generateCompetitionFixtures(
  competitionId: string,
  options: { force?: boolean } = {}
): Promise<{ generated: number; matchdays: number }> {
  return await generateCompetitionFixturesFirestore(competitionId, options);
}

export async function resetCompetitionFixtures(
  competitionId: string
): Promise<{ deleted?: number; generated: number; matchdays: number }> {
  return await generateCompetitionFixturesFirestore(competitionId, { force: true });
}

export async function getFixtures(filter: {
  competitionId?: string;
  seasonId?: string;
  matchday?: number;
  clubId?: string;
  userId?: string;
  status?: string;
  limit?: number;
}): Promise<Fixture[]> {
  return await getFixturesFirestore(filter);
}

export async function getFixtureById(
  fixtureId: string,
  currentUserId?: string
): Promise<Fixture | null> {
  return await getFixtureByIdFirestore(fixtureId, currentUserId);
}
