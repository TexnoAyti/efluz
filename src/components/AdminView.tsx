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
  UserMinus,
  UserPlus,
  ExternalLink,
  FileCheck,
  X,
  Flame,
  ArrowRight,
  Lock,
  Unlock,
} from 'lucide-react';

type AdminTab = 'overview' | 'clubs' | 'matches' | 'results' | 'competitions' | 'users' | 'system';

interface PendingFixtureItem extends Fixture {
  submissions?: {
    id: string;
    submittedByUserId: string;
    submitterUsername: string;
    submitterName: string;
    clubId: string;
    homeScore: number;
    awayScore: number;
    proofUrl?: string;
    createdAt: string;
  }[];
}

export const AdminView: React.FC = () => {
  const { user, activeSeasonId, showToast } = useAuth();
  const { t } = useI18n();

  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>('overview');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Core Data
  const [overviewData, setOverviewData] = useState<any>(null);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [pendingResults, setPendingResults] = useState<PendingFixtureItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [diagnostics, setDiagnostics] = useState<any>(null);

  // Filter States - Matches
  const [matchCompFilter, setMatchCompFilter] = useState<string>('ALL');
  const [matchStatusFilter, setMatchStatusFilter] = useState<string>('ALL');
  const [matchSearch, setMatchSearch] = useState<string>('');

  // Filter States - Clubs
  const [clubLeagueFilter, setClubLeagueFilter] = useState<string>('ALL');
  const [clubOccupancyFilter, setClubOccupancyFilter] = useState<string>('ALL');
  const [clubSearch, setClubSearch] = useState<string>('');

  // Filter States - Users
  const [userSearch, setUserSearch] = useState<string>('');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('ALL');

  // Club Ownership Management Modals
  const [selectedClubForAssign, setSelectedClubForAssign] = useState<Club | null>(null);
  const [assignTargetUserId, setAssignTargetUserId] = useState<string>('');
  const [assignUserSearch, setAssignUserSearch] = useState<string>('');
  const [selectedClubForRelease, setSelectedClubForRelease] = useState<Club | null>(null);

  // Results Management Modals
  const [selectedPendingForApprove, setSelectedPendingForApprove] = useState<PendingFixtureItem | null>(null);
  const [approveHomeScore, setApproveHomeScore] = useState<number>(0);
  const [approveAwayScore, setApproveAwayScore] = useState<number>(0);
  const [approveNotes, setApproveNotes] = useState<string>('');

  const [selectedPendingForReject, setSelectedPendingForReject] = useState<PendingFixtureItem | null>(null);
  const [rejectNotes, setRejectNotes] = useState<string>('');

  const [selectedPendingForInspect, setSelectedPendingForInspect] = useState<PendingFixtureItem | null>(null);

  // Dispute Resolution Modal State
  const [selectedDisputeForResolve, setSelectedDisputeForResolve] = useState<Dispute | null>(null);
  const [manualHomeScore, setManualHomeScore] = useState<number>(0);
  const [manualAwayScore, setManualAwayScore] = useState<number>(0);
  const [resolutionNotes, setResolutionNotes] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Fixture Reopen & Inspect State
  const [selectedFixtureForReopen, setSelectedFixtureForReopen] = useState<Fixture | null>(null);
  const [reopenNotes, setReopenNotes] = useState<string>('');
  const [selectedFixtureForInspect, setSelectedFixtureForInspect] = useState<Fixture | null>(null);

  // Competition Action State
  const [generatingCompId, setGeneratingCompId] = useState<string | null>(null);
  const [rebuildingStandingsCompId, setRebuildingStandingsCompId] = useState<string | null>(null);

  // Fixture Validation Diagnostic State
  const [fixtureValidationReport, setFixtureValidationReport] = useState<any>(null);
  const [isValidatingFixtures, setIsValidatingFixtures] = useState(false);
  const [showValidationModal, setShowValidationModal] = useState(false);

  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(new Set());

  const loadTabData = async (tab: AdminTab, skipCache = false) => {
    if (!user?.isAdmin) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      if (tab === 'overview') {
        const [overviewRes, disputesRes, pendingRes, auditRes] = await Promise.all([
          api.getAdminOverview(activeSeasonId, skipCache).catch(() => null),
          api.getAdminDisputes('OPEN', skipCache).catch(() => ({ disputes: [] })),
          api.getAdminPendingResults(activeSeasonId, skipCache).catch(() => ({ pendingFixtures: [], total: 0 })),
          api.getAdminAuditLogs(10, skipCache).catch(() => ({ logs: [] })),
        ]);
        if (overviewRes) setOverviewData(overviewRes);
        if (disputesRes?.disputes) setDisputes(disputesRes.disputes);
        if (pendingRes?.pendingFixtures) setPendingResults(pendingRes.pendingFixtures as any);
        if (auditRes?.logs) setAuditLogs(auditRes.logs);
      } else if (tab === 'clubs') {
        const [clubsRes, usersRes] = await Promise.all([
          api.getAdminClubs(activeSeasonId, undefined, skipCache).catch(() => ({ clubs: [], total: 0 })),
          users.length === 0 ? api.getAdminUsers(skipCache).catch(() => ({ users: [] })) : Promise.resolve(null),
        ]);
        if (clubsRes?.clubs) setClubs(clubsRes.clubs);
        if (usersRes?.users) setUsers(usersRes.users);
      } else if (tab === 'matches') {
        const [fixturesRes, compsRes] = await Promise.all([
          api.getAdminFixtures(activeSeasonId, undefined, undefined, undefined, 200, skipCache).catch(() => ({ fixtures: [], total: 0 })),
          competitions.length === 0 ? api.getCompetitions(activeSeasonId, skipCache).catch(() => ({ competitions: [] })) : Promise.resolve(null),
        ]);
        if (fixturesRes?.fixtures) setFixtures(fixturesRes.fixtures);
        if (compsRes?.competitions) setCompetitions(compsRes.competitions);
      } else if (tab === 'results') {
        const [pendingRes, disputesRes] = await Promise.all([
          api.getAdminPendingResults(activeSeasonId, skipCache).catch(() => ({ pendingFixtures: [], total: 0 })),
          api.getAdminDisputes('OPEN', skipCache).catch(() => ({ disputes: [] })),
        ]);
        if (pendingRes?.pendingFixtures) setPendingResults(pendingRes.pendingFixtures as any);
        if (disputesRes?.disputes) setDisputes(disputesRes.disputes);
      } else if (tab === 'competitions') {
        const compsRes = await api.getCompetitions(activeSeasonId, skipCache).catch(() => ({ competitions: [] }));
        if (compsRes?.competitions) setCompetitions(compsRes.competitions);
      } else if (tab === 'users') {
        const usersRes = await api.getAdminUsers(skipCache).catch(() => ({ users: [] }));
        if (usersRes?.users) setUsers(usersRes.users);
      } else if (tab === 'system') {
        const diagRes = await api.getAdminDiagnostics().catch(() => null);
        if (diagRes) setDiagnostics(diagRes);
      }

      setLoadedTabs((prev) => new Set(prev).add(tab));
    } catch (err: any) {
      console.error(`Failed to load admin data for ${tab}:`, err);
      setError("Couldn't load some administrative records. Please click refresh.");
    } finally {
      setIsLoading(false);
    }
  };

  const loadAllAdminData = async (skipCache = false) => {
    await loadTabData(activeAdminTab, skipCache);
  };

  useEffect(() => {
    if (user?.isAdmin) {
      loadTabData(activeAdminTab, false);
    } else {
      setIsLoading(false);
    }
  }, [activeAdminTab, activeSeasonId, user?.isAdmin]);

  // =========================================================================
  // CLUB OWNERSHIP ACTIONS
  // =========================================================================
  const handleAssignClub = async () => {
    if (!selectedClubForAssign || !assignTargetUserId) return;
    setIsProcessing(true);
    try {
      const res = await api.adminAssignClub(selectedClubForAssign.id, assignTargetUserId, activeSeasonId);
      showToast(res.message || `Club '${selectedClubForAssign.name}' successfully assigned.`, 'success');
      setSelectedClubForAssign(null);
      setAssignTargetUserId('');
      setAssignUserSearch('');
      await loadAllAdminData(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to assign club.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReleaseClub = async () => {
    if (!selectedClubForRelease) return;
    setIsProcessing(true);
    try {
      const res = await api.adminReleaseClub(selectedClubForRelease.id, activeSeasonId);
      showToast(res.message || `Club '${selectedClubForRelease.name}' has been released.`, 'success');
      setSelectedClubForRelease(null);
      await loadAllAdminData(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to release club.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // =========================================================================
  // RESULTS & APPROVAL ACTIONS
  // =========================================================================
  const handleApproveResult = async () => {
    if (!selectedPendingForApprove) return;
    setIsProcessing(true);
    try {
      const res = await api.adminApproveResult(
        selectedPendingForApprove.id,
        approveHomeScore,
        approveAwayScore,
        approveNotes || 'Result approved and confirmed by competition administrator.'
      );
      showToast(res.message || 'Result confirmed and standings updated.', 'success');
      setSelectedPendingForApprove(null);
      setApproveNotes('');
      await loadAllAdminData(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to approve match result.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRejectResult = async () => {
    if (!selectedPendingForReject) return;
    setIsProcessing(true);
    try {
      const res = await api.adminRejectResult(
        selectedPendingForReject.id,
        rejectNotes || 'Submission rejected by tournament admin. Please re-enter correct score.'
      );
      showToast(res.message || 'Match reopened for fresh submission.', 'success');
      setSelectedPendingForReject(null);
      setRejectNotes('');
      await loadAllAdminData(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to reject result.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

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

  // Competition Actions
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

  const handleRunFixtureValidation = async () => {
    setIsValidatingFixtures(true);
    try {
      const report = await api.getFixtureValidationReport(activeSeasonId);
      setFixtureValidationReport(report);
      setShowValidationModal(true);
      if (report.allValid) {
        showToast('All 5 domestic leagues verified! 100% single round-robin compliance.', 'success');
      } else {
        showToast('Fixture validation finished with issues. See details.', 'info');
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to run fixture validation.', 'error');
    } finally {
      setIsValidatingFixtures(false);
    }
  };

  const handleAdvanceMatchday = async (compId: string) => {
    setIsProcessing(true);
    try {
      const res = await api.advanceCompetitionMatchday(compId, 30);
      showToast(`Matchday advanced to MD ${res.currentMatchday} of ${res.totalMatchdays}! Timer set to 30h.`, 'success');
      await loadAllAdminData(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to advance matchday.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleToggleMatchdayOverride = async (compId: string, currentOverride?: string) => {
    setIsProcessing(true);
    try {
      const nextStatus = currentOverride === 'FORCE_LOCKED' ? 'FORCE_OPEN' : currentOverride === 'FORCE_OPEN' ? 'AUTO' : 'FORCE_LOCKED';
      const res = await api.overrideCompetitionMatchday(compId, nextStatus as any);
      showToast(`Matchday override updated to ${res.adminOverrideStatus}!`, 'success');
      await loadAllAdminData(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to update matchday override.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenMatchdayNow = async (compId: string) => {
    setIsProcessing(true);
    try {
      const res = await api.openCompetitionMatchdayNow(compId, 30);
      showToast(`Matchday unlocked for 30 hours!`, 'success');
      await loadAllAdminData(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to open matchday.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // =========================================================================
  // FILTERED DATASETS
  // =========================================================================
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

  const assignableUsers = useMemo(() => {
    if (!assignUserSearch.trim()) return users.slice(0, 15);
    const q = assignUserSearch.toLowerCase();
    return users
      .filter((u) => {
        return (
          u.username?.toLowerCase().includes(q) ||
          `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase().includes(q) ||
          u.telegramId?.includes(q) ||
          u.id.toLowerCase().includes(q)
        );
      })
      .slice(0, 20);
  }, [users, assignUserSearch]);

  // Clean, official 19 competition categorization
  const groupedCompetitions = useMemo(() => {
    // 1. Domestic Leagues (5)
    const domesticLeagues = competitions.filter(
      (c) =>
        c.type === 'LEAGUE' ||
        c.type === 'league' ||
        c.id.includes('premier-league') ||
        c.id.includes('la-liga') ||
        c.id.includes('serie-a') ||
        c.id.includes('bundesliga') ||
        c.id.includes('ligue-1')
    );

    // 2. Domestic Cups (6)
    const domesticCups = competitions.filter(
      (c) =>
        c.id.includes('fa-cup') ||
        c.id.includes('efl-cup') ||
        c.id.includes('copa-del-rey') ||
        c.id.includes('coppa-italia') ||
        c.id.includes('dfb-pokal') ||
        c.id.includes('coupe-de-france')
    );

    // 3. Super Cups (5) - strictly exclude Trophée des Champions
    const superCups = competitions.filter(
      (c) =>
        (c.id.includes('community-shield') ||
          c.id.includes('supercopa-espana') ||
          c.id.includes('supercoppa-italiana') ||
          c.id.includes('dfl-supercup') ||
          c.id.includes('uefa-super-cup')) &&
        !c.id.includes('trophee-des-champions')
    );

    // 4. European Competitions (2: UCL & UEL)
    const european = competitions.filter(
      (c) =>
        (c.id.includes('champions-league') || c.id.includes('europa-league') || c.id.includes('ucl') || c.id.includes('uel')) &&
        !c.id.includes('conference-league') &&
        !c.id.includes('uecl') &&
        !c.id.includes('uefa-super-cup')
    );

    return { domesticLeagues, domesticCups, superCups, european };
  }, [competitions]);

  // Match Status Metrics
  const matchMetrics = useMemo(() => {
    const upcoming = fixtures.filter((f) => f.status === 'SCHEDULED' || f.status === 'AWAITING_RESULT').length;
    const completed = fixtures.filter((f) => f.status === 'CONFIRMED').length;
    const pendingConfirm = fixtures.filter((f) => f.status === 'PENDING_CONFIRMATION').length;
    const disputed = fixtures.filter((f) => f.status === 'DISPUTED').length;
    const postponed = fixtures.filter((f) => f.status === 'POSTPONED').length;
    return { upcoming, completed, pendingConfirm, disputed, postponed };
  }, [fixtures]);

  const occupiedClubsCount = clubs.filter((c) => c.isTaken || c.claimedByUserId).length;
  const availableClubsCount = Math.max(0, (clubs.length || 96) - occupiedClubsCount);

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

  return (
    <div className="space-y-5 animate-in fade-in duration-300 pb-24 max-w-7xl mx-auto">
      {/* ========================================================================= */}
      {/* TOP HEADER & SYSTEM BANNER */}
      {/* ========================================================================= */}
      <div className="glass-panel p-4 sm:p-6 shadow-2xl relative overflow-hidden border-slate-800">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                <Shield className="w-3 h-3" />
                Tournament Control Dashboard
              </span>
              <span className="text-[11px] font-semibold text-slate-400">
                Officer: <strong className="text-emerald-400">@{user?.username}</strong> ({user?.id})
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-black bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 font-mono">
                Season 2026/27 ACTIVE
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
              <SlidersHorizontal className="w-6 h-6 text-amber-400 shrink-0" />
              <span>EFL UZ Competition Management System</span>
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

      {/* ========================================================================= */}
      {/* SECTION TABS (HIGH DENSITY NAVIGATION) */}
      {/* ========================================================================= */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {/* 1. OVERVIEW */}
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
          {pendingResults.length > 0 && (
            <span className="px-1.5 py-0.2 bg-amber-600 text-slate-950 rounded-full font-black text-[10px]">
              {pendingResults.length}
            </span>
          )}
        </button>

        {/* 2. CLUBS */}
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
          <span>Clubs ({clubs.length || 96})</span>
        </button>

        {/* 3. MATCHES */}
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
          <span>Matches ({fixtures.length})</span>
        </button>

        {/* 4. RESULTS */}
        <button
          id="tab-admin-results"
          onClick={() => setActiveAdminTab('results')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs whitespace-nowrap transition-all min-h-[40px] ${
            activeAdminTab === 'results'
              ? 'bg-rose-500 text-slate-950 font-black shadow-lg shadow-rose-500/25 scale-[1.02]'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <FileCheck className="w-4 h-4" />
          <span>Results & Review</span>
          {(pendingResults.length > 0 || disputes.length > 0) && (
            <span className="px-1.5 py-0.2 bg-rose-600 text-white rounded-full font-black text-[10px] animate-pulse">
              {pendingResults.length + disputes.length}
            </span>
          )}
        </button>

        {/* 5. COMPETITIONS */}
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
          <span>19 Competitions</span>
        </button>

        {/* 6. PLAYERS */}
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

        {/* 7. SYSTEM & AUDIT */}
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
          <span>System Diagnostics</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* 1. OVERVIEW SECTION */}
      {/* ========================================================================= */}
      {activeAdminTab === 'overview' && (
        <div className="space-y-6">
          {/* Top KPI Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Active Season */}
            <div className="glass-card p-4 rounded-2xl relative overflow-hidden border-emerald-500/30">
              <div className="text-[10px] font-black text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                Active Season
              </div>
              <div className="text-xl sm:text-2xl font-black text-white mt-1">2026/27</div>
              <div className="text-[10px] text-emerald-400 font-semibold mt-0.5">Status: ACTIVE • 5 Leagues</div>
            </div>

            {/* Total Users */}
            <div className="glass-card p-4 rounded-2xl relative overflow-hidden border-slate-800">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5" />
                Registered Users
              </div>
              <div className="text-xl sm:text-2xl font-black text-white mt-1 tabular-nums">
                {overviewData?.counts?.totalUsers || users.length || 0}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">Telegram Verified Players</div>
            </div>

            {/* Registered Clubs (96) */}
            <div className="glass-card p-4 rounded-2xl relative overflow-hidden border-slate-800">
              <div className="text-[10px] font-black text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" />
                Registered Clubs
              </div>
              <div className="text-xl sm:text-2xl font-black text-white mt-1 tabular-nums">96</div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                <span className="text-emerald-400 font-bold">{occupiedClubsCount} Occupied</span> •{' '}
                <span className="text-amber-400 font-bold">{availableClubsCount} Available</span>
              </div>
            </div>

            {/* Active Competitions */}
            <div className="glass-card p-4 rounded-2xl relative overflow-hidden border-amber-500/30">
              <div className="text-[10px] font-black text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5" />
                Active Competitions
              </div>
              <div className="text-xl sm:text-2xl font-black text-white mt-1 tabular-nums">19</div>
              <div className="text-[10px] text-slate-400 mt-0.5">5 Leagues • 6 Cups • 5 Super • 3 UEFA</div>
            </div>
          </div>

          {/* Match & Result KPI Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Upcoming Matches */}
            <div className="glass-card p-4 rounded-2xl border-slate-800">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Upcoming Matches</div>
              <div className="text-xl font-black text-white mt-1 tabular-nums">{matchMetrics.upcoming}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Scheduled & In-Play</div>
            </div>

            {/* Completed Matches */}
            <div className="glass-card p-4 rounded-2xl border-slate-800">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Completed Matches</div>
              <div className="text-xl font-black text-emerald-400 mt-1 tabular-nums">{matchMetrics.completed}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Confirmed & In Standings</div>
            </div>

            {/* Pending Confirmations */}
            <div className="glass-card p-4 rounded-2xl border-amber-500/30 bg-amber-950/10">
              <div className="text-[10px] font-black text-amber-400 uppercase tracking-wider flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Pending Confirmations
              </div>
              <div className="text-xl font-black text-amber-300 mt-1 tabular-nums">{pendingResults.length}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Awaiting Review or Consensus</div>
            </div>

            {/* Open Disputes */}
            <div className="glass-card p-4 rounded-2xl border-rose-500/30 bg-rose-950/10">
              <div className="text-[10px] font-black text-rose-400 uppercase tracking-wider flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Open Conflicts
              </div>
              <div className="text-xl font-black text-rose-300 mt-1 tabular-nums">{disputes.length}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Score Mismatches</div>
            </div>
          </div>

          {/* ACTION CENTER / NEEDS ATTENTION */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Flame className="w-4 h-4 text-amber-400" />
                <span>Action Center • Urgent Reviews ({pendingResults.length + disputes.length})</span>
              </h2>
              <button
                onClick={() => setActiveAdminTab('results')}
                className="text-xs text-amber-400 hover:text-amber-300 font-bold flex items-center gap-1"
              >
                <span>View Results Center</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {pendingResults.length === 0 && disputes.length === 0 ? (
              <div className="glass-panel p-6 text-center border-emerald-500/30 bg-emerald-950/10 shadow-xl">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 mx-auto mb-2">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-white">All Tournament Matches Clear</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  No pending score submissions or unresolved match disputes require administrator attention.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Pending Results Preview */}
                {pendingResults.slice(0, 4).map((fix) => (
                  <div key={fix.id} className="glass-card p-4 rounded-xl border-amber-500/30 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-amber-400 uppercase tracking-wide">
                        {fix.competitionName || 'Tournament'} • MD {fix.matchday}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[9px] font-black bg-amber-500/20 text-amber-300">
                        {fix.status}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs py-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <ClubCrest clubId={fix.homeClubId} logoUrl={fix.homeClub?.logoUrl} name={fix.homeClub?.name} size="xs" />
                        <span className="font-bold text-white truncate">{fix.homeClub?.name}</span>
                      </div>
                      <span className="font-black text-slate-400 px-2">vs</span>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold text-white truncate">{fix.awayClub?.name}</span>
                        <ClubCrest clubId={fix.awayClubId} logoUrl={fix.awayClub?.logoUrl} name={fix.awayClub?.name} size="xs" />
                      </div>
                    </div>

                    {fix.submissions && fix.submissions.length > 0 && (
                      <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2 rounded-lg border border-white/[0.05]">
                        Claimed: <strong className="text-emerald-400 font-mono">{fix.submissions[0].homeScore} - {fix.submissions[0].awayScore}</strong> by @{fix.submissions[0].submitterUsername}
                      </div>
                    )}

                    <button
                      onClick={() => {
                        setSelectedPendingForApprove(fix);
                        setApproveHomeScore(fix.submissions?.[0]?.homeScore ?? 0);
                        setApproveAwayScore(fix.submissions?.[0]?.awayScore ?? 0);
                      }}
                      className="w-full py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-black transition-all shadow"
                    >
                      Review & Confirm
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Shortcuts Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <button
              onClick={() => setActiveAdminTab('clubs')}
              className="glass-card p-4 rounded-xl text-left hover:border-emerald-500/40 transition-all space-y-1 group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  Manage 96 Clubs
                </span>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
              </div>
              <p className="text-[11px] text-slate-400">
                Inspect club owners, availability, assign new players or release occupied teams.
              </p>
            </button>

            <button
              onClick={() => setActiveAdminTab('matches')}
              className="glass-card p-4 rounded-xl text-left hover:border-emerald-500/40 transition-all space-y-1 group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-emerald-400" />
                  Match Engine
                </span>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
              </div>
              <p className="text-[11px] text-slate-400">
                Inspect schedule across all 19 tournaments, check scores, reopen matches if needed.
              </p>
            </button>

            <button
              onClick={handleEvaluateQualifications}
              disabled={isProcessing}
              className="glass-card p-4 rounded-xl text-left hover:border-emerald-500/40 transition-all space-y-1 group"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  European Qualifications
                </span>
                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-amber-400 transition-colors" />
              </div>
              <p className="text-[11px] text-slate-400">
                Calculate UEFA Champions League, Europa League, and Conference League allocations.
              </p>
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. CLUBS SECTION */}
      {/* ========================================================================= */}
      {activeAdminTab === 'clubs' && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="glass-panel p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black text-white flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  <span>96 Official European Clubs</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Safely manage club occupancy, assign registered users, or release clubs. Deletion is protected.
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs font-bold">
                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/20">
                  {occupiedClubsCount} Occupied
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300">
                  {availableClubsCount} Available
                </span>
              </div>
            </div>

            {/* Filter Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-white/[0.06]">
              {/* Search */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={clubSearch}
                  onChange={(e) => setClubSearch(e.target.value)}
                  placeholder="Search club name or owner..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* League Filter */}
              <select
                value={clubLeagueFilter}
                onChange={(e) => setClubLeagueFilter(e.target.value)}
                className="px-3 py-2 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-semibold"
              >
                <option value="ALL">All Leagues (96 Clubs)</option>
                <option value="league-premier-league">Premier League (20)</option>
                <option value="league-la-liga">La Liga (20)</option>
                <option value="league-serie-a">Serie A (20)</option>
                <option value="league-bundesliga">Bundesliga (18)</option>
                <option value="league-ligue-1">Ligue 1 (18)</option>
              </select>

              {/* Occupancy Filter */}
              <select
                value={clubOccupancyFilter}
                onChange={(e) => setClubOccupancyFilter(e.target.value)}
                className="px-3 py-2 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-semibold"
              >
                <option value="ALL">All Availability</option>
                <option value="OCCUPIED">Occupied Only</option>
                <option value="AVAILABLE">Available Only</option>
              </select>
            </div>
          </div>

          {/* Clubs Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredClubs.map((club) => {
              const isOccupied = club.isTaken || Boolean(club.claimedByUserId);
              return (
                <div
                  key={club.id}
                  className={`glass-card p-3.5 rounded-2xl flex flex-col justify-between space-y-3 transition-all border ${
                    isOccupied ? 'border-emerald-500/30' : 'border-slate-800/80'
                  }`}
                >
                  <div className="space-y-2">
                    {/* Crest & Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <ClubCrest
                          clubId={club.id}
                          logoUrl={club.logoUrl}
                          name={club.name}
                          shortName={club.shortName}
                          size="md"
                          className="shrink-0"
                        />
                        <div className="min-w-0">
                          <h3 className="text-xs font-black text-white truncate leading-tight">{club.name}</h3>
                          <span className="text-[10px] text-slate-400 font-mono font-bold">{club.shortName} • {club.country}</span>
                        </div>
                      </div>

                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-black uppercase shrink-0 ${
                          isOccupied
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {isOccupied ? 'Occupied' : 'Free'}
                      </span>
                    </div>

                    {/* Owner details */}
                    <div className="bg-slate-950/70 p-2.5 rounded-xl border border-white/[0.05] space-y-1">
                      <div className="text-[9px] uppercase font-black text-slate-500">Current Manager</div>
                      {isOccupied ? (
                        <div className="space-y-0.5">
                          <div className="text-xs font-black text-emerald-400 truncate flex items-center gap-1">
                            <UserCheck className="w-3 h-3 shrink-0" />
                            <span>@{club.claimedByUsername || club.managerUsername || 'player'}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono truncate">
                            ID: {club.claimedByUserId || club.managerUserId || '—'}
                          </div>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500 italic font-semibold">Available for assignment</div>
                      )}
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="pt-2 border-t border-white/[0.06] flex items-center gap-2">
                    {isOccupied ? (
                      <>
                        <button
                          onClick={() => setSelectedClubForRelease(club)}
                          className="flex-1 py-1.5 px-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-lg text-[11px] font-black flex items-center justify-center gap-1 transition-all"
                        >
                          <UserMinus className="w-3 h-3" />
                          <span>Release</span>
                        </button>
                        <button
                          onClick={() => {
                            setSelectedClubForAssign(club);
                            setAssignTargetUserId(club.claimedByUserId || '');
                          }}
                          className="flex-1 py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-all"
                        >
                          <UserPlus className="w-3 h-3" />
                          <span>Reassign</span>
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          setSelectedClubForAssign(club);
                          setAssignTargetUserId('');
                        }}
                        className="w-full py-1.5 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg text-[11px] font-black flex items-center justify-center gap-1.5 transition-all shadow"
                      >
                        <UserPlus className="w-3 h-3" />
                        <span>Assign Player</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. MATCHES SECTION */}
      {/* ========================================================================= */}
      {activeAdminTab === 'matches' && (
        <div className="space-y-4">
          {/* Filters Bar */}
          <div className="glass-panel p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black text-white flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-emerald-400" />
                  <span>Fixture Management & Schedule Inspector</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Inspect results, review status, identify postponed/problematic matches, or reopen for corrections.
                </p>
              </div>

              <div className="text-xs font-bold text-slate-400 font-mono">
                Showing <strong className="text-emerald-400">{filteredFixtures.length}</strong> matches
              </div>
            </div>

            {/* Filter Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-white/[0.06]">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={matchSearch}
                  onChange={(e) => setMatchSearch(e.target.value)}
                  placeholder="Search club or fixture ID..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {/* Competition Filter */}
              <select
                value={matchCompFilter}
                onChange={(e) => setMatchCompFilter(e.target.value)}
                className="px-3 py-2 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-semibold"
              >
                <option value="ALL">All Competitions (19)</option>
                {competitions.map((comp) => (
                  <option key={comp.id} value={comp.id}>
                    {comp.name}
                  </option>
                ))}
              </select>

              {/* Status Filter */}
              <select
                value={matchStatusFilter}
                onChange={(e) => setMatchStatusFilter(e.target.value)}
                className="px-3 py-2 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-semibold"
              >
                <option value="ALL">All Match Statuses</option>
                <option value="SCHEDULED">SCHEDULED (Upcoming)</option>
                <option value="AWAITING_RESULT">AWAITING_RESULT (In Play)</option>
                <option value="PENDING_CONFIRMATION">PENDING_CONFIRMATION (1 Submission)</option>
                <option value="CONFIRMED">CONFIRMED (Final)</option>
                <option value="DISPUTED">DISPUTED (Conflict)</option>
                <option value="POSTPONED">POSTPONED</option>
              </select>
            </div>
          </div>

          {/* Fixtures List */}
          <div className="space-y-2.5">
            {filteredFixtures.length === 0 ? (
              <div className="glass-panel p-8 text-center border-slate-800 text-slate-400 text-xs">
                No fixtures matched the selected filters.
              </div>
            ) : (
              filteredFixtures.map((fix) => {
                const isConfirmed = fix.status === 'CONFIRMED';
                const isDisputed = fix.status === 'DISPUTED';
                const isPending = fix.status === 'PENDING_CONFIRMATION';

                return (
                  <div
                    key={fix.id}
                    className={`glass-card p-3 sm:p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 border ${
                      isDisputed
                        ? 'border-rose-500/40 bg-rose-950/10'
                        : isPending
                        ? 'border-amber-500/40 bg-amber-950/10'
                        : 'border-slate-800/80'
                    }`}
                  >
                    {/* Left: Tournament Badge & Teams */}
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase text-amber-400 bg-amber-500/15 px-2 py-0.5 rounded">
                          {fix.competitionName || fix.competitionId}
                        </span>
                        {fix.matchday && (
                          <span className="text-[10px] font-bold text-slate-400 font-mono">
                            Matchday {fix.matchday}
                          </span>
                        )}
                        {fix.roundName && (
                          <span className="text-[10px] font-bold text-slate-400">
                            • {fix.roundName}
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.2 text-[9px] font-black uppercase rounded ${
                            isConfirmed
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : isDisputed
                              ? 'bg-rose-500/20 text-rose-400'
                              : isPending
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {fix.status}
                        </span>
                      </div>

                      {/* Scoreline */}
                      <div className="flex items-center gap-3 text-xs sm:text-sm font-bold text-white">
                        <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
                          <span className="truncate">{fix.homeClub?.name || fix.homeClubId}</span>
                          <ClubCrest
                            clubId={fix.homeClubId}
                            logoUrl={fix.homeClub?.logoUrl}
                            name={fix.homeClub?.name}
                            size="xs"
                            className="shrink-0"
                          />
                        </div>

                        {/* Middle Score / Time */}
                        <div className="px-3 py-1 bg-slate-950/80 rounded-lg border border-white/[0.08] font-mono font-black text-center min-w-[54px]">
                          {isConfirmed ? (
                            <span className="text-emerald-400">
                              {fix.homeScore} - {fix.awayScore}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">VS</span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 flex-1 justify-start min-w-0">
                          <ClubCrest
                            clubId={fix.awayClubId}
                            logoUrl={fix.awayClub?.logoUrl}
                            name={fix.awayClub?.name}
                            size="xs"
                            className="shrink-0"
                          />
                          <span className="truncate">{fix.awayClub?.name || fix.awayClubId}</span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      <button
                        onClick={() => setSelectedFixtureForInspect(fix)}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold flex items-center gap-1"
                      >
                        <Eye className="w-3.5 h-3.5 text-slate-400" />
                        <span>Inspect</span>
                      </button>

                      {isConfirmed && (
                        <button
                          onClick={() => setSelectedFixtureForReopen(fix)}
                          className="px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-bold flex items-center gap-1"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Reopen</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. RESULTS SECTION (DEDICATED PENDING REVIEW WORKFLOW) */}
      {/* ========================================================================= */}
      {activeAdminTab === 'results' && (
        <div className="space-y-4">
          <div className="glass-panel p-4 space-y-1">
            <h2 className="text-sm font-black text-white flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-amber-400" />
              <span>Pending Results Review & Arbitration Workflow</span>
            </h2>
            <p className="text-xs text-slate-400">
              Matches with single submissions or conflicting claims. Administrator approval immediately updates official standings and tournament knockout progressions.
            </p>
          </div>

          {/* Pending Submissions List */}
          <div className="space-y-3">
            {pendingResults.length === 0 && disputes.length === 0 ? (
              <div className="glass-panel p-10 text-center border-emerald-500/30 bg-emerald-950/10">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 mx-auto mb-3">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-white">No Pending Result Confirmations</h3>
                <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                  All match submissions have either achieved two-player consensus or been confirmed by tournament officials.
                </p>
              </div>
            ) : (
              pendingResults.map((fix) => {
                const sub = fix.submissions?.[0];
                return (
                  <div
                    key={fix.id}
                    className="glass-panel p-4 sm:p-5 rounded-2xl border-amber-500/40 shadow-xl space-y-3 bg-amber-950/10"
                  >
                    {/* Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.08] pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          {fix.status}
                        </span>
                        <span className="text-xs font-black text-white">
                          {fix.competitionName || 'Tournament'} • Matchday {fix.matchday}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">({fix.id})</span>
                      </div>

                      {sub && (
                        <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          <span>Submitted: {new Date(sub.createdAt).toLocaleString()}</span>
                        </div>
                      )}
                    </div>

                    {/* Clubs and Score Claim */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-center">
                      {/* Match Matchup */}
                      <div className="flex items-center justify-between bg-slate-950/70 p-3 rounded-xl border border-white/[0.06]">
                        <div className="flex items-center gap-2">
                          <ClubCrest clubId={fix.homeClubId} logoUrl={fix.homeClub?.logoUrl} name={fix.homeClub?.name} size="sm" />
                          <div>
                            <div className="text-xs font-bold text-white">{fix.homeClub?.name}</div>
                            <div className="text-[10px] text-slate-400">@{fix.homeClub?.claimedByUsername || 'player'}</div>
                          </div>
                        </div>
                        <span className="text-xs font-black text-slate-500 px-2">VS</span>
                        <div className="flex items-center gap-2 text-right">
                          <div>
                            <div className="text-xs font-bold text-white">{fix.awayClub?.name}</div>
                            <div className="text-[10px] text-slate-400">@{fix.awayClub?.claimedByUsername || 'player'}</div>
                          </div>
                          <ClubCrest clubId={fix.awayClubId} logoUrl={fix.awayClub?.logoUrl} name={fix.awayClub?.name} size="sm" />
                        </div>
                      </div>

                      {/* Submitted Score Details */}
                      <div className="bg-slate-950/70 p-3 rounded-xl border border-white/[0.06] flex items-center justify-between">
                        <div>
                          <span className="text-[10px] uppercase font-black text-slate-500 block">Submitted Score Claim</span>
                          <span className="text-lg font-black text-emerald-400 font-mono">
                            {sub ? `${sub.homeScore} - ${sub.awayScore}` : 'Pending entry'}
                          </span>
                          <span className="text-[10px] text-slate-400 block">
                            By @{sub?.submitterUsername || 'player'}
                          </span>
                        </div>

                        {sub?.proofUrl && (
                          <a
                            href={sub.proofUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-1.5 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-bold flex items-center gap-1.5"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Proof Screenshot</span>
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Admin Action Bar */}
                    <div className="pt-2 flex flex-wrap items-center justify-end gap-2">
                      <button
                        onClick={() => setSelectedPendingForInspect(fix)}
                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold flex items-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Inspect Full Record</span>
                      </button>

                      <button
                        onClick={() => {
                          setSelectedPendingForReject(fix);
                          setRejectNotes('');
                        }}
                        className="px-3.5 py-2 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Reject & Reopen</span>
                      </button>

                      <button
                        onClick={() => {
                          setSelectedPendingForApprove(fix);
                          setApproveHomeScore(sub?.homeScore ?? 0);
                          setApproveAwayScore(sub?.awayScore ?? 0);
                          setApproveNotes('');
                        }}
                        className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-lg shadow-emerald-500/20"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Approve Result</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. COMPETITIONS SECTION */}
      {/* ========================================================================= */}
      {activeAdminTab === 'competitions' && (
        <div className="space-y-6">
          <div className="glass-panel p-4 space-y-1">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-black text-white flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-amber-400" />
                  <span>18 Official Tournament Competitions</span>
                </h2>
                <p className="text-xs text-slate-400">
                  5 Single Round-Robin Domestic Leagues, 6 National Cups, 5 Super Cups, and 2 32-Team European Competitions.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleRunFixtureValidation}
                  disabled={isValidatingFixtures}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow transition-all disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{isValidatingFixtures ? 'Validating...' : 'Validate 19/17 MD Formats'}</span>
                </button>

                <button
                  onClick={handleEvaluateQualifications}
                  disabled={isProcessing}
                  className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-black flex items-center gap-1.5 shadow"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Evaluate European Spots</span>
                </button>
              </div>
            </div>
          </div>

          {/* 1. DOMESTIC LEAGUES (5) */}
          <div className="space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-2">
              <Globe2 className="w-3.5 h-3.5" />
              <span>Domestic Leagues (5) • Single Round-Robin (19 MDs for 20 teams, 17 MDs for 18 teams)</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {groupedCompetitions.domesticLeagues.map((comp) => {
                const totalMds = comp.totalMatchdays || (comp.leagueId?.includes('bundesliga') || comp.leagueId?.includes('ligue-1') ? 17 : 19);
                const currentMd = comp.currentMatchday || 1;
                const override = comp.adminOverrideStatus || 'AUTO';
                const isOpen = override === 'FORCE_OPEN' || (override !== 'FORCE_LOCKED' && comp.isMatchdayOpen);

                return (
                  <div key={comp.id} className="glass-card p-4 rounded-2xl border-slate-800 space-y-3 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-white">{comp.name}</span>
                        <div className="flex items-center gap-1">
                          <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                            override === 'FORCE_OPEN'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : override === 'FORCE_LOCKED'
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : isOpen
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : 'bg-slate-700 text-slate-300'
                          }`}>
                            {override !== 'AUTO' ? override : isOpen ? 'MD Open (30h)' : 'MD Locked'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-900/60 p-2 rounded-xl border border-white/[0.04]">
                        <span className="font-bold text-white">Matchday {currentMd} / {totalMds}</span>
                        <span>{comp.formatConfig?.qualificationSpots || 4} European Spots</span>
                      </div>

                      {comp.nextMatchdayOpenAt && (
                        <div className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-500" />
                          <span>Timer: {new Date(comp.nextMatchdayOpenAt).toLocaleString()}</span>
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-white/[0.06] space-y-2">
                      {/* Matchday Admin Controls */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => handleAdvanceMatchday(comp.id)}
                          disabled={isProcessing}
                          className="py-1.5 px-2 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1"
                        >
                          <ChevronRight className="w-3 h-3" />
                          <span>Advance +1 MD</span>
                        </button>

                        <button
                          onClick={() => handleToggleMatchdayOverride(comp.id, override)}
                          disabled={isProcessing}
                          className={`py-1.5 px-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 border ${
                            override === 'FORCE_LOCKED'
                              ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/30'
                              : 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/30'
                          }`}
                        >
                          {override === 'FORCE_LOCKED' ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                          <span>{override === 'FORCE_LOCKED' ? 'Unlock MD' : 'Lock MD'}</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleRebuildStandings(comp.id)}
                          disabled={rebuildingStandingsCompId === comp.id}
                          className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold flex items-center justify-center gap-1"
                        >
                          <RefreshCw className={`w-3 h-3 ${rebuildingStandingsCompId === comp.id ? 'animate-spin' : ''}`} />
                          <span>Rebuild Table</span>
                        </button>
                        <button
                          onClick={() => {
                            setMatchCompFilter(comp.id);
                            setActiveAdminTab('matches');
                          }}
                          className="px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 rounded-lg text-xs font-bold flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Fixtures</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. DOMESTIC CUPS (6) */}
          <div className="space-y-3 pt-2">
            <h3 className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <Trophy className="w-3.5 h-3.5" />
              <span>National Cups (6) • FA Cup, EFL Cup, Copa del Rey, Coppa Italia, DFB-Pokal, Coupe de France</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {groupedCompetitions.domesticCups.map((comp) => (
                <div key={comp.id} className="glass-card p-4 rounded-2xl border-slate-800 space-y-3 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-white">{comp.name}</span>
                      <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-amber-500/15 text-amber-300">
                        Knockout Cup
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Single Leg Elimination with Extra Time & Penalties
                    </p>
                  </div>

                  <div className="pt-2 border-t border-white/[0.06] flex items-center gap-2">
                    <button
                      onClick={() => {
                        setMatchCompFilter(comp.id);
                        setActiveAdminTab('matches');
                      }}
                      className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold flex items-center justify-center gap-1"
                    >
                      <Eye className="w-3 h-3" />
                      <span>Inspect Brackets & Fixtures</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 3. SUPER CUPS (5) */}
          <div className="space-y-3 pt-2">
            <h3 className="text-xs font-black uppercase tracking-wider text-indigo-400 flex items-center gap-2">
              <Award className="w-3.5 h-3.5" />
              <span>Super Cups (5) • FA Community Shield, Supercopa de España, Supercoppa Italiana, DFL-Supercup, UEFA Super Cup</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {groupedCompetitions.superCups.map((comp) => (
                <div key={comp.id} className="glass-card p-4 rounded-2xl border-slate-800 space-y-3 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-white">{comp.name}</span>
                      <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-indigo-500/15 text-indigo-300">
                        Super Cup
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Season Opener Showcase Match
                    </p>
                  </div>

                  <div className="pt-2 border-t border-white/[0.06] flex items-center gap-2">
                    <button
                      onClick={() => {
                        setMatchCompFilter(comp.id);
                        setActiveAdminTab('matches');
                      }}
                      className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold flex items-center justify-center gap-1"
                    >
                      <Eye className="w-3 h-3" />
                      <span>View Match</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 4. EUROPEAN COMPETITIONS (2: UCL & UEL) */}
          <div className="space-y-3 pt-2">
            <h3 className="text-xs font-black uppercase tracking-wider text-rose-400 flex items-center gap-2">
              <Globe2 className="w-3.5 h-3.5" />
              <span>European Competitions (2) • UEFA Champions League & UEFA Europa League</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {groupedCompetitions.european.map((comp) => {
                const totalMds = comp.totalMatchdays || 8;
                const currentMd = comp.currentMatchday || 1;
                const override = comp.adminOverrideStatus || 'AUTO';
                const isOpen = override === 'FORCE_OPEN' || (override !== 'FORCE_LOCKED' && comp.isMatchdayOpen);

                return (
                  <div key={comp.id} className="glass-card p-4 rounded-2xl border-slate-800 space-y-3 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-white">{comp.name}</span>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                          override === 'FORCE_OPEN'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : override === 'FORCE_LOCKED'
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            : isOpen
                            ? 'bg-rose-500/15 text-rose-300'
                            : 'bg-slate-700 text-slate-300'
                        }`}>
                          {override !== 'AUTO' ? override : isOpen ? 'MD Open (30h)' : 'MD Locked'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-900/60 p-2 rounded-xl border border-white/[0.04]">
                        <span className="font-bold text-white">Matchday {currentMd} / {totalMds}</span>
                        <span>32 Teams • 8 Rounds (4H / 4A)</span>
                      </div>

                      {comp.nextMatchdayOpenAt && (
                        <div className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-500" />
                          <span>Timer: {new Date(comp.nextMatchdayOpenAt).toLocaleString()}</span>
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-white/[0.06] space-y-2">
                      {/* Matchday Admin Controls */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => handleAdvanceMatchday(comp.id)}
                          disabled={isProcessing}
                          className="py-1.5 px-2 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1"
                        >
                          <ChevronRight className="w-3 h-3" />
                          <span>Advance +1 MD</span>
                        </button>

                        <button
                          onClick={() => handleToggleMatchdayOverride(comp.id, override)}
                          disabled={isProcessing}
                          className={`py-1.5 px-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 border ${
                            override === 'FORCE_LOCKED'
                              ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/30'
                              : 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/30'
                          }`}
                        >
                          {override === 'FORCE_LOCKED' ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                          <span>{override === 'FORCE_LOCKED' ? 'Unlock MD' : 'Lock MD'}</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleRebuildStandings(comp.id)}
                          disabled={rebuildingStandingsCompId === comp.id}
                          className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-bold flex items-center justify-center gap-1"
                        >
                          <RefreshCw className={`w-3 h-3 ${rebuildingStandingsCompId === comp.id ? 'animate-spin' : ''}`} />
                          <span>Rebuild Table</span>
                        </button>
                        <button
                          onClick={() => {
                            setMatchCompFilter(comp.id);
                            setActiveAdminTab('matches');
                          }}
                          className="px-3 py-1.5 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 rounded-lg text-xs font-bold flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Fixtures</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. PLAYERS & ROSTER SECTION */}
      {/* ========================================================================= */}
      {activeAdminTab === 'users' && (
        <div className="space-y-4">
          <div className="glass-panel p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-black text-white flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-emerald-400" />
                  <span>Registered Telegram Players ({users.length})</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Inspect telegram user authentication, claimed clubs, and role permissions.
                </p>
              </div>
            </div>

            {/* Filter */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-white/[0.06]">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search player username or ID..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <select
                value={userRoleFilter}
                onChange={(e) => setUserRoleFilter(e.target.value)}
                className="px-3 py-2 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-semibold"
              >
                <option value="ALL">All Roles</option>
                <option value="ADMIN">Administrators</option>
                <option value="PLAYER">Standard Players</option>
              </select>
            </div>
          </div>

          {/* Users Table */}
          <div className="glass-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08] text-[10px] uppercase font-black text-slate-400 bg-slate-950/40">
                    <th className="p-3">Player</th>
                    <th className="p-3">Telegram ID</th>
                    <th className="p-3">Role</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-3">
                        <div className="font-bold text-white">@{u.username || 'unknown'}</div>
                        <div className="text-[10px] text-slate-400">
                          {u.firstName} {u.lastName}
                        </div>
                      </td>
                      <td className="p-3 font-mono text-slate-400">{u.telegramId || u.id}</td>
                      <td className="p-3">
                        {u.isAdmin ? (
                          <span className="px-2 py-0.5 rounded text-[9px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            ADMIN
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-800 text-slate-400">
                            PLAYER
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {u.isSuspended ? (
                          <span className="text-rose-400 font-bold">Suspended</span>
                        ) : (
                          <span className="text-emerald-400 font-bold">Active</span>
                        )}
                      </td>
                      <td className="p-3 text-slate-400 font-mono text-[11px]">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 7. SYSTEM & AUDIT SECTION */}
      {/* ========================================================================= */}
      {activeAdminTab === 'system' && (
        <div className="space-y-4">
          {/* Health & DB Status */}
          <div className="glass-panel p-4 space-y-3">
            <h2 className="text-sm font-black text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-400" />
              <span>Firestore System Health & Diagnostics</span>
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="bg-slate-950/60 p-3 rounded-xl border border-white/[0.05]">
                <div className="text-[10px] uppercase font-black text-slate-500">Database Connection</div>
                <div className="text-xs font-black text-emerald-400 mt-1 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>CONNECTED</span>
                </div>
              </div>

              <div className="bg-slate-950/60 p-3 rounded-xl border border-white/[0.05]">
                <div className="text-[10px] uppercase font-black text-slate-500">Project ID</div>
                <div className="text-xs font-mono font-bold text-white mt-1 truncate">
                  {diagnostics?.projectId || overviewData?.systemHealth?.projectId || 'Default Project'}
                </div>
              </div>

              <div className="bg-slate-950/60 p-3 rounded-xl border border-white/[0.05]">
                <div className="text-[10px] uppercase font-black text-slate-500">Total Audit Logs</div>
                <div className="text-xs font-black text-white mt-1">{auditLogs.length} Records</div>
              </div>

              <div className="bg-slate-950/60 p-3 rounded-xl border border-white/[0.05]">
                <div className="text-[10px] uppercase font-black text-slate-500">Auth Mode</div>
                <div className="text-xs font-mono font-bold text-emerald-400 mt-1">Telegram HMAC Verified</div>
              </div>
            </div>

            {/* Read Budget & Telemetry Widget */}
            {diagnostics?.readMetrics && (
              <div className="mt-4 pt-4 border-t border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-black uppercase text-slate-300 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <span>Firestore Extreme Read Minimization Telemetry</span>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/30">
                    Free Tier Safe (&lt; 50,000 / day)
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="bg-slate-950/80 p-3 rounded-xl border border-white/[0.05]">
                    <div className="text-[10px] uppercase font-black text-slate-500">Session Reads</div>
                    <div className="text-base font-black text-emerald-400 mt-0.5">
                      {diagnostics.readMetrics.sessionReads}
                    </div>
                    <div className="text-[9px] text-slate-500">Reads tracked</div>
                  </div>

                  <div className="bg-slate-950/80 p-3 rounded-xl border border-white/[0.05]">
                    <div className="text-[10px] uppercase font-black text-slate-500">Cache Hit Ratio</div>
                    <div className="text-base font-black text-sky-400 mt-0.5">
                      {diagnostics.readMetrics.cacheHits + diagnostics.readMetrics.cacheMisses > 0
                        ? `${Math.round(
                            (diagnostics.readMetrics.cacheHits /
                              (diagnostics.readMetrics.cacheHits + diagnostics.readMetrics.cacheMisses)) *
                              100
                          )}%`
                        : '100%'}
                    </div>
                    <div className="text-[9px] text-slate-500">{diagnostics.readMetrics.cacheHits} hits / {diagnostics.readMetrics.cacheMisses} misses</div>
                  </div>

                  <div className="bg-slate-950/80 p-3 rounded-xl border border-white/[0.05]">
                    <div className="text-[10px] uppercase font-black text-slate-500">Free-Tier Quota Used</div>
                    <div className="text-base font-black text-amber-400 mt-0.5">
                      {diagnostics.readMetrics.budget?.percentageConsumed ?? 0}%
                    </div>
                    <div className="text-[9px] text-slate-500">Limit: 50,000 / day</div>
                  </div>

                  <div className="bg-slate-950/80 p-3 rounded-xl border border-white/[0.05]">
                    <div className="text-[10px] uppercase font-black text-slate-500">Avg Reads / Session</div>
                    <div className="text-base font-black text-purple-400 mt-0.5">
                      {diagnostics.readMetrics.budget?.estimatedReadsPerUserSession ?? 2}
                    </div>
                    <div className="text-[9px] text-slate-500">User avg (target &lt; 100)</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Audit Logs Table */}
          <div className="glass-panel p-4 space-y-3">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <FileText className="w-4 h-4 text-amber-400" />
              <span>Tamper-Evident Administrative Audit Log</span>
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08] text-[10px] uppercase font-black text-slate-400 bg-slate-950/40">
                    <th className="p-2.5">Time</th>
                    <th className="p-2.5">Actor</th>
                    <th className="p-2.5">Action</th>
                    <th className="p-2.5">Target Entity</th>
                    <th className="p-2.5">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {auditLogs.slice(0, 30).map((log) => (
                    <tr key={log.id} className="hover:bg-white/[0.02]">
                      <td className="p-2.5 text-slate-400 font-mono text-[10px] whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="p-2.5 font-bold text-emerald-400">{log.actorUserId}</td>
                      <td className="p-2.5">
                        <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-slate-800 text-slate-300 font-mono">
                          {log.action}
                        </span>
                      </td>
                      <td className="p-2.5 text-slate-300 font-mono text-[11px]">
                        {log.entityType}:{log.entityId}
                      </td>
                      <td className="p-2.5 text-slate-400 text-[11px] max-w-xs truncate">{log.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ASSIGN CLUB */}
      {/* ========================================================================= */}
      {selectedClubForAssign && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel p-5 max-w-md w-full rounded-2xl border-emerald-500/40 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2">
                <ClubCrest
                  clubId={selectedClubForAssign.id}
                  logoUrl={selectedClubForAssign.logoUrl}
                  name={selectedClubForAssign.name}
                  size="sm"
                />
                <div>
                  <h3 className="text-sm font-black text-white">Assign Club Manager</h3>
                  <p className="text-[10px] text-slate-400">{selectedClubForAssign.name}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedClubForAssign(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-bold text-slate-300 block">Select Registered Player</label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={assignUserSearch}
                  onChange={(e) => setAssignUserSearch(e.target.value)}
                  placeholder="Filter by username or Telegram ID..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                {assignableUsers.map((u) => {
                  const isSelected = assignTargetUserId === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setAssignTargetUserId(u.id)}
                      className={`w-full p-2.5 rounded-xl text-left text-xs transition-all flex items-center justify-between ${
                        isSelected
                          ? 'bg-emerald-500/20 border border-emerald-500/40 text-white font-bold'
                          : 'bg-slate-900/60 hover:bg-slate-800 text-slate-300'
                      }`}
                    >
                      <div>
                        <div className="font-bold text-white">@{u.username || 'unknown'}</div>
                        <div className="text-[10px] text-slate-400 font-mono">ID: {u.telegramId || u.id}</div>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-emerald-400" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={() => setSelectedClubForAssign(null)}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAssignClub}
                disabled={!assignTargetUserId || isProcessing}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-black shadow transition-all disabled:opacity-50"
              >
                {isProcessing ? 'Assigning...' : 'Confirm Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: RELEASE CLUB */}
      {/* ========================================================================= */}
      {selectedClubForRelease && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel p-5 max-w-md w-full rounded-2xl border-rose-500/40 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
                <UserMinus className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-white">Release Club Ownership</h3>
                <p className="text-xs text-slate-400">{selectedClubForRelease.name}</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-3 rounded-xl border border-white/[0.06]">
              Are you sure you want to release ownership of <strong>{selectedClubForRelease.name}</strong> from user{' '}
              <strong className="text-rose-400">@{selectedClubForRelease.claimedByUsername || selectedClubForRelease.claimedByUserId}</strong>?
              The club will immediately become available for other players.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={() => setSelectedClubForRelease(null)}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReleaseClub}
                disabled={isProcessing}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-black shadow transition-all disabled:opacity-50"
              >
                {isProcessing ? 'Releasing...' : 'Confirm Release'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: APPROVE RESULT */}
      {/* ========================================================================= */}
      {selectedPendingForApprove && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel p-5 max-w-md w-full rounded-2xl border-emerald-500/40 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-black text-white">Approve Match Result</h3>
                  <p className="text-[10px] text-slate-400">
                    {selectedPendingForApprove.competitionName} • Matchday {selectedPendingForApprove.matchday}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedPendingForApprove(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Score Inputs */}
            <div className="bg-slate-950/70 p-4 rounded-xl border border-white/[0.06] space-y-3">
              <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                  <ClubCrest
                    clubId={selectedPendingForApprove.homeClubId}
                    logoUrl={selectedPendingForApprove.homeClub?.logoUrl}
                    name={selectedPendingForApprove.homeClub?.name}
                    size="sm"
                    className="mx-auto mb-1"
                  />
                  <div className="text-xs font-bold text-white truncate">{selectedPendingForApprove.homeClub?.name}</div>
                  <input
                    type="number"
                    min={0}
                    value={approveHomeScore}
                    onChange={(e) => setApproveHomeScore(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-16 py-2 text-center text-lg font-black bg-slate-900 border border-slate-700 rounded-xl text-emerald-400 mt-2 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>

                <div>
                  <ClubCrest
                    clubId={selectedPendingForApprove.awayClubId}
                    logoUrl={selectedPendingForApprove.awayClub?.logoUrl}
                    name={selectedPendingForApprove.awayClub?.name}
                    size="sm"
                    className="mx-auto mb-1"
                  />
                  <div className="text-xs font-bold text-white truncate">{selectedPendingForApprove.awayClub?.name}</div>
                  <input
                    type="number"
                    min={0}
                    value={approveAwayScore}
                    onChange={(e) => setApproveAwayScore(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-16 py-2 text-center text-lg font-black bg-slate-900 border border-slate-700 rounded-xl text-emerald-400 mt-2 focus:outline-none focus:border-emerald-500 font-mono"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">Administrative Note</label>
              <input
                type="text"
                value={approveNotes}
                onChange={(e) => setApproveNotes(e.target.value)}
                placeholder="Optional confirmation note..."
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={() => setSelectedPendingForApprove(null)}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApproveResult}
                disabled={isProcessing}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-black shadow transition-all disabled:opacity-50"
              >
                {isProcessing ? 'Confirming...' : 'Confirm & Update Standings'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: REJECT RESULT */}
      {/* ========================================================================= */}
      {selectedPendingForReject && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel p-5 max-w-md w-full rounded-2xl border-rose-500/40 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-rose-400" />
                <div>
                  <h3 className="text-sm font-black text-white">Reject Result Submission</h3>
                  <p className="text-[10px] text-slate-400">
                    {selectedPendingForReject.homeClub?.name} vs {selectedPendingForReject.awayClub?.name}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedPendingForReject(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Rejecting this result will discard the pending submission and reopen the fixture so both players can re-submit their score.
            </p>

            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">Reason / Note to Players</label>
              <textarea
                rows={2}
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="e.g. Incorrect score claimed or invalid screenshot..."
                className="w-full p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500 resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={() => setSelectedPendingForReject(null)}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRejectResult}
                disabled={isProcessing}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-black shadow transition-all disabled:opacity-50"
              >
                {isProcessing ? 'Rejecting...' : 'Reject & Reopen Match'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: INSPECT FIXTURE */}
      {/* ========================================================================= */}
      {(selectedFixtureForInspect || selectedPendingForInspect) && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel p-5 max-w-lg w-full rounded-2xl border-slate-800 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
            {(() => {
              const fix = selectedFixtureForInspect || selectedPendingForInspect!;
              return (
                <>
                  <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                    <div className="flex items-center gap-2">
                      <Eye className="w-5 h-5 text-indigo-400" />
                      <div>
                        <h3 className="text-sm font-black text-white">Match Inspector Record</h3>
                        <p className="text-[10px] text-slate-400 font-mono">Fixture ID: {fix.id}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedFixtureForInspect(null);
                        setSelectedPendingForInspect(null);
                      }}
                      className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Metadata Grid */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-950/60 p-2.5 rounded-xl border border-white/[0.05]">
                      <span className="text-[9px] uppercase font-black text-slate-500 block">Competition</span>
                      <span className="font-bold text-white">{fix.competitionName || fix.competitionId}</span>
                    </div>
                    <div className="bg-slate-950/60 p-2.5 rounded-xl border border-white/[0.05]">
                      <span className="text-[9px] uppercase font-black text-slate-500 block">Status</span>
                      <span className="font-bold text-emerald-400 font-mono">{fix.status}</span>
                    </div>
                    <div className="bg-slate-950/60 p-2.5 rounded-xl border border-white/[0.05]">
                      <span className="text-[9px] uppercase font-black text-slate-500 block">Home Team</span>
                      <span className="font-bold text-white">{fix.homeClub?.name}</span>
                    </div>
                    <div className="bg-slate-950/60 p-2.5 rounded-xl border border-white/[0.05]">
                      <span className="text-[9px] uppercase font-black text-slate-500 block">Away Team</span>
                      <span className="font-bold text-white">{fix.awayClub?.name}</span>
                    </div>
                  </div>

                  {/* Submissions if any */}
                  {(fix as any).submissions && (fix as any).submissions.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-[10px] uppercase font-black text-slate-400 block">Raw Player Submissions</span>
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {(fix as any).submissions.map((sub: any, idx: number) => (
                          <div key={idx} className="bg-slate-950/80 p-2.5 rounded-xl border border-white/[0.05] text-xs flex items-center justify-between">
                            <div>
                              <div className="font-bold text-emerald-400">@{sub.submitterUsername}</div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                Claimed: {sub.homeScore} - {sub.awayScore} • {new Date(sub.createdAt).toLocaleTimeString()}
                              </div>
                            </div>
                            {sub.proofUrl && (
                              <a
                                href={sub.proofUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[11px] text-indigo-400 hover:underline flex items-center gap-1"
                              >
                                <ExternalLink className="w-3 h-3" />
                                <span>Proof</span>
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-white/[0.08] flex justify-end">
                    <button
                      onClick={() => {
                        setSelectedFixtureForInspect(null);
                        setSelectedPendingForInspect(null);
                      }}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold"
                    >
                      Close
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: REOPEN FIXTURE */}
      {/* ========================================================================= */}
      {selectedFixtureForReopen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel p-5 max-w-md w-full rounded-2xl border-rose-500/40 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
                <RotateCcw className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-white">Reopen Confirmed Fixture</h3>
                <p className="text-xs text-slate-400">
                  {selectedFixtureForReopen.homeClub?.name} vs {selectedFixtureForReopen.awayClub?.name}
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Reopening will remove the confirmed score from official standings and reset the fixture status to <strong>AWAITING_RESULT</strong> so that a corrected score can be submitted.
            </p>

            <div>
              <label className="text-[11px] font-bold text-slate-300 block mb-1">Reason for Reopening</label>
              <input
                type="text"
                value={reopenNotes}
                onChange={(e) => setReopenNotes(e.target.value)}
                placeholder="e.g. Disputed score entry or accidental submission..."
                className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={() => setSelectedFixtureForReopen(null)}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleReopenFixture(selectedFixtureForReopen.id, reopenNotes)}
                disabled={isProcessing}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-black shadow transition-all disabled:opacity-50"
              >
                {isProcessing ? 'Reopening...' : 'Confirm & Reopen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: FIXTURE VALIDATION DIAGNOSTIC */}
      {/* ========================================================================= */}
      {showValidationModal && fixtureValidationReport && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="glass-panel p-6 max-w-3xl w-full rounded-2xl border-emerald-500/40 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Domestic League Single Round-Robin Diagnostic</h3>
                  <p className="text-xs text-slate-400">
                    Target: 20 clubs → 19 MD (190 matches) | 18 clubs → 17 MD (153 matches)
                  </p>
                </div>
              </div>
              <span
                className={`px-3 py-1 rounded-full text-xs font-black uppercase ${
                  fixtureValidationReport.allValid
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                }`}
              >
                {fixtureValidationReport.allValid ? '100% Valid' : 'Needs Generation'}
              </span>
            </div>

            {/* Summary KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-900/60 p-3 rounded-xl border border-white/[0.04] text-center">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Total Clubs</span>
                <span className="text-base font-black text-white">{fixtureValidationReport.summary?.totalClubs || 96}</span>
              </div>
              <div className="bg-slate-900/60 p-3 rounded-xl border border-white/[0.04] text-center">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Expected Matches</span>
                <span className="text-base font-black text-white">{fixtureValidationReport.summary?.expectedTotalFixtures || 876}</span>
              </div>
              <div className="bg-slate-900/60 p-3 rounded-xl border border-white/[0.04] text-center">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Actual Matches</span>
                <span className="text-base font-black text-emerald-400">{fixtureValidationReport.summary?.actualTotalFixtures || 0}</span>
              </div>
              <div className="bg-slate-900/60 p-3 rounded-xl border border-white/[0.04] text-center">
                <span className="text-[10px] text-slate-400 font-bold uppercase block">Confirmed Results</span>
                <span className="text-base font-black text-amber-400">{fixtureValidationReport.summary?.totalConfirmed || 0}</span>
              </div>
            </div>

            {/* Per League Diagnostic Table */}
            <div className="space-y-3">
              <h4 className="text-xs font-black uppercase text-slate-300">League Breakdown</h4>
              <div className="space-y-2">
                {fixtureValidationReport.leagues?.map((l: any) => (
                  <div
                    key={l.competitionId}
                    className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                      l.isValid
                        ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                        : 'bg-amber-950/20 border-amber-500/30 text-amber-200'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-white">{l.name}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-900 font-bold text-slate-300">
                          {l.clubCount} Clubs
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>Matchdays: <strong className="text-white">{l.actualMatchdays} / {l.expectedMatchdays}</strong></span>
                        <span>Matches: <strong className="text-white">{l.actualFixtureCount} / {l.expectedFixtureCount}</strong></span>
                        <span>Duplicates: <strong className="text-white">{l.duplicatePairCount}</strong></span>
                        <span>Reverse (H/A): <strong className="text-white">{l.reverseFixtureCount}</strong></span>
                      </div>
                      {l.issues?.length > 0 && (
                        <div className="text-[11px] text-amber-400 mt-1.5 space-y-0.5">
                          {l.issues.map((issue: string, idx: number) => (
                            <div key={idx} className="flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                              <span>{issue}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {l.isValid ? (
                        <span className="px-3 py-1 rounded-lg text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Perfect 19/17 MD
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            setShowValidationModal(false);
                            handleGenerateCompetition(l.competitionId);
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-black bg-amber-500 hover:bg-amber-400 text-slate-950 shadow"
                        >
                          Generate {l.expectedMatchdays} MDs
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-white/[0.08]">
              <span className="text-[11px] text-slate-500">
                Diagnostic generated at: {new Date(fixtureValidationReport.timestamp).toLocaleTimeString()}
              </span>
              <button
                type="button"
                onClick={() => setShowValidationModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold"
              >
                Close Diagnostic
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
