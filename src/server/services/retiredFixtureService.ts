/** Explicit correction of a verified production duplicate, approved by the
 * tournament owner. The played match remains in round 1 with its original ID,
 * score, proof and submissions. Storage is retained for audit/recovery; the
 * accidental round-10 copy cannot be listed, played or used to block progression.
 * This is deliberately not a general pair deduplicator: cup rematches and other
 * seasons must remain intact. No startup writes or additional Firestore reads.
 */
export const RETIRED_FIXTURES = [{
  id: 'fix-comp-serie-a-2026-md10-inter-vs-milan',
  seasonId: 'season-2026-27',
  competitionId: 'comp-serie-a-2026',
  retainedFixtureId: 'fix-comp-serie-a-2026-md1-inter-vs-milan',
}] as const;

export function isRetiredFixture(id: string, seasonId?: string): boolean {
  return RETIRED_FIXTURES.some(row => row.id === id && (!seasonId || row.seasonId === seasonId));
}

export function filterRetiredFixtures<T extends { id: string; seasonId?: string }>(fixtures: T[], seasonId?: string): T[] {
  return fixtures.filter(fixture => !isRetiredFixture(fixture.id, fixture.seasonId || seasonId));
}

export function assertFixtureNotRetired(id: string): void {
  if (isRetiredFixture(id)) {
    throw Object.assign(new Error('Bu o‘yin 1-turda o‘ynalgan. Takroriy o‘yinga natija kiritib bo‘lmaydi.'), {
      code: 'FIXTURE_RETIRED', statusCode: 409,
    });
  }
}
