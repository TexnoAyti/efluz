import { Fixture } from '../../types';
import { isCompleteLeagueFixtureSet, isConfirmedFinalFixture } from '../services/seasonInsightsService';

function fixture(roundName: string, status = 'CONFIRMED'): Fixture {
  return { id: roundName, competitionId: 'comp-fa-cup-2026', roundName, status } as Fixture;
}

for (const round of ['Semi-Finals', 'Quarter-Finals', 'Semi-Final', 'Quarterfinal']) {
  if (isConfirmedFinalFixture(fixture(round))) throw new Error(`${round} incorrectly awarded a trophy`);
}
if (isConfirmedFinalFixture(fixture('Final', 'SCHEDULED'))) throw new Error('Unplayed final awarded a trophy');
if (!isConfirmedFinalFixture(fixture('Final'))) throw new Error('Confirmed final not recognized');

const competitionId = 'comp-premier-league-2026';
const clubs = Array.from({ length: 20 }, (_, index) => `club-${index}`);
const fixtures: Fixture[] = [];
for (let home = 0; home < clubs.length; home++) {
  for (let away = home + 1; away < clubs.length; away++) {
    fixtures.push({ id: `${home}-${away}`, competitionId, status: 'CONFIRMED',
      homeClubId: clubs[home], awayClubId: clubs[away], homeScore: 1, awayScore: 0 } as Fixture);
  }
}
if (!isCompleteLeagueFixtureSet(fixtures, competitionId)) throw new Error('Complete league rejected');
if (isCompleteLeagueFixtureSet(fixtures.slice(0, -1), competitionId)) throw new Error('Partial league awarded a trophy');
const duplicate = [...fixtures.slice(0, -1), { ...fixtures[0], id: 'duplicate' }];
if (isCompleteLeagueFixtureSet(duplicate, competitionId)) throw new Error('Duplicate pairing awarded a trophy');
if (isCompleteLeagueFixtureSet(fixtures.map((item, index) => index === 0 ? { ...item, status: 'POSTPONED' } : item), competitionId)) {
  throw new Error('Postponed fixture awarded a trophy');
}
console.log('SEASON_TROPHY_SAFETY_REGRESSION_PASS');
