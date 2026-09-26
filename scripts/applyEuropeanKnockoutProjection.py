from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing marker: {label}')
    return text.replace(old, new, 1)

# ChampionsLeagueView: create live position-driven knockout projection when actual KO fixtures do not exist.
p = Path('src/components/ChampionsLeagueView.tsx')
s = p.read_text()
marker = "  }, [standings, participants]);\n\n  return (\n"
insert = r'''  }, [standings, participants]);

  const actualKnockoutFixtures = useMemo(
    () => fixtures.filter((f) =>
      f.id.includes('-po-') ||
      f.id.includes('-r16-') ||
      f.id.includes('-qf-') ||
      f.id.includes('-sf-') ||
      f.id.includes('-final-')
    ),
    [fixtures]
  );

  /**
   * Live knockout projection driven entirely by the current league-phase ranking.
   * It is display-only: no projected node can submit a result or mutate tournament data.
   * Once authoritative knockout fixtures exist, they replace this projection automatically.
   */
  const projectedKnockoutFixtures = useMemo<Fixture[]>(() => {
    if (actualKnockoutFixtures.length > 0 || displayStandings.length < 24 || !selectedTournament) return [];

    const ranked = [...displayStandings]
      .sort((a, b) => (a.position || 999) - (b.position || 999))
      .slice(0, 24);
    if (ranked.length < 24) return [];

    const now = new Date().toISOString();
    const clubFromRow = (row: StandingsRow) => ({
      id: row.clubId,
      name: row.clubName,
      shortName: row.shortName,
      country: '',
      leagueId: '',
      logoUrl: (row as any).clubLogoUrl || (row as any).logoUrl || '',
      active: true,
      managerUsername: row.managerUsername,
      claimedByUserId: row.managerUserId || null,
      claimedByUsername: row.managerUsername || null,
      createdAt: now,
    } as any);
    const baseFixture = (id: string, matchday: number, roundName: string): Fixture => ({
      id,
      seasonId: selectedTournament.seasonId,
      competitionId: selectedTournament.id,
      competitionName: selectedTournament.name,
      matchday,
      roundName,
      homeClubId: null,
      awayClubId: null,
      scheduledAt: now,
      status: 'SCHEDULED',
      homeScore: null,
      awayScore: null,
      winnerClubId: null,
      resultConfirmedAt: null,
      createdAt: now,
      updatedAt: now,
      ...( { isProjected: true } as any),
    });

    const out: Fixture[] = [];

    // Position-paired play-offs: 9v24, 10v23, ... 16v17.
    for (let i = 0; i < 8; i++) {
      const seeded = ranked[8 + i];
      const unseeded = ranked[23 - i];
      const f = baseFixture(`projection-${selectedTournament.id}-po-m${i}`, 9, 'Knockout Play-offs');
      f.homeClubId = unseeded.clubId;
      f.awayClubId = seeded.clubId;
      f.homeClub = clubFromRow(unseeded);
      f.awayClub = clubFromRow(seeded);
      (f as any).homeSeedPosition = unseeded.position;
      (f as any).awaySeedPosition = seeded.position;
      (f as any).projectionLabel = `#${seeded.position} vs #${unseeded.position}`;
      out.push(f);
    }

    // Top 8 are direct R16 qualifiers. Their opponent is the winner of the
    // corresponding position-paired play-off and updates live as standings move.
    for (let i = 0; i < 8; i++) {
      const direct = ranked[i];
      const seeded = ranked[8 + i];
      const unseeded = ranked[23 - i];
      const f = baseFixture(`projection-${selectedTournament.id}-r16-m${i}`, 10, 'Round of 16');
      f.homeClubId = direct.clubId;
      f.homeClub = clubFromRow(direct);
      f.awayClubId = null;
      f.awaySourceFixtureId = `projection-${selectedTournament.id}-po-m${i}`;
      (f as any).homeSeedPosition = direct.position;
      (f as any).awaySourceLabel = `Winner #${seeded.position} vs #${unseeded.position}`;
      out.push(f);
    }

    for (let i = 0; i < 4; i++) {
      const f = baseFixture(`projection-${selectedTournament.id}-qf-m${i}`, 11, 'Quarter-Finals');
      f.homeSourceFixtureId = `projection-${selectedTournament.id}-r16-m${i * 2}`;
      f.awaySourceFixtureId = `projection-${selectedTournament.id}-r16-m${i * 2 + 1}`;
      (f as any).homeSourceLabel = `Winner R16 • M${i * 2 + 1}`;
      (f as any).awaySourceLabel = `Winner R16 • M${i * 2 + 2}`;
      out.push(f);
    }

    for (let i = 0; i < 2; i++) {
      const f = baseFixture(`projection-${selectedTournament.id}-sf-m${i}`, 12, 'Semi-Finals');
      f.homeSourceFixtureId = `projection-${selectedTournament.id}-qf-m${i * 2}`;
      f.awaySourceFixtureId = `projection-${selectedTournament.id}-qf-m${i * 2 + 1}`;
      (f as any).homeSourceLabel = `Winner QF • M${i * 2 + 1}`;
      (f as any).awaySourceLabel = `Winner QF • M${i * 2 + 2}`;
      out.push(f);
    }

    const final = baseFixture(`projection-${selectedTournament.id}-final-m0`, 13, 'Final');
    final.homeSourceFixtureId = `projection-${selectedTournament.id}-sf-m0`;
    final.awaySourceFixtureId = `projection-${selectedTournament.id}-sf-m1`;
    (final as any).homeSourceLabel = 'Winner SF • M1';
    (final as any).awaySourceLabel = 'Winner SF • M2';
    out.push(final);

    return out;
  }, [actualKnockoutFixtures.length, displayStandings, selectedTournament]);

  const bracketFixtures = actualKnockoutFixtures.length > 0 ? actualKnockoutFixtures : projectedKnockoutFixtures;
  const isLiveProjection = actualKnockoutFixtures.length === 0 && projectedKnockoutFixtures.length > 0;

  return (
'''
s = replace_once(s, marker, insert, 'projection insertion')

