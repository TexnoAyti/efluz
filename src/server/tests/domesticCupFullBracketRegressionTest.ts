import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tree = readFileSync('src/components/SofaBracketTree.tsx', 'utf8');
const cupView = readFileSync('src/components/CupBracketsView.tsx', 'utf8');
const bracket = readFileSync('src/components/TournamentBracket.tsx', 'utf8');

assert.match(tree, /expectedTeams - 16/);
assert.match(tree, /const prelimTeamsCount = prelimMatches \* 2/);
assert.match(tree, /const byeTeamsCount = expectedTeams - prelimTeamsCount/);
assert.match(tree, /const pureByeMatches = \(byeTeamsCount - prelimMatches\) \/ 2/);
assert.match(tree, /LEGACY_BRACKET_INCOMPLETE/);
assert.match(tree, /actual\.some\(protectedFixture\)/);
assert.match(tree, /countsAreComplete/);
assert.match(tree, /logicalStructureValid/);
assert.match(tree, /firstPathClubs/);
assert.match(tree, /expectedParticipantIds/);
assert.match(tree, /validateSources/);
assert.match(tree, /fixture\.homeSourceFixtureId === expectedSource/);
assert.match(tree, /awaySourceFixtureId: `fix-\$\{competition\.id\}-r1-m\$\{k\}`/);
assert.match(tree, /FULL TREE/);
assert.match(tree, /<svg/);
assert.match(tree, /C \$\{mid\} \$\{y1\}, \$\{mid\} \$\{y2\}/);
assert.match(cupView, /getLeagueClubs\(activeCup\.leagueId, activeSeasonId\)/);
assert.match(bracket, /<SofaBracketTree/);
assert.match(bracket, /participants=\{participants\}/);

console.log('domestic cup full bracket regression: PASS');
