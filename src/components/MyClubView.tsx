import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Fixture, Competition } from '../types';
import {
  Shield,
  Trophy,
  Calendar,
  Flame,
  Globe2,
  Award,
  ChevronRight,
  ExternalLink,
  Users,
  MapPin,
  Sparkles,
  ArrowUpRight,
} from 'lucide-react';

interface MyClubViewProps {
  onNavigateTab: (tab: any) => void;
  onSelectFixtureForMatchCenter?: (fixture: Fixture) => void;
}

export const MyClubView: React.FC<MyClubViewProps> = ({
  onNavigateTab,
  onSelectFixtureForMatchCenter,
}) => {
  const { user, currentClub, activeSeasonId } = useAuth();
  const { t } = useI18n();

  const [stats, setStats] = useState<{
    matchesPlayed: number;
    wins: number;
    draws: number;
    losses: number;
    goalsScored: number;
    goalsConceded: number;
    points: number;
    trophies: number;
    leaguePosition: number;
  } | null>(null);

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [upcomingFixtures, setUpcomingFixtures] = useState<Fixture[]>([]);
  const [recentFixtures, setRecentFixtures] = useState<Fixture[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadClubData() {
      setIsLoading(true);
      try {
        const [meRes, matchesRes, compsRes] = await Promise.all([
          api.getMe(activeSeasonId),
          api.getMyMatches(activeSeasonId),
          api.getCompetitions(activeSeasonId),
        ]);

        setStats(meRes.stats);
        setCompetitions(compsRes.competitions);

        const pending = matchesRes.fixtures.filter(
          (m) => m.status !== 'CONFIRMED' && m.status !== 'CANCELLED'
        );
        const finished = matchesRes.fixtures.filter((m) => m.status === 'CONFIRMED');

        setUpcomingFixtures(pending.slice(0, 5));
        setRecentFixtures(finished.slice(0, 5));
      } catch (err: any) {
        console.error('Failed to load club data:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadClubData();
  }, [activeSeasonId, currentClub?.id]);

  if (!currentClub) {
    return (
      <div className="glass-panel p-6 sm:p-8 text-center max-w-xl mx-auto my-8 sm:my-12 shadow-2xl">
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto mb-4 text-amber-400">
          <Shield className="w-7 h-7 sm:w-8 sm:h-8" />
        </div>
        <h2 className="text-lg sm:text-xl font-black text-white mb-2">{t.noClubSelected}</h2>
        <p className="text-xs text-slate-400 mb-6 leading-relaxed">
          {t.claimConfirmationDesc}
        </p>
        <button
          onClick={() => onNavigateTab('leagues')}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl btn-glass-primary text-slate-950 font-black text-xs sm:text-sm shadow-lg shadow-emerald-500/20 active:scale-95 transition-all min-h-[42px] touch-manipulation"
        >
          <Shield className="w-4 h-4" />
          <span>{t.selectYourClub}</span>
        </button>
      </div>
    );
  }

  const goalDifference = (stats?.goalsScored || 0) - (stats?.goalsConceded || 0);

  return (
    <div className="space-y-5 animate-in fade-in duration-300 pb-20">
      {/* Club Banner Header */}
      <div className="relative overflow-hidden glass-panel p-6 sm:p-8 shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row items-center md:items-start justify-between gap-6 relative z-10 text-center md:text-left">
          <div className="flex flex-col md:flex-row items-center gap-5">
            <div className="w-24 h-24 rounded-3xl bg-slate-950/80 p-3 border border-white/[0.08] flex items-center justify-center shadow-xl shrink-0">
              <img
                src={currentClub.logoUrl}
                alt={currentClub.name}
                className="w-full h-full object-contain drop-shadow-md"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>

            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-black uppercase tracking-wider mb-2">
                <Sparkles className="w-3.5 h-3.5" />
                <span>{currentClub.leagueId ? currentClub.leagueId.replace('league-', '').replace('-', ' ').toUpperCase() : 'DOMESTIC LEAGUE'}</span>
              </div>
              <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
                {currentClub.name}
              </h1>
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-xs text-slate-400 mt-2">
                <span className="flex items-center gap-1.5 font-medium text-slate-300">
                  <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                  {currentClub.stadium || 'Official Stadium'}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1.5 font-medium text-slate-300">
                  <Users className="w-3.5 h-3.5 text-indigo-400" />
                  {t.manager}: <strong className="text-white">@{user?.username}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* Key Metric Highlights */}
          <div className="flex items-center gap-3">
            <div className="glass-card px-5 py-3 text-center min-w-[90px]">
              <div className="text-[10px] uppercase font-bold text-slate-400">{t.pos}</div>
              <div className="text-2xl font-black text-amber-400 flex items-center justify-center gap-1">
                <Trophy className="w-4 h-4 text-amber-400" />
                <span>#{stats?.leaguePosition || 1}</span>
              </div>
            </div>
            <div className="glass-card px-5 py-3 text-center min-w-[90px]">
              <div className="text-[10px] uppercase font-bold text-slate-400">{t.pts}</div>
              <div className="text-2xl font-black text-white">{stats?.points || 0}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Season Performance Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="glass-card p-4 text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">{t.played}</div>
          <div className="text-xl font-black text-white">{stats?.matchesPlayed || 0}</div>
        </div>

        <div className="glass-card p-4 text-center">
          <div className="text-[10px] uppercase font-bold text-emerald-400 mb-1">{t.won}</div>
          <div className="text-xl font-black text-emerald-400">{stats?.wins || 0}</div>
        </div>

        <div className="glass-card p-4 text-center">
          <div className="text-[10px] uppercase font-bold text-amber-400 mb-1">{t.drawn}</div>
          <div className="text-xl font-black text-amber-400">{stats?.draws || 0}</div>
        </div>

        <div className="glass-card p-4 text-center">
          <div className="text-[10px] uppercase font-bold text-rose-400 mb-1">{t.lost}</div>
          <div className="text-xl font-black text-rose-400">{stats?.losses || 0}</div>
        </div>

        <div className="glass-card p-4 text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">{t.goalsFor} / {t.goalsAgainst}</div>
          <div className="text-lg font-black text-slate-200">
            {stats?.goalsScored || 0} : {stats?.goalsConceded || 0}
          </div>
        </div>

        <div className="glass-card p-4 text-center">
          <div className="text-[10px] uppercase font-bold text-slate-400 mb-1">{t.gd}</div>
          <div
            className={`text-xl font-black ${
              goalDifference > 0
                ? 'text-emerald-400'
                : goalDifference < 0
                ? 'text-rose-400'
                : 'text-slate-300'
            }`}
          >
            {goalDifference > 0 ? `+${goalDifference}` : goalDifference}
          </div>
        </div>
      </div>

      {/* Active Tournament Competitions for this Club */}
      <div className="space-y-3">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2 px-1">
          <Award className="w-4 h-4 text-emerald-400" />
          <span>{t.competitionsParticipating}</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Domestic League */}
          <div className="glass-panel p-5 relative overflow-hidden flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  {t.domesticTitle}
                </span>
                <Trophy className="w-4 h-4 text-emerald-400" />
              </div>
              <h4 className="text-base font-black text-white mb-1">
                {currentClub.leagueId ? currentClub.leagueId.replace('league-', '').replace('-', ' ').toUpperCase() : 'LEAGUE CHAMPIONSHIP'}
              </h4>
              <p className="text-xs text-slate-400">
                {t.currentPosition}: <strong className="text-amber-400">#{stats?.leaguePosition || 1}</strong> ({stats?.points || 0} {t.pointsAbbr})
              </p>
            </div>
            <button
              onClick={() => onNavigateTab('standings')}
              className="mt-4 inline-flex items-center justify-between text-xs font-bold text-emerald-400 hover:text-emerald-300 pt-3 border-t border-white/[0.06]"
            >
              <span>{t.leagueStandings}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Domestic Cup */}
          <div className="glass-panel p-5 relative overflow-hidden flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  {t.cupTitle}
                </span>
                <Award className="w-4 h-4 text-indigo-400" />
              </div>
              <h4 className="text-base font-black text-white mb-1">
                {currentClub.leagueId?.includes('premier')
                  ? 'FA Cup & EFL Cup'
                  : currentClub.leagueId?.includes('la-liga')
                  ? 'Copa del Rey'
                  : currentClub.leagueId?.includes('serie-a')
                  ? 'Coppa Italia'
                  : currentClub.leagueId?.includes('bundesliga')
                  ? 'DFB-Pokal'
                  : 'Coupe de France'}
              </h4>
              <p className="text-xs text-slate-400">
                Knockout single-elimination tournament bracket
              </p>
            </div>
            <button
              onClick={() => onNavigateTab('cups')}
              className="mt-4 inline-flex items-center justify-between text-xs font-bold text-indigo-400 hover:text-indigo-300 pt-3 border-t border-white/[0.06]"
            >
              <span>{t.knockoutBracket}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* European Tournaments */}
          <div className="glass-panel p-5 relative overflow-hidden flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-sky-500/20 text-sky-400 border border-sky-500/30">
                  {t.europeanTitle}
                </span>
                <Globe2 className="w-4 h-4 text-sky-400" />
              </div>
              <h4 className="text-base font-black text-white mb-1">
                UEFA Champions League
              </h4>
              <p className="text-xs text-slate-400">
                Top 4 domestic qualification spot
              </p>
            </div>
            <button
              onClick={() => onNavigateTab('champions-league')}
              className="mt-4 inline-flex items-center justify-between text-xs font-bold text-sky-400 hover:text-sky-300 pt-3 border-t border-white/[0.06]"
            >
              <span>{t.uefaChampionsLeague}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Upcoming Fixtures for this Club */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-amber-400" />
            <span>{t.quickFixtures}</span>
          </h3>
          <button
            onClick={() => onNavigateTab('my-matches')}
            className="text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
          >
            <span>{t.navMyMatches}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {upcomingFixtures.length === 0 ? (
          <div className="glass-card p-6 text-center text-slate-400 text-xs">
            {t.noUpcomingMatches}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {upcomingFixtures.map((fix) => (
              <div
                key={fix.id}
                onClick={() => {
                  if (onSelectFixtureForMatchCenter) onSelectFixtureForMatchCenter(fix);
                  onNavigateTab('my-matches');
                }}
                className="glass-card hover:border-white/[0.15] cursor-pointer p-4 flex items-center justify-between gap-4 transition-all group"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-slate-950/80 p-2 border border-white/[0.08] flex items-center justify-center shrink-0">
                    <img
                      src={fix.homeClub?.logoUrl}
                      alt={fix.homeClub?.name}
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <div className="truncate">
                    <div className="text-xs font-bold text-white group-hover:text-emerald-400 transition-colors truncate">
                      {fix.homeClub?.name} vs {fix.awayClub?.name}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {fix.competitionName} • {fix.roundName || `Matchday ${fix.matchday}`}
                    </div>
                  </div>
                </div>

                <span className="px-3 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-black shrink-0">
                  {t.openMatchCenter}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
