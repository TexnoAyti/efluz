from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing marker: {label}')
    return text.replace(old, new, 1)

# Strengthen domestic bracket integrity: counts alone are not enough.
p = Path('src/components/SofaBracketTree.tsx')
s = p.read_text()
old = '''  const expectedTotal = Object.values(expectedCounts).reduce((sum, count) => sum + count, 0);
  const structurallyComplete =
    actual.length === expectedTotal &&
    (Object.keys(expectedCounts) as RoundKey[]).every((key) => actualCounts[key] === expectedCounts[key]);

  if (structurallyComplete) return { fixtures: actual as BracketFixture[], projected: false };
  if (actual.some(protectedFixture)) {
    return {
      fixtures: actual as BracketFixture[],
      projected: false,
      warning: 'Legacy bracket is incomplete, but protected match data exists. Display repair is intentionally disabled to preserve real results.',
    };
  }

  const clubs = [...participants]
'''
new = '''  const expectedTotal = Object.values(expectedCounts).reduce((sum, count) => sum + count, 0);
  const countsAreComplete =
    actual.length === expectedTotal &&
    (Object.keys(expectedCounts) as RoundKey[]).every((key) => actualCounts[key] === expectedCounts[key]);
  const hasProtectedData = actual.some(protectedFixture);

  const sortedParticipants = [...participants]
    .filter((club) => club.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, expectedTeams);
  const expectedParticipantIds = new Set(sortedParticipants.map((club) => club.id));
  const prelimMatches = expectedTeams - 16;
  const prelimTeamsCount = prelimMatches * 2;
  const byeTeamsCount = expectedTeams - prelimTeamsCount;
  const pureByeMatches = (byeTeamsCount - prelimMatches) / 2;

  // A legacy bracket can have the right number of fixtures but still be logically broken
  // (duplicate clubs, only half the play-in field, or R16 slots not sourced from play-in winners).
  // Deep validation is applied while the bracket is still pristine. Once real result data exists,
  // we never synthesize a replacement display over protected tournament state.
  let logicalStructureValid = countsAreComplete;
  if (logicalStructureValid && !hasProtectedData) {
    const byRound = (key: RoundKey) => actual
      .filter((fixture) => classifyRound(fixture) === key)
      .sort((a, b) => fixtureIndex(a) - fixtureIndex(b));
    const prelim = byRound('PRELIM');
    const r16 = byRound('R16');
    const qf = byRound('QF');
    const sf = byRound('SF');
    const final = byRound('FINAL');
    const firstPathClubs = new Set<string>();
    const addInitialClub = (clubId?: string | null) => {
      if (!clubId || clubId === 'TBD' || !expectedParticipantIds.has(clubId) || firstPathClubs.has(clubId)) {
        logicalStructureValid = false;
        return;
      }
      firstPathClubs.add(clubId);
    };

    for (let i = 0; i < prelimMatches; i++) {
      const fixture = prelim[i];
      if (!fixture) { logicalStructureValid = false; break; }
      addInitialClub(fixture.homeClubId);
      addInitialClub(fixture.awayClubId);
    }

    for (let i = 0; i < 8 && logicalStructureValid; i++) {
      const fixture = r16[i];
      if (!fixture) { logicalStructureValid = false; break; }
      if (i < pureByeMatches) {
        if (fixture.homeSourceFixtureId || fixture.awaySourceFixtureId) logicalStructureValid = false;
        addInitialClub(fixture.homeClubId);
        addInitialClub(fixture.awayClubId);
      } else {
        const playInIndex = i - pureByeMatches;
        const expectedSource = `fix-${competition.id}-r1-m${playInIndex}`;
        const homeUsesSource = fixture.homeSourceFixtureId === expectedSource;
        const awayUsesSource = fixture.awaySourceFixtureId === expectedSource;
        if (homeUsesSource === awayUsesSource) {
          logicalStructureValid = false;
          break;
        }
        if (homeUsesSource) {
          if (fixture.homeClubId && fixture.homeClubId !== 'TBD') logicalStructureValid = false;
          addInitialClub(fixture.awayClubId);
        } else {
          if (fixture.awayClubId && fixture.awayClubId !== 'TBD') logicalStructureValid = false;
          addInitialClub(fixture.homeClubId);
        }
      }
    }

    const validateSources = (round: Fixture[], sourceRound: number) => {
      round.forEach((fixture, index) => {
        if (!logicalStructureValid) return;
        const expectedHome = `fix-${competition.id}-r${sourceRound}-m${index * 2}`;
        const expectedAway = `fix-${competition.id}-r${sourceRound}-m${index * 2 + 1}`;
        const sources = new Set([fixture.homeSourceFixtureId, fixture.awaySourceFixtureId].filter(Boolean));
        if (sources.size !== 2 || !sources.has(expectedHome) || !sources.has(expectedAway)) logicalStructureValid = false;
      });
    };
    validateSources(qf, 2);
    validateSources(sf, 3);
    validateSources(final, 4);

    if (firstPathClubs.size !== expectedTeams) logicalStructureValid = false;
    for (const clubId of expectedParticipantIds) {
      if (!firstPathClubs.has(clubId)) logicalStructureValid = false;
    }
  }

  if (logicalStructureValid) return { fixtures: actual as BracketFixture[], projected: false };
  if (hasProtectedData) {
    return {
      fixtures: actual as BracketFixture[],
      projected: false,
      warning: 'Legacy bracket structure is inconsistent, but protected match data exists. Automatic display repair is disabled to preserve real results.',
    };
  }

  const clubs = sortedParticipants;
'''
s = replace_once(s, old, new, 'logical integrity block')

old2 = '''  const prelimMatches = expectedTeams - 16;
  const prelimTeamsCount = prelimMatches * 2;
  const byeTeamsCount = expectedTeams - prelimTeamsCount;
  const pureByeMatches = (byeTeamsCount - prelimMatches) / 2;
  const now = new Date().toISOString();
'''
new2 = '''  const now = new Date().toISOString();
'''
s = replace_once(s, old2, new2, 'dedupe bracket dimensions')
s = s.replace(
    'bracket is structurally incomplete. Showing the canonical',
    'bracket is structurally or logically incomplete. Showing the canonical',
    1,
)
p.write_text(s)

# Full-tree view is now the primary mobile and desktop experience; remove duplicate round-only UI visually.
p = Path('src/components/TournamentBracket.tsx')
s = p.read_text()
s = replace_once(
    s,
    '<div className="mt-4 flex gap-2 overflow-x-auto pb-1 scrollbar-none lg:hidden">',
    '<div className="hidden">',
    'hide legacy mobile round chips',
)
s = replace_once(s, '<div className="lg:hidden">', '<div className="hidden">', 'hide legacy mobile round list')
p.write_text(s)

# Extend regression assertions without touching any DB.
p = Path('src/server/tests/domesticCupFullBracketRegressionTest.ts')
s = p.read_text()
marker = "assert.match(tree, /actual\\.some\\(protectedFixture\\)/);\n"
addition = marker + "assert.match(tree, /countsAreComplete/);\nassert.match(tree, /logicalStructureValid/);\nassert.match(tree, /firstPathClubs/);\nassert.match(tree, /expectedParticipantIds/);\nassert.match(tree, /validateSources/);\nassert.match(tree, /fixture\\.homeSourceFixtureId === expectedSource/);\n"
s = replace_once(s, marker, addition, 'regression assertions')
p.write_text(s)

print('domestic cup logical integrity patch applied')
