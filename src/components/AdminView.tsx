import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Dispute, AuditLog, Competition, User } from '../types';
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
    <div className="space-y-6 animate-in fade-in duration-300 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/20 text-rose-400 border border-rose-500/30">
              Admin Control Center
            </span>
            <span className="text-xs text-slate-400">Authorized Admin: @{user?.username}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight mt-1 flex items-center gap-2">
            <Sliders className="w-6 h-6 text-emerald-400" />
            <span>{t.adminPanel}</span>
          </h2>
        </div>

        <button
          onClick={loadAdminData}
          disabled={isLoading}
          className="self-start md:self-auto px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-2xl text-xs font-bold flex items-center gap-2 transition-colors border border-slate-700 shadow-md"
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
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-xs transition-all ${
            activeAdminTab === 'disputes'
              ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20 font-black'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
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
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-xs transition-all ${
            activeAdminTab === 'fixtures'
              ? 'bg-emerald-500 text-slate-950 font-black shadow-lg shadow-emerald-500/20'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Fixture Engine</span>
        </button>

        <button
          id="tab-admin-qualification"
          onClick={() => setActiveAdminTab('qualification')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-xs transition-all ${
            activeAdminTab === 'qualification'
              ? 'bg-blue-600 text-white font-black shadow-lg shadow-blue-600/20'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Globe2 className="w-4 h-4" />
          <span>UEFA Qualification</span>
        </button>

        <button
          id="tab-admin-users"
          onClick={() => setActiveAdminTab('users')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-xs transition-all ${
            activeAdminTab === 'users'
              ? 'bg-emerald-500 text-slate-950 font-black shadow-lg shadow-emerald-500/20'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <UserCheck className="w-4 h-4" />
          <span>Players ({users.length})</span>
        </button>

        <button
          id="tab-admin-audit"
          onClick={() => setActiveAdminTab('audit')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-xs transition-all ${
            activeAdminTab === 'audit'
              ? 'bg-emerald-500 text-slate-950 font-black shadow-lg shadow-emerald-500/20'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Audit Logs</span>
        </button>
      </div>

      {/* DISPUTES TAB */}
      {activeAdminTab === 'disputes' && (
        <div className="space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 flex items-center justify-between shadow-xl">
            <div>
              <h3 className="font-bold text-sm text-slate-100">{t.disputeResolutionCenter} Queue</h3>
              <p className="text-xs text-slate-400">
                Automatic detection triggers when two managers submit conflicting scores for the same fixture.
              </p>
            </div>
            <span className="px-3 py-1.5 rounded-xl bg-slate-800 text-xs font-black text-slate-200 border border-slate-700">
              {disputes.length} Open Cases
            </span>
          </div>

          {isLoading ? (
            <div className="py-20 flex flex-col items-center justify-center text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin text-rose-500 mb-2" />
              <span className="text-xs">{t.loading}</span>
            </div>
          ) : disputes.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center shadow-xl">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-2 opacity-80" />
              <h4 className="text-base font-bold text-slate-200">All Clear! No Open Disputes</h4>
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
                    className="bg-slate-900 border border-rose-500/30 rounded-3xl p-6 shadow-2xl space-y-4"
                  >
                    {/* Dispute Title Bar */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-rose-500/20 text-rose-400 border border-rose-500/30">
                            SCORE CONFLICT
                          </span>
                          <span className="text-xs font-bold text-slate-300">
                            {fix?.competitionName} • {fix?.roundName || `Matchday ${fix?.matchday}`}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">Ticket ID: {dispute.id}</p>
                      </div>

                      <span className="text-xs text-slate-400">
                        Logged: {new Date(dispute.createdAt).toLocaleString()}
                      </span>
                    </div>

                    {/* Submissions Side-by-Side Comparison */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Home Submission Box */}
                      <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <img
                              src={fix?.homeClub?.logoUrl}
                              alt={fix?.homeClub?.name}
                              className="w-5 h-5 object-contain"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                            <span className="font-bold text-xs text-slate-200">
                              {fix?.homeClub?.name} (@{fix?.homeClub?.claimedByUsername || 'player'})
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500 uppercase font-bold">Home Entry</span>
                        </div>

                        {dispute.homeSubmission ? (
                          <div className="space-y-2">
                            <div className="text-lg font-black text-emerald-400 bg-slate-900 p-2 rounded-xl border border-slate-800 text-center">
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
                      <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <img
                              src={fix?.awayClub?.logoUrl}
                              alt={fix?.awayClub?.name}
                              className="w-5 h-5 object-contain"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                            <span className="font-bold text-xs text-slate-200">
                              {fix?.awayClub?.name} (@{fix?.awayClub?.claimedByUsername || 'player'})
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500 uppercase font-bold">Away Entry</span>
                        </div>

                        {dispute.awaySubmission ? (
                          <div className="space-y-2">
                            <div className="text-lg font-black text-rose-400 bg-slate-900 p-2 rounded-xl border border-slate-800 text-center">
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
                    <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-end gap-2.5">
                      {dispute.homeSubmission && (
                        <button
                          disabled={isProcessing}
                          onClick={() => {
                            setSelectedDisputeForResolve(dispute);
                            handleResolveDispute('CONFIRM_HOME_SUBMISSION');
                          }}
                          className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-md transition-colors"
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
                          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-md transition-colors"
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
                        className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 transition-colors"
                      >
                        Set Custom Score
                      </button>

                      <button
                        disabled={isProcessing}
                        onClick={() => {
                          setSelectedDisputeForResolve(dispute);
                          handleResolveDispute('CANCEL_MATCH');
                        }}
                        className="px-4 py-2.5 bg-rose-900/60 hover:bg-rose-800 text-rose-200 font-bold text-xs rounded-xl border border-rose-700/50 transition-colors"
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
        <div className="space-y-6">
          {/* Reopen Fixture Tool */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <div>
              <h3 className="font-bold text-sm text-slate-100">Reopen Fixture for Resubmission</h3>
              <p className="text-xs text-slate-400 mt-0.5">
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
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="sm:col-span-1">
                <input
                  type="text"
                  placeholder="Reason / Notes for audit log"
                  value={reopenNotes}
                  onChange={(e) => setReopenNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="sm:col-span-1">
                <button
                  disabled={isProcessing || !fixtureIdToReopen}
                  onClick={handleReopenFixture}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-50 text-slate-950 font-black text-xs rounded-xl shadow-md transition-all"
                >
                  {isProcessing ? 'Reopening...' : 'Reopen Fixture'}
                </button>
              </div>
            </div>
          </div>

          {/* Competitions Round-Robin Generators */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
            <div>
              <h3 className="font-bold text-sm text-slate-100">Tournament Schedule Generation (Berger Algorithm)</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Generates mathematical double round-robin pairings for leagues or knockout brackets.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {competitions.map((comp) => (
                <div
                  key={comp.id}
                  className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 flex flex-col justify-between gap-3 shadow-inner"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-bold text-xs text-slate-200">{comp.name}</div>
                      <span className="text-[10px] text-slate-500 uppercase">{comp.type} • {comp.totalTeams} Teams</span>
                    </div>
                    <span className={`text-[9px] uppercase font-black px-2 py-0.5 rounded-full ${comp.status === 'active' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'}`}>
                      {comp.status}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                    <button
                      disabled={isProcessing || generatingCompId !== null}
                      onClick={() => handleGenerateCompetition(comp.id)}
                      className="flex-1 py-1.5 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 text-slate-950 font-black text-xs rounded-xl transition-all"
                    >
                      {generatingCompId === comp.id
                        ? 'Generating...'
                        : comp.hasFixtures
                        ? 'Regenerate'
                        : 'Generate'}
                    </button>
                    {comp.hasFixtures && (
                      <button
                        disabled={isProcessing || generatingCompId !== null}
                        onClick={() => handleResetCompetition(comp.id)}
                        className="py-1.5 px-2.5 bg-rose-950/50 hover:bg-rose-900/80 active:bg-rose-800 disabled:opacity-50 text-rose-300 border border-rose-800/40 font-bold text-xs rounded-xl transition-all"
                        title="Delete & Reset Fixtures"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* QUALIFICATION TAB */}
      {activeAdminTab === 'qualification' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
          <div>
            <h3 className="font-bold text-sm text-slate-100 flex items-center gap-2">
              <Globe2 className="w-5 h-5 text-blue-400" />
              <span>UEFA European Qualification Evaluator</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Computes domestic league rankings and cup victors to populate UEFA Champions League, Europa League, and Conference League tournament seeds.
            </p>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-blue-500/30 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="text-xs text-slate-300">
              <span className="font-bold text-white block">Automatic UEFA Progression Engine</span>
              Run this at the end of the league season to advance qualified clubs into European phase.
            </div>

            <button
              disabled={isProcessing}
              onClick={handleEvaluateQualifications}
              className="px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs rounded-xl shadow-lg shadow-blue-600/30 transition-all shrink-0"
            >
              {isProcessing ? 'Evaluating...' : 'Evaluate & Seed European Cups'}
            </button>
          </div>
        </div>
      )}

      {/* USERS TAB */}
      {activeAdminTab === 'users' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl shadow-xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-100">Registered Telegram Players</h3>
            <span className="text-xs text-slate-400">{users.length} Users</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950/70 border-b border-slate-800 text-[11px] font-bold text-slate-400 uppercase">
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Telegram ID</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-800/40">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-200">@{u.username}</div>
                      <div className="text-[10px] text-slate-400">{u.firstName} {u.lastName}</div>
                    </td>
                    <td className="py-3 px-4 text-slate-400 font-mono text-[11px]">{u.telegramId}</td>
                    <td className="py-3 px-4">
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
                    <td className="py-3 px-4">
                      {u.isSuspended ? (
                        <span className="text-rose-400 font-bold">Suspended</span>
                      ) : (
                        <span className="text-emerald-400 font-bold">Active</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-500 text-[11px]">
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
        <div className="bg-slate-900 border border-slate-800 rounded-3xl shadow-xl overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-100">Audit Trail & Action Logs</h3>
            <span className="text-xs text-slate-400">{auditLogs.length} Records</span>
          </div>

          <div className="divide-y divide-slate-800/60 max-h-[600px] overflow-y-auto">
            {auditLogs.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-xs">No audit records logged yet.</div>
            ) : (
              auditLogs.map((log) => (
                <div key={log.id} className="p-4 hover:bg-slate-800/30 transition-colors text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-indigo-400 bg-indigo-950/50 px-2 py-0.5 rounded border border-indigo-500/30 text-[11px]">
                      {log.action}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-slate-300">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-md shadow-2xl p-6 text-white space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-base text-slate-100">Set Custom Score Resolution</h3>
              <button
                onClick={() => setSelectedDisputeForResolve(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  {selectedDisputeForResolve.fixture?.homeClub?.shortName || 'Home'} Score
                </label>
                <input
                  type="number"
                  min="0"
                  value={manualHomeScore}
                  onChange={(e) => setManualHomeScore(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-center text-xl font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  {selectedDisputeForResolve.fixture?.awayClub?.shortName || 'Away'} Score
                </label>
                <input
                  type="number"
                  min="0"
                  value={manualAwayScore}
                  onChange={(e) => setManualAwayScore(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-center text-xl font-bold"
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
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setSelectedDisputeForResolve(null)}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs"
              >
                Cancel
              </button>
              <button
                disabled={isProcessing}
                onClick={() => handleResolveDispute('MANUAL_SCORE')}
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-black rounded-xl text-xs shadow-lg"
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
