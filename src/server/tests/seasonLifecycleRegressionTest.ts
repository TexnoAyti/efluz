import { fixtureLifecyclePhase } from '../services/seasonLifecycleService';
import { Fixture } from '../../types';

function fixture(competitionId: string, matchday: number): Fixture {
  return {
    id: `${competitionId}-${matchday}`,
    seasonId: 'season-2026-27',
    competitionId,
    competitionName: competitionId,
    matchday,
    homeClubId: 'club-a',
    awayClubId: 'club-b',
    status: 'SCHEDULED',
  } as Fixture;
}

const cases: Array<[string, number, string]> = [
  ['comp-premier-league-2026', 1, 'LEAGUE_1_9'],
  ['comp-serie-a-2026', 9, 'LEAGUE_1_9'],
  ['comp-fa-cup-2026', 1, 'DOMESTIC_CUPS'],
  ['comp-copa-del-rey-2026', 3, 'DOMESTIC_CUPS'],
  ['comp-la-liga-2026', 10, 'LEAGUE_10_19'],
  ['comp-bundesliga-2026', 19, 'LEAGUE_10_19'],
  ['comp-champions-league-2026', 1, 'EUROPE'],
  ['comp-europa-league-2026', 8, 'EUROPE'],
  ['comp-premier-league-2026', 20, 'LEAGUE_20_PLUS'],
  ['comp-ligue-1-2026', 34, 'LEAGUE_20_PLUS'],
];

let failed = 0;
for (const [competitionId, md, expected] of cases) {
  const actual = fixtureLifecyclePhase(fixture(competitionId, md));
  if (actual !== expected) {
    console.error(`FAIL ${competitionId} MD${md}: expected ${expected}, got ${actual}`);
    failed++;
  }
}

if (fixtureLifecyclePhase(fixture('comp-community-shield-2026', 1)) !== null) {
  console.error('FAIL super cup must stay outside lifecycle gating');
  failed++;
}

if (failed > 0) process.exit(1);
console.log('SEASON_LIFECYCLE_REGRESSION_PASS');