old = '''          <TournamentBracket
            fixtures={fixtures}
            currentClubId={currentClub?.id}
            userId={user?.id}
            onSelectFixture={(f) => setSelectedFixtureForSubmit(f)}
            competition={selectedTournament}
          />

          {fixtures.filter(
            (f) =>
              f.id.includes('-po-') ||
              f.id.includes('-r16-') ||
              f.id.includes('-qf-') ||
              f.id.includes('-sf-') ||
              f.id.includes('-final-')
          ).length === 0 && (
'''
new = '''          {isLiveProjection && (
            <div className="rounded-2xl border border-blue-400/20 bg-blue-500/[0.07] px-4 py-3 text-xs text-blue-100 shadow-lg">
              <div className="flex items-center gap-2 font-black uppercase tracking-wider">
                <Sparkles className="h-4 w-4 text-blue-300" />
                Live knockout projection
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                Juftliklar hozirgi liga jadvalidagi o‘rinlarga qarab avtomatik yangilanadi: 9–24, 10–23, 11–22 … 16–17. Liga bosqichi tugagach final jadval bo‘yicha rasmiy bracket yaratiladi.
              </p>
            </div>
          )}

          <TournamentBracket
            fixtures={bracketFixtures}
            currentClubId={currentClub?.id}
            userId={user?.id}
            onSelectFixture={isLiveProjection ? undefined : (f) => setSelectedFixtureForSubmit(f)}
            competition={selectedTournament}
          />

          {bracketFixtures.length === 0 && (
'''
s = replace_once(s, old, new, 'bracket fixture swap')
p.write_text(s)

