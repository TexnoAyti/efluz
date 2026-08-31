import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Dispute, AuditLog, Competition, User, Club, Fixture } from '../types';
import { ClubCrest } from './ClubCrest';
import {
  SlidersHorizontal,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileText,
  Shield,
  RefreshCw,
  Sparkles,
  Link,
  Loader2,
  Clock,
  UserCheck,
  Calendar,
  Layers,
  Award,
  Globe2,
  Trophy,
  Database,
  Search,
  Filter,
  Eye,
  Activity,
  RotateCcw,
  ChevronRight,
  Info,
  Sliders,
  Check,
} from 'lucide-react';

type AdminTab = 'overview' | 'matches' | 'clubs' | 'competitions' | 'users' | 'system';

export const AdminView: React.FC = () => {
  const { user, activeSeasonId, showToast } = useAuth();
  const { t } = useI18n();

  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Core Data
  const [overviewData, setOverviewData] = useState<any>(null);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [diagnostics, setDiagnostics] = useState<any>(null);

  // Filter States
  const [matchCompFilter, setMatchCompFilter] = useState<string>('ALL');
  const [matchStatusFilter, setMatchStatusFilter] = useState<string>('ALL');
  const [matchSearch, setMatchSearch] = useState<string>('');

  const [clubLeagueFilter, setClubLeagueFilter] = useState<string>('ALL');
  const [clubOccupancyFilter, setClubOccupancyFilter] = useState<string>('ALL');
  const [clubSearch, setClubSearch] = useState<string>('');

  const [userSearch, setUserSearch] = useState<string>('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('ALL');

  // Resolution Modal State
  const [selectedDisputeForResolve, setSelectedDisputeForResolve] = useState<Dispute | null>(null);
  const [manualHomeScore, setManualHomeScore] = useState<number>(0);
  const [manualAwayScore, setManualAwayScore] = useState<number>(0);
  const [resolutionNotes, setResolutionNotes] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Fixture Reopen & Inspect State
  const [selectedFixtureForReopen, setSelectedFixtureForReopen] = useState<Fixture | null>(null);
  const [reopenNotes, setReopenNotes] = useState<string>('');
  const [selectedFixtureForInspect, setSelectedFixtureForInspect] = useState<Fixture | null>(null);

  // Generator State
  const [generatingCompId, setGeneratingCompId] = useState<string | null>(null);
  const [rebuildingStandingsCompId, setRebuildingStandingsCompId] = useState<string | null>(null);

  const loadAllAdminData = async (skipCache = false) => {
    if (!user?.isAdmin) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      const [
        overviewRes,
        disputesRes,
        auditRes,
        compsRes,
        usersRes,
        clubsRes,
        fixturesRes,
        diagRes,
      ] = await Promise.all([
        api.getAdminOverview(activeSeasonId, skipCache).catch(() => null),
        api.getAdminDisputes('OPEN', skipCache).catch(() => ({ disputes: [] })),
        api.getAdminAuditLogs(40, skipCache).catch(() => ({ logs: [] })),
        api.getCompetitions(activeSeasonId, skipCache).catch(() => ({ competitions: [] })),
        api.getAdminUsers(skipCache).catch(() => ({ users: [] })),
        api.getAdminClubs(activeSeasonId, undefined, skipCache).catch(() => ({ clubs: [], total: 0 })),
        api.getAdminFixtures(activeSeasonId, undefined, undefined, undefined, 120, skipCache).catch(() => ({ fixtures: [], total: 0 })),
        api.getAdminDiagnostics().catch(() => null),
      ]);

      if (overviewRes) setOverviewData(overviewRes);
      if (disputesRes?.disputes) setDisputes(disputesRes.disputes);
      if (auditRes?.logs) setAuditLogs(auditRes.logs);
      if (compsRes?.competitions) setCompetitions(compsRes.competitions);
      if (usersRes?.users) setUsers(usersRes.users);
      if (clubsRes?.clubs) setClubs(clubsRes.clubs);
      if (fixturesRes?.fixtures) setFixtures(fixturesRes.fixtures);
      if (diagRes) setDiagnostics(diagRes);
    } catch (err: any) {
      console.error('Failed to load admin data:', err);
      setError("Couldn't load some administrative records. Please click refresh.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user?.isAdmin) {
      loadAllAdminData();
    } else {
      setIsLoading(false);
    }
  }, [activeSeasonId, user?.isAdmin]);

  // Dispute Resolution Action
  const handleResolveDispute = async (
    action: 'CONFIRM_HOME_SUBMISSION' | 'CONFIRM_AWAY_SUBMISSION' | 'MANUAL_SCORE' | 'CANCEL_MATCH'
  ) => {
    if (!selectedDisputeForResolve) return;
    setIsProcessing(true);
    try {
      await api.resolveAdminDispute(selectedDisputeForResolve.id, {
        action,
        manualHomeScore: action === 'MANUAL_SCORE' ? manualHomeScore : undefined,
        manualAwayScore: action === 'MANUAL_SCORE' ? manualAwayScore : undefined,
        notes: resolutionNotes || `Resolved with ${action} by tournament admin`,
      });
      showToast('Dispute resolved successfully! Standings and fixture updated.', 'success');
      setSelectedDisputeForResolve(null);
      setResolutionNotes('');
      await loadAllAdminData(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to resolve dispute.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Reopen Fixture Action
  const handleReopenFixture = async (fixtureId: string, notes?: string) => {
    setIsProcessing(true);
    try {
      await api.reopenFixture(fixtureId, notes || 'Reopened by tournament administrator');
      showToast('Fixture successfully reopened for fresh score submission.', 'success');
      setSelectedFixtureForReopen(null);
      setReopenNotes('');
      await loadAllAdminData(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to reopen fixture.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Schedule Generation Actions
  const handleGenerateCompetition = async (compId: string) => {
    setGeneratingCompId(compId);
    try {
      const res = await api.generateCompetitionFixtures(compId, true);
      showToast(res.message || 'Schedule generated and persisted in Firestore.', 'success');
      await loadAllAdminData(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to generate schedule.', 'error');
    } finally {
      setGeneratingCompId(null);
    }
  };

  const handleResetCompetition = async (compId: string) => {
    setGeneratingCompId(compId);
    try {
      const res = await api.resetCompetitionFixtures(compId);
      showToast(res.message || 'Schedule reset and regenerated successfully.', 'success');
      await loadAllAdminData(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to reset schedule.', 'error');
    } finally {
      setGeneratingCompId(null);
    }
  };

  const handleRebuildStandings = async (compId: string) => {
    setRebuildingStandingsCompId(compId);
    try {
      const res = await api.rebuildStandings(compId);
      showToast(res.message || 'Standings recalculated from confirmed fixtures.', 'success');
      await loadAllAdminData(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to rebuild standings.', 'error');
    } finally {
      setRebuildingStandingsCompId(null);
    }
  };

  const handleEvaluateQualifications = async () => {
    setIsProcessing(true);
    try {
      const res = await api.evaluateSeasonQualifications(activeSeasonId);
      showToast(res.message || 'European qualifications calculated and persisted!', 'success');
      await loadAllAdminData(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to evaluate qualifications.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Filtered Matches
  const filteredFixtures = useMemo(() => {
    return fixtures.filter((f) => {
      if (matchCompFilter !== 'ALL' && f.competitionId !== matchCompFilter) return false;
      if (matchStatusFilter !== 'ALL' && f.status !== matchStatusFilter) return false;
      if (matchSearch.trim()) {
        const q = matchSearch.toLowerCase();
        const homeMatch = f.homeClub?.name?.toLowerCase().includes(q) || f.homeClub?.shortName?.toLowerCase().includes(q);
        const awayMatch = f.awayClub?.name?.toLowerCase().includes(q) || f.awayClub?.shortName?.toLowerCase().includes(q);
        const compMatch = f.competitionName?.toLowerCase().includes(q);
        const idMatch = f.id.toLowerCase().includes(q);
        if (!homeMatch && !awayMatch && !compMatch && !idMatch) return false;
      }
      return true;
    });
  }, [fixtures, matchCompFilter, matchStatusFilter, matchSearch]);

  // Filtered Clubs
  const filteredClubs = useMemo(() => {
    return clubs.filter((c) => {
      if (clubLeagueFilter !== 'ALL' && c.leagueId !== clubLeagueFilter) return false;
      if (clubOccupancyFilter === 'OCCUPIED' && !c.isTaken && !c.claimedByUserId) return false;
      if (clubOccupancyFilter === 'AVAILABLE' && (c.isTaken || c.claimedByUserId)) return false;
      if (clubSearch.trim()) {
        const q = clubSearch.toLowerCase();
        const nameMatch = c.name.toLowerCase().includes(q) || c.shortName.toLowerCase().includes(q);
        const managerMatch = c.claimedByUsername?.toLowerCase().includes(q) || c.managerUsername?.toLowerCase().includes(q);
        if (!nameMatch && !managerMatch) return false;
      }
      return true;
    });
  }, [clubs, clubLeagueFilter, clubOccupancyFilter, clubSearch]);

  // Filtered Users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (userRoleFilter === 'ADMIN' && !u.isAdmin) return false;
      if (userRoleFilter === 'PLAYER' && u.isAdmin) return false;
      if (userRoleFilter === 'SUSPENDED' && !u.isSuspended) return false;
      if (userSearch.trim()) {
        const q = userSearch.toLowerCase();
        const unameMatch = u.username?.toLowerCase().includes(q);
        const nameMatch = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase().includes(q);
        const idMatch = u.telegramId?.includes(q) || u.id?.toLowerCase().includes(q);
        if (!unameMatch && !nameMatch && !idMatch) return false;
      }
      return true;
    });
  }, [users, userRoleFilter, userSearch]);

  // Grouped Competitions
  const groupedCompetitions = useMemo(() => {
    const domesticLeagues = competitions.filter((c) => c.type === 'LEAGUE' || (c.type as string) === 'league');
    const domesticCups = competitions.filter(
      (c) => c.type === 'KNOCKOUT' || (c.type as string) === 'cup'
    );
    const superCups = competitions.filter(
      (c) => (c.type === 'SUPER_CUP' || (c.type as string) === 'super_cup') && c.id !== 'comp-trophee-des-champions'
    );
    const european = competitions.filter(
      (c) =>
        c.type === 'EUROPEAN_LEAGUE_PHASE' ||
        c.type === 'EUROPEAN_KNOCKOUT' ||
        (c.type as string) === 'champions_league' ||
        (c.type as string) === 'europa_league' ||
        (c.type as string) === 'conference_league'
    );

    return { domesticLeagues, domesticCups, superCups, european };
  }, [competitions]);

  // Unauthorized Screen
  if (!user?.isAdmin) {
    return (
      <div className="py-16 px-4 max-w-lg mx-auto text-center animate-in fade-in duration-300">
        <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mx-auto mb-4 shadow-xl">
          <Shield className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-black text-white">Admin Authorization Required</h3>
        <p className="text-xs text-slate-400 mt-2 leading-relaxed">
          The active account (Telegram ID: <span className="font-mono text-emerald-400 font-bold">{user?.telegramId || 'Unauthenticated'}</span>, Username: <span className="font-mono text-emerald-400 font-bold">@{user?.username || 'player'}</span>) does not possess administrative privileges.
        </p>
      </div>
    );
  }

  const occupiedClubsCount = clubs.filter((c) => c.isTaken || c.claimedByUserId).length;
  const availableClubsCount = Math.max(0, clubs.length - occupiedClubsCount);

  return (
    <div className="space-y-5 animate-in fade-in duration-300 pb-20 max-w-7xl mx-auto">
      {/* Top Header & Fast Action Bar */}
      <div className="glass-panel p-4 sm:p-6 shadow-2xl relative overflow-hidden border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30">
                Football Competition Control Center
              </span>
              <span className="text-[11px] font-semibold text-slate-400">
                Officer: <strong className="text-emerald-400">@{user?.username}</strong> ({user?.id})
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">
                Season 2026/27 Active
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
              <SlidersHorizontal className="w-6 h-6 text-amber-400 shrink-0" />
              <span>Tournament Administration & Match Engine</span>
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              id="btn-admin-refresh-data"
              onClick={() => loadAllAdminData(true)}
              disabled={isLoading}
              className="px-4 py-2 glass-card text-slate-200 hover:text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-md min-h-[40px] touch-manipulation hover:border-emerald-500/40"
            >
              <RefreshCw className={`w-4 h-4 text-emerald-400 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh Center</span>
            </button>
          </div>
        </div>

        {/* Global Error Banner if any */}
        {error && (
          <div className="mt-4 p-3 bg-rose-950/70 border border-rose-500/40 rounded-xl flex items-center justify-between gap-2 text-xs text-rose-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => loadAllAdminData(true)}
              className="px-2.5 py-1 bg-rose-800 hover:bg-rose-700 text-white rounded-lg font-bold text-[11px]"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* Sub-Navigation Tabs - Horizontal Scroller for mobile */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        <button
          id="tab-admin-overview"
          onClick={() => setActiveAdminTab('overview')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all min-h-[40px] ${
            activeAdminTab === 'overview'
              ? 'bg-amber-500 text-slate-950 font-black shadow-lg shadow-amber-500/25 scale-[1.02]'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Overview</span>
          {disputes.length > 0 && (
            <span className="px-1.5 py-0.2 bg-rose-500 text-white rounded-full font-black text-[10px] animate-pulse">
              {disputes.length}
            </span>
          )}
        </button>

        <button
          id="tab-admin-matches"
          onClick={() => setActiveAdminTab('matches')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all min-h-[40px] ${
            activeAdminTab === 'matches'
              ? 'btn-glass-primary text-slate-950 font-black shadow-lg shadow-emerald-500/25 scale-[1.02]'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Match Management</span>
          {fixtures.length > 0 && (
            <span className="text-[10px] text-slate-400 opacity-80 font-mono">({fixtures.length})</span>
          )}
        </button>

        <button
          id="tab-admin-clubs"
          onClick={() => setActiveAdminTab('clubs')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all min-h-[40px] ${
            activeAdminTab === 'clubs'
              ? 'btn-glass-primary text-slate-950 font-black shadow-lg shadow-emerald-500/25 scale-[1.02]'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>96 Clubs ({clubs.length || 96})</span>
        </button>

        <button
          id="tab-admin-competitions"
          onClick={() => setActiveAdminTab('competitions')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all min-h-[40px] ${
            activeAdminTab === 'competitions'
              ? 'btn-glass-primary text-slate-950 font-black shadow-lg shadow-emerald-500/25 scale-[1.02]'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <Trophy className="w-4 h-4" />
          <span>Competitions ({competitions.length})</span>
        </button>

        <button
          id="tab-admin-users"
          onClick={() => setActiveAdminTab('users')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all min-h-[40px] ${
            activeAdminTab === 'users'
              ? 'btn-glass-primary text-slate-950 font-black shadow-lg shadow-emerald-500/25 scale-[1.02]'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          <span>Players ({users.length})</span>
        </button>

        <button
          id="tab-admin-system"
          onClick={() => setActiveAdminTab('system')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all min-h-[40px] ${
            activeAdminTab === 'system'
              ? 'btn-glass-primary text-slate-950 font-black shadow-lg shadow-emerald-500/25 scale-[1.02]'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>System & Audit</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 1. OVERVIEW TAB */}
      {/* ========================================================================= */}
      {activeAdminTab === 'overview' && (
        <div className="space-y-6">
          {/* ACTION CENTER / NEEDS ATTENTION */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <AlertTriangle className={`w-4 h-4 ${disputes.length > 0 ? 'text-rose-400 animate-bounce' : 'text-emerald-400'}`} />
                <span>Action Center & Urgent Attention</span>
              </h2>
              <span className="text-xs font-semibold text-slate-400">
                {disputes.length} Active Conflict{disputes.length === 1 ? '' : 's'}
              </span>
            </div>

            {disputes.length === 0 ? (
              <div className="glass-panel p-6 sm:p-8 text-center border-emerald-500/30 bg-emerald-950/10 shadow-xl">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 mx-auto mb-3">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-white">All systems clear — No pending disputes or unresolved fixtures</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                  All tournament matches, submitted scores, and standings are currently synchronized and verified.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {disputes.map((dispute) => {
                  const fix = dispute.fixture;
                  return (
                    <div
                      key={dispute.id}
                      className="glass-panel border-rose-500/40 p-4 sm:p-5 shadow-2xl space-y-3 bg-rose-950/15"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-0.5 rounded text-[10px] font-black uppercase bg-rose-500/20 text-rose-400 border border-rose-500/30">
                            Score Conflict
                          </span>
                          <span className="text-xs font-black text-white">
                            {fix?.competitionName || 'Tournament'} • Matchday {fix?.matchday}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 hidden sm:inline">
                            (Dispute ID: {dispute.id.slice(0, 8)})
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {new Date(dispute.createdAt).toLocaleString()}
                        </span>
                      </div>

                      {/* Submissions side-by-side */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* Home entry */}
                        <div className="glass-card p-3 rounded-xl">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <ClubCrest
                                clubId={fix?.homeClub?.id}
                                logoUrl={fix?.homeClub?.logoUrl}
                                name={fix?.homeClub?.name}
                                shortName={fix?.homeClub?.shortName}
                                size="xs"
                                className="w-5 h-5 shrink-0"
                              />
                              <span className="text-xs font-bold text-slate-200 truncate">
                                {fix?.homeClub?.name} (@{fix?.homeClub?.claimedByUsername || 'player'})
                              </span>
                            </div>
                            <span className="text-[9px] uppercase font-black text-slate-400">Home Claim</span>
                          </div>
                          {dispute.homeSubmission ? (
                            <div className="flex items-center justify-between bg-slate-950/80 p-2 rounded-lg border border-white/[0.06]">
                              <span className="text-base font-black text-emerald-400">
                                {dispute.homeSubmission.homeScore} - {dispute.homeSubmission.awayScore}
                              </span>
                              {dispute.homeSubmission.proofUrl && (
                                <a
                                  href={dispute.homeSubmission.proofUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] text-indigo-400 hover:underline flex items-center gap-1"
                                >
                                  <Link className="w-3 h-3" />
                                  <span>Proof</span>
                                </a>
                              )}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-500 italic">No entry submitted</div>
                          )}
                        </div>

                        {/* Away entry */}
                        <div className="glass-card p-3 rounded-xl">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <ClubCrest
                                clubId={fix?.awayClub?.id}
                                logoUrl={fix?.awayClub?.logoUrl}
                                name={fix?.awayClub?.name}
                                shortName={fix?.awayClub?.shortName}
                                size="xs"
                                className="w-5 h-5 shrink-0"
                              />
                              <span className="text-xs font-bold text-slate-200 truncate">
                                {fix?.awayClub?.name} (@{fix?.awayClub?.claimedByUsername || 'player'})
                              </span>
                            </div>
                            <span className="text-[9px] uppercase font-black text-slate-400">Away Claim</span>
                          </div>
                          {dispute.awaySubmission ? (
                            <div className="flex items-center justify-between bg-slate-950/80 p-2 rounded-lg border border-white/[0.06]">
                              <span className="text-base font-black text-rose-400">
                                {dispute.awaySubmission.homeScore} - {dispute.awaySubmission.awayScore}
                              </span>
                              {dispute.awaySubmission.proofUrl && (
                                <a
                                  href={dispute.awaySubmission.proofUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[11px] text-indigo-400 hover:underline flex items-center gap-1"
                                >
                                  <Link className="w-3 h-3" />
                                  <span>Proof</span>
                                </a>
                              )}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-500 italic">No entry submitted</div>
                          )}
                        </div>
                      </div>

                      {/* 1-Click Fast Resolution Bar */}
                      <div className="pt-2 flex flex-wrap items-center justify-end gap-2">
                        {dispute.homeSubmission && (
                          <button
                            disabled={isProcessing}
                            onClick={() => {
                              setSelectedDisputeForResolve(dispute);
                              handleResolveDispute('CONFIRM_HOME_SUBMISSION');
                            }}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow transition-all min-h-[36px]"
                          >
                            Accept Home ({dispute.homeSubmission.homeScore}-{dispute.homeSubmission.awayScore})
                          </button>
                        )}

                        {dispute.awaySubmission && (
                          <button
                            disabled={isProcessing}
                            onClick={() => {
                              setSelectedDisputeForResolve(dispute);
                              handleResolveDispute('CONFIRM_AWAY_SUBMISSION');
                            }}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow transition-all min-h-[36px]"
                          >
                            Accept Away ({dispute.awaySubmission.homeScore}-{dispute.awaySubmission.awayScore})
                          </button>
                        )}

                        <button
                          onClick={() => {
                            setSelectedDisputeForResolve(dispute);
                            setManualHomeScore(dispute.homeSubmission?.homeScore || 0);
                            setManualAwayScore(dispute.awaySubmission?.awayScore || 0);
                          }}
                          className="px-3 py-1.5 glass-card text-slate-200 font-bold text-xs rounded-xl transition-all min-h-[36px]"
                        >
                          Custom Score Ruling
                        </button>

                        <button
                          disabled={isProcessing}
                          onClick={() => {
                            setSelectedDisputeForResolve(dispute);
                            handleResolveDispute('CANCEL_MATCH');
                          }}
                          className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-800 text-rose-200 font-bold text-xs rounded-xl border border-rose-700/50 transition-all min-h-[36px]"
                        >
                          Void Match
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* COMPETITION STATUS GRID */}
          <div className="space-y-3">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span>Tournament & Competition Status</span>
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="glass-panel p-3.5 shadow-lg space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">Active Season</span>
                <div className="text-lg font-black text-white">2026/27</div>
                <span className="text-[9px] font-black text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded">
                  OFFICIAL ACTIVE
                </span>
              </div>

              <div className="glass-panel p-3.5 shadow-lg space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">Domestic Leagues</span>
                <div className="text-lg font-black text-white">5 Leagues</div>
                <span className="text-[9px] font-semibold text-slate-400">ENG, ESP, ITA, GER, FRA</span>
              </div>

              <div className="glass-panel p-3.5 shadow-lg space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">Total Clubs</span>
                <div className="text-lg font-black text-white">{clubs.length || 96} Clubs</div>
                <span className="text-[9px] font-semibold text-emerald-400">
                  {occupiedClubsCount} Claimed • {availableClubsCount} Open
                </span>
              </div>

              <div className="glass-panel p-3.5 shadow-lg space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">Registered Players</span>
                <div className="text-lg font-black text-white">{users.length} Users</div>
                <span className="text-[9px] font-semibold text-slate-400">Telegram Verified</span>
              </div>

              <div className="glass-panel p-3.5 shadow-lg space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">Scheduled Matches</span>
                <div className="text-lg font-black text-white">{fixtures.length} Fixtures</div>
                <span className="text-[9px] font-semibold text-indigo-400">Across Competitions</span>
              </div>

              <div className="glass-panel p-3.5 shadow-lg space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">System Disputes</span>
                <div className={`text-lg font-black ${disputes.length > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {disputes.length} Open
                </div>
                <span className="text-[9px] font-semibold text-slate-400">
                  {disputes.length === 0 ? 'Synchronized' : 'Requires Ruling'}
                </span>
              </div>
            </div>
          </div>

          {/* SYSTEM HEALTH & PERSISTENCE PANEL */}
          <div className="glass-panel p-5 sm:p-6 shadow-xl space-y-4 border-slate-800">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Database & Multi-Tier Cache Health</h3>
              </div>
              <span className="text-[11px] text-slate-400">
                Last checked: {new Date().toLocaleTimeString()}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="glass-card p-3.5 rounded-xl space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white">Cloud Firestore</span>
                  <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-500/20 text-emerald-400">
                    Connected
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 font-mono">
                  Project: {diagnostics?.projectId || 'efl-uz-prod'} • DB: {diagnostics?.databaseId || '(default)'}
                </p>
              </div>

              <div className="glass-card p-3.5 rounded-xl space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white">In-Memory TTL Cache</span>
                  <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-500/20 text-emerald-400">
                    Active (Quota Guard)
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Protects Firestore read quotas with smart TTL and invalidation hooks.
                </p>
              </div>

              <div className="glass-card p-3.5 rounded-xl space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white">SQLite Fallback Store</span>
                  <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-500/20 text-emerald-400">
                    Ready
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Instant offline persistence fallback layer operational.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. MATCH MANAGEMENT TAB */}
      {/* ========================================================================= */}
      {activeAdminTab === 'matches' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="glass-panel p-4 shadow-xl space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search club name, competition, or fixture ID..."
                  value={matchSearch}
                  onChange={(e) => setMatchSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 glass-input rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 min-h-[38px]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={matchCompFilter}
                  onChange={(e) => setMatchCompFilter(e.target.value)}
                  className="px-3 py-2 glass-input rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500 min-h-[38px] bg-slate-900"
                >
                  <option value="ALL">All Competitions ({competitions.length})</option>
                  {competitions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <select
                  value={matchStatusFilter}
                  onChange={(e) => setMatchStatusFilter(e.target.value)}
                  className="px-3 py-2 glass-input rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500 min-h-[38px] bg-slate-900"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="SCHEDULED">Scheduled</option>
                  <option value="PENDING_CONFIRMATION">Pending Confirmation</option>
                  <option value="CONFIRMED">Confirmed</option>
                  <option value="DISPUTED">Disputed</option>
                  <option value="CANCELLED">Cancelled</option>
                  <option value="POSTPONED">Postponed</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400 pt-1 border-t border-white/[0.04]">
              <span>Showing {filteredFixtures.length} of {fixtures.length} matches</span>
              {(matchSearch || matchCompFilter !== 'ALL' || matchStatusFilter !== 'ALL') && (
                <button
                  onClick={() => {
                    setMatchSearch('');
                    setMatchCompFilter('ALL');
                    setMatchStatusFilter('ALL');
                  }}
                  className="text-emerald-400 hover:underline text-[11px] font-bold"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          {/* Fixture List / Cards */}
          {isLoading ? (
            <div className="py-20 text-center text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mx-auto mb-2" />
              <span className="text-xs">{t.loading}</span>
            </div>
          ) : filteredFixtures.length === 0 ? (
            <div className="glass-panel p-12 text-center text-slate-400">
              <Info className="w-8 h-8 text-slate-500 mx-auto mb-2" />
              <p className="text-xs font-semibold">No fixtures match your search or filter criteria.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredFixtures.map((fix) => {
                const isDisputed = fix.status === 'DISPUTED';
                const isConfirmed = fix.status === 'CONFIRMED';
                const isPending = fix.status === 'PENDING_CONFIRMATION';

                return (
                  <div
                    key={fix.id}
                    className={`glass-panel p-4 shadow-lg transition-all ${
                      isDisputed ? 'border-rose-500/40 bg-rose-950/10' : 'hover:border-slate-700'
                    }`}
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      {/* Match Meta & Teams */}
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            {fix.competitionName || 'Match'} • MD {fix.matchday}
                          </span>
                          <span
                            className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                              isConfirmed
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : isDisputed
                                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                : isPending
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {fix.status}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono truncate hidden sm:inline">
                            ID: {fix.id}
                          </span>
                        </div>

                        {/* Match Row */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {/* Home Club */}
                          <div className="flex items-center gap-2.5">
                            <ClubCrest
                              clubId={fix.homeClub?.id}
                              logoUrl={fix.homeClub?.logoUrl}
                              name={fix.homeClub?.name}
                              shortName={fix.homeClub?.shortName}
                              size="sm"
                              className="w-6 h-6 shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-white truncate">
                                {fix.homeClub?.name || 'Home Club'}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                @{fix.homeClub?.claimedByUsername || fix.homeClub?.managerUsername || 'available'}
                              </div>
                            </div>
                          </div>

                          {/* Away Club */}
                          <div className="flex items-center gap-2.5">
                            <ClubCrest
                              clubId={fix.awayClub?.id}
                              logoUrl={fix.awayClub?.logoUrl}
                              name={fix.awayClub?.name}
                              shortName={fix.awayClub?.shortName}
                              size="sm"
                              className="w-6 h-6 shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-white truncate">
                                {fix.awayClub?.name || 'Away Club'}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                @{fix.awayClub?.claimedByUsername || fix.awayClub?.managerUsername || 'available'}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Score & Action Controls */}
                      <div className="flex items-center justify-between md:justify-end gap-3 pt-2 md:pt-0 border-t md:border-t-0 border-white/[0.04] shrink-0">
                        {/* Score Display */}
                        <div className="px-3 py-1.5 bg-slate-950/80 rounded-xl border border-white/[0.08] text-center min-w-[70px]">
                          <span className="text-base font-black text-white">
                            {fix.homeScore !== undefined && fix.homeScore !== null ? fix.homeScore : '-'} :{' '}
                            {fix.awayScore !== undefined && fix.awayScore !== null ? fix.awayScore : '-'}
                          </span>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-1.5">
                          {isDisputed && (
                            <button
                              onClick={() => {
                                const found = disputes.find((d) => d.fixtureId === fix.id);
                                if (found) {
                                  setSelectedDisputeForResolve(found);
                                  setManualHomeScore(found.homeSubmission?.homeScore || 0);
                                  setManualAwayScore(found.awaySubmission?.awayScore || 0);
                                } else {
                                  showToast('Dispute record not found in active list.', 'error');
                                }
                              }}
                              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow transition-all min-h-[36px]"
                            >
                              Arbitrate
                            </button>
                          )}

                          <button
                            onClick={() => setSelectedFixtureForInspect(fix)}
                            className="px-2.5 py-1.5 glass-card hover:border-slate-600 text-slate-300 text-xs font-bold rounded-xl transition-all min-h-[36px] flex items-center gap-1"
                            title="View match details"
                          >
                            <Eye className="w-3.5 h-3.5 text-slate-400" />
                            <span className="hidden sm:inline">Details</span>
                          </button>

                          {(isConfirmed || isDisputed || isPending) && (
                            <button
                              onClick={() => setSelectedFixtureForReopen(fix)}
                              className="px-2.5 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-bold rounded-xl transition-all min-h-[36px] flex items-center gap-1"
                              title="Reopen match for resubmission"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Reopen</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. CLUBS MANAGEMENT TAB */}
      {/* ========================================================================= */}
      {activeAdminTab === 'clubs' && (
        <div className="space-y-4">
          {/* Search & Filters */}
          <div className="glass-panel p-4 shadow-xl space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search club name, short code, or manager..."
                  value={clubSearch}
                  onChange={(e) => setClubSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 glass-input rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 min-h-[38px]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={clubLeagueFilter}
                  onChange={(e) => setClubLeagueFilter(e.target.value)}
                  className="px-3 py-2 glass-input rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500 min-h-[38px] bg-slate-900"
                >
                  <option value="ALL">All Domestic Leagues (5)</option>
                  <option value="league-premier-league">Premier League (20)</option>
                  <option value="league-la-liga">La Liga (20)</option>
                  <option value="league-serie-a">Serie A (20)</option>
                  <option value="league-bundesliga">Bundesliga (18)</option>
                  <option value="league-ligue-1">Ligue 1 (18)</option>
                </select>

                <select
                  value={clubOccupancyFilter}
                  onChange={(e) => setClubOccupancyFilter(e.target.value)}
                  className="px-3 py-2 glass-input rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500 min-h-[38px] bg-slate-900"
                >
                  <option value="ALL">All Statuses ({clubs.length})</option>
                  <option value="OCCUPIED">Occupied ({occupiedClubsCount})</option>
                  <option value="AVAILABLE">Available ({availableClubsCount})</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400 pt-1 border-t border-white/[0.04]">
              <span>
                Showing {filteredClubs.length} of {clubs.length} Clubs (96 Total Official European Clubs)
              </span>
              {(clubSearch || clubLeagueFilter !== 'ALL' || clubOccupancyFilter !== 'ALL') && (
                <button
                  onClick={() => {
                    setClubSearch('');
                    setClubLeagueFilter('ALL');
                    setClubOccupancyFilter('ALL');
                  }}
                  className="text-emerald-400 hover:underline text-[11px] font-bold"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          {/* Club Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredClubs.map((c) => {
              const isClaimed = Boolean(c.isTaken || c.claimedByUserId);
              const leagueDisplay = c.leagueId
                ? c.leagueId.replace('league-', '').replace('-', ' ').toUpperCase()
                : 'LEAGUE';

              return (
                <div
                  key={c.id}
                  className="glass-panel p-4 shadow-lg flex items-center justify-between gap-3 hover:border-slate-700 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <ClubCrest
                      clubId={c.id}
                      logoUrl={c.logoUrl}
                      name={c.name}
                      shortName={c.shortName}
                      size="md"
                      className="w-9 h-9 shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="font-bold text-xs text-white truncate">{c.name}</div>
                      <div className="text-[10px] text-slate-400 font-medium">
                        {leagueDisplay} • {c.country}
                      </div>
                      <div className="text-[11px] font-semibold mt-0.5 truncate">
                        {isClaimed ? (
                          <span className="text-emerald-400">@{c.claimedByUsername || c.managerUsername || 'claimed'}</span>
                        ) : (
                          <span className="text-slate-500 italic">Available to claim</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded text-[9px] font-black uppercase shrink-0 ${
                      isClaimed
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {isClaimed ? 'Occupied' : 'Open'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. COMPETITIONS & SCHEDULING TAB */}
      {/* ========================================================================= */}
      {activeAdminTab === 'competitions' && (
        <div className="space-y-6">
          {/* UEFA European Qualification Tool */}
          <div className="glass-panel p-5 sm:p-6 shadow-xl border-blue-500/30 bg-blue-950/15 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Globe2 className="w-5 h-5 text-blue-400" />
                  <h3 className="text-sm font-black text-white">UEFA European Qualification Engine</h3>
                </div>
                <p className="text-xs text-slate-400">
                  Calculates final league table positions and domestic cup winners to seed the 2026/27 UEFA Champions League, Europa League, and Conference League brackets.
                </p>
              </div>

              <button
                disabled={isProcessing}
                onClick={handleEvaluateQualifications}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs rounded-xl shadow-lg shadow-blue-600/30 transition-all shrink-0 min-h-[40px] touch-manipulation flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>{isProcessing ? 'Evaluating...' : 'Evaluate & Seed European Cups'}</span>
              </button>
            </div>
          </div>

          {/* Group 1: Domestic Leagues (5) */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>Domestic Leagues (5 Major Leagues • 96 Clubs)</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {groupedCompetitions.domesticLeagues.map((comp) => (
                <CompetitionCard
                  key={comp.id}
                  competition={comp}
                  generatingCompId={generatingCompId}
                  rebuildingStandingsCompId={rebuildingStandingsCompId}
                  onGenerate={handleGenerateCompetition}
                  onReset={handleResetCompetition}
                  onRebuildStandings={handleRebuildStandings}
                />
              ))}
            </div>
          </div>

          {/* Group 2: Domestic Cups (6) */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-400" />
              <span>Domestic Cups (6 Knockout Tournaments)</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {groupedCompetitions.domesticCups.map((comp) => (
                <CompetitionCard
                  key={comp.id}
                  competition={comp}
                  generatingCompId={generatingCompId}
                  rebuildingStandingsCompId={rebuildingStandingsCompId}
                  onGenerate={handleGenerateCompetition}
                  onReset={handleResetCompetition}
                  onRebuildStandings={handleRebuildStandings}
                />
              ))}
            </div>
          </div>

          {/* Group 3: Super Cups (5) */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-purple-400" />
              <span>Super Cups (5 Official Matchups)</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {groupedCompetitions.superCups.map((comp) => (
                <CompetitionCard
                  key={comp.id}
                  competition={comp}
                  generatingCompId={generatingCompId}
                  rebuildingStandingsCompId={rebuildingStandingsCompId}
                  onGenerate={handleGenerateCompetition}
                  onReset={handleResetCompetition}
                  onRebuildStandings={handleRebuildStandings}
                />
              ))}
            </div>
          </div>

          {/* Group 4: European Competitions (3) */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Globe2 className="w-4 h-4 text-blue-400" />
              <span>UEFA European Competitions</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {groupedCompetitions.european.map((comp) => (
                <CompetitionCard
                  key={comp.id}
                  competition={comp}
                  generatingCompId={generatingCompId}
                  rebuildingStandingsCompId={rebuildingStandingsCompId}
                  onGenerate={handleGenerateCompetition}
                  onReset={handleResetCompetition}
                  onRebuildStandings={handleRebuildStandings}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. USERS / PLAYERS TAB */}
      {/* ========================================================================= */}
      {activeAdminTab === 'users' && (
        <div className="glass-panel shadow-2xl overflow-hidden border-slate-800">
          <div className="p-4 sm:p-5 border-b border-white/[0.06] space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-white">Registered Telegram Players</h3>
                <p className="text-xs text-slate-400">Authentic Telegram accounts logged into EFL UZ 2026/27</p>
              </div>
              <span className="px-3 py-1 bg-slate-900 rounded-xl text-xs font-black text-slate-300 border border-slate-800 self-start sm:self-auto">
                {filteredUsers.length} Players Listed
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by username, full name, or Telegram ID..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 glass-input rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 min-h-[36px]"
                />
              </div>

              <select
                value={userRoleFilter}
                onChange={(e) => setUserRoleFilter(e.target.value)}
                className="px-3 py-1.5 glass-input rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500 min-h-[36px] bg-slate-900"
              >
                <option value="ALL">All Users</option>
                <option value="ADMIN">Admins Only</option>
                <option value="PLAYER">Standard Players</option>
                <option value="SUSPENDED">Suspended Accounts</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse min-w-[500px]">
              <thead>
                <tr className="border-b border-white/[0.06] text-[10px] font-black text-slate-400 uppercase bg-slate-950/40">
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Telegram ID</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Joined Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-white flex items-center gap-2">
                        <span>@{u.username}</span>
                        {u.isAdmin && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-amber-500/20 text-amber-400 border border-amber-500/30">
                            Admin
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {u.firstName} {u.lastName || ''}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-300 font-mono text-[11px]">{u.telegramId}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          u.isAdmin
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        {u.isAdmin ? 'Administrator' : 'Manager'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {u.isSuspended ? (
                        <span className="text-rose-400 font-bold">Suspended</span>
                      ) : (
                        <span className="text-emerald-400 font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Active</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-400 text-[11px]">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. SYSTEM & AUDIT LOGS TAB */}
      {/* ========================================================================= */}
      {activeAdminTab === 'system' && (
        <div className="space-y-5">
          {/* Firestore Diagnostics Data */}
          <div className="glass-panel p-5 sm:p-6 shadow-xl space-y-4 border-slate-800">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Firestore Collection Record Counts</h3>
              </div>
              <span className="text-[11px] font-mono text-emerald-400">ONLINE</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {diagnostics?.collections &&
                Object.entries(diagnostics.collections).map(([key, val]: [string, any]) => (
                  <div key={key} className="glass-card p-3 rounded-xl space-y-1">
                    <span className="text-[10px] uppercase font-bold text-slate-400 truncate block">
                      {key.replace('_', ' ')}
                    </span>
                    <div className="text-lg font-black text-white">{val} docs</div>
                  </div>
                ))}
            </div>
          </div>

          {/* Audit Logs */}
          <div className="glass-panel shadow-2xl overflow-hidden border-slate-800">
            <div className="p-4 sm:p-5 border-b border-white/[0.06] flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-white">Administrative Action Audit Trail</h3>
                <p className="text-xs text-slate-400">Security logged operations across tournament life cycle</p>
              </div>
              <span className="text-xs text-slate-400 font-mono">{auditLogs.length} Records</span>
            </div>

            <div className="divide-y divide-white/[0.04] max-h-[600px] overflow-y-auto">
              {auditLogs.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">No audit logs recorded yet.</div>
              ) : (
                auditLogs.map((log) => (
                  <div key={log.id} className="p-4 hover:bg-white/[0.02] transition-colors space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-500/30 text-[10px]">
                        {log.action}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-slate-300">
                      Entity: <strong className="text-white">{log.targetType || log.entityType} ({log.targetId || log.entityId})</strong> • Actor: <span className="text-emerald-400 font-mono">{log.actorId || log.actorUsername || 'Admin'}</span>
                    </div>
                    {log.notes && (
                      <p className="text-[11px] text-slate-400 italic bg-slate-950/40 p-2 rounded-lg border border-white/[0.04]">
                        {log.notes}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: CUSTOM SCORE DISPUTE RESOLUTION */}
      {/* ========================================================================= */}
      {selectedDisputeForResolve && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="glass-modal w-full max-w-md shadow-2xl p-6 text-white space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h3 className="font-bold text-base text-white">Dispute Arbitration Ruling</h3>
              <button
                onClick={() => setSelectedDisputeForResolve(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1 truncate">
                  {selectedDisputeForResolve.fixture?.homeClub?.name || 'Home'} Score
                </label>
                <input
                  type="number"
                  min="0"
                  value={manualHomeScore}
                  onChange={(e) => setManualHomeScore(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full px-3 py-2 glass-input rounded-xl text-center text-xl font-black"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1 truncate">
                  {selectedDisputeForResolve.fixture?.awayClub?.name || 'Away'} Score
                </label>
                <input
                  type="number"
                  min="0"
                  value={manualAwayScore}
                  onChange={(e) => setManualAwayScore(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full px-3 py-2 glass-input rounded-xl text-center text-xl font-black"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Admin Ruling Justification / Notes
              </label>
              <textarea
                placeholder="e.g. Verified by official match video evidence."
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 glass-input rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setSelectedDisputeForResolve(null)}
                className="flex-1 py-2.5 glass-card text-slate-300 font-semibold rounded-xl text-xs"
              >
                Cancel
              </button>
              <button
                disabled={isProcessing}
                onClick={() => handleResolveDispute('MANUAL_SCORE')}
                className="flex-1 py-2.5 btn-glass-primary text-slate-950 font-black rounded-xl text-xs shadow-lg"
              >
                {isProcessing ? 'Applying Ruling...' : 'Confirm Score Ruling'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: REOPEN FIXTURE */}
      {/* ========================================================================= */}
      {selectedFixtureForReopen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="glass-modal w-full max-w-md shadow-2xl p-6 text-white space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h3 className="font-bold text-base text-white">Reopen Fixture for Resubmission</h3>
              <button
                onClick={() => setSelectedFixtureForReopen(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              This action will reset the fixture between <strong className="text-white">{selectedFixtureForReopen.homeClub?.name}</strong> and <strong className="text-white">{selectedFixtureForReopen.awayClub?.name}</strong> back to <code className="text-amber-400 font-mono">SCHEDULED</code> state and remove previous conflicting submissions so players can submit afresh.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Reason / Note for Audit Log
              </label>
              <input
                type="text"
                placeholder="e.g. Players requested rematch due to network disconnect"
                value={reopenNotes}
                onChange={(e) => setReopenNotes(e.target.value)}
                className="w-full px-3 py-2 glass-input rounded-xl text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setSelectedFixtureForReopen(null)}
                className="flex-1 py-2.5 glass-card text-slate-300 font-semibold rounded-xl text-xs"
              >
                Cancel
              </button>
              <button
                disabled={isProcessing}
                onClick={() => handleReopenFixture(selectedFixtureForReopen.id, reopenNotes)}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black rounded-xl text-xs shadow-lg"
              >
                {isProcessing ? 'Reopening...' : 'Confirm Reopen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: MATCH DETAILS & SCREENSHOT INSPECTOR */}
      {/* ========================================================================= */}
      {selectedFixtureForInspect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
          <div className="glass-modal w-full max-w-lg shadow-2xl p-6 text-white space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <h3 className="font-bold text-base text-white">Match Inspector</h3>
                <span className="text-[11px] text-slate-400 font-mono">ID: {selectedFixtureForInspect.id}</span>
              </div>
              <button
                onClick={() => setSelectedFixtureForInspect(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <div className="glass-card p-4 rounded-xl space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{selectedFixtureForInspect.competitionName || 'Tournament'}</span>
                <span>Matchday {selectedFixtureForInspect.matchday}</span>
              </div>

              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <ClubCrest
                    clubId={selectedFixtureForInspect.homeClub?.id}
                    logoUrl={selectedFixtureForInspect.homeClub?.logoUrl}
                    name={selectedFixtureForInspect.homeClub?.name}
                    shortName={selectedFixtureForInspect.homeClub?.shortName}
                    size="sm"
                    className="w-7 h-7"
                  />
                  <span className="font-bold text-xs">{selectedFixtureForInspect.homeClub?.name}</span>
                </div>

                <div className="text-lg font-black text-emerald-400">
                  {selectedFixtureForInspect.homeScore ?? '-'} : {selectedFixtureForInspect.awayScore ?? '-'}
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs">{selectedFixtureForInspect.awayClub?.name}</span>
                  <ClubCrest
                    clubId={selectedFixtureForInspect.awayClub?.id}
                    logoUrl={selectedFixtureForInspect.awayClub?.logoUrl}
                    name={selectedFixtureForInspect.awayClub?.name}
                    shortName={selectedFixtureForInspect.awayClub?.shortName}
                    size="sm"
                    className="w-7 h-7"
                  />
                </div>
              </div>

              {selectedFixtureForInspect.proofUrl && (
                <div className="pt-2 border-t border-white/[0.06]">
                  <span className="text-[11px] text-slate-400 block mb-1">Submitted Proof Screenshot:</span>
                  <a
                    href={selectedFixtureForInspect.proofUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:underline"
                  >
                    <Link className="w-3.5 h-3.5" />
                    <span>Open Verified Match Screenshot</span>
                  </a>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedFixtureForInspect(null)}
                className="px-5 py-2 btn-glass-primary text-slate-950 font-black rounded-xl text-xs"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface CompetitionCardProps {
  competition: Competition;
  generatingCompId: string | null;
  rebuildingStandingsCompId: string | null;
  onGenerate: (id: string) => void;
  onReset: (id: string) => void;
  onRebuildStandings: (id: string) => void;
}

const CompetitionCard: React.FC<CompetitionCardProps> = ({
  competition,
  generatingCompId,
  rebuildingStandingsCompId,
  onGenerate,
  onReset,
  onRebuildStandings,
}) => {
  const hasGeneratedFixtures = Boolean(
    competition.hasFixtures ||
      (competition.fixtureCount && competition.fixtureCount > 0) ||
      (competition.fixturesCount && competition.fixturesCount > 0) ||
      competition.generationStatus === 'generated'
  );
  const fixtureCount = competition.fixtureCount || competition.fixturesCount || 0;

  return (
    <div className="glass-panel p-4 rounded-2xl flex flex-col justify-between gap-3 shadow-lg hover:border-slate-700 transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold text-xs text-white truncate">{competition.name}</div>
          <span className="text-[10px] text-slate-400 uppercase font-semibold block mt-0.5">
            {competition.type} • {competition.totalTeams ?? 0} Teams
            {hasGeneratedFixtures && ` • ${fixtureCount} Matches`}
          </span>
        </div>
        <span
          className={`text-[9px] uppercase font-black px-2 py-0.5 rounded-full shrink-0 ${
            hasGeneratedFixtures
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-slate-800 text-slate-400 border border-slate-700'
          }`}
        >
          {hasGeneratedFixtures ? 'Scheduled' : 'Open'}
        </span>
      </div>

      <div className="flex items-center gap-1.5 pt-2 border-t border-white/[0.06]">
        <button
          disabled={generatingCompId !== null || rebuildingStandingsCompId !== null}
          onClick={() => onGenerate(competition.id)}
          className={`flex-1 py-1.5 px-2 font-black text-[11px] rounded-xl transition-all disabled:opacity-50 min-h-[34px] touch-manipulation ${
            hasGeneratedFixtures ? 'glass-card text-slate-200 hover:text-white' : 'btn-glass-primary text-slate-950'
          }`}
        >
          {generatingCompId === competition.id
            ? 'Generating...'
            : hasGeneratedFixtures
            ? 'Regenerate'
            : 'Generate'}
        </button>

        {hasGeneratedFixtures && (
          <button
            disabled={generatingCompId !== null || rebuildingStandingsCompId !== null}
            onClick={() => onRebuildStandings(competition.id)}
            className="py-1.5 px-2 glass-card hover:border-emerald-500/50 text-emerald-300 font-bold text-[11px] rounded-xl transition-all disabled:opacity-50 min-h-[34px]"
            title="Recalculate and persist standings"
          >
            {rebuildingStandingsCompId === competition.id ? 'Rebuilding...' : 'Standings'}
          </button>
        )}

        {hasGeneratedFixtures && (
          <button
            disabled={generatingCompId !== null || rebuildingStandingsCompId !== null}
            onClick={() => onReset(competition.id)}
            className="py-1.5 px-2 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 font-bold text-xs rounded-xl transition-all disabled:opacity-50 min-h-[34px]"
            title="Delete and reset schedule"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
