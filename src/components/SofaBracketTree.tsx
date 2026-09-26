import React, { useMemo } from 'react';
import { Competition, Fixture, Club } from '../types';
import { ClubCrest } from './ClubCrest';
import { GitBranch, Maximize2, ShieldAlert, Sparkles, Trophy } from 'lucide-react';

type BracketFixture = Fixture & {
  isProjected?: boolean;
  projectionReason?: string;
  homeSourceLabel?: string;
  awaySourceLabel?: string;
  homeSeedPosition?: number;
  awaySeedPosition?: number;
};

type RoundKey = 'PRELIM' | 'PLAYOFF' | 'R16' | 'QF' | 'SF' | 'FINAL';

interface Props {
  fixtures: Fixture[];
  competition?: Competition | null;
  participants?: Club[];
  currentClubId?: string;
  onSelectFixture?: (fixture: Fixture) => void;
}

interface RoundColumn {
  key: RoundKey;
  label: string;
  fixtures: BracketFixture[];
}

interface PositionedMatch {
  fixture: BracketFixture;
  round: RoundKey;
  index: number;
  x: number;
  y: number;
}

const CARD_WIDTH = 232;
const CARD_HEIGHT = 112;
const COLUMN_GAP = 86;
const SLOT_HEIGHT = 144;
const HEADER_HEIGHT = 50;

function expectedTeamsForCompetition(competition?: Competition | null): number | null {
  if (!competition || competition.type !== 'KNOCKOUT') return null;
  const text = `${competition.id || ''} ${competition.name || ''}`.toLowerCase();
  if (text.includes('dfb') || text.includes('coupe-de-france') || text.includes('coupe de france')) return 18;
  if (text.includes('fa-cup') || text.includes('fa cup') || text.includes('copa') || text.includes('coppa')) return 20;
  return null;
}

function classifyRound(fixture: Fixture): RoundKey | null {
  const round = String(fixture.roundName || '').toLowerCase();
  const id = String(fixture.id || '').toLowerCase();
  if (round.includes('prelim') || round.includes('play-in') || id.includes('-r1-m')) return 'PRELIM';
  if (round.includes('playoff') || round.includes('play-off') || id.includes('-po-m')) return 'PLAYOFF';
  if (round.includes('round of 16') || id.includes('-r16-m') || (id.includes('-r2-m') && Number(fixture.matchday) === 2)) return 'R16';
  if (round.includes('quarter') || id.includes('-qf-m') || (id.includes('-r3-m') && Number(fixture.matchday) === 3)) return 'QF';
  if (round.includes('semi') || id.includes('-sf-m') || (id.includes('-r4-m') && Number(fixture.matchday) === 4)) return 'SF';
  if ((round.includes('final') && !round.includes('semi')) || id.includes('-final-m') || id.includes('-r5-m0')) return 'FINAL';
  return null;
}

