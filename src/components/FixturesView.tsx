import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api, invalidateClientCache } from '../lib/api';
import { Competition, Fixture } from '../types';
import { ResultSubmissionModal } from './ResultSubmissionModal';
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
} from 'lucide-react';

export const FixturesView: React.FC = () => {
  const { user, currentClub, activeSeasonId, showToast } = useAuth();

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string>('comp-premier-league-2026');
  const [selectedMatchday, setSelectedMatchday] = useState<number>(1);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'ALL' | 'MY_MATCHES' | 'PENDING' | 'DISPUTED' | 'CONFIRMED'>('ALL');
  const [selectedFixtureForSubmit, setSelectedFixtureForSubmit] = useState<Fixture | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

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
  const totalMatchdays = activeComp?.type === 'LEAGUE' ? (activeComp.totalTeams === 18 ? 34 : 38) : 1;

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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Calendar className="w-6 h-6 text-emerald-400" />
            <span>Fixtures & Results</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Browse match schedules, submit match scores, and verify results.
          </p>
        </div>

        {/* Competition Dropdown */}
        <div className="w-full sm:w-72">
          <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            Select Competition
          </label>
          <select
            id="select-competition-filter"
            value={selectedCompetitionId}
            onChange={(e) => {
              setSelectedCompetitionId(e.target.value);
              setSelectedMatchday(1);
            }}
            className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-xs font-bold text-white focus:outline-none focus:border-emerald-500"
          >
            {competitions.map((comp) => (
              <option key={comp.id} value={comp.id}>
                {comp.name} ({comp.type})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Matchday Stepper (For League competitions) */}
      {activeComp?.type === 'LEAGUE' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedMatchday((prev) => Math.max(1, prev - 1))}
              disabled={selectedMatchday <= 1}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="text-center px-4">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Matchday</span>
              <span className="text-base sm:text-lg font-black text-white">
                {selectedMatchday} <span className="text-slate-500 font-normal text-xs">/ {totalMatchdays}</span>
              </span>
            </div>

            <button
              onClick={() => setSelectedMatchday((prev) => Math.min(totalMatchdays, prev + 1))}
              disabled={selectedMatchday >= totalMatchdays}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Quick Matchday Pills Selector */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 sm:pb-0 scrollbar-none">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 19, 20, 38].map((md) => {
              if (md > totalMatchdays) return null;
              const isSelected = selectedMatchday === md;
              return (
                <button
                  key={md}
                  onClick={() => setSelectedMatchday(md)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all shrink-0 ${
                    isSelected
                      ? 'bg-emerald-500 text-slate-950 font-black'
                      : 'bg-slate-950/60 hover:bg-slate-800 text-slate-400 border border-slate-800'
                  }`}
                >
                  MD {md}
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
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterMode === 'ALL'
                ? 'bg-slate-800 text-white border border-slate-600'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Fixtures ({fixtures.length})
          </button>
          <button
            onClick={() => setFilterMode('MY_MATCHES')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterMode === 'MY_MATCHES'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            My Matches
          </button>
          <button
            onClick={() => setFilterMode('PENDING')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterMode === 'PENDING'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Pending
          </button>
          <button
            onClick={() => setFilterMode('DISPUTED')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterMode === 'DISPUTED'
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Disputes
          </button>
          <button
            onClick={() => setFilterMode('CONFIRMED')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              filterMode === 'CONFIRMED'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
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
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs shadow-md flex items-center gap-1.5"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Generate Official Berger Schedule</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Error State */}
      {error && !isLoading && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-between gap-3 text-rose-300 text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => loadFixtures(true)}
            className="px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-bold flex items-center gap-1 shrink-0"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      )}

      {/* Fixtures List */}
      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mb-2" />
          <span className="text-xs">Loading fixtures & match states...</span>
        </div>
      ) : filteredFixtures.length === 0 ? (
        <div className="py-16 text-center bg-slate-900 border border-slate-800 rounded-2xl">
          <Calendar className="w-12 h-12 text-slate-600 mx-auto mb-2 opacity-60" />
          <h4 className="text-sm font-bold text-slate-200">No fixtures found</h4>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            No fixtures match this filter. Click below to generate the Berger round-robin schedule if empty.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredFixtures.map((fixture) => {
            const isHomeUser = fixture.homeOwnerId === user?.id || fixture.homeClubId === currentClub?.id;
            const isAwayUser = fixture.awayOwnerId === user?.id || fixture.awayClubId === currentClub?.id;
            const isUserParticipant = isHomeUser || isAwayUser;

            return (
              <div
                key={fixture.id}
                className={`bg-slate-900 border rounded-2xl p-4 flex flex-col justify-between shadow-lg transition-all ${
                  isUserParticipant
                    ? 'border-emerald-500/40 bg-slate-900/90 shadow-emerald-500/5'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Header status */}
                <div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2.5 mb-3 text-xs">
                    <span className="font-semibold text-slate-400">
                      {fixture.roundName || `Matchday ${fixture.matchday}`}
                    </span>
                    {getStatusBadge(fixture.status)}
                  </div>

                  {/* Matchup row */}
                  <div className="grid grid-cols-7 items-center gap-2 text-center py-2">
                    {/* Home Club */}
                    <div className="col-span-3 flex flex-col items-center">
                      <div className="w-12 h-12 rounded-xl bg-slate-950 p-2 border border-slate-800 flex items-center justify-center mb-1 shadow-inner">
                        <img
                          src={fixture.homeClub?.logoUrl}
                          alt={fixture.homeClub?.name}
                          className="w-8 h-8 object-contain"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      </div>
                      <span className={`font-bold text-xs line-clamp-1 ${isHomeUser ? 'text-emerald-400 font-black' : 'text-slate-200'}`}>
                        {fixture.homeClub?.name}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {isHomeUser ? '(You)' : `@${fixture.homeClub?.claimedByUsername || 'unclaimed'}`}
                      </span>
                    </div>

                    {/* Score / VS Center */}
                    <div className="col-span-1 flex flex-col items-center justify-center">
                      {fixture.status === 'CONFIRMED' ? (
                        <div className="text-xl sm:text-2xl font-black text-emerald-400 tracking-tight">
                          {fixture.homeScore} - {fixture.awayScore}
                        </div>
                      ) : fixture.status === 'DISPUTED' ? (
                        <div className="text-xs font-black text-rose-400 bg-rose-500/10 px-2 py-1 rounded-lg border border-rose-500/30">
                          DISPUTE
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 text-xs font-black flex items-center justify-center border border-slate-700">
                          VS
                        </div>
                      )}
                    </div>

                    {/* Away Club */}
                    <div className="col-span-3 flex flex-col items-center">
                      <div className="w-12 h-12 rounded-xl bg-slate-950 p-2 border border-slate-800 flex items-center justify-center mb-1 shadow-inner">
                        <img
                          src={fixture.awayClub?.logoUrl}
                          alt={fixture.awayClub?.name}
                          className="w-8 h-8 object-contain"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      </div>
                      <span className={`font-bold text-xs line-clamp-1 ${isAwayUser ? 'text-emerald-400 font-black' : 'text-slate-200'}`}>
                        {fixture.awayClub?.name}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {isAwayUser ? '(You)' : `@${fixture.awayClub?.claimedByUsername || 'unclaimed'}`}
                      </span>
                    </div>
                  </div>

                  {/* Submission details banner if pending */}
                  {fixture.status === 'PENDING_CONFIRMATION' && (
                    <div className="mt-2.5 p-2 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] text-amber-300 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>1 manager submitted. Waiting for 2nd submission.</span>
                      </div>
                    </div>
                  )}

                  {/* Dispute warning if disputed */}
                  {fixture.status === 'DISPUTED' && (
                    <div className="mt-2.5 p-2 bg-rose-500/10 border border-rose-500/20 rounded-xl text-[11px] text-rose-300 flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Score discrepancy detected. Admin review in progress.</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom CTA Action Button */}
                <div className="pt-3 border-t border-slate-800/80 mt-3 flex items-center justify-between gap-2">
                  <div className="text-[10px] text-slate-500">
                    {fixture.status === 'CONFIRMED'
                      ? 'Result Verified & Standings Updated'
                      : fixture.userSubmission
                      ? `Your input: ${fixture.userSubmission.homeScore}-${fixture.userSubmission.awayScore}`
                      : 'Not submitted yet'}
                  </div>

                  {/* Anyone or participant can submit in sandbox/prod */}
                  <button
                    id={`btn-fixture-submit-${fixture.id}`}
                    onClick={() => setSelectedFixtureForSubmit(fixture)}
                    className={`px-3.5 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all ${
                      fixture.status === 'CONFIRMED'
                        ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                        : isUserParticipant
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black shadow-md shadow-emerald-500/10'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      {fixture.status === 'CONFIRMED'
                        ? 'View Details'
                        : fixture.userSubmission
                        ? 'Update Score'
                        : 'Submit Score'}
                    </span>
                  </button>
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
