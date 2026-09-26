import React, { useMemo, useState } from 'react';
import { Competition, Fixture } from '../types';
import { ClubCrest } from './ClubCrest';
import { SofaBracketTree } from './SofaBracketTree';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Crown,
  GitBranch,
  Layers,
  LayoutGrid,
  Radio,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { useUserProfile } from '../context/UserProfileContext';
import { useI18n } from '../i18n';
import { getClubOwnerDisplay } from '../lib/ownerUtils';

interface TournamentBracketProps {
  fixtures: Fixture[];
  currentClubId?: string;
  userId?: string;
  onSelectFixture?: (fixture: Fixture) => void;
  competition?: Competition | null;
}

type RoundKey = 'PRELIM' | 'PLAYOFF' | 'R16' | 'QF' | 'SF' | 'FINAL' | 'UNKNOWN';
type BracketViewMode = 'bracket' | 'rounds';

interface RoundDefinition {
  key: RoundKey;
  label: string;
  shortLabel: string;
  fixtures: Fixture[];
  accent: string;
  glow: string;
}

function classifyFixtureRound(fixture: Fixture): RoundKey {
  const round = (fixture.roundName || '').toLowerCase();
  const id = (fixture.id || '').toLowerCase();
  if (round.includes('round of 16') || round.includes('nimchorak') || round.includes('1/8') || id.includes('-r16-m')) return 'R16';
  if (round.includes('quarter') || round.includes('chorak') || round.includes('1/4') || id.includes('-qf-m')) return 'QF';
  if ((round.includes('semi') || round.includes('yarim') || round.includes('1/2') || id.includes('-sf-m')) && !round.includes('quarter')) return 'SF';
  if (round.includes('final') && !round.includes('semi') && !round.includes('quarter')) return 'FINAL';
  if (round.includes('playoff') || round.includes('play-off') || id.includes('-po-m')) return 'PLAYOFF';
  if (round.includes('prelim') || round.includes('play-in') || round.includes('dastlabki') || round.includes('saralash')) return 'PRELIM';
  if (id.includes('-r5-m0')) return 'FINAL';
  if (id.includes('-r4-m') && Number(fixture.matchday) === 4) return 'SF';
  if (id.includes('-r3-m') && Number(fixture.matchday) === 3) return 'QF';
  if (id.includes('-r2-m') && Number(fixture.matchday) === 2) return 'R16';
  if (id.includes('-r1-m') && Number(fixture.matchday) === 1) return 'PRELIM';
  return 'UNKNOWN';
}

