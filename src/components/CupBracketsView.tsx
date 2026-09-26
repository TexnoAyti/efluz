import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Club, Competition, Fixture } from '../types';
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
  const { user, currentClub, activeSeasonId } = useAuth();
  const { t } = useI18n();

  const [cupCompetitions, setCupCompetitions] = useState<Competition[]>([]);
  const [selectedCupId, setSelectedCupId] = useState('');
  const [cupFixtures, setCupFixtures] = useState<Fixture[]>([]);
  const [cupParticipants, setCupParticipants] = useState<Club[]>([]);
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

  useEffect(() => {
    let cancelled = false;
    if (!activeCup?.leagueId) {
      setCupParticipants([]);
      return () => { cancelled = true; };
    }
    api.getLeagueClubs(activeCup.leagueId, activeSeasonId)
      .then((res) => { if (!cancelled) setCupParticipants(res.clubs || []); })
      .catch((err) => {
        console.warn('[CUP_BRACKET] Could not load full participant roster:', err);
        if (!cancelled) setCupParticipants([]);
      });
    return () => { cancelled = true; };
  }, [activeCup?.leagueId, activeSeasonId]);

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

  return (
    <div className="space-y-5 pb-24 animate-in fade-in duration-300">
      {onNavigateTab && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => onNavigateTab('leagues')}
            className="flex min-h-[38px] shrink-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3.5 text-xs font-bold text-slate-300 transition hover:border-emerald-400/30 hover:text-white"
          >
            <Shield className="h-3.5 w-3.5 text-emerald-400" />
            Domestic Leagues
          </button>
          <button className="flex min-h-[38px] shrink-0 items-center gap-2 rounded-xl border border-amber-300/30 bg-amber-400 px-3.5 text-xs font-black text-slate-950 shadow-lg shadow-amber-500/15">
            <Trophy className="h-3.5 w-3.5" />
            National Cups
          </button>
          <button
            onClick={() => onNavigateTab('champions-league')}
            className="flex min-h-[38px] shrink-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3.5 text-xs font-bold text-slate-300 transition hover:border-blue-400/30 hover:text-white"
          >
            <Sparkles className="h-3.5 w-3.5 text-blue-400" />
            Champions League
          </button>
        </div>
      )}

      <section className="relative overflow-hidden rounded-[28px] border border-amber-300/20 bg-[radial-gradient(circle_at_16%_15%,rgba(251,191,36,0.18),transparent_27%),radial-gradient(circle_at_88%_18%,rgba(59,130,246,0.13),transparent_24%),linear-gradient(135deg,#111827_0%,#060b16_58%,#090d17_100%)] p-5 shadow-2xl sm:p-7">
        <div className="pointer-events-none absolute -right-10 -top-16 h-52 w-52 rounded-full border border-amber-300/10" />
        <div className="pointer-events-none absolute -right-2 -top-8 h-36 w-36 rounded-full border border-amber-300/10" />
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">
              <Crown className="h-3.5 w-3.5" />
              EFL UZ • 2026/27 Cup Journey
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-4xl">
              {activeCup?.name || t.navCups}
            </h1>
            <p className="mt-2 max-w-xl text-xs leading-5 text-slate-300 sm:text-sm">
              Barcha {expectedTeams} klub kubokda qatnashadi. Play-in faqat bracketni 16 jamoaga tushiradi — hech bir klub turnirdan avtomatik chiqarib tashlanmaydi.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 sm:min-w-[370px]">
            <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-3 backdrop-blur">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Clubs</div>
              <div className="mt-1 text-xl font-black text-white">{expectedTeams}</div>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-3 backdrop-blur">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Matches</div>
              <div className="mt-1 text-xl font-black text-white">{format.totalMatches}</div>
            </div>
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.07] p-3 backdrop-blur">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300/70">Champion</div>
              <div className="mt-1 text-xl font-black text-amber-300">1</div>
            </div>
          </div>
        </div>

        <div className="relative z-10 mt-6 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {cupCompetitions.map((cup) => {
            const selected = cup.id === selectedCupId;
            return (
              <button
                key={cup.id}
                onClick={() => setSelectedCupId(cup.id)}
                className={`shrink-0 rounded-xl border px-3.5 py-2 text-xs font-black transition ${
                  selected
                    ? 'border-amber-300/40 bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/10'
                    : 'border-white/[0.08] bg-white/[0.04] text-slate-300 hover:border-white/[0.18] hover:text-white'
                }`}
              >
                {cup.name}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-[24px] border border-white/[0.08] bg-slate-950/55 p-4 shadow-xl sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-black text-white">
              <Zap className="h-4 w-4 text-amber-400" />
              Format qanday ishlaydi?
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Single elimination • bir mag‘lubiyat — turnirdan chiqish • barcha klublar start ro‘yxatida.
            </p>
          </div>

          <div className="flex min-w-0 items-stretch gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <div className="min-w-[128px] rounded-2xl border border-violet-400/20 bg-violet-500/[0.08] p-3">
              <div className="text-[9px] font-black uppercase tracking-wider text-violet-300">Play-in</div>
              <div className="mt-1 text-sm font-black text-white">{format.playInTeams} clubs</div>
              <div className="mt-0.5 text-[10px] text-slate-400">{format.playInMatches} matches</div>
            </div>
            <div className="flex items-center px-1 text-slate-600"><ArrowRight className="h-4 w-4" /></div>
            <div className="min-w-[128px] rounded-2xl border border-blue-400/20 bg-blue-500/[0.07] p-3">
              <div className="text-[9px] font-black uppercase tracking-wider text-blue-300">Round of 16</div>
              <div className="mt-1 text-sm font-black text-white">16 clubs</div>
              <div className="mt-0.5 text-[10px] text-slate-400">{format.byeTeams} byes + {format.playInMatches} winners</div>
            </div>
            <div className="flex items-center px-1 text-slate-600"><ArrowRight className="h-4 w-4" /></div>
            <div className="min-w-[98px] rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3">
              <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">QF</div>
              <div className="mt-1 text-sm font-black text-white">8 clubs</div>
            </div>
            <div className="flex items-center px-1 text-slate-600"><ArrowRight className="h-4 w-4" /></div>
            <div className="min-w-[98px] rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3">
              <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">SF</div>
              <div className="mt-1 text-sm font-black text-white">4 clubs</div>
            </div>
            <div className="flex items-center px-1 text-slate-600"><ArrowRight className="h-4 w-4" /></div>
            <div className="min-w-[110px] rounded-2xl border border-amber-400/20 bg-amber-400/[0.07] p-3">
              <div className="text-[9px] font-black uppercase tracking-wider text-amber-300">Final</div>
              <div className="mt-1 text-sm font-black text-white">2 clubs</div>
            </div>
          </div>
        </div>
      </section>

      {cupFixtures.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
            <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-slate-500"><Users className="h-3 w-3" />Visible</div>
            <div className="mt-1 text-lg font-black text-white">{Math.max(bracketStats.visibleClubs, expectedTeams)}</div>
          </div>
          <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/[0.05] p-3">
            <div className="text-[9px] font-black uppercase tracking-wider text-emerald-300/70">Completed</div>
            <div className="mt-1 text-lg font-black text-emerald-300">{bracketStats.completed}</div>
          </div>
          <div className="rounded-2xl border border-blue-400/15 bg-blue-500/[0.05] p-3">
            <div className="text-[9px] font-black uppercase tracking-wider text-blue-300/70">Open / Pending</div>
            <div className="mt-1 text-lg font-black text-blue-300">{bracketStats.live}</div>
          </div>
        </div>
      )}

      {error && !isLoading && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/25 bg-rose-950/25 p-4 text-xs text-rose-200">
          <div className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" /><span>{error}</span></div>
          <button onClick={loadCupFixtures} className="rounded-xl bg-rose-500 px-3 py-2 font-black text-white">Retry</button>
        </div>
      )}

      {isLoading && cupFixtures.length === 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => <div key={index} className="h-40 animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.025]" />)}
        </div>
      ) : cupFixtures.length === 0 ? (
        <div className="rounded-[28px] border border-white/[0.07] bg-white/[0.025] py-16 text-center shadow-xl">
          <Trophy className="mx-auto h-10 w-10 text-slate-600" />
          <h3 className="mt-3 text-sm font-black text-white">Bracket hali yaratilmagan</h3>
          <p className="mx-auto mt-1 max-w-md px-5 text-xs leading-5 text-slate-400">
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
          participants={cupParticipants}
        />
      )}

      {selectedFixtureForSubmit && (
        <ResultSubmissionModal
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
