import React, { useMemo, useState } from 'react';
import { Club, Competition, Fixture } from '../types';
import { ClubCrest } from './ClubCrest';
import { SofaBracketTree } from './SofaBracketTree';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Crown,
  Flame,
  GitBranch,
  Medal,
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
  participants?: Club[];
}

type RoundKey = 'PRELIM' | 'PLAYOFF' | 'R16' | 'QF' | 'SF' | 'FINAL' | 'UNKNOWN';

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
  if (round.includes('prelim') || round.includes('dastlabki') || round.includes('saralash')) return 'PRELIM';

  // Legacy domestic-cup fixture IDs. 18/20-team cups use R1 as play-in.
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

function sourceLabel(sourceFixtureId?: string | null): string {
  if (!sourceFixtureId) return 'Winner TBD';
  const roundMatch = sourceFixtureId.match(/-r(\d+)-m(\d+)$/i);
  if (!roundMatch) return 'Winner TBD';
  const roundNumber = Number(roundMatch[1]);
  const matchNumber = Number(roundMatch[2]) + 1;
  const roundName = roundNumber === 1 ? 'Play-in' : roundNumber === 2 ? 'R16' : roundNumber === 3 ? 'QF' : roundNumber === 4 ? 'SF' : `R${roundNumber}`;
  return `Winner ${roundName} • M${matchNumber}`;
}

