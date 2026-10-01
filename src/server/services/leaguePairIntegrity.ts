import { Fixture } from '../../types';

export function analyzeLeaguePairs(fixtures: Fixture[], clubs: Array<{ id: string; name: string }>) {
  const names = new Map(clubs.map(club => [club.id, club.name]));
  const pairs = new Map<string, string[]>();
  const invalidFixtureIds: string[] = [];
  for (const fixture of fixtures) {
    const home = fixture.homeClubId, away = fixture.awayClubId;
    if (!home || !away || home === away || !names.has(home) || !names.has(away)) {
      invalidFixtureIds.push(fixture.id); continue;
    }
    const key = [home, away].sort().join('|');
    pairs.set(key, [...(pairs.get(key) || []), fixture.id]);
  }
  const missingPairs: Array<{ homeClubId: string; awayClubId: string; homeClubName: string; awayClubName: string }> = [];
  const ids = [...names.keys()].sort();
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if (!pairs.has([ids[i], ids[j]].join('|'))) missingPairs.push({
      homeClubId: ids[i], awayClubId: ids[j],
      homeClubName: names.get(ids[i])!, awayClubName: names.get(ids[j])!,
    });
  }
  return { missingPairs, invalidFixtureIds };
}
