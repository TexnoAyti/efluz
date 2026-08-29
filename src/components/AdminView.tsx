import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Dispute, AuditLog, Competition, User } from '../types';
import { ClubCrest } from './ClubCrest';
import {
  Sliders,
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
} from 'lucide-react';

export const AdminView: React.FC = () => {
  const { user, activeSeasonId, showToast } = useAuth();
  const { t } = useI18n();

  const [activeAdminTab, setActiveAdminTab] = useState<'disputes' | 'fixtures' | 'qualification' | 'users' | 'audit'>('disputes');
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Manual resolution state modal
  const [selectedDisputeForResolve, setSelectedDisputeForResolve] = useState<Dispute | null>(null);
  const [manualHomeScore, setManualHomeScore] = useState<number>(0);
  const [manualAwayScore, setManualAwayScore] = useState<number>(0);
  const [resolutionNotes, setResolutionNotes] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [generatingCompId, setGeneratingCompId] = useState<string | null>(null);

  // Fixture reopen state
  const [fixtureIdToReopen, setFixtureIdToReopen] = useState<string>('');
  const [reopenNotes, setReopenNotes] = useState<string>('');

  const loadAdminData = async () => {
    if (!user?.isAdmin) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [disputesRes, auditRes, compsRes, usersRes] = await Promise.all([
        api.getAdminDisputes('OPEN'),
        api.getAdminAuditLogs(40),
        api.getCompetitions(activeSeasonId),
        api.getAdminUsers(),
      ]);
      setDisputes(disputesRes.disputes);
      setAuditLogs(auditRes.logs);
      setCompetitions(compsRes.competitions);
      setUsers(usersRes.users);
    } catch (err: any) {
      console.error('Failed to load admin data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user?.isAdmin) {
      loadAdminData();
    } else {
      setIsLoading(false);
    }
  }, [activeSeasonId, user?.isAdmin]);

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
      showToast('Dispute resolved successfully! Standings updated.', 'success');
      setSelectedDisputeForResolve(null);
      setResolutionNotes('');
      await loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to resolve dispute.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReopenFixture = async () => {
    if (!fixtureIdToReopen.trim()) {
      showToast('Please enter a valid Fixture ID.', 'error');
      return;
    }
    setIsProcessing(true);
    try {
      await api.reopenFixture(fixtureIdToReopen.trim(), reopenNotes || 'Reopened by tournament admin');
      showToast('Fixture successfully reopened for fresh score submission.', 'success');
      setFixtureIdToReopen('');
      setReopenNotes('');
      await loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to reopen fixture.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateCompetition = async (compId: string) => {
    setGeneratingCompId(compId);
    try {
      const res = await api.generateCompetitionFixtures(compId, true);
      showToast(res.message || 'Schedule generated and persisted in Firestore.', 'success');
      await loadAdminData();
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
      await loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to reset schedule.', 'error');
    } finally {
      setGeneratingCompId(null);
    }
  };

  const handleEvaluateQualifications = async () => {
    setIsProcessing(true);
    try {
      const res = await api.evaluateSeasonQualifications(activeSeasonId);
      showToast('European qualification calculation complete!', 'success');
      await loadAdminData();
    } catch (err: any) {
      showToast(err.message || 'Failed to evaluate qualifications.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!user?.isAdmin) {
    return (
      <div className="py-16 px-4 max-w-lg mx-auto text-center animate-in fade-in duration-300">
        <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 mx-auto mb-4 shadow-xl">
          <Shield className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-black text-white">Admin Authorization Required</h3>
        <p className="text-xs text-slate-400 mt-2 leading-relaxed">
          The active account (Telegram ID: <span className="font-mono text-emerald-400 font-bold">{user?.telegramId || 'Unauthenticated'}</span>, Username: <span className="font-mono text-emerald-400 font-bold">@{user?.username || 'player'}</span>) is not listed in the <code className="text-slate-300 font-mono text-[11px] bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">ADMIN_TELEGRAM_IDS</code> configuration.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-300 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel p-4 sm:p-6 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/20 text-rose-400 border border-rose-500/30">
              Admin Control Center
            </span>
            <span className="text-[11px] text-slate-400">Authorized: @{user?.username}</span>
          </div>
          <h2 className="text-lg sm:text-2xl font-black text-white tracking-tight mt-1 flex items-center gap-2">
            <Sliders className="w-5 h-5 text-emerald-400" />
            <span>{t.adminPanel}</span>
          </h2>
        </div>

        <button
          onClick={loadAdminData}
          disabled={isLoading}
          className="self-start sm:self-auto px-3.5 py-2 glass-card text-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors shadow-md min-h-[38px] touch-manipulation"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Data</span>
        </button>
      </div>

      {/* Admin Tab Controls */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          id="tab-admin-disputes"
          onClick={() => setActiveAdminTab('disputes')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold text-xs whitespace-nowrap transition-all min-h-[38px] ${
            activeAdminTab === 'disputes'
              ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20 font-black'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <AlertTriangle className="w-4 h-4" />
          <span>{t.disputeResolutionCenter}</span>
          {disputes.length > 0 && (
            <span className="px-1.5 py-0.2 bg-white text-rose-600 rounded-full font-black text-[10px]">
              {disputes.length}
            </span>
          )}
        </button>

        <button
          id="tab-admin-fixtures"
          onClick={() => setActiveAdminTab('fixtures')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold text-xs whitespace-nowrap transition-all min-h-[38px] ${
            activeAdminTab === 'fixtures'
              ? 'btn-glass-primary text-slate-950 font-black shadow-lg shadow-emerald-500/20'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Fixture Engine</span>
        </button>

        <button
          id="tab-admin-qualification"
          onClick={() => setActiveAdminTab('qualification')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold text-xs whitespace-nowrap transition-all min-h-[38px] ${
            activeAdminTab === 'qualification'
              ? 'bg-blue-600 text-white font-black shadow-lg shadow-blue-600/20'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <Globe2 className="w-4 h-4" />
          <span>UEFA Qualification</span>
        </button>

        <button
          id="tab-admin-users"
          onClick={() => setActiveAdminTab('users')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold text-xs whitespace-nowrap transition-all min-h-[38px] ${
            activeAdminTab === 'users'
              ? 'btn-glass-primary text-slate-950 font-black shadow-lg shadow-emerald-500/20'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          <span>Players ({users.length})</span>
        </button>

        <button
          id="tab-admin-audit"
          onClick={() => setActiveAdminTab('audit')}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold text-xs whitespace-nowrap transition-all min-h-[38px] ${
            activeAdminTab === 'audit'
              ? 'btn-glass-primary text-slate-950 font-black shadow-lg shadow-emerald-500/20'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Audit Logs</span>
        </button>
      </div>

      {/* DISPUTES TAB */}
      {activeAdminTab === 'disputes' && (
        <div className="space-y-4">
          <div className="glass-panel p-4 sm:p-5 flex items-center justify-between shadow-xl">
            <div>
              <h3 className="font-bold text-xs sm:text-sm text-slate-100">{t.disputeResolutionCenter} Queue</h3>
              <p className="text-[11px] text-slate-400">
                Automatic detection triggers when two managers submit conflicting scores for the same fixture.
              </p>
            </div>
            <span className="px-3 py-1.5 rounded-xl glass-card text-xs font-black text-slate-200">
              {disputes.length} Cases
            </span>
          </div>

          {isLoading ? (
            <div className="py-20 flex flex-col items-center justify-center text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-rose-500 mb-2" />
              <span className="text-xs">{t.loading}</span>
            </div>
          ) : disputes.length === 0 ? (
            <div className="glass-panel p-10 sm:p-12 text-center shadow-xl">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-2 opacity-80" />
              <h4 className="text-sm sm:text-base font-bold text-slate-200">All Clear! No Open Disputes</h4>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                All tournament match submissions are currently verified and synchronized with consensus.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {disputes.map((dispute) => {
                const fix = dispute.fixture;

                return (
                  <div
                    key={dispute.id}
                    className="glass-panel border-rose-500/40 p-4 sm:p-6 shadow-2xl space-y-4"
                  >
                    {/* Dispute Title Bar */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-rose-500/20 text-rose-400 border border-rose-500/30">
                            SCORE CONFLICT
                          </span>
                          <span className="text-xs font-bold text-slate-300">
                            {fix?.competitionName} • {fix?.roundName || `Matchday ${fix?.matchday}`}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-0.5">Ticket ID: {dispute.id}</p>
                      </div>

                      <span className="text-[11px] text-slate-400">
                        Logged: {new Date(dispute.createdAt).toLocaleString()}
                      </span>
                    </div>

                    {/* Submissions Side-by-Side Comparison */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      {/* Home Submission Box */}
                      <div className="glass-card p-3.5">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <ClubCrest
                              clubId={fix?.homeClub?.id}
                              logoUrl={fix?.homeClub?.logoUrl}
                              name={fix?.homeClub?.name}
                              shortName={fix?.homeClub?.shortName}
                              size="xs"
                              className="w-5 h-5 shrink-0"
                            />
                            <span className="font-bold text-xs text-slate-200 truncate">
                              {fix?.homeClub?.name} (@{fix?.homeClub?.claimedByUsername || 'player'})
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500 uppercase font-bold shrink-0">Home Entry</span>
                        </div>

                        {dispute.homeSubmission ? (
                          <div className="space-y-2">
                            <div className="text-base sm:text-lg font-black text-emerald-400 bg-slate-950/80 p-2 rounded-xl border border-white/[0.06] text-center">
                              {dispute.homeSubmission.homeScore} - {dispute.homeSubmission.awayScore}
                            </div>
                            {dispute.homeSubmission.proofUrl && (
                              <a
                                href={dispute.homeSubmission.proofUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:underline"
                              >
                                <Link className="w-3.5 h-3.5" />
                                <span>View Screenshot Proof</span>
                              </a>
                            )}
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500 italic">No entry submitted</div>
                        )}
                      </div>

                      {/* Away Submission Box */}
                      <div className="glass-card p-3.5">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <ClubCrest
                              clubId={fix?.awayClub?.id}
                              logoUrl={fix?.awayClub?.logoUrl}
                              name={fix?.awayClub?.name}
                              shortName={fix?.awayClub?.shortName}
                              size="xs"
                              className="w-5 h-5 shrink-0"
                            />
                            <span className="font-bold text-xs text-slate-200 truncate">
                              {fix?.awayClub?.name} (@{fix?.awayClub?.claimedByUsername || 'player'})
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500 uppercase font-bold shrink-0">Away Entry</span>
                        </div>

                        {dispute.awaySubmission ? (
                          <div className="space-y-2">
                            <div className="text-base sm:text-lg font-black text-rose-400 bg-slate-950/80 p-2 rounded-xl border border-white/[0.06] text-center">
                              {dispute.awaySubmission.homeScore} - {dispute.awaySubmission.awayScore}
                            </div>
                            {dispute.awaySubmission.proofUrl && (
                              <a
                                href={dispute.awaySubmission.proofUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:underline"
                              >
                                <Link className="w-3.5 h-3.5" />
                                <span>View Screenshot Proof</span>
                              </a>
                            )}
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500 italic">No entry submitted</div>
                        )}
                      </div>
                    </div>

                    {/* Admin 1-Click Resolution Buttons */}
                    <div className="pt-3 border-t border-white/[0.06] flex flex-wrap items-center justify-end gap-2">
                      {dispute.homeSubmission && (
                        <button
                          disabled={isProcessing}
                          onClick={() => {
                            setSelectedDisputeForResolve(dispute);
                            handleResolveDispute('CONFIRM_HOME_SUBMISSION');
                          }}
                          className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-md transition-colors min-h-[36px] touch-manipulation"
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
                          className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-md transition-colors min-h-[36px] touch-manipulation"
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
                        className="px-3.5 py-2 glass-card text-slate-200 font-bold text-xs rounded-xl transition-colors min-h-[36px] touch-manipulation"
                      >
                        Set Custom Score
                      </button>

                      <button
                        disabled={isProcessing}
                        onClick={() => {
                          setSelectedDisputeForResolve(dispute);
                          handleResolveDispute('CANCEL_MATCH');
                        }}
                        className="px-3.5 py-2 bg-rose-950/60 hover:bg-rose-800 text-rose-200 font-bold text-xs rounded-xl border border-rose-700/50 transition-colors min-h-[36px] touch-manipulation"
                      >
                        Void / Cancel Match
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* FIXTURE ENGINE TAB */}
      {activeAdminTab === 'fixtures' && (
        <div className="space-y-5">
          {/* Reopen Fixture Tool */}
          <div className="glass-panel p-4 sm:p-6 shadow-xl space-y-4">
            <div>
              <h3 className="font-bold text-xs sm:text-sm text-slate-100">Reopen Fixture for Resubmission</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Resets a confirmed or disputed match back to scheduled state and clears prior submissions.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1">
                <input
                  type="text"
                  placeholder="Fixture ID (e.g. fix-epl-md1-01)"
                  value={fixtureIdToReopen}
                  onChange={(e) => setFixtureIdToReopen(e.target.value)}
                  className="w-full px-3 py-2 glass-input rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500 min-h-[38px]"
                />
              </div>
              <div className="sm:col-span-1">
                <input
                  type="text"
                  placeholder="Reason / Notes for audit log"
                  value={reopenNotes}
                  onChange={(e) => setReopenNotes(e.target.value)}
                  className="w-full px-3 py-2 glass-input rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500 min-h-[38px]"
                />
              </div>
              <div className="sm:col-span-1">
                <button
                  disabled={isProcessing || !fixtureIdToReopen}
                  onClick={handleReopenFixture}
                  className="w-full py-2 px-3 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-50 text-slate-950 font-black text-xs rounded-xl shadow-md transition-all min-h-[38px] touch-manipulation"
                >
                  {isProcessing ? 'Reopening...' : 'Reopen Fixture'}
                </button>
              </div>
            </div>
          </div>

          {/* Competitions Round-Robin Generators */}
          <div className="glass-panel p-4 sm:p-6 shadow-xl space-y-4">
            <div>
              <h3 className="font-bold text-xs sm:text-sm text-slate-100">Tournament Schedule Generation (Berger Algorithm)</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Generates mathematical double round-robin pairings for leagues or knockout brackets.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {competitions.map((comp) => {
                const hasGeneratedFixtures = Boolean(
                  comp.hasFixtures ||
                  (comp.fixtureCount && comp.fixtureCount > 0) ||
                  (comp.fixturesCount && comp.fixturesCount > 0) ||
                  comp.generationStatus === 'generated'
                );
                const fixtureCount = comp.fixtureCount || comp.fixturesCount || 0;

                return (
                  <div
                    key={comp.id}
                    className="p-3.5 rounded-2xl glass-card flex flex-col justify-between gap-3 shadow-inner"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-xs text-slate-200">{comp.name}</div>
                        <span className="text-[10px] text-slate-400 uppercase">
                          {comp.type} • {comp.totalTeams ?? 0} Teams
                          {hasGeneratedFixtures && ` • ${fixtureCount} fixtures`}
                        </span>
                      </div>
                      <span
                        className={`text-[9px] uppercase font-black px-2 py-0.5 rounded-full ${
                          hasGeneratedFixtures
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {hasGeneratedFixtures ? 'Generated' : 'Unscheduled'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
                      <button
                        disabled={isProcessing || generatingCompId !== null}
                        onClick={() => handleGenerateCompetition(comp.id)}
                        className={`flex-1 py-2 px-3 font-black text-xs rounded-xl transition-all disabled:opacity-50 min-h-[36px] touch-manipulation ${
                          hasGeneratedFixtures
                            ? 'glass-card text-slate-200'
                            : 'btn-glass-primary text-slate-950'
                        }`}
                      >
                        {generatingCompId === comp.id
                          ? 'Generating...'
                          : hasGeneratedFixtures
                          ? 'Regenerate'
                          : 'Generate'}
                      </button>
                      {hasGeneratedFixtures && (
                        <button
                          disabled={isProcessing || generatingCompId !== null}
                          onClick={() => handleResetCompetition(comp.id)}
                          className="py-2 px-3 bg-rose-950/50 hover:bg-rose-900/80 active:bg-rose-800 disabled:opacity-50 text-rose-300 border border-rose-800/40 font-bold text-xs rounded-xl transition-all min-h-[36px] touch-manipulation"
                          title="Delete & Reset Fixtures"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* QUALIFICATION TAB */}
      {activeAdminTab === 'qualification' && (
        <div className="glass-panel p-4 sm:p-6 shadow-xl space-y-5">
          <div>
            <h3 className="font-bold text-xs sm:text-sm text-slate-100 flex items-center gap-2">
              <Globe2 className="w-4 h-4 text-blue-400" />
              <span>UEFA European Qualification Evaluator</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-1">
              Computes domestic league rankings and cup victors to populate UEFA Champions League, Europa League, and Conference League tournament seeds.
            </p>
          </div>

          <div className="glass-card p-4 border-blue-500/30 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-slate-300">
              <span className="font-bold text-white block">Automatic UEFA Progression Engine</span>
              Run this at the end of the league season to advance qualified clubs into European phase.
            </div>

            <button
              disabled={isProcessing}
              onClick={handleEvaluateQualifications}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs rounded-xl shadow-lg shadow-blue-600/30 transition-all shrink-0 min-h-[38px] touch-manipulation"
            >
              {isProcessing ? 'Evaluating...' : 'Evaluate & Seed European Cups'}
            </button>
          </div>
        </div>
      )}

      {/* USERS TAB */}
      {activeAdminTab === 'users' && (
        <div className="glass-panel shadow-xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-white/[0.06] flex items-center justify-between">
            <h3 className="font-bold text-xs sm:text-sm text-slate-100">Registered Telegram Players</h3>
            <span className="text-xs text-slate-400">{users.length} Users</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse min-w-[320px]">
              <thead>
                <tr className="border-b border-white/[0.06] text-[10px] font-black text-slate-400 uppercase">
                  <th className="py-2.5 px-3">User</th>
                  <th className="py-2.5 px-3 hidden sm:table-cell">Telegram ID</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 hidden sm:table-cell">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-white/[0.03]">
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-slate-200">@{u.username}</div>
                      <div className="text-[10px] text-slate-400">{u.firstName} {u.lastName}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px] hidden sm:table-cell">{u.telegramId}</td>
                    <td className="py-2.5 px-3">
                      {u.isAdmin ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          Admin
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400">
                          Player
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      {u.isSuspended ? (
                        <span className="text-rose-400 font-bold">Suspended</span>
                      ) : (
                        <span className="text-emerald-400 font-bold">Active</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 text-[11px] hidden sm:table-cell">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AUDIT LOGS TAB */}
      {activeAdminTab === 'audit' && (
        <div className="glass-panel shadow-xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-white/[0.06] flex items-center justify-between">
            <h3 className="font-bold text-xs sm:text-sm text-slate-100">Audit Trail & Action Logs</h3>
            <span className="text-xs text-slate-400">{auditLogs.length} Records</span>
          </div>

          <div className="divide-y divide-white/[0.04] max-h-[600px] overflow-y-auto">
            {auditLogs.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-xs">No audit records logged yet.</div>
            ) : (
              auditLogs.map((log) => (
                <div key={log.id} className="p-3.5 hover:bg-white/[0.02] transition-colors text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-indigo-400 bg-indigo-950/50 px-2 py-0.5 rounded border border-indigo-500/30 text-[10px]">
                      {log.action}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-slate-300 text-xs">
                    Target: <strong className="text-white">{log.targetType} ({log.targetId})</strong> • Actor ID: {log.actorId}
                  </div>
                  {log.notes && <p className="text-slate-400 text-[11px] italic">Notes: {log.notes}</p>}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Manual Resolution Modal */}
      {selectedDisputeForResolve && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="glass-modal w-full max-w-md shadow-2xl p-5 text-white space-y-4">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h3 className="font-bold text-sm sm:text-base text-slate-100">Set Custom Score Resolution</h3>
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
                  {selectedDisputeForResolve.fixture?.homeClub?.shortName || 'Home'} Score
                </label>
                <input
                  type="number"
                  min="0"
                  value={manualHomeScore}
                  onChange={(e) => setManualHomeScore(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full px-3 py-2 glass-input rounded-xl text-center text-xl font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1 truncate">
                  {selectedDisputeForResolve.fixture?.awayClub?.shortName || 'Away'} Score
                </label>
                <input
                  type="number"
                  min="0"
                  value={manualAwayScore}
                  onChange={(e) => setManualAwayScore(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full px-3 py-2 glass-input rounded-xl text-center text-xl font-bold"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Admin Ruling Justification / Notes
              </label>
              <textarea
                placeholder="e.g. Verified by final match video screenshot."
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 glass-input rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setSelectedDisputeForResolve(null)}
                className="flex-1 py-2.5 glass-button text-slate-300 font-semibold rounded-xl text-xs"
              >
                Cancel
              </button>
              <button
                disabled={isProcessing}
                onClick={() => handleResolveDispute('MANUAL_SCORE')}
                className="flex-1 py-2.5 btn-glass-primary text-slate-950 font-black rounded-xl text-xs shadow-lg"
              >
                {isProcessing ? 'Applying Ruling...' : 'Confirm Ruling'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
