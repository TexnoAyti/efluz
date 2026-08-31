import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Fixture, Club } from '../types';
import { ResultSubmissionModal } from './ResultSubmissionModal';
import { ClubCrest } from './ClubCrest';
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
  const [error, setError] = useState<string | null>(null);

  const loadDashboardData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [meRes, matchesRes] = await Promise.all([
        api.getMe(activeSeasonId).catch((err) => {
          console.warn('Dashboard getMe failed:', err);
          return null;
        }),
        api.getMyMatches(activeSeasonId).catch((err) => {
          console.warn('Dashboard getMyMatches failed:', err);
          return null;
        }),
      ]);

      if (meRes?.stats) {
        setStats(meRes.stats);
      }
      if (matchesRes?.fixtures) {
        setMyMatches(matchesRes.fixtures);
      }

      if (!meRes && !matchesRes) {
        setError("Couldn't load data. Please try again.");
      }
    } catch (err: any) {
      console.error('Failed to load dashboard data:', err);
      setError("Couldn't load data. Please try again.");
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
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" /> {t.matchStatusConfirmed}
          </span>
        );
      case 'PENDING_CONFIRMATION':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse">
            <Clock className="w-3 h-3" /> {t.matchStatusPending}
          </span>
        );
      case 'DISPUTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <AlertTriangle className="w-3 h-3" /> {t.matchStatusDisputed}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-slate-300 glass-pill">
            <Calendar className="w-3 h-3" /> {t.matchStatusUpcoming}
          </span>
        );
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300 pb-20">
      {/* Auth Error Banner (if Telegram auth rejected) */}
      {authStatus === 'AUTH_ERROR' && (
        <div className="p-4 glass-panel bg-rose-950/40 border-rose-500/40 text-rose-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xl">
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
              className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 transition-colors shadow-md"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>View Diagnostics</span>
            </button>
          )}
        </div>
      )}

      {/* Data Error Banner with Retry */}
      {error && !stats && myMatches.length === 0 && (
        <div className="p-4 rounded-2xl glass-panel border-rose-500/30 bg-rose-950/30 text-rose-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xl">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <div className="font-bold text-xs sm:text-sm text-white">Couldn't load data</div>
              <div className="text-xs text-rose-300/80 mt-0.5">Please try again.</div>
            </div>
          </div>
          <button
            onClick={() => loadDashboardData()}
            className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 shadow-md transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Loading Skeletons */}
      {isLoading && !stats && myMatches.length === 0 && (
        <div className="space-y-4 animate-pulse">
          <div className="h-28 rounded-2xl bg-white/[0.04] border border-white/[0.06]" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="h-44 rounded-2xl bg-white/[0.04] border border-white/[0.06]" />
            <div className="h-44 rounded-2xl bg-white/[0.04] border border-white/[0.06]" />
          </div>
        </div>
      )}

      {/* Club Claim Banner (if user has no club yet) */}
      {!isLoading && !currentClub && (
        <div className="glass-panel p-5 sm:p-6 text-white shadow-xl">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 mb-2.5">
              <Sparkles className="w-3 h-3" /> Season 2026/27 Active
            </div>
            <h2 className="text-lg sm:text-2xl font-black tracking-tight mb-1.5">
              {t.selectYourClub}
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mb-4 leading-relaxed">
              Select your club from Premier League, La Liga, Serie A, Bundesliga, or Ligue 1 to participate in matchdays and league tables.
            </p>
            <button
              id="btn-claim-club-banner"
              onClick={() => onNavigateTab('leagues')}
              className="inline-flex items-center gap-2 px-4 py-2 btn-glass-primary text-slate-950 font-black text-xs sm:text-sm shadow-md"
            >
              <Shield className="w-3.5 h-3.5 text-slate-950" />
              <span>{t.allClubs}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Club & Player Status Card (when claimed) */}
      {currentClub && (
        <div className="glass-panel p-4 sm:p-5 shadow-xl">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Club identity */}
            <div className="flex items-center gap-3.5">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-slate-950/90 p-2 border border-white/[0.08] flex items-center justify-center shrink-0">
                <ClubCrest
                  clubId={currentClub.id}
                  logoUrl={currentClub.logoUrl}
                  name={currentClub.name}
                  shortName={currentClub.shortName}
                  size="xl"
                  className="w-full h-full"
                />
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {currentClub.leagueId ? currentClub.leagueId.replace('league-', '').replace('-', ' ').toUpperCase() : 'LEAGUE'}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">@{user?.username}</span>
                </div>
                <h2 className="text-lg sm:text-xl font-black text-white tracking-tight mt-0.5 truncate">
                  {currentClub.name}
                </h2>
                <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5 truncate">
                  <span>{currentClub.stadium || 'Home Stadium'}</span>
                  <span>•</span>
                  <span className="text-emerald-400 font-bold">{currentClub.shortName}</span>
                </p>
              </div>
            </div>

            {/* Quick stats badges - Tabular Numbers */}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 glass-card p-2 rounded-lg border-white/[0.06] tabular-nums">
              <div className="text-center px-2">
                <div className="text-[9px] uppercase font-bold text-slate-400">{t.pos}</div>
                <div className="text-sm sm:text-base font-black text-amber-400 flex items-center justify-center gap-0.5 mt-0.5">
                  <Trophy className="w-3 h-3 text-amber-400" />
                  <span>#{stats?.leaguePosition || 1}</span>
                </div>
              </div>
              <div className="text-center px-2">
                <div className="text-[9px] uppercase font-bold text-slate-400">{t.pts}</div>
                <div className="text-sm sm:text-base font-black text-white mt-0.5">{stats?.points || 0}</div>
              </div>
              <div className="text-center px-2">
                <div className="text-[9px] uppercase font-bold text-slate-400">W-D-L</div>
                <div className="text-xs sm:text-sm font-bold text-emerald-400 mt-0.5">
                  {stats?.wins || 0}-{stats?.draws || 0}-{stats?.losses || 0}
                </div>
              </div>
              <div className="text-center px-2 hidden sm:block">
                <div className="text-[9px] uppercase font-bold text-slate-400">{t.gd}</div>
                <div className="text-sm sm:text-base font-bold text-slate-200 mt-0.5">
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Next Match */}
        <div className="glass-panel p-4 sm:p-5 shadow-xl space-y-3 min-w-0">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <Flame className="w-4 h-4 text-amber-400 shrink-0" />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 truncate">
                {t.nextMatch}
              </h3>
            </div>
            {nextMatch && getStatusBadge(nextMatch.status)}
          </div>

          {nextMatch ? (
            <div className="space-y-3 min-w-0">
              <div className="text-[11px] text-slate-400 font-medium truncate">
                {nextMatch.competitionName} • {nextMatch.roundName || `${t.matchday} ${nextMatch.matchday}`}
              </div>

              <div className="flex items-center justify-between gap-2 py-2 px-1">
                {/* Home */}
                <div className="flex-1 min-w-0 flex flex-col items-center text-center">
                  <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-slate-950/80 p-1.5 border border-white/[0.08] flex items-center justify-center mb-1 shadow-inner shrink-0">
                    <ClubCrest
                      clubId={nextMatch.homeClub?.id}
                      logoUrl={nextMatch.homeClub?.logoUrl}
                      name={nextMatch.homeClub?.name}
                      shortName={nextMatch.homeClub?.shortName}
                      size="md"
                      className="w-7 h-7"
                    />
                  </div>
                  <span className="font-bold text-xs text-slate-100 truncate w-full">
                    {nextMatch.homeClub?.shortName || nextMatch.homeClub?.name}
                  </span>
                  <span className="text-[10px] text-slate-400 truncate w-full">
                    {nextMatch.homeOwnerId === user?.id ? `(${t.myClub})` : `@${nextMatch.homeClub?.claimedByUsername || 'open'}`}
                  </span>
                </div>

                {/* VS Badge */}
                <div className="shrink-0 px-2 flex flex-col items-center">
                  <span className="w-8 h-8 rounded-full glass-card flex items-center justify-center text-[10px] font-black text-emerald-400 border-emerald-500/20">
                    VS
                  </span>
                </div>

                {/* Away */}
                <div className="flex-1 min-w-0 flex flex-col items-center text-center">
                  <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-slate-950/80 p-1.5 border border-white/[0.08] flex items-center justify-center mb-1 shadow-inner shrink-0">
                    <ClubCrest
                      clubId={nextMatch.awayClub?.id}
                      logoUrl={nextMatch.awayClub?.logoUrl}
                      name={nextMatch.awayClub?.name}
                      shortName={nextMatch.awayClub?.shortName}
                      size="md"
                      className="w-7 h-7"
                    />
                  </div>
                  <span className="font-bold text-xs text-slate-100 truncate w-full">
                    {nextMatch.awayClub?.shortName || nextMatch.awayClub?.name}
                  </span>
                  <span className="text-[10px] text-slate-400 truncate w-full">
                    {nextMatch.awayOwnerId === user?.id ? `(${t.myClub})` : `@${nextMatch.awayClub?.claimedByUsername || 'open'}`}
                  </span>
                </div>
              </div>

              <button
                onClick={() => {
                  if (onSelectFixtureForMatchCenter) onSelectFixtureForMatchCenter(nextMatch);
                  onNavigateTab('my-matches');
                }}
                className="w-full py-2.5 btn-glass-primary font-black text-xs flex items-center justify-center gap-1.5 min-h-[44px] touch-manipulation"
              >
                <Swords className="w-3.5 h-3.5" />
                <span>{t.openMatchCenter}</span>
              </button>
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-slate-400">
              {t.noUpcomingMatches}
            </div>
          )}
        </div>

        {/* Latest Result & Current Form */}
        <div className="glass-panel p-4 sm:p-5 shadow-xl space-y-3 min-w-0">
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <Trophy className="w-4 h-4 text-emerald-400 shrink-0" />
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 truncate">
                {t.latestResult}
              </h3>
            </div>
            {latestFinishedMatch && (
              <span className="text-[10px] font-bold text-slate-400 truncate max-w-[120px]">
                {latestFinishedMatch.competitionName}
              </span>
            )}
          </div>

          {latestFinishedMatch ? (
            <div className="space-y-3 min-w-0">
              <div className="flex items-center justify-between p-2.5 glass-card border-white/[0.08] gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <ClubCrest
                    clubId={latestFinishedMatch.homeClub?.id}
                    logoUrl={latestFinishedMatch.homeClub?.logoUrl}
                    name={latestFinishedMatch.homeClub?.name}
                    shortName={latestFinishedMatch.homeClub?.shortName}
                    size="xs"
                    className="w-5 h-5"
                  />
                  <span className="font-bold text-xs text-white truncate">
                    {latestFinishedMatch.homeClub?.shortName || latestFinishedMatch.homeClub?.name}
                  </span>
                </div>

                <div className="px-2.5 py-1 glass-card border-white/[0.1] font-black text-xs sm:text-sm text-white shrink-0">
                  {latestFinishedMatch.homeScore} : {latestFinishedMatch.awayScore}
                </div>

                <div className="flex items-center gap-2 min-w-0 flex-1 justify-end">
                  <span className="font-bold text-xs text-white truncate text-right">
                    {latestFinishedMatch.awayClub?.shortName || latestFinishedMatch.awayClub?.name}
                  </span>
                  <ClubCrest
                    clubId={latestFinishedMatch.awayClub?.id}
                    logoUrl={latestFinishedMatch.awayClub?.logoUrl}
                    name={latestFinishedMatch.awayClub?.name}
                    shortName={latestFinishedMatch.awayClub?.shortName}
                    size="xs"
                    className="w-5 h-5"
                  />
                </div>
              </div>

              {/* Form Guide */}
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">{t.recentForm}</div>
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
                  {recentFinishedMatches.map((fix) => {
                    const outcome = calculateForm(fix);
                    return (
                      <span
                        key={fix.id}
                        className={`w-6 h-6 rounded-lg flex items-center justify-center font-black text-[11px] shrink-0 ${
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
            <div className="py-6 text-center text-xs text-slate-400">
              No completed matches yet.
            </div>
          )}
        </div>
      </div>

      {/* Quick Navigation Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <button
          onClick={() => onNavigateTab('standings')}
          className="p-3.5 glass-card glass-card-interactive text-left transition-all shadow-md group"
        >
          <Trophy className="w-5 h-5 text-emerald-400 mb-1.5 group-hover:scale-110 transition-transform" />
          <div className="text-xs font-bold text-white">{t.leagueStandings}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Live tables & points</div>
        </button>

        <button
          onClick={() => onNavigateTab('cups')}
          className="p-3.5 glass-card glass-card-interactive text-left transition-all shadow-md group"
        >
          <Award className="w-5 h-5 text-indigo-400 mb-1.5 group-hover:scale-110 transition-transform" />
          <div className="text-xs font-bold text-white">{t.navCups}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">Domestic elimination</div>
        </button>

        <button
          onClick={() => onNavigateTab('champions-league')}
          className="p-3.5 glass-card glass-card-interactive text-left transition-all shadow-md group"
        >
          <Globe2 className="w-5 h-5 text-sky-400 mb-1.5 group-hover:scale-110 transition-transform" />
          <div className="text-xs font-bold text-white">{t.navChampionsLeague}</div>
          <div className="text-[10px] text-slate-400 mt-0.5">UEFA tournament</div>
        </button>

        <button
          onClick={() => onNavigateTab('leagues')}
          className="p-3.5 glass-card glass-card-interactive text-left transition-all shadow-md group"
        >
          <Shield className="w-5 h-5 text-amber-400 mb-1.5 group-hover:scale-110 transition-transform" />
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
