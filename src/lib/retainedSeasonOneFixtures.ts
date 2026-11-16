import type {Fixture} from '../types';

/** Old-season access is strictly limited to verified retained clubs in surviving
 * UEFA and Super Cup competitions. Historical domestic leagues stay archived. */
export function mergeRetainedSeasonOneFixtures(
  current: Fixture[],
  historical: Fixture[],
  retainedClubIds: readonly string[],
): Fixture[] {
  const retained = new Set(retainedClubIds);
  const eligible = historical.filter(f => {
    const comp = f.competitionId || '';
    const cup = /(?:champions|europa|super-cup)/.test(comp);
    return cup && (retained.has(f.homeClubId || '') || retained.has(f.awayClubId || ''));
  });
  const seen = new Set<string>();
  return [...current, ...eligible].filter(f => {
    const key = `${f.seasonId || ''}:${f.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
