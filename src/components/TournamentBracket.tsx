import React, { useRef, useState, useMemo } from 'react';
import { Fixture, Competition } from '../types';
import { ClubCrest } from './ClubCrest';
import {
  Trophy,
  Swords,
  Sparkles,
  CheckCircle2,
  Send,
  ChevronRight,
  ChevronLeft,
  Calendar,
  Clock,
  Shield,
  Layers,
  LayoutGrid,
} from 'lucide-react';
import { useUserProfile } from '../context/UserProfileContext';
import { useI18n } from '../i18n';
import { getClubOwnerDisplay } from '../lib/ownerUtils';
import { openTelegramChat, isValidTelegramUsername } from '../lib/telegramUtils';

interface TournamentBracketProps {
  fixtures: Fixture[];
  currentClubId?: string;
  userId?: string;
  onSelectFixture?: (fixture: Fixture) => void;
  competition?: Competition | null;
}

// Classifier for fixture rounds
function classifyFixtureRound(f: Fixture): 'PRELIM' | 'PLAYOFF' | 'R16' | 'QF' | 'SF' | 'FINAL' | 'UNKNOWN' {
  const rn = (f.roundName || '').toLowerCase();
  const id = (f.id || '').toLowerCase();

  if (
    rn.includes('prelim') ||
    rn.includes('dastlabki') ||
    rn.includes('saralash') ||
    (id.includes('-r1-m') && f.matchday === 1)
  ) {
    return 'PRELIM';
  }
  if (rn.includes('playoff') || rn.includes('play-off') || id.includes('-po-m')) {
    return 'PLAYOFF';
  }
  if (
    rn.includes('16') ||
    rn.includes('nimchorak') ||
    rn.includes('1/8') ||
    id.includes('-r16-m') ||
    (id.includes('-r2-m') && f.matchday === 2)
  ) {
    return 'R16';
  }
  if (
    rn.includes('quarter') ||
    rn.includes('chorak') ||
    rn.includes('1/4') ||
    id.includes('-qf-m') ||
    (id.includes('-r3-m') && f.matchday === 3)
  ) {
    return 'QF';
  }
  if (
    (rn.includes('semi') ||
      rn.includes('yarim') ||
      rn.includes('1/2') ||
      id.includes('-sf-m') ||
      (id.includes('-r4-m') && f.matchday === 4)) &&
    !rn.includes('quarter')
  ) {
    return 'SF';
  }
  if (
    rn.includes('final') &&
    !rn.includes('semi') &&
    !rn.includes('quarter') &&
    !rn.includes('16') &&
    !rn.includes('nimchorak')
  ) {
    return 'FINAL';
  }
  if (id.includes('-r5-m0') || id.includes('-final-m0')) {
    return 'FINAL';
  }
  return 'UNKNOWN';
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

  const [viewMode, setViewMode] = useState<'tree' | 'arena'>('tree');
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Categorize and sort fixtures
  const { prelimFixtures, playoffFixtures, r16Fixtures, qfFixtures, sfFixtures, finalFixture } = useMemo(() => {
    const prelim: Fixture[] = [];
    const playoff: Fixture[] = [];
    const r16: Fixture[] = [];
    const qf: Fixture[] = [];
    const sf: Fixture[] = [];
    let finalMatch: Fixture | null = null;

    fixtures.forEach((f) => {
      const type = classifyFixtureRound(f);
      if (type === 'PRELIM') prelim.push(f);
      else if (type === 'PLAYOFF') playoff.push(f);
      else if (type === 'R16') r16.push(f);
      else if (type === 'QF') qf.push(f);
      else if (type === 'SF') sf.push(f);
      else if (type === 'FINAL') finalMatch = f;
    });

    const sortFn = (a: Fixture, b: Fixture) => {
      const aIdx = parseInt(a.id.split('-m')[1] || '0', 10);
      const bIdx = parseInt(b.id.split('-m')[1] || '0', 10);
      return aIdx - bIdx;
    };

    return {
      prelimFixtures: prelim.sort(sortFn),
      playoffFixtures: playoff.sort(sortFn),
      r16Fixtures: r16.sort(sortFn),
      qfFixtures: qf.sort(sortFn),
      sfFixtures: sf.sort(sortFn),
      finalFixture: finalMatch,
    };
  }, [fixtures]);

  const hasPrelim = prelimFixtures.length > 0;
  const hasPlayoff = playoffFixtures.length > 0;
  const hasR16 = r16Fixtures.length > 0;
  const hasQF = qfFixtures.length > 0;
  const hasSF = sfFixtures.length > 0;

  const scrollToRound = (id: string) => {
    const el = document.getElementById(id);
    if (el && scrollContainerRef.current) {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  };

  // Champion calculation
  const championClub = useMemo(() => {
    if (!finalFixture || finalFixture.status !== 'CONFIRMED' || !finalFixture.winnerClubId) {
      return null;
    }
    if (finalFixture.winnerClubId === finalFixture.homeClubId) {
      return finalFixture.homeClub;
    }
    if (finalFixture.winnerClubId === finalFixture.awayClubId) {
      return finalFixture.awayClub;
    }
    return null;
  }, [finalFixture]);

  // Render individual Match Card
  const renderMatchCard = (fixture: Fixture | null, matchLabel: string, isCenterFinal = false) => {
    if (!fixture) {
      return (
        <div className="w-[260px] sm:w-[280px] bg-slate-900/60 p-3.5 rounded-2xl border border-white/[0.06] flex flex-col justify-center min-h-[96px] shadow-sm select-none">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span>{matchLabel}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-500 font-mono">TBD</span>
          </div>
          <div className="text-xs text-slate-500 italic">Kutilmoqda / TBD</div>
        </div>
      );
    }

    const isUserMatch =
      (currentClubId && (fixture.homeClubId === currentClubId || fixture.awayClubId === currentClubId)) ||
      (userId && (fixture.homeOwnerId === userId || fixture.awayOwnerId === userId));

    const isHomeWinner = fixture.winnerClubId
      ? fixture.winnerClubId === fixture.homeClubId
      : fixture.homeScore !== null &&
        fixture.awayScore !== null &&
        fixture.homeScore! > fixture.awayScore!;

    const isAwayWinner = fixture.winnerClubId
      ? fixture.winnerClubId === fixture.awayClubId
      : fixture.homeScore !== null &&
        fixture.awayScore !== null &&
        fixture.awayScore! > fixture.homeScore!;

    const isHomeUser =
      (currentClubId && fixture.homeClubId === currentClubId) || (userId && fixture.homeOwnerId === userId);
    const isAwayUser =
      (currentClubId && fixture.awayClubId === currentClubId) || (userId && fixture.awayOwnerId === userId);

    const isHomeTbd = !fixture.homeClubId || fixture.homeClubId === 'TBD' || fixture.homeClub?.name === 'TBD';
    const isAwayTbd = !fixture.awayClubId || fixture.awayClubId === 'TBD' || fixture.awayClub?.name === 'TBD';

    const homeOwnerInfo = isHomeTbd
      ? null
      : getClubOwnerDisplay(fixture.homeClub, fixture.homeUser, fixture.homeOwnerId, t.userNeeded);
    const awayOwnerInfo = isAwayTbd
      ? null
      : getClubOwnerDisplay(fixture.awayClub, fixture.awayUser, fixture.awayOwnerId, t.userNeeded);

    const oppOwnerInfo = isHomeUser ? awayOwnerInfo : isAwayUser ? homeOwnerInfo : null;
    const hasOppTg = oppOwnerInfo && isValidTelegramUsername(oppOwnerInfo.username);

    return (
      <div
        id={fixture.id}
        onClick={() => onSelectFixture?.(fixture)}
        className={`w-[260px] sm:w-[280px] bg-slate-900/95 p-3 sm:p-3.5 rounded-2xl border transition-all duration-200 shadow-lg cursor-pointer group hover:scale-[1.01] ${
          isUserMatch
            ? 'border-amber-400/80 bg-amber-950/25 ring-1 ring-amber-400/40 shadow-amber-500/10'
            : isCenterFinal
            ? 'border-amber-500/50 bg-amber-950/30 shadow-amber-500/10'
            : 'border-white/[0.12] hover:border-white/[0.30] bg-[#0c1322]'
        }`}
      >
        {/* Match Header Bar */}
        <div className="flex items-center justify-between text-[10px] mb-2 pb-1.5 border-b border-white/[0.06]">
          <span className="font-bold text-slate-300 truncate max-w-[140px] tracking-tight">{matchLabel}</span>
          <span
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-1 ${
              fixture.status === 'CONFIRMED'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : fixture.status === 'DISPUTED'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                : 'bg-white/[0.06] text-slate-400'
            }`}
          >
            {fixture.status === 'CONFIRMED' && <CheckCircle2 className="w-2.5 h-2.5" />}
            {fixture.status === 'CONFIRMED' ? 'Tugagan' : fixture.status === 'DISPUTED' ? 'Nizo' : 'Kutilmoqda'}
          </span>
        </div>

        {/* Home Team Row */}
        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <ClubCrest
              clubId={fixture.homeClub?.id}
              logoUrl={fixture.homeClub?.logoUrl}
              name={fixture.homeClub?.name || 'Home'}
              shortName={fixture.homeClub?.shortName}
              size="xs"
              className="w-5 h-5 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span
                  className={`text-xs truncate block ${
                    isHomeWinner
                      ? 'font-black text-emerald-400'
                      : isHomeTbd
                      ? 'font-medium text-slate-500 italic'
                      : 'font-bold text-slate-100'
                  }`}
                >
                  {isHomeTbd ? 'TBD / Aniqlanmoqda' : fixture.homeClub?.name || 'Home'}
                </span>
                {isHomeUser && (
                  <span className="text-[8px] font-black text-emerald-400 bg-emerald-500/20 border border-emerald-500/30 px-1 py-0.2 rounded shrink-0">
                    Siz
                  </span>
                )}
              </div>
              {isHomeTbd ? (
                <span className="text-[9px] text-slate-500 italic block">Aniqlanmoqda</span>
              ) : homeOwnerInfo?.isClaimed ? (
                homeOwnerInfo.userId ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openUserProfile(homeOwnerInfo.userId!);
                    }}
                    className="text-[9px] text-slate-400 hover:text-emerald-400 truncate block text-left transition-colors font-medium"
                  >
                    {homeOwnerInfo.displayText}
                  </button>
                ) : (
                  <span className="text-[9px] text-slate-400 truncate block font-medium">
                    {homeOwnerInfo.displayText}
                  </span>
                )
              ) : (
                <span className="text-[9px] text-amber-400/90 font-bold truncate block">
                  {t.userNeeded}
                </span>
              )}
            </div>
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded-lg font-mono font-black shrink-0 ml-1.5 ${
              isHomeWinner
                ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/30'
                : 'bg-white/[0.06] text-slate-200'
            }`}
          >
            {fixture.homeScore !== null && fixture.homeScore !== undefined ? fixture.homeScore : '-'}
          </span>
        </div>

        {/* Subtle separator */}
        <div className="my-1 border-t border-white/[0.04]" />

        {/* Away Team Row */}
        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <ClubCrest
              clubId={fixture.awayClub?.id}
              logoUrl={fixture.awayClub?.logoUrl}
              name={fixture.awayClub?.name || 'Away'}
              shortName={fixture.awayClub?.shortName}
              size="xs"
              className="w-5 h-5 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span
                  className={`text-xs truncate block ${
                    isAwayWinner
                      ? 'font-black text-emerald-400'
                      : isAwayTbd
                      ? 'font-medium text-slate-500 italic'
                      : 'font-bold text-slate-100'
                  }`}
                >
                  {isAwayTbd ? 'TBD / Aniqlanmoqda' : fixture.awayClub?.name || 'Away'}
                </span>
                {isAwayUser && (
                  <span className="text-[8px] font-black text-emerald-400 bg-emerald-500/20 border border-emerald-500/30 px-1 py-0.2 rounded shrink-0">
                    Siz
                  </span>
                )}
              </div>
              {isAwayTbd ? (
                <span className="text-[9px] text-slate-500 italic block">Aniqlanmoqda</span>
              ) : awayOwnerInfo?.isClaimed ? (
                awayOwnerInfo.userId ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openUserProfile(awayOwnerInfo.userId!);
                    }}
                    className="text-[9px] text-slate-400 hover:text-emerald-400 truncate block text-left transition-colors font-medium"
                  >
                    {awayOwnerInfo.displayText}
                  </button>
                ) : (
                  <span className="text-[9px] text-slate-400 truncate block font-medium">
                    {awayOwnerInfo.displayText}
                  </span>
                )
              ) : (
                <span className="text-[9px] text-amber-400/90 font-bold truncate block">
                  {t.userNeeded}
                </span>
              )}
            </div>
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded-lg font-mono font-black shrink-0 ml-1.5 ${
              isAwayWinner
                ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/30'
                : 'bg-white/[0.06] text-slate-200'
            }`}
          >
            {fixture.awayScore !== null && fixture.awayScore !== undefined ? fixture.awayScore : '-'}
          </span>
        </div>

        {/* Opponent Telegram Contact Button if user's match */}
        {isUserMatch && hasOppTg && oppOwnerInfo?.username && (
          <div className="pt-2 border-t border-white/[0.06] mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openTelegramChat(oppOwnerInfo.username!);
              }}
              className="text-[10px] font-bold px-2.5 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 transition-all flex items-center gap-1.5 shadow-sm min-h-[32px] touch-manipulation"
            >
              <Send className="w-3 h-3" />
              <span>Raqibga yozish (@{oppOwnerInfo.username})</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Top Toolbar: View switch & Quick Jump */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-2xl border border-white/[0.06]">
        {/* Quick jump round pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none text-xs font-bold">
          {hasPrelim && (
            <button
              type="button"
              onClick={() => scrollToRound('col-prelim')}
              className="px-2.5 py-1 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 transition-colors shrink-0"
            >
              Dastlabki saralash
            </button>
          )}
          {hasPlayoff && (
            <button
              type="button"
              onClick={() => scrollToRound('col-playoff')}
              className="px-2.5 py-1 rounded-xl bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 transition-colors shrink-0"
            >
              Play-offs (9–24)
            </button>
          )}
          {hasR16 && (
            <button
              type="button"
              onClick={() => scrollToRound('col-r16')}
              className="px-2.5 py-1 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 transition-colors shrink-0"
            >
              Nimchorak final
            </button>
          )}
          {hasQF && (
            <button
              type="button"
              onClick={() => scrollToRound('col-qf')}
              className="px-2.5 py-1 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 transition-colors shrink-0"
            >
              Chorak final
            </button>
          )}
          {hasSF && (
            <button
              type="button"
              onClick={() => scrollToRound('col-sf')}
              className="px-2.5 py-1 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 transition-colors shrink-0"
            >
              Yarim final
            </button>
          )}
          <button
            type="button"
            onClick={() => scrollToRound('col-final')}
            className="px-3 py-1 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 transition-colors shrink-0 flex items-center gap-1 font-black"
          >
            <Trophy className="w-3.5 h-3.5" />
            <span>Katta Final</span>
          </button>
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center gap-1 shrink-0 bg-slate-950/60 p-1 rounded-xl border border-white/[0.08] self-end sm:self-auto">
          <button
            type="button"
            onClick={() => setViewMode('tree')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'tree'
                ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Bosqichlar (Tree)</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('arena')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              viewMode === 'arena'
                ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Klassik Arena</span>
          </button>
        </div>
      </div>

      {/* Champion Celebration Banner if crowned */}
      {championClub && (
        <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-amber-500/20 via-amber-500/10 to-amber-500/20 border border-amber-400/50 shadow-xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/50 flex items-center justify-center shadow-inner shrink-0">
              <Trophy className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider text-amber-400">
                Turnir Chempioni Cownasi
              </div>
              <div className="text-base sm:text-lg font-black text-white flex items-center gap-2">
                <ClubCrest
                  clubId={championClub.id}
                  logoUrl={championClub.logoUrl}
                  name={championClub.name}
                  size="sm"
                  className="w-5 h-5 inline-block"
                />
                <span>{championClub.name}</span>
              </div>
            </div>
          </div>
          <span className="text-xs font-black px-3 py-1.5 rounded-xl bg-amber-500 text-slate-950 shadow-md">
            G‘OLIB
          </span>
        </div>
      )}

      {/* VIEW 1: HORIZONTAL PROGRESSIVE TREE BRACKET */}
      {viewMode === 'tree' && (
        <div
          ref={scrollContainerRef}
          className="bg-slate-950/80 p-4 sm:p-6 rounded-3xl border border-white/[0.08] shadow-2xl overflow-x-auto scrollbar-thin scroll-smooth"
        >
          <div className="inline-flex gap-8 min-w-full pb-4">
            {/* 1. Preliminary Round (for 18/20-team domestic cups) */}
            {hasPrelim && (
              <div id="col-prelim" className="flex flex-col space-y-4 shrink-0">
                <div className="text-center pb-2 border-b border-white/[0.08]">
                  <div className="text-xs font-black uppercase text-amber-400 tracking-wider">
                    Dastlabki Saralash
                  </div>
                  <div className="text-[10px] text-slate-400 font-semibold">
                    {prelimFixtures.length} ta o‘yin
                  </div>
                </div>
                <div className="flex flex-col justify-around gap-6 flex-1">
                  {prelimFixtures.map((f, i) => (
                    <div key={f.id}>{renderMatchCard(f, `Saralash #${i + 1}`)}</div>
                  ))}
                </div>
              </div>
            )}

            {/* 2. Play-offs (for UCL / UEL 9th-24th seeds) */}
            {hasPlayoff && (
              <div id="col-playoff" className="flex flex-col space-y-4 shrink-0">
                <div className="text-center pb-2 border-b border-indigo-500/30">
                  <div className="text-xs font-black uppercase text-indigo-400 tracking-wider">
                    Knockout Play-offs
                  </div>
                  <div className="text-[10px] text-indigo-300/80 font-semibold">
                    9–24-o‘rinlar ({playoffFixtures.length} ta o‘yin)
                  </div>
                </div>
                <div className="flex flex-col justify-around gap-4 flex-1">
                  {playoffFixtures.map((f, i) => (
                    <div key={f.id}>{renderMatchCard(f, `Play-off #${i + 1}`)}</div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. Round of 16 */}
            {hasR16 && (
              <div id="col-r16" className="flex flex-col space-y-4 shrink-0">
                <div className="text-center pb-2 border-b border-white/[0.08]">
                  <div className="text-xs font-black uppercase text-slate-200 tracking-wider">
                    Nimchorak Final
                  </div>
                  <div className="text-[10px] text-slate-400 font-semibold">
                    Round of 16 ({r16Fixtures.length} ta o‘yin)
                  </div>
                </div>
                <div className="flex flex-col justify-around gap-6 flex-1">
                  {r16Fixtures.map((f, i) => (
                    <div key={f.id}>{renderMatchCard(f, `R16 #${i + 1}`)}</div>
                  ))}
                </div>
              </div>
            )}

            {/* 4. Quarter-Finals */}
            {hasQF && (
              <div id="col-qf" className="flex flex-col space-y-4 shrink-0">
                <div className="text-center pb-2 border-b border-white/[0.08]">
                  <div className="text-xs font-black uppercase text-slate-200 tracking-wider">
                    Chorak Final
                  </div>
                  <div className="text-[10px] text-slate-400 font-semibold">
                    Quarter-Finals ({qfFixtures.length} ta o‘yin)
                  </div>
                </div>
                <div className="flex flex-col justify-around gap-8 flex-1">
                  {qfFixtures.map((f, i) => (
                    <div key={f.id}>{renderMatchCard(f, `Chorak #${i + 1}`)}</div>
                  ))}
                </div>
              </div>
            )}

            {/* 5. Semi-Finals */}
            {hasSF && (
              <div id="col-sf" className="flex flex-col space-y-4 shrink-0">
                <div className="text-center pb-2 border-b border-white/[0.08]">
                  <div className="text-xs font-black uppercase text-slate-200 tracking-wider">
                    Yarim Final
                  </div>
                  <div className="text-[10px] text-slate-400 font-semibold">
                    Semi-Finals ({sfFixtures.length} ta o‘yin)
                  </div>
                </div>
                <div className="flex flex-col justify-around gap-12 flex-1">
                  {sfFixtures.map((f, i) => (
                    <div key={f.id}>{renderMatchCard(f, `Yarim Final #${i + 1}`)}</div>
                  ))}
                </div>
              </div>
            )}

            {/* 6. Grand Final */}
            <div id="col-final" className="flex flex-col space-y-4 shrink-0">
              <div className="text-center pb-2 border-b border-amber-500/40">
                <div className="text-xs font-black uppercase text-amber-400 tracking-wider flex items-center justify-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5" />
                  <span>Katta Final</span>
                </div>
                <div className="text-[10px] text-amber-300/80 font-semibold">
                  Grand Final (1 ta o‘yin)
                </div>
              </div>
              <div className="flex flex-col justify-center items-center flex-1 py-8">
                <div className="w-14 h-14 rounded-full bg-amber-500/20 border-2 border-amber-400/50 flex items-center justify-center mb-4 shadow-lg shadow-amber-500/20">
                  <Trophy className="w-7 h-7 text-amber-400" />
                </div>
                <div className="text-xs font-black uppercase tracking-widest text-amber-300 mb-3">
                  Kubok Sohibi Uchun Jang
                </div>
                {renderMatchCard(finalFixture, 'GRAND FINAL', true)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: CLASSIC ARENA SYMMETRIC BRACKET (CONVERGING IN THE CENTER) */}
      {viewMode === 'arena' && (
        <div
          ref={scrollContainerRef}
          className="bg-slate-950/80 p-4 sm:p-6 rounded-3xl border border-white/[0.08] shadow-2xl overflow-x-auto scrollbar-thin scroll-smooth"
        >
          {/* Header Row */}
          <div className="grid grid-cols-5 gap-4 mb-6 px-2 text-center text-xs font-black uppercase tracking-wider text-slate-400 min-w-[1000px]">
            <div className="text-left">Chorak Final (Chap)</div>
            <div>Yarim Final 1</div>
            <div className="text-amber-400 flex items-center justify-center gap-1.5">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span>GRAND FINAL</span>
            </div>
            <div>Yarim Final 2</div>
            <div className="text-right">Chorak Final (O‘ng)</div>
          </div>

          {/* Symmetrical Grid */}
          <div className="grid grid-cols-5 gap-4 items-center min-w-[1000px]">
            {/* Left QF (2 matches) */}
            <div className="flex flex-col justify-around gap-12">
              <div>{renderMatchCard(qfFixtures[0] || null, 'Chorak #1')}</div>
              <div>{renderMatchCard(qfFixtures[1] || null, 'Chorak #2')}</div>
            </div>

            {/* Left SF (1 match) */}
            <div className="flex flex-col justify-center">
              <div>{renderMatchCard(sfFixtures[0] || null, 'Yarim Final 1')}</div>
            </div>

            {/* Center Final */}
            <div className="flex flex-col items-center justify-center p-4 rounded-3xl bg-amber-950/20 border-2 border-amber-400/40 shadow-2xl shadow-amber-500/10">
              <div className="w-14 h-14 rounded-full bg-amber-500/20 border border-amber-400/50 flex items-center justify-center mb-3 shadow-inner">
                <Trophy className="w-7 h-7 text-amber-400" />
              </div>
              <div className="text-xs font-black uppercase text-amber-300 tracking-wider mb-2">
                Grand Final
              </div>
              {renderMatchCard(finalFixture, 'KATTA FINAL', true)}
            </div>

            {/* Right SF (1 match) */}
            <div className="flex flex-col justify-center">
              <div>{renderMatchCard(sfFixtures[1] || null, 'Yarim Final 2')}</div>
            </div>

            {/* Right QF (2 matches) */}
            <div className="flex flex-col justify-around gap-12">
              <div>{renderMatchCard(qfFixtures[2] || null, 'Chorak #3')}</div>
              <div>{renderMatchCard(qfFixtures[3] || null, 'Chorak #4')}</div>
            </div>
          </div>

          {/* Bottom R16 / Play-off collapsible drawer for completeness */}
          {(hasR16 || hasPlayoff || hasPrelim) && (
            <div className="mt-8 pt-6 border-t border-white/[0.08] min-w-[1000px]">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-black uppercase tracking-wider text-slate-300">
                  Oldingi Saralash & Nimchorak Bosqichlari
                </span>
                <span className="text-[11px] text-slate-400">
                  Barcha o‘yinlar to‘liq saralangan
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {prelimFixtures.map((f, i) => (
                  <div key={f.id}>{renderMatchCard(f, `Saralash #${i + 1}`)}</div>
                ))}
                {playoffFixtures.map((f, i) => (
                  <div key={f.id}>{renderMatchCard(f, `Play-off #${i + 1}`)}</div>
                ))}
                {r16Fixtures.map((f, i) => (
                  <div key={f.id}>{renderMatchCard(f, `R16 #${i + 1}`)}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
