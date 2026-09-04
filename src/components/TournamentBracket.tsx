import React from 'react';
import { Fixture } from '../types';
import { ClubCrest } from './ClubCrest';
import { Trophy, Swords, Sparkles, CheckCircle2 } from 'lucide-react';
import { useUserProfile } from '../context/UserProfileContext';
import { openTelegramChat } from '../lib/telegramUtils';

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

  // Categorize fixtures by round
  const r16Fixtures = fixtures.filter(
    (f) =>
      f.roundName?.toLowerCase().includes('16') ||
      f.roundName?.toLowerCase().includes('nimchorak') ||
      f.matchday === 16
  );
  const qfFixtures = fixtures.filter(
    (f) =>
      f.roundName?.toLowerCase().includes('quarter') ||
      f.roundName?.toLowerCase().includes('chorak') ||
      f.roundName?.toLowerCase().includes('qf')
  );
  const sfFixtures = fixtures.filter(
    (f) =>
      f.roundName?.toLowerCase().includes('semi') ||
      f.roundName?.toLowerCase().includes('yarim') ||
      f.roundName?.toLowerCase().includes('sf')
  );
  const finalFixtures = fixtures.filter(
    (f) =>
      (f.roundName?.toLowerCase().includes('final') || f.roundName?.toLowerCase().includes('finali')) &&
      !f.roundName?.toLowerCase().includes('semi') &&
      !f.roundName?.toLowerCase().includes('quarter')
  );
  const playoffFixtures = fixtures.filter(
    (f) =>
      f.roundName?.toLowerCase().includes('playoff') ||
      f.roundName?.toLowerCase().includes('play-off') ||
      f.roundName?.toLowerCase().includes('saralash')
  );

  // If standard named rounds aren't explicit, fall back to sequential grouping
  const allKnockouts = fixtures.length > 0 ? fixtures : [];
  const effectiveR16 = r16Fixtures.length > 0 ? r16Fixtures : allKnockouts.slice(0, 8);
  const effectiveQF = qfFixtures.length > 0 ? qfFixtures : allKnockouts.slice(8, 12);
  const effectiveSF = sfFixtures.length > 0 ? sfFixtures : allKnockouts.slice(12, 14);
  const effectiveFinal = finalFixtures.length > 0 ? finalFixtures[0] : allKnockouts[14] || null;

  // Split Left and Right halves
  const leftR16 = effectiveR16.slice(0, 4);
  const rightR16 = effectiveR16.slice(4, 8);
  const leftQF = effectiveQF.slice(0, 2);
  const rightQF = effectiveQF.slice(2, 4);
  const leftSF = effectiveSF[0] || null;
  const rightSF = effectiveSF[1] || null;

  const renderMatchCard = (fixture: Fixture | null, matchLabel: string, isCenter = false) => {
    if (!fixture) {
      return (
        <div className="w-56 glass-card p-2.5 rounded-xl border border-white/[0.05] opacity-60 flex flex-col justify-center min-h-[76px]">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">
            {matchLabel}
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

    return (
      <div
        onClick={() => onSelectFixture?.(fixture)}
        className={`w-56 glass-panel p-2.5 rounded-xl transition-all shadow-md cursor-pointer group ${
          isUserMatch
            ? 'border-amber-400/60 bg-amber-950/20 shadow-amber-500/10'
            : isCenter
            ? 'border-blue-400/50 bg-blue-950/30 shadow-blue-500/10'
            : 'hover:border-white/[0.2]'
        }`}
      >
        <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1.5 pb-1 border-b border-white/[0.06]">
          <span className="font-bold text-slate-300 truncate max-w-[120px]">{matchLabel}</span>
          <span className="text-[9px] font-semibold px-1.5 py-0.2 rounded bg-white/[0.05] text-slate-400">
            {fixture.status === 'CONFIRMED' ? 'Tugagan' : 'Jarayonda'}
          </span>
        </div>

        {/* Home Team */}
        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <ClubCrest
              clubId={fixture.homeClub?.id}
              logoUrl={fixture.homeClub?.logoUrl}
              name={fixture.homeClub?.name || 'Home'}
              shortName={fixture.homeClub?.shortName}
              size="xs"
              className="w-4 h-4 shrink-0"
            />
            <span
              className={`text-xs truncate ${
                isHomeWinner ? 'font-black text-emerald-400' : 'font-semibold text-slate-200'
              }`}
            >
              {fixture.homeClub?.name || 'Home'}
            </span>
          </div>
          <span
            className={`text-xs px-1.5 py-0.5 rounded font-mono font-black shrink-0 ${
              isHomeWinner ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/[0.05] text-slate-300'
            }`}
          >
            {fixture.homeScore !== null && fixture.homeScore !== undefined ? fixture.homeScore : '-'}
          </span>
        </div>

        {/* Away Team */}
        <div className="flex items-center justify-between py-1 border-t border-white/[0.04]">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <ClubCrest
              clubId={fixture.awayClub?.id}
              logoUrl={fixture.awayClub?.logoUrl}
              name={fixture.awayClub?.name || 'Away'}
              shortName={fixture.awayClub?.shortName}
              size="xs"
              className="w-4 h-4 shrink-0"
            />
            <span
              className={`text-xs truncate ${
                isAwayWinner ? 'font-black text-emerald-400' : 'font-semibold text-slate-200'
              }`}
            >
              {fixture.awayClub?.name || 'Away'}
            </span>
          </div>
          <span
            className={`text-xs px-1.5 py-0.5 rounded font-mono font-black shrink-0 ${
              isAwayWinner ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/[0.05] text-slate-300'
            }`}
          >
            {fixture.awayScore !== null && fixture.awayScore !== undefined ? fixture.awayScore : '-'}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
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

      {/* Main Tournament Bracket with Left and Right Halves meeting in Center */}
      <div className="glass-panel p-4 sm:p-6 shadow-2xl overflow-x-auto scrollbar-thin">
        <div className="min-w-[960px] pb-4">
          <div className="flex items-center justify-between mb-6 px-2 text-center text-xs font-black uppercase tracking-wider text-slate-400">
            <div className="w-56 text-left">Nimchorak Final (R16)</div>
            <div className="w-56">Chorak Final (QF)</div>
            <div className="w-56">Yarim Final (SF)</div>
            <div className="w-56 text-amber-400 flex items-center justify-center gap-1.5">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span>FINAL</span>
            </div>
            <div className="w-56">Yarim Final (SF)</div>
            <div className="w-56">Chorak Final (QF)</div>
            <div className="w-56 text-right">Nimchorak Final (R16)</div>
          </div>

          <div className="grid grid-cols-7 gap-3 items-center">
            {/* 1. LEFT R16 (4 Matches) */}
            <div className="flex flex-col justify-around gap-4">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={`left-r16-${idx}`}>
                  {renderMatchCard(leftR16[idx] || null, `R16 Match ${idx + 1}`)}
                </div>
              ))}
            </div>

            {/* 2. LEFT QF (2 Matches) */}
            <div className="flex flex-col justify-around gap-12">
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
            <div className="flex flex-col items-center justify-center p-3 rounded-2xl glass-panel border-amber-400/40 bg-amber-950/20 shadow-xl shadow-amber-500/10">
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
            <div className="flex flex-col justify-around gap-12">
              {Array.from({ length: 2 }).map((_, idx) => (
                <div key={`right-qf-${idx}`}>
                  {renderMatchCard(rightQF[idx] || null, `Chorak #${idx + 3}`)}
                </div>
              ))}
            </div>

            {/* 7. RIGHT R16 (4 Matches) */}
            <div className="flex flex-col justify-around gap-4">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={`right-r16-${idx}`}>
                  {renderMatchCard(rightR16[idx] || null, `R16 Match ${idx + 5}`)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
