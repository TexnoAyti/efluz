import React, { useMemo } from 'react';
import { Competition, Fixture } from '../types';
import { ClubCrest } from './ClubCrest';
import { GitBranch, Maximize2, Trophy } from 'lucide-react';

type BracketFixture = Fixture & {
  isProjected?: boolean;
  homeSourceLabel?: string;
  awaySourceLabel?: string;
  homeSeedPosition?: number;
  awaySeedPosition?: number;
};

type RoundKey = 'PRELIM' | 'PLAYOFF' | 'R16' | 'QF' | 'SF' | 'FINAL';

interface Props {
  fixtures: Fixture[];
  competition?: Competition | null;
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

// Mobile-first canvas metrics. These keep the original connected tree while
// cutting the old ~1200px tall bracket to a much denser canvas.
const CARD_WIDTH = 204;
const CARD_HEIGHT = 88;
const COLUMN_GAP = 54;
const SLOT_HEIGHT = 104;
const HEADER_HEIGHT = 40;

function classifyRound(fixture: Fixture): RoundKey | null {
  const round = String(fixture.roundName || '').toLowerCase();
  const id = String(fixture.id || '').toLowerCase();
  if (round.includes('round of 16') || round.includes('1/8') || id.includes('-r16-m') || (id.includes('-r2-m') && Number(fixture.matchday) === 2)) return 'R16';
  if (round.includes('quarter') || round.includes('1/4') || id.includes('-qf-m') || (id.includes('-r3-m') && Number(fixture.matchday) === 3)) return 'QF';
  if ((round.includes('semi') || round.includes('1/2')) && !round.includes('quarter')) return 'SF';
  if (id.includes('-sf-m') || (id.includes('-r4-m') && Number(fixture.matchday) === 4)) return 'SF';
  if ((round.includes('final') && !round.includes('semi') && !round.includes('quarter')) || id.includes('-final-m') || id.includes('-r5-m0')) return 'FINAL';
  if (round.includes('playoff') || round.includes('play-off') || id.includes('-po-m')) return 'PLAYOFF';
  if (round.includes('prelim') || round.includes('play-in') || round.includes('dastlabki') || round.includes('saralash') || (id.includes('-r1-m') && Number(fixture.matchday) === 1)) return 'PRELIM';
  return null;
}

function fixtureIndex(fixture: Fixture): number {
  const match = String(fixture.id || '').match(/-m(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

function sourceIds(fixture: BracketFixture): string[] {
  return [
    (fixture as any).homeSourceFixtureId,
    (fixture as any).awaySourceFixtureId,
    (fixture as any).sourceFixtureId,
  ].filter((value): value is string => Boolean(value));
}

function inferredTargetId(source: BracketFixture, all: BracketFixture[]): string | null {
  for (const candidate of all) {
    if (sourceIds(candidate).includes(source.id)) return candidate.id;
  }

  const id = String(source.id || '');
  const competitionId = source.competitionId;
  const prelim = id.match(/-r1-m(\d+)$/i);
  if (prelim) {
    const r16 = all.filter((fixture) => classifyRound(fixture) === 'R16').sort((a, b) => fixtureIndex(a) - fixtureIndex(b));
    const linked = r16.find((fixture) => sourceIds(fixture).includes(source.id));
    return linked?.id || null;
  }
  const r16 = id.match(/(?:-r2|-r16)-m(\d+)$/i);
  if (r16) return `fix-${competitionId}-${id.includes('-r16-') ? 'qf' : 'r3'}-m${Math.floor(Number(r16[1]) / 2)}`;
  const qf = id.match(/(?:-r3|-qf)-m(\d+)$/i);
  if (qf) return `fix-${competitionId}-${id.includes('-qf-') ? 'sf' : 'r4'}-m${Math.floor(Number(qf[1]) / 2)}`;
  const sf = id.match(/(?:-r4|-sf)-m(\d+)$/i);
  if (sf) return `fix-${competitionId}-${id.includes('-sf-') ? 'final' : 'r5'}-m0`;
  const po = id.match(/-po-m(\d+)$/i);
  if (po) return `fix-${competitionId}-r16-m${Number(po[1])}`;
  return null;
}

function compactName(value?: string | null): string {
  if (!value) return 'TBD';
  return value.length > 20 ? `${value.slice(0, 18)}…` : value;
}

function sourceLabel(fixture: BracketFixture, side: 'home' | 'away'): string {
  const explicit = side === 'home' ? fixture.homeSourceLabel : fixture.awaySourceLabel;
  if (explicit) return explicit;
  const sourceId = side === 'home' ? (fixture as any).homeSourceFixtureId : (fixture as any).awaySourceFixtureId;
  if (!sourceId) return 'Winner TBD';
  const match = String(sourceId).match(/-r(\d+)-m(\d+)$/i);
  if (!match) return 'Winner TBD';
  const round = Number(match[1]);
  const label = round === 1 ? 'Play-in' : round === 2 ? 'R16' : round === 3 ? 'QF' : round === 4 ? 'SF' : `R${round}`;
  return `Winner ${label} M${Number(match[2]) + 1}`;
}

export const SofaBracketTree: React.FC<Props> = ({ fixtures, competition, currentClubId, onSelectFixture }) => {
  const bracketFixtures = fixtures as BracketFixture[];

  const rounds = useMemo<RoundColumn[]>(() => {
    const order: RoundKey[] = ['PRELIM', 'PLAYOFF', 'R16', 'QF', 'SF', 'FINAL'];
    const labels: Record<RoundKey, string> = {
      PRELIM: 'Play-in',
      PLAYOFF: 'Playoff',
      R16: 'Round of 16',
      QF: 'Quarter-final',
      SF: 'Semi-final',
      FINAL: 'Final',
    };
    return order
      .map((key) => ({
        key,
        label: labels[key],
        fixtures: bracketFixtures.filter((fixture) => classifyRound(fixture) === key).sort((a, b) => fixtureIndex(a) - fixtureIndex(b)),
      }))
      .filter((round) => round.fixtures.length > 0);
  }, [bracketFixtures]);

  const layout = useMemo(() => {
    if (!rounds.length) return { positions: [] as PositionedMatch[], connectors: [] as Array<[PositionedMatch, PositionedMatch]>, width: 0, height: 0 };

    const mainRound = rounds.find((round) => round.key === 'R16') || rounds.reduce((best, round) => round.fixtures.length > best.fixtures.length ? round : best, rounds[0]);
    const baseCount = Math.max(1, mainRound.fixtures.length);
    const centers = new Map<string, number>();
    const roundX = new Map<RoundKey, number>();
    rounds.forEach((round, index) => roundX.set(round.key, index * (CARD_WIDTH + COLUMN_GAP)));

    mainRound.fixtures.forEach((fixture, index) => centers.set(fixture.id, HEADER_HEIGHT + index * SLOT_HEIGHT + SLOT_HEIGHT / 2));

    for (const round of rounds.slice(rounds.indexOf(mainRound) + 1)) {
      for (const fixture of round.fixtures) {
        const sourceCenters = sourceIds(fixture).map((id) => centers.get(id)).filter((value): value is number => typeof value === 'number');
        if (sourceCenters.length) centers.set(fixture.id, sourceCenters.reduce((a, b) => a + b, 0) / sourceCenters.length);
        else centers.set(fixture.id, HEADER_HEIGHT + ((fixtureIndex(fixture) + 0.5) * baseCount / Math.max(1, round.fixtures.length)) * SLOT_HEIGHT);
      }
    }

    for (const round of rounds.slice(0, rounds.indexOf(mainRound)).reverse()) {
      for (const fixture of round.fixtures) {
        const targetId = inferredTargetId(fixture, bracketFixtures);
        const targetCenter = targetId ? centers.get(targetId) : undefined;
        centers.set(fixture.id, targetCenter ?? HEADER_HEIGHT + ((fixtureIndex(fixture) + 0.5) * baseCount / Math.max(1, round.fixtures.length)) * SLOT_HEIGHT);
      }
    }

    const positions: PositionedMatch[] = rounds.flatMap((round) => round.fixtures.map((fixture, index) => ({
      fixture,
      round: round.key,
      index,
      x: roundX.get(round.key) || 0,
      y: (centers.get(fixture.id) || HEADER_HEIGHT + SLOT_HEIGHT / 2) - CARD_HEIGHT / 2,
    })));
    const positionById = new Map(positions.map((position) => [position.fixture.id, position]));
    const connectors: Array<[PositionedMatch, PositionedMatch]> = [];
    for (const source of positions) {
      const targetId = inferredTargetId(source.fixture, bracketFixtures);
      const target = targetId ? positionById.get(targetId) : undefined;
      if (target) connectors.push([source, target]);
    }

    return {
      positions,
      connectors,
      width: rounds.length * CARD_WIDTH + Math.max(0, rounds.length - 1) * COLUMN_GAP,
      height: HEADER_HEIGHT + baseCount * SLOT_HEIGHT + 12,
    };
  }, [bracketFixtures, rounds]);

  if (!rounds.length) return null;

  return (
    <div className="border-b border-white/[0.07] bg-[#050a13]">
      <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-3 sm:px-5 sm:pt-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.18em] text-blue-300 sm:text-[10px]">
            <GitBranch className="h-3.5 w-3.5" /> Connected knockout map
          </div>
          <p className="mt-1 text-[9px] text-slate-500 sm:text-[10px]">{competition?.name || 'Cup'} • swipe horizontally to follow the full path</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-white/[0.07] bg-white/[0.03] px-2 py-1.5 text-[8px] font-black text-slate-400 sm:text-[9px]">
          <Maximize2 className="h-3 w-3" /> FULL TREE
        </div>
      </div>

      <div className="overflow-x-auto overscroll-x-contain px-2.5 pb-4 scrollbar-thin sm:px-5 sm:pb-5">
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          <svg className="pointer-events-none absolute inset-0 z-0" width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              <linearGradient id="bracketLineCompact" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgba(96,165,250,0.34)" />
                <stop offset="100%" stopColor="rgba(251,191,36,0.42)" />
              </linearGradient>
            </defs>
            {layout.connectors.map(([from, to]) => {
              const x1 = from.x + CARD_WIDTH;
              const y1 = from.y + CARD_HEIGHT / 2;
              const x2 = to.x;
              const y2 = to.y + CARD_HEIGHT / 2;
              const mid = x1 + (x2 - x1) / 2;
              return <path key={`${from.fixture.id}->${to.fixture.id}`} d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} fill="none" stroke="url(#bracketLineCompact)" strokeWidth="1.5" />;
            })}
          </svg>

          {rounds.map((round, roundIndex) => (
            <div key={round.key} className="absolute top-0 z-10" style={{ left: roundIndex * (CARD_WIDTH + COLUMN_GAP), width: CARD_WIDTH }}>
              <div className="flex h-8 items-center justify-between border-b border-white/[0.06] px-1">
                <span className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-300">{round.label}</span>
                <span className="rounded-full bg-white/[0.04] px-1.5 py-0.5 text-[7px] font-black text-slate-600">{round.fixtures.length}</span>
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
              const isWinner = Boolean(clubId && fixture.winnerClubId === clubId);
              return (
                <div className={`flex h-[29px] items-center gap-1.5 rounded-lg px-1.5 ${isWinner ? 'bg-emerald-400/[0.10]' : 'bg-white/[0.018]'}`}>
                  {clubId && clubId !== 'TBD' ? (
                    <ClubCrest clubId={club?.id || clubId} logoUrl={club?.logoUrl} name={club?.name || clubId} shortName={club?.shortName} size="xs" className="h-4.5 w-4.5 shrink-0" />
                  ) : (
                    <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-dashed border-white/[0.12] text-[7px] text-slate-600">?</div>
                  )}
                  <span className={`min-w-0 flex-1 truncate text-[9px] ${isWinner ? 'font-black text-emerald-300' : clubId ? 'font-bold text-slate-200' : 'italic text-slate-500'}`}>
                    {clubId ? compactName(club?.name || clubId) : sourceLabel(fixture, side)}
                  </span>
                  <span className="w-4 text-right font-mono text-[10px] font-black text-slate-300">{score == null ? '–' : score}</span>
                </div>
              );
            };

            return (
              <button
                key={fixture.id}
                type="button"
                disabled={projected}
                onClick={() => { if (!projected) onSelectFixture?.(fixture); }}
                className={`absolute z-10 rounded-xl border p-1.5 text-left shadow-xl transition ${round === 'FINAL' ? 'border-amber-300/35 bg-gradient-to-br from-amber-500/[0.13] to-[#09111f] shadow-amber-500/10' : 'border-white/[0.09] bg-[#09111f]/95'} ${isMine ? 'ring-1 ring-amber-300/55' : ''} ${projected ? 'cursor-default' : 'hover:-translate-y-0.5 hover:border-blue-300/30'}`}
                style={{ left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT }}
              >
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span className={`text-[7px] font-black uppercase tracking-wider ${round === 'FINAL' ? 'text-amber-300' : 'text-blue-300/80'}`}>
                    {round === 'FINAL' ? <span className="flex items-center gap-1"><Trophy className="h-2.5 w-2.5" /> Final</span> : `M${index + 1}`}
                  </span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[6px] font-black uppercase ${projected ? 'bg-violet-400/10 text-violet-300' : fixture.status === 'CONFIRMED' ? 'bg-emerald-400/10 text-emerald-300' : fixture.status === 'DISPUTED' ? 'bg-rose-400/10 text-rose-300' : 'bg-blue-400/10 text-blue-300'}`}>
                    {projected ? 'Projected' : fixture.status === 'CONFIRMED' ? 'Finished' : fixture.status === 'DISPUTED' ? 'Disputed' : 'Open'}
                  </span>
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