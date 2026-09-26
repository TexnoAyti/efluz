import assert from 'node:assert/strict';
import fs from 'node:fs';

const view = fs.readFileSync('src/components/ChampionsLeagueView.tsx', 'utf8');
const bracket = fs.readFileSync('src/components/TournamentBracket.tsx', 'utf8');
const engine = fs.readFileSync('src/server/tournament/knockoutEngine.ts', 'utf8');

assert.match(view, /projectedKnockoutFixtures/);
assert.match(view, /9–24, 10–23, 11–22/);
assert.match(view, /ranked\[8 \+ i\]/);
assert.match(view, /ranked\[23 - i\]/);
assert.match(view, /bracketFixtures/);
assert.match(view, /isLiveProjection \? undefined/);
assert.match(bracket, /Projected/);
assert.match(bracket, /homeSeedPosition/);
assert.match(bracket, /customSourceLabel/);
assert.match(engine, /awaySourceFixtureId: `fix-\$\{competitionId\}-po-m\$\{i\}`/);
assert.match(engine, /homeSourceFixtureId: `fix-\$\{competitionId\}-r16-m\$\{i \* 2\}`/);
assert.match(engine, /homeSourceFixtureId: `fix-\$\{competitionId\}-qf-m\$\{i \* 2\}`/);
assert.match(engine, /homeSourceFixtureId: `fix-\$\{competitionId\}-sf-m0`/);

console.log('european knockout projection regression: PASS');
