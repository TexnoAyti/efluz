import type { Fixture } from '../types';

const leagues = new Set(['comp-premier-league-2026', 'comp-la-liga-2026', 'comp-serie-a-2026', 'comp-bundesliga-2026', 'comp-ligue-1-2026']);
const cups = new Set(['comp-fa-cup-2026', 'comp-copa-del-rey-2026', 'comp-coppa-italia-2026', 'comp-dfb-pokal-2026', 'comp-coupe-de-france-2026']);
const europe = new Set(['comp-champions-league-2026', 'comp-europa-league-2026', 'comp-conference-league-2026']);

function phase(fixture: Fixture): number {
  if (leagues.has(fixture.competitionId)) return fixture.matchday <= 9 ? 10 : 30;
  if (cups.has(fixture.competitionId)) return 20;
  if (europe.has(fixture.competitionId)) return 40;
  return 25;
}

export function sortSeasonFixtures(fixtures: readonly Fixture[]): Fixture[] {
  return [...fixtures].sort((a, b) => {
    const timestamp = (value: string) => Date.parse(value) || 0;
    return phase(a) - phase(b)
      || Number(a.matchday || 0) - Number(b.matchday || 0)
      || timestamp(a.scheduledAt) - timestamp(b.scheduledAt)
      || a.id.localeCompare(b.id);
  });
}

// A locked earlier round still comes before an open later competition.
export function nextSeasonFixture(fixtures: readonly Fixture[]): Fixture | null {
  return sortSeasonFixtures(fixtures).find(f => f.status !== 'CONFIRMED' && f.status !== 'CANCELLED') || null;
}