function fixtureIndex(fixture: Fixture): number {
  const match = String(fixture.id || '').match(/-m(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

function sourceLabel(fixture: Fixture, side: 'home' | 'away'): string {
  const explicit = side === 'home' ? (fixture as any).homeSourceLabel : (fixture as any).awaySourceLabel;
  if (explicit) return explicit;
  const sourceId = side === 'home' ? (fixture as any).homeSourceFixtureId : (fixture as any).awaySourceFixtureId;
  if (!sourceId) return 'Winner TBD';
  const match = String(sourceId).match(/-r(\d+)-m(\d+)$/i);
  if (!match) return 'Winner TBD';
  const round = Number(match[1]);
  const label = round === 1 ? 'Play-in' : round === 2 ? 'R16' : round === 3 ? 'QF' : round === 4 ? 'SF' : `R${round}`;
  return `Winner ${label} • M${Number(match[2]) + 1}`;
}

export const TournamentBracket: React.FC<TournamentBracketProps> = ({
  fixtures,
  currentClubId,
  userId,
  onSelectFixture,
  competition,
}) => {
  const { openUserProfile } = useUserProfile();
  const { t } = useI18n();
  const [activeRoundKey, setActiveRoundKey] = useState<RoundKey | null>(null);
  const [viewMode, setViewMode] = useState<BracketViewMode>('bracket');

  const rounds = useMemo<RoundDefinition[]>(() => {
    const buckets: Record<RoundKey, Fixture[]> = { PRELIM: [], PLAYOFF: [], R16: [], QF: [], SF: [], FINAL: [], UNKNOWN: [] };
    fixtures.forEach((fixture) => buckets[classifyFixtureRound(fixture)].push(fixture));
    Object.values(buckets).forEach((bucket) => bucket.sort((a, b) => fixtureIndex(a) - fixtureIndex(b)));
    const definitions: Array<Omit<RoundDefinition, 'fixtures'>> = [
      { key: 'PRELIM', label: 'Play-in', shortLabel: 'Play-in', accent: 'text-violet-300', glow: 'border-violet-400/25 bg-violet-500/[0.05]' },
      { key: 'PLAYOFF', label: 'Playoff', shortLabel: 'PO', accent: 'text-fuchsia-300', glow: 'border-fuchsia-400/25 bg-fuchsia-500/[0.05]' },
      { key: 'R16', label: 'Round of 16', shortLabel: 'R16', accent: 'text-blue-300', glow: 'border-blue-400/25 bg-blue-500/[0.05]' },
      { key: 'QF', label: 'Quarter-finals', shortLabel: 'QF', accent: 'text-cyan-300', glow: 'border-cyan-400/25 bg-cyan-500/[0.05]' },
      { key: 'SF', label: 'Semi-finals', shortLabel: 'SF', accent: 'text-orange-300', glow: 'border-orange-400/25 bg-orange-500/[0.05]' },
      { key: 'FINAL', label: 'Final', shortLabel: 'Final', accent: 'text-amber-300', glow: 'border-amber-400/30 bg-amber-500/[0.06]' },
    ];
    return definitions.map((definition) => ({ ...definition, fixtures: buckets[definition.key] })).filter((definition) => definition.fixtures.length > 0);
  }, [fixtures]);

  const currentRound = useMemo(() => {
    if (activeRoundKey) {
      const selected = rounds.find((round) => round.key === activeRoundKey);
      if (selected) return selected;
    }
    return rounds.find((round) => round.fixtures.some((fixture) => !['CONFIRMED', 'CANCELLED'].includes(fixture.status))) || rounds[rounds.length - 1] || null;
  }, [activeRoundKey, rounds]);

  const champion = useMemo(() => {
    const finalFixture = rounds.find((round) => round.key === 'FINAL')?.fixtures[0];
    if (!finalFixture || finalFixture.status !== 'CONFIRMED' || !finalFixture.winnerClubId) return null;
    if (finalFixture.winnerClubId === finalFixture.homeClubId) return finalFixture.homeClub || null;
    if (finalFixture.winnerClubId === finalFixture.awayClubId) return finalFixture.awayClub || null;
    return null;
  }, [rounds]);

  const completedCount = useMemo(() => fixtures.filter((fixture) => fixture.status === 'CONFIRMED').length, [fixtures]);
  const progress = fixtures.length ? Math.round((completedCount / fixtures.length) * 100) : 0;
  const currentRoundIndex = currentRound ? rounds.findIndex((round) => round.key === currentRound.key) : -1;

  const renderClubRow = (fixture: Fixture, side: 'home' | 'away') => {
    const home = side === 'home';
    const clubId = home ? fixture.homeClubId : fixture.awayClubId;
    const club = home ? fixture.homeClub : fixture.awayClub;
    const score = home ? fixture.homeScore : fixture.awayScore;
    const owner = home ? (fixture.homeOwner || fixture.homeUser) : (fixture.awayOwner || fixture.awayUser);
    const ownerId = home ? fixture.homeOwnerId : fixture.awayOwnerId;
    const tbd = !clubId || clubId === 'TBD' || club?.name === 'TBD';
    const winner = Boolean(fixture.winnerClubId && fixture.winnerClubId === clubId);
    const isMe = Boolean((currentClubId && currentClubId === clubId) || (userId && userId === ownerId));
    const ownerInfo = tbd ? null : getClubOwnerDisplay(club, owner, ownerId, t.userNeeded);

    return (
      <div className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 ${winner ? 'bg-emerald-400/[0.08]' : 'bg-white/[0.018]'}`}>
        {tbd ? (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-white/[0.12] bg-white/[0.025] text-[9px] font-black text-slate-600">?</div>
        ) : (
          <ClubCrest clubId={club?.id || clubId || undefined} logoUrl={club?.logoUrl} name={club?.name || String(clubId || '')} shortName={club?.shortName} size="xs" className="h-7 w-7 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <span className={`truncate text-xs ${winner ? 'font-black text-emerald-300' : tbd ? 'font-bold italic text-slate-500' : 'font-black text-slate-100'}`}>
              {tbd ? sourceLabel(fixture, side) : `${(home ? (fixture as any).homeSeedPosition : (fixture as any).awaySeedPosition) ? `#${home ? (fixture as any).homeSeedPosition : (fixture as any).awaySeedPosition} ` : ''}${club?.name || clubId}`}
            </span>
            {isMe && <span className="shrink-0 rounded bg-amber-400/15 px-1.5 py-0.5 text-[8px] font-black uppercase text-amber-300">Siz</span>}
          </div>
          {!tbd && (ownerInfo?.isClaimed && ownerInfo.userId ? (
            <button type="button" onClick={(event) => { event.stopPropagation(); openUserProfile(ownerInfo.userId!); }} className="mt-0.5 block max-w-full truncate text-left text-[9px] font-medium text-slate-500 hover:text-blue-300">{ownerInfo.displayText}</button>
          ) : (
            <div className="mt-0.5 truncate text-[9px] font-medium text-slate-600">{ownerInfo?.displayText || t.userNeeded}</div>
          ))}
        </div>
        <div className={`min-w-[30px] rounded-lg border px-2 py-1 text-center font-mono text-sm font-black ${winner ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-white/[0.07] bg-black/20 text-slate-300'}`}>{score ?? '–'}</div>
      </div>
    );
  };

  const renderMatchCard = (fixture: Fixture, round: RoundDefinition, index: number) => {
    const projected = Boolean((fixture as any).isProjected);
    const isMyMatch = Boolean((currentClubId && [fixture.homeClubId, fixture.awayClubId].includes(currentClubId)) || (userId && [fixture.homeOwnerId, fixture.awayOwnerId].includes(userId)));
    const status = projected ? 'Projected' : fixture.status === 'CONFIRMED' ? 'Finished' : fixture.status === 'DISPUTED' ? 'Disputed' : 'Open';
    return (
      <button
        key={fixture.id}
        type="button"
        onClick={() => { if (!projected) onSelectFixture?.(fixture); }}
        className={`group relative w-full overflow-hidden rounded-2xl border p-2.5 text-left shadow-xl transition ${round.key === 'FINAL' ? 'border-amber-300/30 bg-gradient-to-br from-amber-500/[0.10] via-slate-950 to-slate-950' : 'border-white/[0.08] bg-[#0a111e]/95'} ${isMyMatch ? 'ring-1 ring-amber-300/45' : ''}`}
      >
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-1.5"><span className={`text-[9px] font-black uppercase tracking-[0.16em] ${round.accent}`}>{round.shortLabel}</span><span className="text-[9px] font-bold text-slate-600">M{index + 1}</span></div>
          <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase ${fixture.status === 'CONFIRMED' ? 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300' : fixture.status === 'DISPUTED' ? 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300' : 'border-blue-400/20 bg-blue-400/[0.07] text-blue-300'}`}>
            {fixture.status === 'CONFIRMED' ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Radio className="h-2.5 w-2.5" />}{status}
          </span>
        </div>
        <div className="space-y-1.5">{renderClubRow(fixture, 'home')}{renderClubRow(fixture, 'away')}</div>
        {round.key === 'FINAL' && <div className="mt-2 flex items-center justify-center gap-1 text-[9px] font-black uppercase tracking-[0.18em] text-amber-300/70"><Trophy className="h-3 w-3" />Road to Champion</div>}
      </button>
    );
  };

  return (
    <section className="overflow-hidden rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(7,12,23,0.98),rgba(4,8,16,0.98))] shadow-2xl sm:rounded-[28px]">
      <div className="border-b border-white/[0.07] bg-[radial-gradient(circle_at_12%_10%,rgba(59,130,246,0.10),transparent_26%),radial-gradient(circle_at_88%_10%,rgba(251,191,36,0.10),transparent_24%)] p-3.5 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.18em] text-slate-500 sm:text-[10px]"><GitBranch className="h-3.5 w-3.5 text-blue-300" />Knockout bracket</div>
            <div className="mt-1 flex min-w-0 items-center gap-2"><h2 className="truncate text-lg font-black text-white sm:text-xl">{competition?.name || 'Domestic Cup'}</h2><span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.035] px-2 py-0.5 text-[8px] font-black text-slate-400 sm:text-[9px]">{fixtures.length} matches</span></div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="grid grid-cols-2 rounded-xl border border-white/[0.08] bg-black/20 p-1">
              <button type="button" onClick={() => setViewMode('bracket')} className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[9px] font-black uppercase transition sm:text-[10px] ${viewMode === 'bracket' ? 'bg-blue-500/15 text-blue-200 ring-1 ring-blue-400/20' : 'text-slate-500'}`}><LayoutGrid className="h-3.5 w-3.5" />Bracket</button>
              <button type="button" onClick={() => setViewMode('rounds')} className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[9px] font-black uppercase transition sm:text-[10px] ${viewMode === 'rounds' ? 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/20' : 'text-slate-500'}`}><Layers className="h-3.5 w-3.5" />Round to Round</button>
            </div>
            <div className="min-w-0 sm:w-[230px]"><div className="mb-1.5 flex items-center justify-between text-[8px] font-bold uppercase text-slate-500 sm:text-[9px]"><span>Tournament progress</span><span className="text-slate-300">{completedCount}/{fixtures.length}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-blue-400 via-cyan-300 to-amber-300" style={{ width: `${progress}%` }} /></div></div>
          </div>
        </div>
        {viewMode === 'rounds' && <div className="mt-4 flex gap-2 overflow-x-auto pb-1 scrollbar-none">{rounds.map((round) => <button key={round.key} type="button" onClick={() => setActiveRoundKey(round.key)} className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black ${currentRound?.key === round.key ? `${round.glow} ${round.accent}` : 'border-white/[0.07] bg-white/[0.025] text-slate-500'}`}>{round.fixtures.every((fixture) => fixture.status === 'CONFIRMED') && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}{round.label}<span className="text-[9px] opacity-60">{round.fixtures.length}</span></button>)}</div>}
      </div>

      {champion && <div className="relative overflow-hidden border-b border-amber-300/20 bg-[radial-gradient(circle_at_center,rgba(251,191,36,0.13),transparent_55%)] px-4 py-5 text-center sm:px-5 sm:py-6"><Sparkles className="absolute left-[18%] top-5 h-4 w-4 text-amber-300/40" /><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-300/25 bg-amber-400/[0.10]"><Crown className="h-5 w-5 text-amber-300" /></div><div className="mt-3 text-[8px] font-black uppercase tracking-[0.23em] text-amber-300/70">2026/27 Champion</div><div className="mt-1 text-lg font-black text-white">{champion.name}</div></div>}

      {viewMode === 'bracket' && <SofaBracketTree fixtures={fixtures} competition={competition} currentClubId={currentClubId} onSelectFixture={onSelectFixture} />}

      {viewMode === 'rounds' && currentRound && (
        <div className="mx-auto w-full max-w-3xl p-3 sm:p-4 lg:p-5">
          <div className={`mb-3 flex items-center justify-between rounded-2xl border p-2.5 sm:p-3 ${currentRound.glow}`}>
            <div><div className={`text-[9px] font-black uppercase tracking-[0.16em] sm:text-[10px] ${currentRound.accent}`}>{currentRound.label}</div><div className="mt-0.5 text-[11px] font-bold text-slate-400 sm:text-xs">{currentRound.fixtures.length} ta match</div></div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => { if (currentRoundIndex > 0) setActiveRoundKey(rounds[currentRoundIndex - 1].key); }} className="rounded-xl border border-white/[0.07] bg-black/20 p-2 text-slate-400 disabled:opacity-25" disabled={currentRoundIndex <= 0} aria-label="Previous round"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" onClick={() => { if (currentRoundIndex >= 0 && currentRoundIndex < rounds.length - 1) setActiveRoundKey(rounds[currentRoundIndex + 1].key); }} className="rounded-xl border border-white/[0.07] bg-black/20 p-2 text-slate-400 disabled:opacity-25" disabled={currentRoundIndex < 0 || currentRoundIndex >= rounds.length - 1} aria-label="Next round"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="space-y-3">{currentRound.fixtures.map((fixture, index) => renderMatchCard(fixture, currentRound, index))}</div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 border-t border-white/[0.06] bg-black/15 px-3 py-2.5 text-[8px] font-bold text-slate-600 sm:text-[9px]"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-400" />Open match</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />Confirmed winner</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-300" />Your path</span></div>
    </section>
  );
};