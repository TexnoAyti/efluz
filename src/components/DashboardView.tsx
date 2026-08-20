import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Fixture, Club } from '../types';
import { ResultSubmissionModal } from './ResultSubmissionModal';
import {
  Shield,
  Trophy,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  Flame,
  ChevronRight,
  Swords,
  Globe2,
  Award,
  Terminal,
  RefreshCw,
} from 'lucide-react';

interface DashboardViewProps {
  onNavigateTab: (tab: any) => void;
  onSelectFixtureForMatchCenter?: (fixture: Fixture) => void;
  onOpenDiagnostics?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigateTab,
  onSelectFixtureForMatchCenter,
  onOpenDiagnostics,
}) => {
  const {
    user,
    currentClub,
    activeSeasonId,
    authStatus,
    authError,
    telegramDiagnostics,
    refreshUserData,
    showToast,
  } = useAuth();
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

  const [myMatches, setMyMatches] = useState<Fixture[]>([]);
  const [selectedFixtureForSubmit, setSelectedFixtureForSubmit] = useState<Fixture | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      const [meRes, matchesRes] = await Promise.all([
        api.getMe(activeSeasonId),
        api.getMyMatches(activeSeasonId),
      ]);
      setStats(meRes.stats);
      setMyMatches(matchesRes.fixtures);
    } catch (err: any) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [activeSeasonId, user?.id, currentClub?.id]);

  // Determine next pending match vs past confirmed matches
  const pendingMatches = myMatches.filter((m) => m.status !== 'CONFIRMED' && m.status !== 'CANCELLED');
  const nextMatch = pendingMatches[0] || null;
  const recentFinishedMatches = myMatches.filter((m) => m.status === 'CONFIRMED');
  const latestFinishedMatch = recentFinishedMatches[recentFinishedMatches.length - 1] || null;

  const calculateForm = (fixture: Fixture): 'W' | 'D' | 'L' => {
    const isHome = fixture.homeOwnerId === user?.id || fixture.homeClubId === currentClub?.id;
    const myScore = isHome ? fixture.homeScore! : fixture.awayScore!;
    const oppScore = isHome ? fixture.awayScore! : fixture.homeScore!;
    if (myScore > oppScore) return 'W';
    if (myScore === oppScore) return 'D';
    return 'L';
  };

  const getStatusBadge = (status: Fixture['status']) => {
    switch (status) {
      case 'CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" /> {t.matchStatusConfirmed}
          </span>
        );
      case 'PENDING_CONFIRMATION':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse">
            <Clock className="w-3 h-3" /> {t.matchStatusPending}
          </span>
        );
      case 'DISPUTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
            <AlertTriangle className="w-3 h-3" /> {t.matchStatusDisputed}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
            <Calendar className="w-3 h-3" /> {t.matchStatusUpcoming}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-20">
      {/* Auth Error Banner (if Telegram auth rejected) */}
      {authStatus === 'AUTH_ERROR' && (
        <div className="p-4 rounded-2xl bg-rose-950/60 border border-rose-500/40 text-rose-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xl">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-xs sm:text-sm text-rose-100">Telegram Authentication Failed</div>
              <div className="text-xs text-rose-300/90 mt-0.5">
                Reason: {authError || 'Invalid or expired Telegram WebApp signature'}
              </div>
            </div>
          </div>
          {onOpenDiagnostics && (
            <button
              id="btn-open-diagnostics-error"
              onClick={onOpenDiagnostics}
              className="px-3 py-1.5 rounded-xl bg-rose-800 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 transition-colors"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>View Diagnostics</span>
            </button>
          )}
        </div>
      )}

      {/* Club Claim Promo Banner (if user has no club yet) */}
      {!currentClub && (
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-600 via-teal-700 to-indigo-800 p-6 sm:p-8 text-white shadow-2xl">
          <div className="relative z-10 max-w-xl">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/20 text-white text-xs font-black uppercase tracking-wider mb-3 backdrop-blur-sm">
              <Sparkles className="w-3.5 h-3.5" /> 2026/27 Registration Open
            </div>
            <h2 className="text-xl sm:text-3xl font-black tracking-tight mb-2">
              {t.selectYourClub}
            </h2>
            <p className="text-xs sm:text-sm text-emerald-100 mb-5 leading-relaxed">
              Choose from 96 authentic European clubs across Premier League, La Liga, Serie A, Bundesliga, and Ligue 1 to compete in the active season.
            </p>
            <button
              id="btn-claim-club-banner"
              onClick={() => onNavigateTab('leagues')}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-white text-slate-950 font-black text-xs sm:text-sm shadow-xl hover:bg-slate-100 active:scale-95 transition-all"
            >
              <Shield className="w-4 h-4 text-emerald-600" />
              <span>{t.allClubs}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Club & Player Status Card (when claimed) */}
      {currentClub && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-7 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            {/* Club identity */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-slate-950 p-3 border-2 border-slate-700/80 flex items-center justify-center shadow-xl shrink-0">
                <img
                  src={currentClub.logoUrl}
                  alt={currentClub.name}
                  className="w-full h-full object-contain drop-shadow"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {currentClub.leagueId ? currentClub.leagueId.replace('league-', '').replace('-', ' ').toUpperCase() : 'DOMESTIC LEAGUE'}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">@{user?.username}</span>
                </div>
                <h2 className="text-xl sm:text-3xl font-black text-white tracking-tight mt-1">
                  {currentClub.name}
                </h2>
                <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                  <span>{currentClub.stadium || 'Home Stadium'}</span>
                  <span>•</span>
                  <span className="text-emerald-400 font-bold">{currentClub.shortName}</span>
                </p>
              </div>
            </div>

            {/* Quick stats badges */}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 sm:gap-3 bg-slate-950/80 p-3 rounded-2xl border border-slate-800">
              <div className="text-center">
                <div className="text-[10px] uppercase font-bold text-slate-400">{t.pos}</div>
                <div className="text-base sm:text-xl font-black text-amber-400 flex items-center justify-center gap-0.5">
                  <Trophy className="w-4 h-4 text-amber-400" />
                  <span>#{stats?.leaguePosition || 1}</span>
                </div>
              </div>
              <div className="text-center">
                <div className="text-[10px] uppercase font-bold text-slate-400">{t.pts}</div>
                <div className="text-base sm:text-xl font-black text-white">{stats?.points || 0}</div>
              </div>
              <div className="text-center">
                <div className="text-[10px] uppercase font-bold text-slate-400">W-D-L</div>
                <div className="text-xs sm:text-sm font-bold text-emerald-400 mt-1">
                  {stats?.wins || 0}-{stats?.draws || 0}-{stats?.losses || 0}
                </div>
              </div>
              <div className="text-center hidden sm:block">
                <div className="text-[10px] uppercase font-bold text-slate-400">{t.gd}</div>
                <div className="text-base sm:text-xl font-black text-slate-200">
                  {((stats?.goalsScored || 0) - (stats?.goalsConceded || 0)) > 0
                    ? `+${(stats?.goalsScored || 0) - (stats?.goalsConceded || 0)}`
                    : (stats?.goalsScored || 0) - (stats?.goalsConceded || 0)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Next Match & Latest Result Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Next Match */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-300">
                {t.nextMatch}
              </h3>
            </div>
            {nextMatch && getStatusBadge(nextMatch.status)}
          </div>

          {nextMatch ? (
            <div className="space-y-4">
              <div className="text-xs text-slate-400 font-medium">
                {nextMatch.competitionName} • {nextMatch.roundName || `${t.matchday} ${nextMatch.matchday}`}
              </div>

              <div className="grid grid-cols-7 items-center gap-2 text-center py-2">
                {/* Home */}
                <div className="col-span-3 flex flex-col items-center">
                  <div className="w-12 h-12 rounded-2xl bg-slate-950 p-2 border border-slate-800 flex items-center justify-center mb-1 shadow-inner">
                    <img
                      src={nextMatch.homeClub?.logoUrl}
                      alt={nextMatch.homeClub?.name}
                      className="w-8 h-8 object-contain"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <span className="font-bold text-xs text-slate-100 truncate max-w-full">
                    {nextMatch.homeClub?.name}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {nextMatch.homeOwnerId === user?.id ? `(${t.myClub})` : `@${nextMatch.homeClub?.claimedByUsername || 'open'}`}
                  </span>
                </div>

                {/* VS */}
                <div className="col-span-1 flex items-center justify-center">
                  <span className="w-8 h-8 rounded-full bg-slate-950 border border-slate-800 flex items-center justify-center text-[10px] font-black text-slate-400">
                    VS
                  </span>
                </div>

                {/* Away */}
                <div className="col-span-3 flex flex-col items-center">
                  <div className="w-12 h-12 rounded-2xl bg-slate-950 p-2 border border-slate-800 flex items-center justify-center mb-1 shadow-inner">
                    <img
                      src={nextMatch.awayClub?.logoUrl}
                      alt={nextMatch.awayClub?.name}
                      className="w-8 h-8 object-contain"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <span className="font-bold text-xs text-slate-100 truncate max-w-full">
                    {nextMatch.awayClub?.name}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {nextMatch.awayOwnerId === user?.id ? `(${t.myClub})` : `@${nextMatch.awayClub?.claimedByUsername || 'open'}`}
                  </span>
                </div>
              </div>

              <button
                onClick={() => {
                  if (onSelectFixtureForMatchCenter) onSelectFixtureForMatchCenter(nextMatch);
                  onNavigateTab('my-matches');
                }}
                className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs shadow-md shadow-emerald-500/20 active:scale-95 transition-all flex items-center justify-center gap-1.5"
              >
                <Swords className="w-3.5 h-3.5" />
                <span>{t.openMatchCenter}</span>
              </button>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-400">
              {t.noUpcomingMatches}
            </div>
          )}
        </div>

        {/* Latest Result & Current Form */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-emerald-400" />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-300">
                {t.latestResult} & {t.recentForm}
              </h3>
            </div>
            {latestFinishedMatch && (
              <span className="text-[10px] font-bold text-slate-400">
                {latestFinishedMatch.competitionName}
              </span>
            )}
          </div>

          {latestFinishedMatch ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3.5 bg-slate-950 rounded-2xl border border-slate-800">
                <div className="flex items-center gap-2">
                  <img
                    src={latestFinishedMatch.homeClub?.logoUrl}
                    alt={latestFinishedMatch.homeClub?.name}
                    className="w-6 h-6 object-contain"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <span className="font-bold text-xs text-white">
                    {latestFinishedMatch.homeClub?.name}
                  </span>
                </div>

                <div className="px-3 py-1 bg-slate-900 border border-slate-800 rounded-xl font-black text-sm text-white">
                  {latestFinishedMatch.homeScore} : {latestFinishedMatch.awayScore}
                </div>

                <div className="flex items-center gap-2 text-right">
                  <span className="font-bold text-xs text-white">
                    {latestFinishedMatch.awayClub?.name}
                  </span>
                  <img
                    src={latestFinishedMatch.awayClub?.logoUrl}
                    alt={latestFinishedMatch.awayClub?.name}
                    className="w-6 h-6 object-contain"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>
              </div>

              {/* Form Guide */}
              <div>
                <div className="text-[11px] font-bold text-slate-400 mb-2">{t.recentForm}</div>
                <div className="flex items-center gap-2">
                  {recentFinishedMatches.map((fix) => {
                    const outcome = calculateForm(fix);
                    return (
                      <span
                        key={fix.id}
                        className={`w-7 h-7 rounded-xl flex items-center justify-center font-black text-xs ${
                          outcome === 'W'
                            ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                            : outcome === 'D'
                            ? 'bg-amber-500 text-slate-950'
                            : 'bg-rose-500 text-white'
                        }`}
                      >
                        {outcome}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-400">
              No completed matches yet. Results and form will appear here after matches are played and confirmed.
            </div>
          )}
        </div>
      </div>

      {/* Quick Navigation Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => onNavigateTab('standings')}
          className="p-4 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl text-left transition-all shadow-md group"
        >
          <Trophy className="w-5 h-5 text-emerald-400 mb-2 group-hover:scale-110 transition-transform" />
          <div className="text-xs font-bold text-white">{t.leagueStandings}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Live tables & points</div>
        </button>

        <button
          onClick={() => onNavigateTab('cups')}
          className="p-4 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl text-left transition-all shadow-md group"
        >
          <Award className="w-5 h-5 text-indigo-400 mb-2 group-hover:scale-110 transition-transform" />
          <div className="text-xs font-bold text-white">{t.navCups}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Domestic elimination</div>
        </button>

        <button
          onClick={() => onNavigateTab('champions-league')}
          className="p-4 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl text-left transition-all shadow-md group"
        >
          <Globe2 className="w-5 h-5 text-sky-400 mb-2 group-hover:scale-110 transition-transform" />
          <div className="text-xs font-bold text-white">{t.navChampionsLeague}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">UEFA tournament</div>
        </button>

        <button
          onClick={() => onNavigateTab('leagues')}
          className="p-4 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl text-left transition-all shadow-md group"
        >
          <Shield className="w-5 h-5 text-amber-400 mb-2 group-hover:scale-110 transition-transform" />
          <div className="text-xs font-bold text-white">{t.allClubs}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Top 5 European leagues</div>
        </button>
      </div>

      {/* Result Submission Modal if active */}
      {selectedFixtureForSubmit && (
        <ResultSubmissionModal
          fixture={selectedFixtureForSubmit}
          isOpen={true}
          onClose={() => setSelectedFixtureForSubmit(null)}
          onSuccess={() => {
            loadDashboardData();
          }}
        />
      )}
    </div>
  );
};
