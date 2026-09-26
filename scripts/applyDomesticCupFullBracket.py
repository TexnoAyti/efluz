from pathlib import Path
import json


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing marker: {label}')
    return text.replace(old, new, 1)

# TournamentBracket integration
p = Path('src/components/TournamentBracket.tsx')
s = p.read_text()
s = replace_once(s, "import { Competition, Fixture } from '../types';", "import { Club, Competition, Fixture } from '../types';", 'tournament type import')
s = replace_once(s, "import { ClubCrest } from './ClubCrest';", "import { ClubCrest } from './ClubCrest';\nimport { SofaBracketTree } from './SofaBracketTree';", 'sofa tree import')
s = replace_once(s, "  competition?: Competition | null;\n}", "  competition?: Competition | null;\n  participants?: Club[];\n}", 'participants prop')
s = replace_once(s, "  onSelectFixture,\n  competition,\n}) => {", "  onSelectFixture,\n  competition,\n  participants = [],\n}) => {", 'participants destructure')
s = replace_once(
    s,
    "      {champion && (\n",
    "      <SofaBracketTree\n        fixtures={fixtures}\n        competition={competition}\n        participants={participants}\n        currentClubId={currentClubId}\n        onSelectFixture={onSelectFixture}\n      />\n\n      {champion && (\n",
    'full bracket insertion',
)
s = replace_once(s, '<div className="hidden lg:block">', '<div className="hidden">', 'hide legacy desktop columns')
p.write_text(s)

# CupBracketsView participant roster feed
p = Path('src/components/CupBracketsView.tsx')
s = p.read_text()
s = replace_once(s, "import { Competition, Fixture } from '../types';", "import { Club, Competition, Fixture } from '../types';", 'cup type import')
s = replace_once(
    s,
    "  const [cupFixtures, setCupFixtures] = useState<Fixture[]>([]);\n",
    "  const [cupFixtures, setCupFixtures] = useState<Fixture[]>([]);\n  const [cupParticipants, setCupParticipants] = useState<Club[]>([]);\n",
    'cup participant state',
)
marker = "  const expectedTeams = expectedTeamsForCup(activeCup);\n"
insert = marker + "\n  useEffect(() => {\n    let cancelled = false;\n    if (!activeCup?.leagueId) {\n      setCupParticipants([]);\n      return () => { cancelled = true; };\n    }\n    api.getLeagueClubs(activeCup.leagueId, activeSeasonId)\n      .then((res) => { if (!cancelled) setCupParticipants(res.clubs || []); })\n      .catch((err) => {\n        console.warn('[CUP_BRACKET] Could not load full participant roster:', err);\n        if (!cancelled) setCupParticipants([]);\n      });\n    return () => { cancelled = true; };\n  }, [activeCup?.leagueId, activeSeasonId]);\n"
s = replace_once(s, marker, insert, 'participant load effect')
old = "          competition={activeCup}\n        />"
new = "          competition={activeCup}\n          participants={cupParticipants}\n        />"
s = replace_once(s, old, new, 'pass cup participants')
p.write_text(s)

# Package regression script
p = Path('package.json')
pkg = json.loads(p.read_text())
pkg['scripts']['test:cup-full-bracket'] = 'node scripts/run-isolated-test.mjs src/server/tests/domesticCupFullBracketRegressionTest.ts'
p.write_text(json.dumps(pkg, indent=2) + '\n')

# Static structural regression. It deliberately avoids DB writes.
Path('src/server/tests/domesticCupFullBracketRegressionTest.ts').write_text(r'''import assert from 'node:assert/strict';
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
assert.match(tree, /awaySourceFixtureId: `fix-\$\{competition\.id\}-r1-m\$\{k\}`/);
assert.match(tree, /FULL TREE/);
assert.match(tree, /<svg/);
assert.match(tree, /C \$\{mid\} \$\{y1\}, \$\{mid\} \$\{y2\}/);
assert.match(cupView, /getLeagueClubs\(activeCup\.leagueId, activeSeasonId\)/);
assert.match(bracket, /<SofaBracketTree/);
assert.match(bracket, /participants=\{participants\}/);

console.log('domestic cup full bracket regression: PASS');
''')

print('domestic cup full bracket integration applied')
