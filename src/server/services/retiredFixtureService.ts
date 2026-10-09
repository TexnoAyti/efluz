/** Explicit correction of a verified production duplicate, approved by the
 * tournament owner. Canonical round: Matchday 10. Original ID, score, proof and
 * submissions are preserved. Storage is retained for audit/recovery; the
 * accidental round-10 copy cannot be listed, played or used to block progression.
 * This is deliberately not a general pair deduplicator: cup rematches and other
 * seasons must remain intact. No startup writes or additional Firestore reads.
 */
export const RETIRED_FIXTURES = [{
  id: 'fix-comp-serie-a-2026-md10-inter-vs-milan',
  seasonId: 'season-2026-27',
  competitionId: 'comp-serie-a-2026',
  retainedFixtureId: 'fix-comp-serie-a-2026-md1-inter-vs-milan',
  matchday: 10,
  roundName: 'Matchday 10',
  scheduledAt: '2026-10-17T15:00:00.000Z',
}] as const;

export function isRetiredFixture(id: string, seasonId?: string): boolean {
  return RETIRED_FIXTURES.some(row => row.id === id && (!seasonId || row.seasonId === seasonId));
}

export function correctFixtureMatchday<T extends { id: string; seasonId?: string }>(fixture: T, seasonId?: string): T {
  const correction = RETIRED_FIXTURES.find(row => row.retainedFixtureId === fixture.id && ((!fixture.seasonId && !seasonId) || row.seasonId === (fixture.seasonId || seasonId)));
  return correction ? { ...fixture, matchday: correction.matchday, roundName: correction.roundName, scheduledAt: correction.scheduledAt, competitionName: 'Serie A' } : fixture;
}

export function hasFixtureMatchdayCorrection(competitionId: string, seasonId: string): boolean {
  return RETIRED_FIXTURES.some(row => row.competitionId === competitionId && row.seasonId === seasonId);
}

export function filterRetiredFixtures<T extends { id: string; seasonId?: string }>(fixtures: T[], seasonId?: string): T[] {
  return fixtures.filter(fixture => !isRetiredFixture(fixture.id, fixture.seasonId || seasonId)).map(fixture => correctFixtureMatchday(fixture, seasonId));
}

export function assertFixtureNotRetired(id: string): void {
  if (isRetiredFixture(id)) {
    throw Object.assign(new Error('Bu o‘yinning tasdiqlangan natijasi Matchday 10 ga biriktirilgan. Takroriy o‘yinga natija kiritib bo‘lmaydi.'), {
      code: 'FIXTURE_RETIRED', statusCode: 409,
    });
  }
}
