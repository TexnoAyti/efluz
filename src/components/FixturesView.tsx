import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useUserProfile } from '../context/UserProfileContext';
import { useI18n } from '../i18n';
import { api, invalidateClientCache } from '../lib/api';
import { Competition, Fixture } from '../types';
import { ResultSubmissionModal } from './ResultSubmissionModal';
import { ClubCrest } from './ClubCrest';
import { MatchdayCountdown } from './MatchdayCountdown';
import { getClubOwnerDisplay } from '../lib/ownerUtils';
import { openTelegramChat, isValidTelegramUsername } from '../lib/telegramUtils';
import {
  Calendar,
  Trophy,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Shield,
  Loader2,
  Sparkles,
  Search,
  RefreshCw,
  Lock,
  Send,
} from 'lucide-react';

export const FixturesView: React.FC = () => {
  const { user, currentClub, activeSeasonId, showToast } = useAuth();
  const { openUserProfile } = useUserProfile();
  const { t } = useI18n();

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string>('comp-premier-league-2026');
  const [selectedMatchday, setSelectedMatchday] = useState<number>(1);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'ALL' | 'MY_MATCHES' | 'PENDING' | 'DISPUTED' | 'CONFIRMED'>('ALL');
  const [selectedFixtureForSubmit, setSelectedFixtureForSubmit] = useState<Fixture | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lockStates, setLockStates] = useState<Record<string, Record<number, { isOpen: boolean; isLocked: boolean; overrideStatus: string }>>>({});

  // Reset selected matchday to active competition's currentMatchday when switching competitions
  const prevCompIdRef = useRef<string>(selectedCompetitionId);
  useEffect(() => {
    if (selectedCompetitionId && selectedCompetitionId !== prevCompIdRef.current) {
      prevCompIdRef.current = selectedCompetitionId;
      const comp = competitions.find((c) => c.id === selectedCompetitionId);
      if (comp) {
        setSelectedMatchday(comp.currentMatchday || 1);
      }
    }
  }, [selectedCompetitionId, competitions]);

  // Fetch isolated locks for selected competition
  useEffect(() => {
    if (!selectedCompetitionId) return;
    let isMounted = true;
    api.getCompetitionLocks(selectedCompetitionId, activeSeasonId)
      .then((res) => {
        if (isMounted && res.locks) {
          setLockStates((prev) => ({
            ...prev,
            [selectedCompetitionId]: res.locks,
          }));
        }
      })
      .catch((err) => {
        console.warn('Failed to load competition locks:', err);
      });
    return () => {
      isMounted = false;
    };
  }, [selectedCompetitionId, activeSeasonId]);

  // Load competitions
  useEffect(() => {
    async function loadComps() {
      setIsLoading(true);
      try {
        const res = await api.getCompetitions(activeSeasonId);
        setCompetitions(res.competitions || []);
        if (res.competitions && res.competitions.length > 0) {
          const defaultComp = res.competitions.find((c) => c.type === 'LEAGUE') || res.competitions[0];
          setSelectedCompetitionId(defaultComp.id);
        } else {
          setIsLoading(false);
        }
      } catch (err: any) {
        console.error('Failed to load competitions:', err);
        setError(err.message || 'Failed to load competitions.');
        setIsLoading(false);
      }
    }
    loadComps();
  }, [activeSeasonId]);

  const activeComp = competitions.find((c) => c.id === selectedCompetitionId);
  const totalMatchdays =
    activeComp?.totalMatchdays ||
    (activeComp?.type === 'LEAGUE'
      ? activeComp.totalTeams === 18 || activeComp.leagueId?.includes('bundesliga') || activeComp.leagueId?.includes('ligue-1')
        ? 17
        : 19
      : activeComp?.type === 'EUROPEAN_LEAGUE_PHASE'
      ? 8
      : 1);

  const isMatchdayLocked = (md: number): boolean => {
    if (!activeComp) return false;
    const isKnockout =
      activeComp.type === 'KNOCKOUT' ||
      activeComp.type === 'SUPER_CUP' ||
      activeComp.type === 'EUROPEAN_KNOCKOUT';
    const compLocks = lockStates[selectedCompetitionId];
    if (compLocks && compLocks[md]) {
      const lock = compLocks[md];
      if (lock.overrideStatus === 'FORCE_OPEN' || lock.isOpen === true) return false;
      if (lock.overrideStatus === 'FORCE_LOCKED' || lock.overrideStatus === 'PAUSED' || lock.isLocked || lock.isOpen === false) return true;
    }
    if (activeComp.adminOverrideStatus === 'FORCE_LOCKED' || activeComp.adminOverrideStatus === 'PAUSED') return true;
    if (activeComp.adminOverrideStatus === 'FORCE_OPEN') return isKnockout ? false : md !== (activeComp.currentMatchday || 1);
    if (activeComp.isMatchdayOpen === false) return true;
    if (isKnockout) return false;
    return md !== (activeComp.currentMatchday || 1);
  };

  const loadFixtures = async (skipCache = false) => {
    if (!selectedCompetitionId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const matchdayParam = activeComp?.type === 'LEAGUE' ? selectedMatchday : undefined;
      const res = await api.getCompetitionFixtures(selectedCompetitionId, matchdayParam, undefined, skipCache);
      setFixtures(res.fixtures || []);
    } catch (err: any) {
      console.error('Failed to load fixtures:', err);
      setError(err.message || 'Failed to load fixtures. Please check your connection.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadFixtures();
  }, [selectedCompetitionId, selectedMatchday, activeSeasonId, user?.id]);

  const handleGenerateFixtures = async () => {
    if (!selectedCompetitionId) return;
    setIsGenerating(true);
    try {
      const res = await api.generateCompetitionFixtures(selectedCompetitionId);
      showToast(res.message || 'Berger round-robin schedule generated!', 'success');
      invalidateClientCache('/api/competitions');
      invalidateClientCache('/api/fixtures');
      await loadFixtures(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to generate schedule.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const filteredFixtures = fixtures.filter((f) => {
    const isMyMatch = f.homeOwnerId === user?.id || f.awayOwnerId === user?.id || f.homeClubId === currentClub?.id || f.awayClubId === currentClub?.id;
    if (filterMode === 'MY_MATCHES') return isMyMatch;
    if (filterMode === 'PENDING') return f.status === 'PENDING_CONFIRMATION' || f.status === 'AWAITING_RESULT' || f.status === 'SCHEDULED';
    if (filterMode === 'DISPUTED') return f.status === 'DISPUTED';
    if (filterMode === 'CONFIRMED') return f.status === 'CONFIRMED';
    return true;
  });

  const getStatusBadge = (status: Fixture['status']) => {
    switch (status) {
      case 'CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" /> Confirmed
          </span>
        );
      case 'PENDING_CONFIRMATION':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse">
            <Clock className="w-3 h-3" /> Awaiting 2nd Submission
          </span>
        );
      case 'DISPUTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
            <AlertTriangle className="w-3 h-3" /> In Dispute Review
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
            <Calendar className="w-3 h-3" /> Scheduled
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-16">
      {/* Top Header & Competition Picker */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel p-4 sm:p-5 shadow-xl">
        <div>
          <h2 className="text-base sm:text-xl font-black text-white tracking-tight flex items-center gap-2">
            <Calendar className="w-5 h-5 text-emerald-400" />
            <span>Fixtures & Results</span>
          </h2>
          <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
            Browse match schedules, submit match scores, and verify results.
          </p>
        </div>

        {/* Competition Dropdown */}
        <div className="w-full sm:w-72">
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">
            Select Competition
          </label>
          <select
            id="select-competition-filter"
            value={selectedCompetitionId}
            onChange={(e) => {
              setSelectedCompetitionId(e.target.value);
              setSelectedMatchday(1);
            }}
            className="w-full px-3 py-2 glass-input rounded-xl text-xs font-bold text-white focus:outline-none focus:border-emerald-500 min-h-[38px]"
          >
            {competitions.map((comp) => (
              <option key={comp.id} value={comp.id} className="bg-slate-900 text-white">
                {comp.name} ({comp.type})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Matchday Stepper (For League competitions) */}
      {activeComp?.type === 'LEAGUE' && (
        <div className="glass-panel p-3 sm:p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedMatchday((prev) => Math.max(1, prev - 1))}
              disabled={selectedMatchday <= 1}
              className="p-2 rounded-xl glass-card text-white disabled:opacity-30 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center touch-manipulation"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="text-center px-3 min-w-[130px]">
              <div className="flex items-center justify-center gap-1.5 mb-0.5">
                <span className="text-[9px] uppercase font-black text-slate-400">Matchday</span>
                {!isMatchdayLocked(selectedMatchday) ? (
                  <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    OPEN
                  </span>
                ) : (
                  <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                    <Lock className="w-2.5 h-2.5" />
                    <span>LOCKED</span>
                  </span>
                )}
              </div>
              <span className="text-sm sm:text-base font-black text-white">
                {selectedMatchday} <span className="text-slate-500 font-normal text-xs">/ {totalMatchdays}</span>
              </span>
              {isMatchdayLocked(selectedMatchday) && activeComp.nextMatchdayOpenAt && (
                <div className="text-[10px] text-amber-300 font-mono mt-0.5 flex items-center justify-center gap-1">
                  <MatchdayCountdown targetIso={activeComp.nextMatchdayOpenAt} />
                </div>
              )}
            </div>

            <button
              onClick={() => setSelectedMatchday((prev) => Math.min(totalMatchdays, prev + 1))}
              disabled={selectedMatchday >= totalMatchdays}
              className="p-2 rounded-xl glass-card text-white disabled:opacity-30 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center touch-manipulation"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Matchday Pills Selector with OPEN/LOCKED indicator */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 sm:pb-0 scrollbar-none">
            {Array.from({ length: totalMatchdays }, (_, i) => i + 1).map((md) => {
              const isSelected = selectedMatchday === md;
              const isLocked = isMatchdayLocked(md);
              return (
                <button
                  key={md}
                  onClick={() => setSelectedMatchday(md)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 min-h-[32px] flex items-center gap-1 ${
                    isSelected
                      ? 'btn-glass-primary text-slate-950 font-black'
                      : isLocked
                      ? 'glass-card text-slate-500 hover:text-slate-300'
                      : 'glass-card text-slate-300 hover:text-white'
                  }`}
                >
                  {isLocked && <Lock className="w-2.5 h-2.5 text-slate-500" />}
                  <span>MD {md}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setFilterMode('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all min-h-[36px] ${
              filterMode === 'ALL'
                ? 'bg-slate-800 text-white border border-slate-600'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Fixtures ({fixtures.length})
          </button>
          <button
            onClick={() => setFilterMode('MY_MATCHES')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all min-h-[36px] ${
              filterMode === 'MY_MATCHES'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            My Matches
          </button>
          <button
            onClick={() => setFilterMode('PENDING')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all min-h-[36px] ${
              filterMode === 'PENDING'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Pending
          </button>
          <button
            onClick={() => setFilterMode('DISPUTED')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all min-h-[36px] ${
              filterMode === 'DISPUTED'
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Disputes
          </button>
          <button
            onClick={() => setFilterMode('CONFIRMED')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all min-h-[36px] ${
              filterMode === 'CONFIRMED'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Confirmed
          </button>
        </div>

        {/* Generate Berger schedule button if 0 fixtures */}
        {fixtures.length === 0 && !isLoading && (
          <button
            disabled={isGenerating}
            onClick={handleGenerateFixtures}
            className="px-4 py-2 rounded-xl btn-glass-primary text-slate-950 font-black text-xs shadow-md flex items-center gap-1.5 min-h-[38px] touch-manipulation"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-950" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-slate-950" />
                <span>Generate Official Berger Schedule</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Error State */}
      {error && fixtures.length === 0 && !isLoading && (
        <div className="p-6 rounded-2xl glass-panel border-rose-500/30 bg-rose-950/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-rose-200 text-xs shadow-xl">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <div className="font-bold text-sm text-white">Couldn't load data</div>
              <div className="text-xs text-rose-300/80 mt-0.5">Please try again.</div>
            </div>
          </div>
          <button
            onClick={() => loadFixtures(true)}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center gap-1.5 shrink-0 shadow-md transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Fixtures List */}
      {isLoading && fixtures.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 animate-pulse">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-36 rounded-2xl bg-white/[0.04] border border-white/[0.06]" />
          ))}
        </div>
      ) : filteredFixtures.length === 0 ? (
        <div className="py-16 text-center glass-panel shadow-xl rounded-2xl border border-white/[0.06]">
          <Calendar className="w-10 h-10 text-slate-500 mx-auto mb-2 opacity-60" />
          <h4 className="text-sm font-bold text-slate-200">No fixtures found</h4>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            No fixtures match this filter.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filteredFixtures.map((fixture) => {
            const isHomeUser = fixture.homeOwnerId === user?.id || fixture.homeClubId === currentClub?.id;
            const isAwayUser = fixture.awayOwnerId === user?.id || fixture.awayClubId === currentClub?.id;
            const isUserParticipant = isHomeUser || isAwayUser;

            return (
              <div
                key={fixture.id}
                className={`glass-panel p-3.5 sm:p-4 flex flex-col justify-between shadow-lg transition-all ${
                  isUserParticipant
                    ? 'border-emerald-500/50 bg-emerald-950/20 shadow-emerald-500/10'
                    : 'hover:border-white/[0.15]'
                }`}
              >
                {/* Header status */}
                <div>
                  <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 mb-2.5 text-xs">
                    <span className="font-semibold text-slate-400 text-[11px]">
                      {fixture.roundName || `Matchday ${fixture.matchday}`}
                    </span>
                    {getStatusBadge(fixture.status)}
                  </div>

                  {/* Matchup row */}
                  <div className="grid grid-cols-7 items-center gap-2 text-center py-1.5">
                    {/* Home Club */}
                    <div className="col-span-3 flex flex-col items-center min-w-0">
                      <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-slate-950/80 p-1.5 border border-white/[0.08] flex items-center justify-center mb-1 shadow-inner shrink-0">
                        <ClubCrest
                          clubId={fixture.homeClub?.id}
                          logoUrl={fixture.homeClub?.logoUrl}
                          name={fixture.homeClub?.name}
                          shortName={fixture.homeClub?.shortName}
                          size="md"
                          className="w-7 h-7"
                        />
                      </div>
                      <span className={`font-bold text-xs truncate max-w-full ${isHomeUser ? 'text-emerald-400 font-black' : 'text-slate-200'}`}>
                        {fixture.homeClub?.name}
                      </span>
                      {isHomeUser ? (
                        <span className="text-[10px] text-emerald-400 font-bold truncate max-w-full mt-0.5">
                          (You)
                        </span>
                      ) : (() => {
                        const homeOwnerInfo = getClubOwnerDisplay(fixture.homeClub, fixture.homeUser, fixture.homeOwnerId, t.userNeeded);
                        if (homeOwnerInfo.isClaimed) {
                          return homeOwnerInfo.userId ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openUserProfile(homeOwnerInfo.userId!);
                              }}
                              className="text-[10px] text-slate-300 hover:text-emerald-400 font-bold truncate max-w-[120px] transition-colors mt-0.5 underline decoration-slate-600 hover:decoration-emerald-500 underline-offset-2"
                            >
                              {homeOwnerInfo.displayText}
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-300 font-bold truncate max-w-[120px] mt-0.5">
                              {homeOwnerInfo.displayText}
                            </span>
                          );
                        }
                        return (
                          <span className="text-[10px] text-amber-400/90 font-bold truncate max-w-full mt-0.5">
                            {t.userNeeded}
                          </span>
                        );
                      })()}
                    </div>

                    {/* Score / VS Center */}
                    <div className="col-span-1 flex flex-col items-center justify-center">
                      {fixture.status === 'CONFIRMED' ? (
                        <div className="text-lg sm:text-xl font-black text-emerald-400 tracking-tight">
                          {fixture.homeScore} - {fixture.awayScore}
                        </div>
                      ) : fixture.status === 'DISPUTED' ? (
                        <div className="text-[10px] font-black text-rose-400 bg-rose-500/15 px-2 py-0.5 rounded-lg border border-rose-500/30">
                          DISPUTE
                        </div>
                      ) : (
                        <div className="w-7 h-7 rounded-full glass-card text-slate-400 text-[10px] font-black flex items-center justify-center">
                          VS
                        </div>
                      )}
                    </div>

                    {/* Away Club */}
                    <div className="col-span-3 flex flex-col items-center min-w-0">
                      <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-slate-950/80 p-1.5 border border-white/[0.08] flex items-center justify-center mb-1 shadow-inner shrink-0">
                        <ClubCrest
                          clubId={fixture.awayClub?.id}
                          logoUrl={fixture.awayClub?.logoUrl}
                          name={fixture.awayClub?.name}
                          shortName={fixture.awayClub?.shortName}
                          size="md"
                          className="w-7 h-7"
                        />
                      </div>
                      <span className={`font-bold text-xs truncate max-w-full ${isAwayUser ? 'text-emerald-400 font-black' : 'text-slate-200'}`}>
                        {fixture.awayClub?.name}
                      </span>
                      {isAwayUser ? (
                        <span className="text-[10px] text-emerald-400 font-bold truncate max-w-full mt-0.5">
                          (You)
                        </span>
                      ) : (() => {
                        const awayOwnerInfo = getClubOwnerDisplay(fixture.awayClub, fixture.awayUser, fixture.awayOwnerId, t.userNeeded);
                        if (awayOwnerInfo.isClaimed) {
                          return awayOwnerInfo.userId ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openUserProfile(awayOwnerInfo.userId!);
                              }}
                              className="text-[10px] text-slate-300 hover:text-emerald-400 font-bold truncate max-w-[120px] transition-colors mt-0.5 underline decoration-slate-600 hover:decoration-emerald-500 underline-offset-2"
                            >
                              {awayOwnerInfo.displayText}
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-300 font-bold truncate max-w-[120px] mt-0.5">
                              {awayOwnerInfo.displayText}
                            </span>
                          );
                        }
                        return (
                          <span className="text-[10px] text-amber-400/90 font-bold truncate max-w-full mt-0.5">
                            {t.userNeeded}
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Submission details banner if pending */}
                  {fixture.status === 'PENDING_CONFIRMATION' && (
                    <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[10px] text-amber-300 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>1 manager submitted. Waiting for 2nd submission.</span>
                      </div>
                    </div>
                  )}

                  {/* Dispute warning if disputed */}
                  {fixture.status === 'DISPUTED' && (
                    <div className="mt-2 p-2 bg-rose-500/10 border border-rose-500/20 rounded-xl text-[10px] text-rose-300 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Score discrepancy detected. Admin review in progress.</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom CTA Action Button */}
                <div className="pt-2.5 border-t border-white/[0.06] mt-2.5 flex items-center justify-between gap-2">
                  <div className="text-[10px] text-slate-500 truncate">
                    {fixture.status === 'CONFIRMED'
                      ? 'Verified & Saved'
                      : fixture.isPlayable === false
                      ? `Matchday ${fixture.matchday} Qulflangan`
                      : fixture.userSubmission
                      ? `Your input: ${fixture.userSubmission.homeScore}-${fixture.userSubmission.awayScore}`
                      : 'Pending Score'}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {(() => {
                      if (!isUserParticipant) return null;
                      const oppUsername = isHomeUser
                        ? (fixture.awayUser?.username || fixture.awayClub?.claimedByUsername)
                        : (fixture.homeUser?.username || fixture.homeClub?.claimedByUsername);
                      if (!isValidTelegramUsername(oppUsername)) return null;
                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openTelegramChat(oppUsername);
                          }}
                          className="px-2.5 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all min-h-[34px] touch-manipulation bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 shadow-sm"
                        >
                          <Send className="w-3 h-3" />
                          <span>Raqibga yozish</span>
                        </button>
                      );
                    })()}

                    {fixture.status === 'CONFIRMED' ? (
                      <button
                        id={`btn-fixture-details-${fixture.id}`}
                        onClick={() => setSelectedFixtureForSubmit(fixture)}
                        className="px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all min-h-[34px] touch-manipulation shrink-0 glass-card text-slate-300"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Details</span>
                      </button>
                    ) : (fixture.isPlayable === false || isMatchdayLocked(fixture.matchday)) ? (
                      <button
                        disabled={true}
                        className="px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all min-h-[34px] touch-manipulation shrink-0 bg-slate-800/70 text-slate-500 border border-slate-700/60 cursor-not-allowed"
                      >
                        <Lock className="w-3.5 h-3.5 text-slate-500" />
                        <span>Qulflangan</span>
                      </button>
                    ) : (
                      <button
                        id={`btn-fixture-submit-${fixture.id}`}
                        onClick={() => setSelectedFixtureForSubmit(fixture)}
                        className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all min-h-[34px] touch-manipulation shrink-0 ${
                          isUserParticipant
                            ? 'btn-glass-primary text-slate-950 font-black'
                            : 'glass-card text-slate-200'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{fixture.userSubmission ? 'Update' : 'Submit'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Result Submission Modal */}
      {selectedFixtureForSubmit && (
        <ResultSubmissionModal
          fixture={selectedFixtureForSubmit}
          isOpen={true}
          onClose={() => setSelectedFixtureForSubmit(null)}
          onSuccess={() => {
            invalidateClientCache('/api/fixtures');
            invalidateClientCache('/api/standings');
            loadFixtures(true);
          }}
        />
      )}
    </div>
  );
};
