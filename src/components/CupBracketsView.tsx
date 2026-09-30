import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Competition, Fixture } from '../types';
import { ClubCrest } from './ClubCrest';
import { ResultSubmissionModal } from './ResultSubmissionModal';
import { TournamentBracket } from './TournamentBracket';
import {
  AlertTriangle,
  ArrowRight,
  Crown,
  Shield,
  Sparkles,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';

interface CupBracketsViewProps {
  onNavigateTab?: (tab: any) => void;
}

function expectedTeamsForCup(cup?: Competition | null): number {
  if (!cup) return 20;
  const haystack = `${cup.id || ''} ${cup.name || ''}`.toLowerCase();
  if (haystack.includes('dfb') || haystack.includes('bundesliga') || haystack.includes('coupe-de-france') || haystack.includes('coupe de france') || haystack.includes('ligue-1')) {
    return 18;
  }
  return 20;
}

export const CupBracketsView: React.FC<CupBracketsViewProps> = ({ onNavigateTab }) => {
  const { user, currentClub, ownedClubs = [], activeSeasonId } = useAuth();
  const { t } = useI18n();

  const [cupCompetitions, setCupCompetitions] = useState<Competition[]>([]);
  const [selectedCupId, setSelectedCupId] = useState('');
  const [cupFixtures, setCupFixtures] = useState<Fixture[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFixtureForSubmit, setSelectedFixtureForSubmit] = useState<Fixture | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadCups() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.getCompetitions(activeSeasonId);
        const cups = (res.competitions || []).filter((competition: Competition) => competition.type === 'KNOCKOUT');
        if (cancelled) return;
        setCupCompetitions(cups);
        setSelectedCupId((current) => {
          if (current && cups.some((cup: Competition) => cup.id === current)) return current;
          return cups[0]?.id || '';
        });
        if (cups.length === 0) setIsLoading(false);
      } catch (err) {
        console.error('Failed to load domestic cups:', err);
        if (!cancelled) {
          setError("Couldn't load domestic cups. Please try again.");
          setIsLoading(false);
        }
      }
    }

    loadCups();
    return () => {
      cancelled = true;
    };
  }, [activeSeasonId]);

  const loadCupFixtures = async () => {
    if (!selectedCupId) {
      setCupFixtures([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getCompetitionFixtures(selectedCupId);
      setCupFixtures(res.fixtures || []);
    } catch (err) {
      console.error('Failed to load cup fixtures:', err);
      setError("Couldn't load this cup bracket. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCupFixtures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCupId, activeSeasonId]);

  const activeCup = cupCompetitions.find((cup) => cup.id === selectedCupId) || null;
  const expectedTeams = expectedTeamsForCup(activeCup);

  const format = useMemo(() => {
    const playInMatches = Math.max(0, expectedTeams - 16);
    const playInTeams = playInMatches * 2;
    const byeTeams = expectedTeams - playInTeams;
    const totalMatches = Math.max(0, expectedTeams - 1);
    return { playInMatches, playInTeams, byeTeams, totalMatches };
  }, [expectedTeams]);

  const bracketStats = useMemo(() => {
    const completed = cupFixtures.filter((fixture) => fixture.status === 'CONFIRMED').length;
    const live = cupFixtures.filter((fixture) => !['CONFIRMED', 'CANCELLED'].includes(fixture.status)).length;
    const clubs = new Set<string>();
    cupFixtures.forEach((fixture) => {
      if (fixture.homeClubId && fixture.homeClubId !== 'TBD') clubs.add(fixture.homeClubId);
      if (fixture.awayClubId && fixture.awayClubId !== 'TBD') clubs.add(fixture.awayClubId);
    });
    return { completed, live, visibleClubs: clubs.size };
  }, [cupFixtures]);

  const userClubInCup = useMemo(() => {
    return (
      ownedClubs.find((c) => cupFixtures.some((f) => f.homeClubId === c.id || f.awayClubId === c.id)) ||
      (currentClub && cupFixtures.some((f) => f.homeClubId === currentClub.id || f.awayClubId === currentClub.id)
        ? currentClub
        : null)
    );
  }, [ownedClubs, currentClub, cupFixtures]);

  return (
    <div className="space-y-4 pb-20 animate-in fade-in duration-200">
      {!user?.isAdmin && onNavigateTab && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => onNavigateTab('leagues')}
            className="flex min-h-[38px] shrink-0 items-center gap-2 rounded-xl border border-white/[0.08] efl-theme-border bg-white/[0.035] efl-theme-surface-2 px-3.5 text-xs font-bold text-slate-300 efl-theme-text-2 transition hover:border-emerald-400/30 hover:text-white efl-theme-hover-text"
          >
            <Shield className="h-3.5 w-3.5 text-emerald-400 efl-theme-emerald" />
            {t.domesticLeagues}
          </button>
          <button className="flex min-h-[38px] shrink-0 items-center gap-2 rounded-xl border border-amber-300/30 bg-amber-400 px-3.5 text-xs font-black text-slate-950 shadow-lg shadow-amber-500/15">
            <Trophy className="h-3.5 w-3.5" />
            {t.nationalCups}
          </button>
          <button
            onClick={() => onNavigateTab('champions-league')}
            className="flex min-h-[38px] shrink-0 items-center gap-2 rounded-xl border border-white/[0.08] efl-theme-border bg-white/[0.035] efl-theme-surface-2 px-3.5 text-xs font-bold text-slate-300 efl-theme-text-2 transition hover:border-blue-400/30 hover:text-white efl-theme-hover-text"
          >
            <Sparkles className="h-3.5 w-3.5 text-blue-400 efl-theme-blue" />
            {t.championsLeague}
          </button>
        </div>
      )}

      {/* 1. Cup Hero Card with clean neutral surfaces */}
      <section className="preview-cup-hero preview-surface relative overflow-hidden rounded-2xl border border-slate-200/80 efl-theme-border dark:border-white/10 p-5 sm:p-6 shadow-xs">
        <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-amber-600 efl-theme-amber dark:text-amber-400">
              <Crown className="h-3.5 w-3.5" />
              EFL UZ • {t.cupJourney}
            </div>
            <h1 className="text-xl sm:text-3xl font-black tracking-tight text-slate-900 efl-theme-text dark:text-white">
              {activeCup?.name || t.navCups}
            </h1>
            <p className="mt-1.5 max-w-xl text-xs leading-5 text-slate-500 efl-theme-muted dark:text-slate-400">
              Barcha {expectedTeams} klub kubokda qatnashadi. Play-in faqat bracketni 16 jamoaga tushiradi — hech bir klub turnirdan avtomatik chiqarib tashlanmaydi.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:min-w-[340px]">
            <div className="rounded-xl border border-slate-200/80 efl-theme-border dark:border-white/10 bg-slate-50 efl-theme-surface-2 dark:bg-white/[0.03] p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 efl-theme-muted dark:text-slate-400">{t.cupClubs}</div>
              <div className="mt-1 text-lg sm:text-xl font-black text-slate-900 efl-theme-text dark:text-white tabular-nums">{expectedTeams}</div>
            </div>
            <div className="rounded-xl border border-slate-200/80 efl-theme-border dark:border-white/10 bg-slate-50 efl-theme-surface-2 dark:bg-white/[0.03] p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 efl-theme-muted dark:text-slate-400">{t.cupMatches}</div>
              <div className="mt-1 text-lg sm:text-xl font-black text-slate-900 efl-theme-text dark:text-white tabular-nums">{format.totalMatches}</div>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-center">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600 efl-theme-amber dark:text-amber-400">{t.cupChampion}</div>
              <div className="mt-1 text-lg sm:text-xl font-black text-amber-600 efl-theme-amber dark:text-amber-400 tabular-nums">1</div>
            </div>
          </div>
        </div>

        {/* Participant's Club in Cup highlight */}
        {userClubInCup && (
          <div className="relative z-10 mt-4 flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-800 efl-theme-amber dark:text-amber-200">
            <ClubCrest
              clubId={userClubInCup.id}
              logoUrl={userClubInCup.logoUrl}
              name={userClubInCup.name}
              shortName={userClubInCup.shortName}
              size="xs"
              className="w-5 h-5 shrink-0"
            />
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-black truncate">{userClubInCup.name}</span>
              <span className="text-[10px] font-bold opacity-80">• Kubok ishtirokchisi (Sizning klubingiz)</span>
            </div>
          </div>
        )}

        {/* Cup Switcher Tabs */}
        <div className="relative z-10 mt-4 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {cupCompetitions.map((cup) => {
            const selected = cup.id === selectedCupId;
            return (
              <button
                key={cup.id}
                onClick={() => setSelectedCupId(cup.id)}
                className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-all flex items-center gap-1.5 min-h-[36px] ${
                  selected
                    ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                    : 'bg-slate-100 efl-theme-surface-2 dark:bg-[#171e2c] border border-slate-200/80 efl-theme-border dark:border-white/10 text-slate-700 efl-theme-text dark:text-slate-300 hover:text-slate-900 efl-theme-hover-text dark:hover:text-white'
                }`}
              >
                <Trophy className={`w-3.5 h-3.5 ${selected ? 'text-slate-950' : 'text-amber-500 efl-theme-amber'}`} />
                <span>{cup.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 2. Format Explanation Strip */}
      <section className="preview-surface rounded-2xl border border-slate-200/80 efl-theme-border dark:border-white/10 p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs sm:text-sm font-black text-slate-900 efl-theme-text dark:text-white">
              <Zap className="h-4 w-4 text-amber-500 efl-theme-amber" />
              Format qanday ishlaydi?
            </div>
            <p className="mt-1 text-[11px] text-slate-500 efl-theme-muted dark:text-slate-400">
              Single elimination • bir mag‘lubiyat — turnirdan chiqish • barcha klublar start ro‘yxatida.
            </p>
          </div>

          <div className="flex min-w-0 items-stretch gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <div className="min-w-[120px] rounded-xl border border-violet-500/20 bg-violet-500/10 p-2.5">
              <div className="text-[9px] font-black uppercase tracking-wider text-violet-600 efl-theme-violet dark:text-violet-300">Play-in</div>
              <div className="mt-0.5 text-xs font-black text-slate-900 efl-theme-text dark:text-white">{format.playInTeams} clubs</div>
              <div className="text-[10px] text-slate-500 efl-theme-muted dark:text-slate-400">{format.playInMatches} matches</div>
            </div>
            <div className="flex items-center px-0.5 text-slate-400 efl-theme-text-2"><ArrowRight className="h-3.5 w-3.5" /></div>
            <div className="min-w-[120px] rounded-xl border border-blue-500/20 bg-blue-500/10 p-2.5">
              <div className="text-[9px] font-black uppercase tracking-wider text-blue-600 efl-theme-blue dark:text-blue-300">Round of 16</div>
              <div className="mt-0.5 text-xs font-black text-slate-900 efl-theme-text dark:text-white">16 clubs</div>
              <div className="text-[10px] text-slate-500 efl-theme-muted dark:text-slate-400">{format.byeTeams} byes + {format.playInMatches} w</div>
            </div>
            <div className="flex items-center px-0.5 text-slate-400 efl-theme-text-2"><ArrowRight className="h-3.5 w-3.5" /></div>
            <div className="min-w-[85px] rounded-xl border border-slate-200/80 efl-theme-border dark:border-white/10 bg-slate-50 efl-theme-surface-2 dark:bg-white/[0.03] p-2.5 text-center">
              <div className="text-[9px] font-black uppercase tracking-wider text-slate-500 efl-theme-muted dark:text-slate-400">QF</div>
              <div className="mt-0.5 text-xs font-black text-slate-900 efl-theme-text dark:text-white">8 clubs</div>
            </div>
            <div className="flex items-center px-0.5 text-slate-400 efl-theme-text-2"><ArrowRight className="h-3.5 w-3.5" /></div>
            <div className="min-w-[85px] rounded-xl border border-slate-200/80 efl-theme-border dark:border-white/10 bg-slate-50 efl-theme-surface-2 dark:bg-white/[0.03] p-2.5 text-center">
              <div className="text-[9px] font-black uppercase tracking-wider text-slate-500 efl-theme-muted dark:text-slate-400">SF</div>
              <div className="mt-0.5 text-xs font-black text-slate-900 efl-theme-text dark:text-white">4 clubs</div>
            </div>
            <div className="flex items-center px-0.5 text-slate-400 efl-theme-text-2"><ArrowRight className="h-3.5 w-3.5" /></div>
            <div className="min-w-[95px] rounded-xl border border-amber-500/20 bg-amber-500/10 p-2.5 text-center">
              <div className="text-[9px] font-black uppercase tracking-wider text-amber-600 efl-theme-amber dark:text-amber-400">Final</div>
              <div className="mt-0.5 text-xs font-black text-amber-600 efl-theme-amber dark:text-amber-400">2 clubs</div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Bracket Progression Summary */}
      {cupFixtures.length > 0 && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-xl border border-slate-200/80 efl-theme-border dark:border-white/10 preview-surface p-3 shadow-xs">
            <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-slate-500 efl-theme-muted dark:text-slate-400">
              <Users className="h-3 w-3" />
              Visible
            </div>
            <div className="mt-1 text-base sm:text-lg font-black text-slate-900 efl-theme-text dark:text-white tabular-nums">
              {Math.max(bracketStats.visibleClubs, expectedTeams)}
            </div>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 shadow-xs">
            <div className="text-[9px] font-black uppercase tracking-wider text-emerald-600 efl-theme-emerald dark:text-emerald-400">
              Completed
            </div>
            <div className="mt-1 text-base sm:text-lg font-black text-emerald-600 efl-theme-emerald dark:text-emerald-400 tabular-nums">
              {bracketStats.completed}
            </div>
          </div>
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 shadow-xs">
            <div className="text-[9px] font-black uppercase tracking-wider text-blue-600 efl-theme-blue dark:text-blue-400">
              Open / Pending
            </div>
            <div className="mt-1 text-base sm:text-lg font-black text-blue-600 efl-theme-blue dark:text-blue-400 tabular-nums">
              {bracketStats.live}
            </div>
          </div>
        </div>
      )}

      {error && !isLoading && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/25 bg-rose-950/25 p-4 text-xs text-rose-200 efl-theme-rose">
          <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 efl-theme-rose" /><span>{error}</span></div>
          <button onClick={loadCupFixtures} className="rounded-xl bg-rose-500 px-3 py-2 font-black text-white">Retry</button>
        </div>
      )}

      {isLoading && cupFixtures.length === 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => <div key={index} className="h-40 animate-pulse rounded-3xl border border-white/[0.06] efl-theme-border bg-white/[0.025] efl-theme-surface-2" />)}
        </div>
      ) : cupFixtures.length === 0 ? (
        <div className="rounded-[28px] border border-white/[0.07] efl-theme-border bg-white/[0.025] efl-theme-surface-2 py-16 text-center shadow-xl">
          <Trophy className="mx-auto h-10 w-10 text-slate-600 efl-theme-muted" />
          <h3 className="mt-3 text-sm font-black text-white efl-theme-text">Bracket hali yaratilmagan</h3>
          <p className="mx-auto mt-1 max-w-md px-5 text-xs leading-5 text-slate-400 efl-theme-text-2">
            Cup draw yaratilganda barcha {expectedTeams} klub play-in va Round of 16 yo‘li orqali bitta connected bracket ichida ko‘rinadi.
          </p>
        </div>
      ) : (
        <TournamentBracket
          fixtures={cupFixtures}
          currentClubId={currentClub?.id}
          userId={user?.id}
          onSelectFixture={setSelectedFixtureForSubmit}
          competition={activeCup}
        />
      )}

      {selectedFixtureForSubmit && (
        <ResultSubmissionModal
          isOpen={true}
          fixture={selectedFixtureForSubmit}
          onClose={() => setSelectedFixtureForSubmit(null)}
          onSuccess={() => {
            setSelectedFixtureForSubmit(null);
            loadCupFixtures();
          }}
        />
      )}
    </div>
  );
};