export const TournamentBracket: React.FC<TournamentBracketProps> = ({
  fixtures,
  currentClubId,
  userId,
  onSelectFixture,
  competition,
  participants = [],
}) => {
  const { openUserProfile } = useUserProfile();
  const { t } = useI18n();
  const [activeRoundKey, setActiveRoundKey] = useState<RoundKey | null>(null);

  const rounds = useMemo<RoundDefinition[]>(() => {
    const buckets: Record<RoundKey, Fixture[]> = {
      PRELIM: [],
      PLAYOFF: [],
      R16: [],
      QF: [],
      SF: [],
      FINAL: [],
      UNKNOWN: [],
    };

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

    return definitions
      .map((definition) => ({ ...definition, fixtures: buckets[definition.key] }))
      .filter((definition) => definition.fixtures.length > 0);
  }, [fixtures]);

  const currentRound = useMemo(() => {
    if (activeRoundKey) {
      const selected = rounds.find((round) => round.key === activeRoundKey);
      if (selected) return selected;
    }
    return rounds.find((round) => round.fixtures.some((fixture) => !['CONFIRMED', 'CANCELLED'].includes(fixture.status))) || rounds[rounds.length - 1] || null;
  }, [activeRoundKey, rounds]);

  const champion = useMemo(() => {
    const finalRound = rounds.find((round) => round.key === 'FINAL');
    const finalFixture = finalRound?.fixtures[0];
    if (!finalFixture || finalFixture.status !== 'CONFIRMED' || !finalFixture.winnerClubId) return null;
    if (finalFixture.winnerClubId === finalFixture.homeClubId) return finalFixture.homeClub || null;
    if (finalFixture.winnerClubId === finalFixture.awayClubId) return finalFixture.awayClub || null;
    return null;
  }, [rounds]);

  const completedCount = useMemo(() => fixtures.filter((fixture) => fixture.status === 'CONFIRMED').length, [fixtures]);
  const progress = fixtures.length ? Math.round((completedCount / fixtures.length) * 100) : 0;

  const renderClubRow = (fixture: Fixture, side: 'home' | 'away') => {
    const isHome = side === 'home';
    const clubId = isHome ? fixture.homeClubId : fixture.awayClubId;
    const club = isHome ? fixture.homeClub : fixture.awayClub;
    const score = isHome ? fixture.homeScore : fixture.awayScore;
    const owner = isHome ? (fixture.homeOwner || fixture.homeUser) : (fixture.awayOwner || fixture.awayUser);
    const ownerId = isHome ? fixture.homeOwnerId : fixture.awayOwnerId;
    const sourceFixtureId = isHome ? (fixture as any).homeSourceFixtureId : (fixture as any).awaySourceFixtureId;
    const customSourceLabel = isHome ? (fixture as any).homeSourceLabel : (fixture as any).awaySourceLabel;
    const seedPosition = isHome ? (fixture as any).homeSeedPosition : (fixture as any).awaySeedPosition;
    const tbd = !clubId || clubId === 'TBD' || club?.name === 'TBD';
    const winner = Boolean(fixture.winnerClubId && fixture.winnerClubId === clubId);
    const isMe = Boolean((currentClubId && currentClubId === clubId) || (userId && userId === ownerId));
    const ownerInfo = tbd ? null : getClubOwnerDisplay(club, owner, ownerId, t.userNeeded);

    return (
      <div className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition ${winner ? 'bg-emerald-400/[0.08]' : 'bg-white/[0.018]'}`}>
        <div className="relative shrink-0">
          {tbd ? (
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-white/[0.12] bg-white/[0.025] text-[9px] font-black text-slate-600">?</div>
          ) : (
            <ClubCrest
              clubId={club?.id || clubId || undefined}
              logoUrl={club?.logoUrl}
              name={club?.name || String(clubId || '')}
              shortName={club?.shortName}
              size="xs"
              className="h-7 w-7"
            />
          )}
          {winner && <div className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[#0b1220] bg-emerald-400" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`truncate text-xs ${winner ? 'font-black text-emerald-300' : tbd ? 'font-bold italic text-slate-500' : 'font-black text-slate-100'}`}>
              {tbd ? (customSourceLabel || sourceLabel(sourceFixtureId)) : `${seedPosition ? `#${seedPosition} ` : ''}${club?.name || clubId}`}
            </span>
            {isMe && <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-amber-300">Siz</span>}
          </div>
          {!tbd && (
            ownerInfo?.isClaimed && ownerInfo.userId ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  openUserProfile(ownerInfo.userId!);
                }}
                className="mt-0.5 block max-w-full truncate text-left text-[9px] font-medium text-slate-500 transition hover:text-blue-300"
              >
                {ownerInfo.displayText}
              </button>
            ) : (
              <div className="mt-0.5 truncate text-[9px] font-medium text-slate-600">{ownerInfo?.displayText || t.userNeeded}</div>
            )
          )}
        </div>

        <div className={`min-w-[30px] rounded-lg border px-2 py-1 text-center font-mono text-sm font-black ${winner ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-white/[0.07] bg-black/20 text-slate-300'}`}>
          {score !== null && score !== undefined ? score : '–'}
        </div>
      </div>
    );
  };

  const renderMatchCard = (fixture: Fixture, round: RoundDefinition, index: number, featured = false) => {
    const isMyMatch = Boolean(
      (currentClubId && [fixture.homeClubId, fixture.awayClubId].includes(currentClubId)) ||
      (userId && [fixture.homeOwnerId, fixture.awayOwnerId].includes(userId))
    );
    const isProjected = Boolean((fixture as any).isProjected);
    const statusLabel = isProjected ? 'Projected' : fixture.status === 'CONFIRMED' ? 'Finished' : fixture.status === 'DISPUTED' ? 'Disputed' : 'Open';
    const canOpen = Boolean(onSelectFixture && !isProjected);

    return (
      <button
        key={fixture.id}
        type="button"
        onClick={() => { if (!isProjected) onSelectFixture?.(fixture); }}
        className={`group relative w-full overflow-hidden rounded-2xl border p-2.5 text-left shadow-xl transition duration-200 ${featured ? 'min-h-[158px] border-amber-300/30 bg-gradient-to-br from-amber-500/[0.10] via-slate-950 to-slate-950' : 'border-white/[0.08] bg-[#0a111e]/95'} ${isMyMatch ? 'ring-1 ring-amber-300/45 shadow-amber-500/10' : ''} ${canOpen ? 'hover:-translate-y-0.5 hover:border-white/[0.18]' : ''}`}
      >
        {featured && <div className="pointer-events-none absolute right-0 top-0 h-20 w-20 rounded-bl-full bg-amber-400/[0.05]" />}
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-1.5">
            <span className={`text-[9px] font-black uppercase tracking-[0.16em] ${round.accent}`}>{round.shortLabel}</span>
            <span className="text-[9px] font-bold text-slate-600">M{index + 1}</span>
          </div>
          <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-wide ${isProjected ? 'border-violet-400/20 bg-violet-400/[0.08] text-violet-300' : fixture.status === 'CONFIRMED' ? 'border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300' : fixture.status === 'DISPUTED' ? 'border-rose-400/20 bg-rose-400/[0.08] text-rose-300' : 'border-blue-400/20 bg-blue-400/[0.07] text-blue-300'}`}>
            {fixture.status === 'CONFIRMED' ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Radio className="h-2.5 w-2.5" />}
            {statusLabel}
          </span>
        </div>

        <div className="space-y-1.5">
          {renderClubRow(fixture, 'home')}
          {renderClubRow(fixture, 'away')}
        </div>

        {featured && (
          <div className="mt-2 flex items-center justify-center gap-1 text-[9px] font-black uppercase tracking-[0.18em] text-amber-300/70">
            <Trophy className="h-3 w-3" />
            Road to Champion
          </div>
        )}
      </button>
    );
  };

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(7,12,23,0.98),rgba(4,8,16,0.98))] shadow-2xl">
      <div className="border-b border-white/[0.07] bg-[radial-gradient(circle_at_12%_10%,rgba(59,130,246,0.10),transparent_26%),radial-gradient(circle_at_88%_10%,rgba(251,191,36,0.10),transparent_24%)] p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
              <GitBranch className="h-3.5 w-3.5 text-blue-300" />
              Knockout bracket
            </div>
            <div className="mt-1 flex items-center gap-2">
              <h2 className="text-lg font-black tracking-tight text-white sm:text-xl">{competition?.name || 'Domestic Cup'}</h2>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2 py-0.5 text-[9px] font-black text-slate-400">{fixtures.length} matches</span>
            </div>
          </div>

          <div className="min-w-[230px]">
            <div className="mb-1.5 flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-slate-500">
              <span>Tournament progress</span>
              <span className="text-slate-300">{completedCount}/{fixtures.length}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-gradient-to-r from-blue-400 via-cyan-300 to-amber-300 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1 scrollbar-none lg:hidden">
          {rounds.map((round) => {
            const active = currentRound?.key === round.key;
            const completed = round.fixtures.every((fixture) => fixture.status === 'CONFIRMED');
            return (
              <button
                key={round.key}
                type="button"
                onClick={() => setActiveRoundKey(round.key)}
                className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-black transition ${active ? `${round.glow} ${round.accent}` : 'border-white/[0.07] bg-white/[0.025] text-slate-500'}`}
              >
                {completed && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                {round.label}
                <span className="text-[9px] opacity-60">{round.fixtures.length}</span>
              </button>
            );
          })}
        </div>
      </div>

      <SofaBracketTree
        fixtures={fixtures}
        competition={competition}
        participants={participants}
        currentClubId={currentClubId}
        onSelectFixture={onSelectFixture}
      />

      {champion && (
        <div className="relative overflow-hidden border-b border-amber-300/20 bg-[radial-gradient(circle_at_center,rgba(251,191,36,0.13),transparent_55%)] px-5 py-6 text-center">
          <Sparkles className="absolute left-[18%] top-5 h-4 w-4 text-amber-300/40" />
          <Sparkles className="absolute right-[18%] top-10 h-3 w-3 text-amber-300/30" />
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-300/25 bg-amber-400/[0.10] shadow-lg shadow-amber-500/10">
            <Crown className="h-6 w-6 text-amber-300" />
          </div>
          <div className="mt-3 text-[9px] font-black uppercase tracking-[0.25em] text-amber-300/70">2026/27 Champion</div>
          <div className="mt-1 text-xl font-black text-white">{champion.name}</div>
        </div>
      )}

      <div className="lg:hidden">
        {currentRound && (
          <div className="p-4">
            <div className={`mb-3 flex items-center justify-between rounded-2xl border p-3 ${currentRound.glow}`}>
              <div>
                <div className={`text-[10px] font-black uppercase tracking-[0.18em] ${currentRound.accent}`}>{currentRound.label}</div>
                <div className="mt-0.5 text-xs font-bold text-slate-400">{currentRound.fixtures.length} ta match</div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const index = rounds.findIndex((round) => round.key === currentRound.key);
                    if (index > 0) setActiveRoundKey(rounds[index - 1].key);
                  }}
                  className="rounded-xl border border-white/[0.07] bg-black/20 p-2 text-slate-400 disabled:opacity-25"
                  disabled={rounds.findIndex((round) => round.key === currentRound.key) <= 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const index = rounds.findIndex((round) => round.key === currentRound.key);
                    if (index >= 0 && index < rounds.length - 1) setActiveRoundKey(rounds[index + 1].key);
                  }}
                  className="rounded-xl border border-white/[0.07] bg-black/20 p-2 text-slate-400 disabled:opacity-25"
                  disabled={rounds.findIndex((round) => round.key === currentRound.key) >= rounds.length - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {currentRound.fixtures.map((fixture, index) => renderMatchCard(fixture, currentRound, index, currentRound.key === 'FINAL'))}
            </div>
          </div>
        )}
      </div>

      <div className="hidden">
        <div className="overflow-x-auto p-5 scrollbar-thin">
          <div className="flex min-w-max items-stretch gap-5">
            {rounds.map((round, roundIndex) => (
              <React.Fragment key={round.key}>
                <div className={`flex w-[270px] flex-col rounded-[22px] border p-3 ${round.glow}`}>
                  <div className="mb-3 flex items-center justify-between border-b border-white/[0.06] pb-2">
                    <div>
                      <div className={`text-[10px] font-black uppercase tracking-[0.18em] ${round.accent}`}>{round.label}</div>
                      <div className="mt-0.5 text-[9px] font-bold text-slate-600">{round.fixtures.length} matches</div>
                    </div>
                    <div className={`flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.07] bg-black/20 ${round.accent}`}>
                      {round.key === 'FINAL' ? <Trophy className="h-4 w-4" /> : round.key === 'SF' ? <Medal className="h-4 w-4" /> : round.key === 'PRELIM' ? <Flame className="h-4 w-4" /> : <GitBranch className="h-4 w-4" />}
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col justify-around gap-3">
                    {round.fixtures.map((fixture, index) => renderMatchCard(fixture, round, index, round.key === 'FINAL'))}
                  </div>
                </div>

                {roundIndex < rounds.length - 1 && (
                  <div className="flex w-7 shrink-0 items-center justify-center">
                    <div className="relative h-full w-px bg-gradient-to-b from-transparent via-white/[0.09] to-transparent">
                      <div className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/[0.08] bg-[#080e19] text-slate-600">
                        <ChevronRight className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-white/[0.06] bg-black/15 px-4 py-3 text-[9px] font-bold text-slate-600">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-400" /> Open match</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Confirmed winner</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-300" /> Your path</span>
      </div>
    </section>
  );
};
