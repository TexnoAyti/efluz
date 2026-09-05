import React, { useRef } from 'react';
import { Fixture } from '../types';
import { ClubCrest } from './ClubCrest';
import { Trophy, Swords, Sparkles, CheckCircle2, Send, ChevronRight, ChevronLeft } from 'lucide-react';
import { useUserProfile } from '../context/UserProfileContext';
import { useI18n } from '../i18n';
import { getClubOwnerDisplay } from '../lib/ownerUtils';
import { openTelegramChat, isValidTelegramUsername } from '../lib/telegramUtils';

interface TournamentBracketProps {
  fixtures: Fixture[];
  currentClubId?: string;
  userId?: string;
  onSelectFixture?: (fixture: Fixture) => void;
}

export const TournamentBracket: React.FC<TournamentBracketProps> = ({
  fixtures,
  currentClubId,
  userId,
  onSelectFixture,
}) => {
  const { openUserProfile } = useUserProfile();
  const { t } = useI18n();

  const bracketContainerRef = useRef<HTMLDivElement>(null);
  const leftR16Ref = useRef<HTMLDivElement>(null);
  const leftQfRef = useRef<HTMLDivElement>(null);
  const finalRef = useRef<HTMLDivElement>(null);
  const rightQfRef = useRef<HTMLDivElement>(null);
  const rightR16Ref = useRef<HTMLDivElement>(null);

  const scrollToRef = (targetRef: React.RefObject<HTMLDivElement>) => {
    if (targetRef.current) {
      targetRef.current.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  };

  // Categorize fixtures by explicit round metadata
  const r16Fixtures = fixtures.filter((f) => {
    const rn = f.roundName?.toLowerCase() || '';
    return rn.includes('16') || rn.includes('nimchorak') || rn.includes('1/8') || rn.includes('r16');
  });

  const qfFixtures = fixtures.filter((f) => {
    const rn = f.roundName?.toLowerCase() || '';
    return rn.includes('quarter') || rn.includes('chorak') || rn.includes('qf') || rn.includes('1/4');
  });

  const sfFixtures = fixtures.filter((f) => {
    const rn = f.roundName?.toLowerCase() || '';
    return (
      (rn.includes('semi') || rn.includes('yarim') || rn.includes('sf') || rn.includes('1/2')) &&
      !rn.includes('quarter')
    );
  });

  const finalFixtures = fixtures.filter((f) => {
    const rn = f.roundName?.toLowerCase() || '';
    return (
      (rn.includes('final') || rn.includes('finali')) &&
      !rn.includes('semi') &&
      !rn.includes('quarter') &&
      !rn.includes('16') &&
      !rn.includes('nimchorak')
    );
  });

  const playoffFixtures = fixtures.filter((f) => {
    const rn = f.roundName?.toLowerCase() || '';
    return rn.includes('playoff') || rn.includes('play-off') || rn.includes('saralash') || rn.includes('preliminary');
  });

  // Non-playoff knockout fixtures fallback
  const knockoutFixtures = fixtures.filter((f) => !playoffFixtures.includes(f));

  // Determine if tournament has explicit rounds or fallback sequentially without legacy matchday assumptions
  const hasExplicitRounds =
    r16Fixtures.length > 0 || qfFixtures.length > 0 || sfFixtures.length > 0 || finalFixtures.length > 0;

  let effectiveR16: (Fixture | null)[] = [];
  let effectiveQF: (Fixture | null)[] = [];
  let effectiveSF: (Fixture | null)[] = [];
  let effectiveFinal: Fixture | null = null;

  if (hasExplicitRounds) {
    effectiveR16 = r16Fixtures;
    effectiveQF = qfFixtures;
    effectiveSF = sfFixtures;
    effectiveFinal = finalFixtures[0] || null;
  } else {
    // Sequential fallback without legacy matchday assumptions
    if (knockoutFixtures.length >= 15) {
      effectiveR16 = knockoutFixtures.slice(0, 8);
      effectiveQF = knockoutFixtures.slice(8, 12);
      effectiveSF = knockoutFixtures.slice(12, 14);
      effectiveFinal = knockoutFixtures[14] || null;
    } else if (knockoutFixtures.length >= 7) {
      effectiveQF = knockoutFixtures.slice(0, 4);
      effectiveSF = knockoutFixtures.slice(4, 6);
      effectiveFinal = knockoutFixtures[6] || null;
    } else if (knockoutFixtures.length >= 3) {
      effectiveSF = knockoutFixtures.slice(0, 2);
      effectiveFinal = knockoutFixtures[2] || null;
    } else if (knockoutFixtures.length >= 1) {
      effectiveFinal = knockoutFixtures[0] || null;
    }
  }

  const showR16 = effectiveR16.length > 0;

  // Split Left and Right halves
  const leftR16 = Array.from({ length: 4 }).map((_, idx) => effectiveR16[idx] || null);
  const rightR16 = Array.from({ length: 4 }).map((_, idx) => effectiveR16[idx + 4] || null);
  const leftQF = Array.from({ length: 2 }).map((_, idx) => effectiveQF[idx] || null);
  const rightQF = Array.from({ length: 2 }).map((_, idx) => effectiveQF[idx + 2] || null);
  const leftSF = effectiveSF[0] || null;
  const rightSF = effectiveSF[1] || null;

  const renderMatchCard = (fixture: Fixture | null, matchLabel: string, isCenter = false) => {
    if (!fixture) {
      return (
        <div className="w-56 sm:w-60 glass-card p-3 rounded-2xl border border-white/[0.06] opacity-60 flex flex-col justify-center min-h-[84px] shadow-sm">
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1 flex items-center justify-between">
            <span>{matchLabel}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-500 font-semibold">TBD</span>
          </div>
          <div className="text-xs text-slate-400 italic">Kutilmoqda / TBD</div>
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

    const isHomeTbd = !fixture.homeClubId || fixture.homeClub?.name === 'TBD';
    const isAwayTbd = !fixture.awayClubId || fixture.awayClub?.name === 'TBD';

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
        onClick={() => onSelectFixture?.(fixture)}
        className={`w-56 sm:w-60 glass-panel p-3 rounded-2xl transition-all shadow-md cursor-pointer group ${
          isUserMatch
            ? 'border-amber-400/70 bg-amber-950/25 shadow-amber-500/10 ring-1 ring-amber-400/30'
            : isCenter
            ? 'border-blue-400/50 bg-blue-950/30 shadow-blue-500/10'
            : 'hover:border-white/[0.25]'
        }`}
      >
        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-2 pb-1 border-b border-white/[0.06]">
          <span className="font-bold text-slate-300 truncate max-w-[120px]">{matchLabel}</span>
          <span
            className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
              fixture.status === 'CONFIRMED'
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                : fixture.status === 'DISPUTED'
                ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                : 'bg-white/[0.05] text-slate-400'
            }`}
          >
            {fixture.status === 'CONFIRMED' ? 'Tugagan' : fixture.status === 'DISPUTED' ? 'Nizo' : 'Kutilmoqda'}
          </span>
        </div>

        {/* Home Team */}
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
                    isHomeWinner ? 'font-black text-emerald-400' : 'font-bold text-slate-200'
                  }`}
                >
                  {isHomeTbd ? 'TBD / Aniqlanmoqda' : fixture.homeClub?.name || 'Home'}
                </span>
                {isHomeUser && (
                  <span className="text-[8px] font-black text-emerald-400 bg-emerald-500/15 px-1 rounded">Siz</span>
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
                    className="text-[9px] text-slate-400 hover:text-emerald-400 truncate block text-left transition-colors"
                  >
                    {homeOwnerInfo.displayText}
                  </button>
                ) : (
                  <span className="text-[9px] text-slate-400 truncate block">
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
              isHomeWinner ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/[0.05] text-slate-300'
            }`}
          >
            {fixture.homeScore !== null && fixture.homeScore !== undefined ? fixture.homeScore : '-'}
          </span>
        </div>

        {/* Away Team */}
        <div className="flex items-center justify-between py-1 border-t border-white/[0.04]">
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
                    isAwayWinner ? 'font-black text-emerald-400' : 'font-bold text-slate-200'
                  }`}
                >
                  {isAwayTbd ? 'TBD / Aniqlanmoqda' : fixture.awayClub?.name || 'Away'}
                </span>
                {isAwayUser && (
                  <span className="text-[8px] font-black text-emerald-400 bg-emerald-500/15 px-1 rounded">Siz</span>
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
                    className="text-[9px] text-slate-400 hover:text-emerald-400 truncate block text-left transition-colors"
                  >
                    {awayOwnerInfo.displayText}
                  </button>
                ) : (
                  <span className="text-[9px] text-slate-400 truncate block">
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
              isAwayWinner ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/[0.05] text-slate-300'
            }`}
          >
            {fixture.awayScore !== null && fixture.awayScore !== undefined ? fixture.awayScore : '-'}
          </span>
        </div>

        {/* Opponent Telegram Contact Button */}
        {isUserMatch && hasOppTg && oppOwnerInfo?.username && (
          <div className="pt-2 border-t border-white/[0.06] mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openTelegramChat(oppOwnerInfo.username!);
              }}
              className="text-xs font-bold px-2.5 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 transition-all flex items-center gap-1.5 shadow-sm min-h-[36px] touch-manipulation"
            >
              <Send className="w-3 h-3" />
              <span>Raqibga yozish</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Play-offs banner if applicable */}
      {playoffFixtures.length > 0 && (
        <div className="glass-panel p-4 rounded-2xl shadow-xl space-y-3 border-indigo-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
              <h4 className="text-xs font-black uppercase text-white tracking-wider">
                Knockout Play-offs (9th–24th Seeds)
              </h4>
            </div>
            <span className="text-[11px] text-indigo-300 font-semibold">
              G‘oliblar Nimchorak finalga yo‘l oladi
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {playoffFixtures.map((f, i) => (
              <div key={f.id}>{renderMatchCard(f, `Play-off #${i + 1}`)}</div>
            ))}
          </div>
        </div>
      )}

      {/* Mobile Navigation Pills */}
      <div className="flex items-center justify-between gap-1.5 overflow-x-auto pb-1 text-xs font-bold sm:hidden">
        {showR16 && (
          <button
            type="button"
            onClick={() => scrollToRef(leftR16Ref)}
            className="px-3 py-1.5 rounded-xl glass-card text-slate-300 active:text-white shrink-0 min-h-[36px] touch-manipulation"
          >
            R16 (Chap)
          </button>
        )}
        <button
          type="button"
          onClick={() => scrollToRef(leftQfRef)}
          className="px-3 py-1.5 rounded-xl glass-card text-slate-300 active:text-white shrink-0 min-h-[36px] touch-manipulation"
        >
          Chorak
        </button>
        <button
          type="button"
          onClick={() => scrollToRef(finalRef)}
          className="px-3.5 py-1.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 active:text-amber-200 shrink-0 flex items-center gap-1 min-h-[36px] touch-manipulation"
        >
          <Trophy className="w-3.5 h-3.5" />
          <span>Final</span>
        </button>
        <button
          type="button"
          onClick={() => scrollToRef(rightQfRef)}
          className="px-3 py-1.5 rounded-xl glass-card text-slate-300 active:text-white shrink-0 min-h-[36px] touch-manipulation"
        >
          Chorak
        </button>
        {showR16 && (
          <button
            type="button"
            onClick={() => scrollToRef(rightR16Ref)}
            className="px-3 py-1.5 rounded-xl glass-card text-slate-300 active:text-white shrink-0 min-h-[36px] touch-manipulation"
          >
            R16 (O‘ng)
          </button>
        )}
      </div>

      {/* Main Tournament Bracket with Left and Right Halves meeting in Center */}
      <div
        ref={bracketContainerRef}
        className="glass-panel p-4 sm:p-6 shadow-2xl overflow-x-auto scrollbar-thin scroll-smooth"
      >
        <div className={`${showR16 ? 'min-w-[1020px]' : 'min-w-[760px]'} pb-4`}>
          {/* Header Row */}
          <div
            className={`grid ${
              showR16 ? 'grid-cols-7' : 'grid-cols-5'
            } gap-3 mb-6 px-2 text-center text-xs font-black uppercase tracking-wider text-slate-400`}
          >
            {showR16 && <div className="text-left">Nimchorak (R16)</div>}
            <div>Chorak Final (QF)</div>
            <div>Yarim Final (SF)</div>
            <div className="text-amber-400 flex items-center justify-center gap-1.5">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span>FINAL</span>
            </div>
            <div>Yarim Final (SF)</div>
            <div>Chorak Final (QF)</div>
            {showR16 && <div className="text-right">Nimchorak (R16)</div>}
          </div>

          <div
            className={`grid ${
              showR16 ? 'grid-cols-7' : 'grid-cols-5'
            } gap-3 items-center`}
          >
            {/* 1. LEFT R16 (4 Matches) */}
            {showR16 && (
              <div ref={leftR16Ref} className="flex flex-col justify-around gap-4">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div key={`left-r16-${idx}`}>
                    {renderMatchCard(leftR16[idx] || null, `R16 Match ${idx + 1}`)}
                  </div>
                ))}
              </div>
            )}

            {/* 2. LEFT QF (2 Matches) */}
            <div ref={leftQfRef} className="flex flex-col justify-around gap-12">
              {Array.from({ length: 2 }).map((_, idx) => (
                <div key={`left-qf-${idx}`}>
                  {renderMatchCard(leftQF[idx] || null, `Chorak #${idx + 1}`)}
                </div>
              ))}
            </div>

            {/* 3. LEFT SF (1 Match) */}
            <div className="flex flex-col justify-center">
              <div>{renderMatchCard(leftSF, 'Yarim Final 1')}</div>
            </div>

            {/* 4. CENTER: THE GRAND FINAL */}
            <div
              ref={finalRef}
              className="flex flex-col items-center justify-center p-3 rounded-2xl glass-panel border-amber-400/40 bg-amber-950/20 shadow-xl shadow-amber-500/10"
            >
              <div className="w-12 h-12 rounded-full bg-amber-500/20 border border-amber-400/40 flex items-center justify-center mb-2 shadow-inner">
                <Trophy className="w-6 h-6 text-amber-400" />
              </div>
              <div className="text-[11px] font-black uppercase text-amber-300 tracking-wider mb-2">
                Grand Final
              </div>
              {renderMatchCard(effectiveFinal, 'UEFA FINAL', true)}
            </div>

            {/* 5. RIGHT SF (1 Match) */}
            <div className="flex flex-col justify-center">
              <div>{renderMatchCard(rightSF, 'Yarim Final 2')}</div>
            </div>

            {/* 6. RIGHT QF (2 Matches) */}
            <div ref={rightQfRef} className="flex flex-col justify-around gap-12">
              {Array.from({ length: 2 }).map((_, idx) => (
                <div key={`right-qf-${idx}`}>
                  {renderMatchCard(rightQF[idx] || null, `Chorak #${idx + 3}`)}
                </div>
              ))}
            </div>

            {/* 7. RIGHT R16 (4 Matches) */}
            {showR16 && (
              <div ref={rightR16Ref} className="flex flex-col justify-around gap-4">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div key={`right-r16-${idx}`}>
                    {renderMatchCard(rightR16[idx] || null, `R16 Match ${idx + 5}`)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