function fixtureIndex(fixture: Fixture): number {
  const match = String(fixture.id || '').match(/-m(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

function protectedFixture(fixture: Fixture): boolean {
  return fixture.status !== 'SCHEDULED' || fixture.homeScore != null || fixture.awayScore != null || Boolean(fixture.winnerClubId || fixture.resultConfirmedAt);
}

function buildProjectedDomesticBracket(
  competition: Competition,
  participants: Club[],
  actual: Fixture[]
): { fixtures: BracketFixture[]; projected: boolean; warning?: string } {
  const expectedTeams = expectedTeamsForCompetition(competition);
  if (!expectedTeams || participants.length < expectedTeams) return { fixtures: actual as BracketFixture[], projected: false };

  const expectedCounts: Record<RoundKey, number> = {
    PRELIM: expectedTeams - 16,
    PLAYOFF: 0,
    R16: 8,
    QF: 4,
    SF: 2,
    FINAL: 1,
  };
  const actualCounts: Record<RoundKey, number> = { PRELIM: 0, PLAYOFF: 0, R16: 0, QF: 0, SF: 0, FINAL: 0 };
  for (const fixture of actual) {
    const key = classifyRound(fixture);
    if (key) actualCounts[key] += 1;
  }

  const expectedTotal = Object.values(expectedCounts).reduce((sum, count) => sum + count, 0);
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
    .filter((club) => club.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, expectedTeams);
  if (clubs.length !== expectedTeams) return { fixtures: actual as BracketFixture[], projected: false };

  const prelimMatches = expectedTeams - 16;
  const prelimTeamsCount = prelimMatches * 2;
  const byeTeamsCount = expectedTeams - prelimTeamsCount;
  const pureByeMatches = (byeTeamsCount - prelimMatches) / 2;
  const now = new Date().toISOString();
  const byId = new Map(actual.map((fixture) => [fixture.id, fixture]));
  const result: BracketFixture[] = [];

  const makeFixture = (
    id: string,
    matchday: number,
    roundName: string,
    homeClub: Club | null,
    awayClub: Club | null,
    extra: Partial<BracketFixture> = {}
  ): BracketFixture => {
    const existing = byId.get(id);
    const canonicalHome = homeClub?.id || null;
    const canonicalAway = awayClub?.id || null;
    const existingMatchesCanonical = Boolean(
      existing &&
      (existing.homeClubId || null) === canonicalHome &&
      (existing.awayClubId || null) === canonicalAway
    );
    if (existingMatchesCanonical) return existing as BracketFixture;
    return {
      id,
      seasonId: competition.seasonId,
      competitionId: competition.id,
      competitionName: competition.name,
      matchday,
      roundName,
      homeClubId: canonicalHome,
      awayClubId: canonicalAway,
      homeClub: homeClub || null,
      awayClub: awayClub || null,
      scheduledAt: existing?.scheduledAt || now,
      status: 'SCHEDULED',
      homeScore: null,
      awayScore: null,
      winnerClubId: null,
      resultConfirmedAt: null,
      createdAt: existing?.createdAt || now,
      updatedAt: existing?.updatedAt || now,
      isProjected: true,
      projectionReason: 'LEGACY_BRACKET_INCOMPLETE',
      ...extra,
    } as BracketFixture;
  };

  for (let i = 0; i < prelimMatches; i++) {
    const homeClub = clubs[byeTeamsCount + i * 2] || null;
    const awayClub = clubs[byeTeamsCount + i * 2 + 1] || null;
    result.push(makeFixture(`fix-${competition.id}-r1-m${i}`, 1, 'Preliminary Round', homeClub, awayClub));
  }

  for (let i = 0; i < 8; i++) {
    if (i < pureByeMatches) {
      result.push(makeFixture(`fix-${competition.id}-r2-m${i}`, 2, 'Round of 16', clubs[i * 2] || null, clubs[i * 2 + 1] || null));
    } else {
      const k = i - pureByeMatches;
      const byeClub = clubs[pureByeMatches * 2 + k] || null;
      result.push(makeFixture(`fix-${competition.id}-r2-m${i}`, 2, 'Round of 16', byeClub, null, {
        awaySourceFixtureId: `fix-${competition.id}-r1-m${k}`,
        awaySourceWinnerSlot: 'away',
        awaySourceLabel: `Winner Play-in M${k + 1}`,
      }));
    }
  }

  const downstream: Array<[number, string, string, number, number]> = [
    [3, 'Quarter-Finals', 'r3', 4, 2],
    [4, 'Semi-Finals', 'r4', 2, 3],
    [5, 'Final', 'r5', 1, 4],
  ];
  for (const [matchday, roundName, roundToken, matchCount, sourceRound] of downstream) {
    for (let i = 0; i < matchCount; i++) {
      const homeSource = `fix-${competition.id}-r${sourceRound}-m${i * 2}`;
      const awaySource = `fix-${competition.id}-r${sourceRound}-m${i * 2 + 1}`;
      result.push(makeFixture(`fix-${competition.id}-${roundToken}-m${i}`, matchday, roundName, null, null, {
        homeSourceFixtureId: homeSource,
        awaySourceFixtureId: awaySource,
        homeSourceWinnerSlot: 'home',
        awaySourceWinnerSlot: 'away',
        homeSourceLabel: `Winner ${sourceRound === 2 ? 'R16' : sourceRound === 3 ? 'QF' : 'SF'} M${i * 2 + 1}`,
        awaySourceLabel: `Winner ${sourceRound === 2 ? 'R16' : sourceRound === 3 ? 'QF' : 'SF'} M${i * 2 + 2}`,
      }));
    }
  }

  return {
    fixtures: result,
    projected: true,
    warning: `Legacy ${competition.name} bracket is structurally incomplete. Showing the canonical ${expectedTeams}-club path without modifying production data.`,
  };
}

function sourceIds(fixture: BracketFixture): string[] {
  return [fixture.homeSourceFixtureId, fixture.awaySourceFixtureId].filter((value): value is string => Boolean(value));
}

function inferredTargetId(source: BracketFixture, all: BracketFixture[]): string | null {
  for (const candidate of all) {
    if (sourceIds(candidate).includes(source.id)) return candidate.id;
  }
  const id = source.id;
  const competitionId = source.competitionId;
  const prelim = id.match(/-r1-m(\d+)$/);
  if (prelim) {
    const expected = expectedTeamsForCompetition({ id: competitionId, name: source.competitionName || '', type: 'KNOCKOUT' } as Competition);
    const pureBye = expected === 18 ? 6 : 4;
    return `fix-${competitionId}-r2-m${pureBye + Number(prelim[1])}`;
  }
  const r16 = id.match(/(?:-r2|-r16)-m(\d+)$/);
  if (r16) return `fix-${competitionId}-${id.includes('-r16-') ? 'qf' : 'r3'}-m${Math.floor(Number(r16[1]) / 2)}`;
  const qf = id.match(/(?:-r3|-qf)-m(\d+)$/);
  if (qf) return `fix-${competitionId}-${id.includes('-qf-') ? 'sf' : 'r4'}-m${Math.floor(Number(qf[1]) / 2)}`;
  const sf = id.match(/(?:-r4|-sf)-m(\d+)$/);
  if (sf) return `fix-${competitionId}-${id.includes('-sf-') ? 'final' : 'r5'}-m0`;
  const po = id.match(/-po-m(\d+)$/);
  if (po) return `fix-${competitionId}-r16-m${Number(po[1])}`;
  return null;
}

function compactName(value?: string | null): string {
  if (!value) return 'TBD';
  return value.length > 23 ? `${value.slice(0, 21)}…` : value;
}

export const SofaBracketTree: React.FC<Props> = ({ fixtures, competition, participants = [], currentClubId, onSelectFixture }) => {
  const normalized = useMemo(() => {
    if (competition && expectedTeamsForCompetition(competition)) {
      return buildProjectedDomesticBracket(competition, participants, fixtures);
    }
    return { fixtures: fixtures as BracketFixture[], projected: false };
  }, [competition, fixtures, participants]);

  const rounds = useMemo<RoundColumn[]>(() => {
    const order: RoundKey[] = ['PRELIM', 'PLAYOFF', 'R16', 'QF', 'SF', 'FINAL'];
    const labels: Record<RoundKey, string> = {
      PRELIM: 'Play-in', PLAYOFF: 'Playoff', R16: 'Round of 16', QF: 'Quarter-final', SF: 'Semi-final', FINAL: 'Final',
    };
    return order
      .map((key) => ({
        key,
        label: labels[key],
        fixtures: normalized.fixtures.filter((fixture) => classifyRound(fixture) === key).sort((a, b) => fixtureIndex(a) - fixtureIndex(b)),
      }))
      .filter((round) => round.fixtures.length > 0);
  }, [normalized.fixtures]);

  const layout = useMemo(() => {
    if (rounds.length === 0) return { positions: [] as PositionedMatch[], width: 0, height: 0, connectors: [] as Array<[PositionedMatch, PositionedMatch]> };
    const mainRound = rounds.find((round) => round.key === 'R16') || rounds.reduce((best, round) => round.fixtures.length > best.fixtures.length ? round : best, rounds[0]);
    const baseCount = Math.max(1, mainRound.fixtures.length);
    const centers = new Map<string, number>();
    const roundX = new Map<RoundKey, number>();
    rounds.forEach((round, index) => roundX.set(round.key, index * (CARD_WIDTH + COLUMN_GAP)));

    mainRound.fixtures.forEach((fixture, index) => centers.set(fixture.id, HEADER_HEIGHT + index * SLOT_HEIGHT + SLOT_HEIGHT / 2));

    const laterRounds = rounds.slice(rounds.indexOf(mainRound) + 1);
    for (const round of laterRounds) {
      for (const fixture of round.fixtures) {
        const sources = sourceIds(fixture);
        const sourceCenters = sources.map((id) => centers.get(id)).filter((value): value is number => typeof value === 'number');
        if (sourceCenters.length) centers.set(fixture.id, sourceCenters.reduce((a, b) => a + b, 0) / sourceCenters.length);
        else {
          const idx = fixtureIndex(fixture);
          const divisor = Math.max(1, round.fixtures.length);
          centers.set(fixture.id, HEADER_HEIGHT + ((idx + 0.5) * baseCount / divisor) * SLOT_HEIGHT);
        }
      }
    }

    const earlierRounds = rounds.slice(0, rounds.indexOf(mainRound)).reverse();
    for (const round of earlierRounds) {
      for (const fixture of round.fixtures) {
        const targetId = inferredTargetId(fixture, normalized.fixtures);
        const targetCenter = targetId ? centers.get(targetId) : undefined;
        const idx = fixtureIndex(fixture);
        centers.set(fixture.id, targetCenter ?? HEADER_HEIGHT + ((idx + 0.5) * baseCount / Math.max(1, round.fixtures.length)) * SLOT_HEIGHT);
      }
    }

    const positions: PositionedMatch[] = rounds.flatMap((round) => round.fixtures.map((fixture, index) => ({
      fixture,
      round: round.key,
      index,
      x: roundX.get(round.key) || 0,
      y: (centers.get(fixture.id) || HEADER_HEIGHT + SLOT_HEIGHT / 2) - CARD_HEIGHT / 2,
    })));
    const posById = new Map(positions.map((position) => [position.fixture.id, position]));
    const connectors: Array<[PositionedMatch, PositionedMatch]> = [];
    for (const source of positions) {
      const targetId = inferredTargetId(source.fixture, normalized.fixtures);
      const target = targetId ? posById.get(targetId) : undefined;
      if (target) connectors.push([source, target]);
    }
    return {
      positions,
      connectors,
      width: rounds.length * CARD_WIDTH + Math.max(0, rounds.length - 1) * COLUMN_GAP,
      height: HEADER_HEIGHT + baseCount * SLOT_HEIGHT + 18,
    };
  }, [normalized.fixtures, rounds]);

  if (rounds.length === 0) return null;

  return (
    <div className="border-b border-white/[0.07] bg-[#050a13]">
      <div className="flex items-center justify-between gap-4 px-4 pb-2 pt-4 sm:px-5">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-blue-300">
            <GitBranch className="h-3.5 w-3.5" /> Full knockout map
          </div>
          <p className="mt-1 text-[10px] text-slate-500">Sofascore-style path • swipe horizontally to inspect every round</p>
        </div>
        <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.03] px-2.5 py-1.5 text-[9px] font-black text-slate-400">
          <Maximize2 className="h-3 w-3" /> FULL TREE
        </div>
      </div>

      {normalized.warning && (
        <div className={`mx-4 mb-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[10px] sm:mx-5 ${normalized.projected ? 'border-violet-400/20 bg-violet-500/[0.07] text-violet-200' : 'border-amber-400/20 bg-amber-500/[0.07] text-amber-200'}`}>
          {normalized.projected ? <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{normalized.warning}</span>
        </div>
      )}

      <div className="overflow-x-auto overscroll-x-contain px-4 pb-5 sm:px-5 scrollbar-thin">
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          <svg className="pointer-events-none absolute inset-0 z-0" width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              <linearGradient id="bracketLine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(96,165,250,0.25)" />
                <stop offset="100%" stopColor="rgba(251,191,36,0.32)" />
              </linearGradient>
            </defs>
            {layout.connectors.map(([from, to]) => {
              const x1 = from.x + CARD_WIDTH;
              const y1 = from.y + CARD_HEIGHT / 2;
              const x2 = to.x;
              const y2 = to.y + CARD_HEIGHT / 2;
              const mid = x1 + (x2 - x1) / 2;
              return <path key={`${from.fixture.id}->${to.fixture.id}`} d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} fill="none" stroke="url(#bracketLine)" strokeWidth="1.5" />;
            })}
          </svg>

          {rounds.map((round, roundIndex) => (
            <div key={round.key} className="absolute top-0 z-10" style={{ left: roundIndex * (CARD_WIDTH + COLUMN_GAP), width: CARD_WIDTH }}>
              <div className="flex h-10 items-center justify-between border-b border-white/[0.06] px-1">
                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-300">{round.label}</span>
                <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[8px] font-black text-slate-600">{round.fixtures.length}</span>
              </div>
            </div>
          ))}

          {layout.positions.map(({ fixture, x, y, round, index }) => {
            const projected = Boolean(fixture.isProjected);
            const isMine = Boolean(currentClubId && [fixture.homeClubId, fixture.awayClubId].includes(currentClubId));
            const renderTeam = (side: 'home' | 'away') => {
              const home = side === 'home';
              const clubId = home ? fixture.homeClubId : fixture.awayClubId;
              const club = home ? fixture.homeClub : fixture.awayClub;
              const score = home ? fixture.homeScore : fixture.awayScore;
              const source = home ? fixture.homeSourceLabel : fixture.awaySourceLabel;
              const isWinner = Boolean(clubId && fixture.winnerClubId === clubId);
              return (
                <div className={`flex h-[39px] items-center gap-2 rounded-lg px-2 ${isWinner ? 'bg-emerald-400/[0.08]' : 'bg-white/[0.018]'}`}>
                  {clubId && clubId !== 'TBD' ? <ClubCrest clubId={club?.id || clubId} logoUrl={club?.logoUrl} name={club?.name || clubId} shortName={club?.shortName} size="xs" className="h-5 w-5 shrink-0" /> : <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-white/[0.12] text-[8px] text-slate-600">?</div>}
                  <span className={`min-w-0 flex-1 truncate text-[10px] ${isWinner ? 'font-black text-emerald-300' : clubId ? 'font-bold text-slate-200' : 'italic text-slate-500'}`}>{clubId ? compactName(club?.name || clubId) : (source || 'Winner TBD')}</span>
                  <span className="w-5 text-right font-mono text-[11px] font-black text-slate-300">{score == null ? '–' : score}</span>
                </div>
              );
            };
            return (
              <button
                key={fixture.id}
                type="button"
                disabled={projected}
                onClick={() => { if (!projected) onSelectFixture?.(fixture); }}
                className={`absolute z-10 rounded-xl border p-2 text-left shadow-xl transition ${round === 'FINAL' ? 'border-amber-300/30 bg-gradient-to-br from-amber-500/[0.11] to-[#09111f]' : 'border-white/[0.09] bg-[#09111f]/95'} ${isMine ? 'ring-1 ring-amber-300/50' : ''} ${projected ? 'cursor-default' : 'hover:border-blue-300/30 hover:-translate-y-0.5'}`}
                style={{ left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT }}
              >
                <div className="mb-1.5 flex items-center justify-between px-0.5">
                  <span className={`text-[8px] font-black uppercase tracking-wider ${round === 'FINAL' ? 'text-amber-300' : 'text-blue-300/80'}`}>{round === 'FINAL' ? <span className="flex items-center gap-1"><Trophy className="h-2.5 w-2.5" /> Final</span> : `M${index + 1}`}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[7px] font-black uppercase ${projected ? 'bg-violet-400/10 text-violet-300' : fixture.status === 'CONFIRMED' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-blue-400/10 text-blue-300'}`}>{projected ? 'Projected' : fixture.status === 'CONFIRMED' ? 'Finished' : 'Open'}</span>
                </div>
                <div className="space-y-1">{renderTeam('home')}{renderTeam('away')}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
