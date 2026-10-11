import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Competition, Fixture } from '../types';
import { ClubCrest } from './ClubCrest';
import { layoutKnockout } from '../lib/knockoutLayout';
import { GitBranch, Maximize2, Trophy } from 'lucide-react';

export type BracketFixture = Fixture & {
  isProjected?: boolean;
  homeSourceLabel?: string;
  awaySourceLabel?: string;
  homeSeedPosition?: number;
  awaySeedPosition?: number;
  nextMatchFixtureId?: string | null;
  secondLegLabel?: string;
  penaltyHomeScore?: number | null;
  penaltyAwayScore?: number | null;
};

type RoundKey = 'PRELIM' | 'R32' | 'PLAYOFF' | 'R16' | 'QF' | 'SF' | 'FINAL';

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
const CARD_WIDTH = 176;
const CARD_HEIGHT = 100;
const COLUMN_GAP = 18;
const SLOT_HEIGHT = 110;

function classifyRound(fixture: Fixture): RoundKey | null {
  const round = String(fixture.roundName || '').toLowerCase();
  const id = String(fixture.id || '').toLowerCase();
  if (round.includes('round of 32')) return 'R32';
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
  const match = String(fixture.id || '').match(/(?:-m|_m)(\d+)(?:_l\d+)?$/i);
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
  if (source.nextMatchFixtureId) return source.nextMatchFixtureId;
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
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);

  const rounds = useMemo<RoundColumn[]>(() => {
    const order: RoundKey[] = ['PRELIM', 'R32', 'PLAYOFF', 'R16', 'QF', 'SF', 'FINAL'];
    const labels: Record<RoundKey, string> = {
      PRELIM: 'Play-in',
      R32: 'Round of 32',
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
    if (!rounds.length) return { positions: [] as PositionedMatch[], connectors: [] as Array<[PositionedMatch, PositionedMatch]>, columns: [] as Array<{ key: string; x: number; side: string; count: number }>, width: 0, height: 0 };

    const mirrored = layoutKnockout(rounds.map(round => ({
      key: round.key,
      nodes: round.fixtures.map(fixture => ({ id: fixture.id, round: round.key, targetId: inferredTargetId(fixture, bracketFixtures) })),
    })), CARD_WIDTH, CARD_HEIGHT, COLUMN_GAP, SLOT_HEIGHT);
    const positions: PositionedMatch[] = rounds.flatMap(round => round.fixtures.map((fixture, index) => ({
      fixture, round: round.key, index, ...mirrored.positions.get(fixture.id)!,
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
      columns: mirrored.columns,
      width: mirrored.width,
      height: mirrored.height,
    };
  }, [bracketFixtures, rounds]);

  useEffect(() => {
    const element = viewport.current;
    if (element) element.scrollLeft = Math.max(0, (layout.width * zoom - element.clientWidth) / 2);
  }, [layout.width, zoom]);

  if (!rounds.length) return null;

  return (
    <div className="border-b border-white/[0.07] efl-theme-border bg-[#050a13] efl-theme-surface">
      <div className="efl-fit-wrap flex items-center justify-between gap-3 px-3 pb-2 pt-3 sm:px-5 sm:pt-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.18em] text-blue-300 efl-theme-blue sm:text-[10px]">
            <GitBranch className="h-3.5 w-3.5" /> Pley-off yo‘li
          </div>
          <p className="mt-1 text-[9px] text-slate-500 efl-theme-muted sm:text-[10px]">{competition?.name || 'Kubok'} • 1-tomon → Final ← 2-tomon</p>
        </div>
        <button type="button" onClick={() => setZoom(zoom < 1 ? 1 : Math.min(1, Math.max(.1, ((viewport.current?.clientWidth || layout.width) - 24) / layout.width)))} className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-xl border border-white/[0.07] efl-theme-border bg-white/[0.03] efl-theme-surface-2 px-2 py-1.5 text-[9px] font-black text-slate-400 efl-theme-text-2" aria-label={zoom < 1 ? 'Bracketni kattalashtirish' : 'Butun bracketni ko‘rsatish'}>
          <Maximize2 className="h-3 w-3" /> {zoom < 1 ? 'Kattalashtirish' : 'Butun bracket'}
        </button>
      </div>

      <div ref={viewport} className="overflow-x-auto overscroll-x-contain px-2.5 pb-4 scrollbar-thin sm:px-5 sm:pb-5" tabIndex={0} aria-label="Pley-off bracketi: chap va o‘ng tomon, markazda final">
        <div style={{ width: layout.width * zoom, height: layout.height * zoom, marginInline: 'auto' }}>
        <div className="relative" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
          <svg className="pointer-events-none absolute inset-0 z-0" width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              <linearGradient id="bracketLineCompact" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" className="efl-theme-connector-start" stopColor="rgba(96,165,250,0.34)" />
                <stop offset="100%" className="efl-theme-connector-end" stopColor="rgba(251,191,36,0.42)" />
              </linearGradient>
            </defs>
            {layout.connectors.map(([from, to]) => {
              const towardRight = to.x > from.x;
              const x1 = from.x + (towardRight ? CARD_WIDTH : 0);
              const y1 = from.y + CARD_HEIGHT / 2;
              const x2 = to.x + (towardRight ? 0 : CARD_WIDTH);
              const y2 = to.y + CARD_HEIGHT / 2;
              const mid = x1 + (x2 - x1) / 2;
              return <path key={`${from.fixture.id}->${to.fixture.id}`} d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} fill="none" stroke="url(#bracketLineCompact)" strokeWidth="1.5" />;
            })}
          </svg>

          {layout.columns.map((column) => (
            <div key={`${column.key}-${column.side}`} className="absolute top-0 z-10" style={{ left: column.x, width: CARD_WIDTH }}>
              <div className="flex h-8 items-center justify-between border-b border-white/[0.06] efl-theme-border px-1">
                <span className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-300 efl-theme-text-2">{rounds.find(r => r.key === column.key)?.label}</span>
                <span className="rounded-full bg-white/[0.04] efl-theme-surface-2 px-1.5 py-0.5 text-[7px] font-black text-slate-600 efl-theme-muted">{column.count}</span>
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
                <div className={`flex h-[29px] items-center gap-1.5 rounded-lg px-1.5 ${isWinner ? 'bg-emerald-400/[0.10]' : 'bg-white/[0.018] efl-theme-surface-2'}`}>
                  {clubId && clubId !== 'TBD' && clubId !== 'BYE' ? (
                    <ClubCrest clubId={club?.id || clubId} logoUrl={club?.logoUrl} name={club?.name || clubId} shortName={club?.shortName} size="xs" className="h-4.5 w-4.5 shrink-0" />
                  ) : (
                    <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-dashed border-white/[0.12] efl-theme-border text-[7px] text-slate-600 efl-theme-muted">?</div>
                  )}
                  <span title={clubId ? club?.name || clubId : sourceLabel(fixture, side)} className={`min-w-0 flex-1 truncate text-[9px] ${isWinner ? 'font-black text-emerald-300 efl-theme-emerald' : clubId ? 'font-bold text-slate-200 efl-theme-text' : 'italic text-slate-500 efl-theme-muted'}`}>
                    {clubId === 'BYE' ? 'BYE' : clubId && clubId !== 'TBD' ? compactName(club?.name || clubId) : sourceLabel(fixture, side)}
                  </span>
                  <span className="w-4 text-right font-mono text-[10px] font-black text-slate-300 efl-theme-text-2">{score == null ? '–' : score}</span>
                </div>
              );
            };

            return (
              <button
                key={fixture.id}
                data-fixture-id={fixture.id}
                type="button"
                disabled={projected || !onSelectFixture}
                onClick={() => { if (!projected) onSelectFixture?.(fixture); }}
                className={`absolute z-10 rounded-xl border p-1 text-left shadow-xl transition ${round === 'FINAL' ? 'border-amber-300/35 bg-gradient-to-br from-amber-500/[0.13] to-[#09111f] efl-theme-final shadow-amber-500/10' : 'border-white/[0.09] efl-theme-border bg-[#09111f]/95 efl-theme-surface'} ${isMine ? 'ring-1 ring-amber-300/55' : ''} ${projected ? 'cursor-default' : 'hover:-translate-y-0.5 hover:border-blue-300/30'}`}
                style={{ left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT }}
              >
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span className={`text-[7px] font-black uppercase tracking-wider ${round === 'FINAL' ? 'text-amber-300 efl-theme-amber' : 'text-blue-300/80 efl-theme-blue'}`}>
                    {round === 'FINAL' ? <span className="flex items-center gap-1"><Trophy className="h-2.5 w-2.5" /> Final</span> : `M${index + 1}`}
                  </span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[6px] font-black uppercase ${projected ? 'bg-violet-400/10 text-violet-300 efl-theme-violet' : fixture.status === 'CONFIRMED' ? 'bg-emerald-400/10 text-emerald-300 efl-theme-emerald' : fixture.status === 'DISPUTED' ? 'bg-rose-400/10 text-rose-300 efl-theme-rose' : 'bg-blue-400/10 text-blue-300 efl-theme-blue'}`}>
                    {projected ? 'Projected' : fixture.status === 'CONFIRMED' ? 'Finished' : fixture.status === 'DISPUTED' ? 'Disputed' : 'Open'}
                  </span>
                </div>
                <div className="space-y-1">{renderTeam('home')}{renderTeam('away')}</div>
                {fixture.secondLegLabel ? <p className="mt-1 truncate text-[8px] leading-[10px] text-slate-400 efl-theme-text-2" title={fixture.secondLegLabel}>{fixture.secondLegLabel}</p> : fixture.penaltyHomeScore != null ? <p className="mt-1 text-[8px] leading-[10px] text-amber-300 efl-theme-amber">Pen: {fixture.penaltyHomeScore}–{fixture.penaltyAwayScore}</p> : null}
              </button>
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
};