# TournamentBracket: projected cards are visibly projected, non-clickable, and show seed/source information.
p = Path('src/components/TournamentBracket.tsx')
s = p.read_text()
old = "    const sourceFixtureId = isHome ? (fixture as any).homeSourceFixtureId : (fixture as any).awaySourceFixtureId;\n    const tbd = !clubId || clubId === 'TBD' || club?.name === 'TBD';\n"
new = "    const sourceFixtureId = isHome ? (fixture as any).homeSourceFixtureId : (fixture as any).awaySourceFixtureId;\n    const customSourceLabel = isHome ? (fixture as any).homeSourceLabel : (fixture as any).awaySourceLabel;\n    const seedPosition = isHome ? (fixture as any).homeSeedPosition : (fixture as any).awaySeedPosition;\n    const tbd = !clubId || clubId === 'TBD' || club?.name === 'TBD';\n"
s = replace_once(s, old, new, 'projected row metadata')
old = "              {tbd ? sourceLabel(sourceFixtureId) : club?.name || clubId}\n"
new = "              {tbd ? (customSourceLabel || sourceLabel(sourceFixtureId)) : `${seedPosition ? `#${seedPosition} ` : ''}${club?.name || clubId}`}\n"
s = replace_once(s, old, new, 'seed/source labels')
old = "    const statusLabel = fixture.status === 'CONFIRMED' ? 'Finished' : fixture.status === 'DISPUTED' ? 'Disputed' : 'Open';\n    const canOpen = Boolean(onSelectFixture);\n"
new = "    const isProjected = Boolean((fixture as any).isProjected);\n    const statusLabel = isProjected ? 'Projected' : fixture.status === 'CONFIRMED' ? 'Finished' : fixture.status === 'DISPUTED' ? 'Disputed' : 'Open';\n    const canOpen = Boolean(onSelectFixture && !isProjected);\n"
s = replace_once(s, old, new, 'projected match state')
old = "        onClick={() => onSelectFixture?.(fixture)}\n"
new = "        onClick={() => { if (!isProjected) onSelectFixture?.(fixture); }}\n"
s = replace_once(s, old, new, 'projected click guard')
old = "          <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-wide ${fixture.status === 'CONFIRMED' ? 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300' : fixture.status === 'DISPUTED' ? 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300' : 'border-blue-400/20 bg-blue-400/[0.07] text-blue-300'}`}>\n"
new = "          <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-wide ${isProjected ? 'border-violet-400/20 bg-violet-400/[0.08] text-violet-300' : fixture.status === 'CONFIRMED' ? 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300' : fixture.status === 'DISPUTED' ? 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300' : 'border-blue-400/20 bg-blue-400/[0.07] text-blue-300'}`}>\n"
s = replace_once(s, old, new, 'projected status style')
p.write_text(s)

# knockoutEngine: make source tracing explicit so the official bracket shows exact progression.
p = Path('src/server/tournament/knockoutEngine.ts')
s = p.read_text()
old = "      awayClubId: 'TBD',\n      scheduledAt: now,\n"
new = "      awayClubId: 'TBD',\n      awaySourceFixtureId: `fix-${competitionId}-po-m${i}`,\n      awaySourceWinnerSlot: 'winner',\n      scheduledAt: now,\n"
s = replace_once(s, old, new, 'r16 playoff source')
old = "      homeClubId: 'TBD',\n      awayClubId: 'TBD',\n      scheduledAt: now,\n"
new = "      homeClubId: 'TBD',\n      awayClubId: 'TBD',\n      homeSourceFixtureId: `fix-${competitionId}-r16-m${i * 2}`,\n      awaySourceFixtureId: `fix-${competitionId}-r16-m${i * 2 + 1}`,\n      homeSourceWinnerSlot: 'winner',\n      awaySourceWinnerSlot: 'winner',\n      scheduledAt: now,\n"
s = replace_once(s, old, new, 'qf source')
old = "      homeClubId: 'TBD',\n      awayClubId: 'TBD',\n      scheduledAt: now,\n"
new = "      homeClubId: 'TBD',\n      awayClubId: 'TBD',\n      homeSourceFixtureId: `fix-${competitionId}-qf-m${i * 2}`,\n      awaySourceFixtureId: `fix-${competitionId}-qf-m${i * 2 + 1}`,\n      homeSourceWinnerSlot: 'winner',\n      awaySourceWinnerSlot: 'winner',\n      scheduledAt: now,\n"
s = replace_once(s, old, new, 'sf source')
old = "    homeClubId: 'TBD',\n    awayClubId: 'TBD',\n    scheduledAt: now,\n"
new = "    homeClubId: 'TBD',\n    awayClubId: 'TBD',\n    homeSourceFixtureId: `fix-${competitionId}-sf-m0`,\n    awaySourceFixtureId: `fix-${competitionId}-sf-m1`,\n    homeSourceWinnerSlot: 'winner',\n    awaySourceWinnerSlot: 'winner',\n    scheduledAt: now,\n"
s = replace_once(s, old, new, 'final source')
p.write_text(s)

# Static regression guard.
Path('src/server/tests/europeanKnockoutProjectionRegressionTest.ts').write_text(r'''import assert from 'node:assert/strict';
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
''')

print('European knockout live projection patch applied')
