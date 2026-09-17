import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import {
  Trophy,
  Play,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
  Shield,
  Clock,
  Eye,
  ArrowRight,
  Info,
} from 'lucide-react';

interface CupItem {
  id: string;
  name: string;
  country: string;
  leagueId: string;
  expectedTeams: number;
}

interface CupDetails {
  competition: any;
  totalParticipants: number;
  expectedTeams: number;
  participants: any[];
  totalFixtures: number;
  completedFixtures: number;
  currentRoundName: string;
  rounds: Array<{
    roundName: string;
    totalMatches: number;
    completedMatches: number;
    fixtures: any[];
  }>;
  isMatchdayLocked: boolean;
}

interface BracketPreview {
  competitionId: string;
  competitionName: string;
  totalParticipants: number;
  roundsCount: number;
  rounds: Array<{
    roundNumber: number;
    roundName: string;
    matchesCount: number;
    pairings: Array<{
      homeClub: { id: string; name: string };
      awayClub: { id: string; name: string };
    }>;
  }>;
}

export const AdminDomesticCupsTab: React.FC = () => {
  const { showToast } = useAuth();

  const [cups, setCups] = useState<CupItem[]>([]);
  const [selectedCupId, setSelectedCupId] = useState<string>('comp-fa-cup-2026');
  const [cupDetails, setCupDetails] = useState<CupDetails | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Preview Modal
  const [preview, setPreview] = useState<BracketPreview | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [isConfirmingGen, setIsConfirmingGen] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  // Advance winner state
  const [advancingFixtureId, setAdvancingFixtureId] = useState<string | null>(null);

  useEffect(() => {
    loadCups();
  }, []);

  useEffect(() => {
    if (selectedCupId) {
      loadCupDetails(selectedCupId);
    }
  }, [selectedCupId]);

  async function loadCups() {
    setIsLoading(true);
    try {
      const res = await api.getDomesticCups();
      setCups(res.cups || []);
      if (res.cups && res.cups.length > 0 && !selectedCupId) {
        setSelectedCupId(res.cups[0].id);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to load domestic cups list', 'error');
    } finally {
      setIsLoading(false);
    }
  }

  async function loadCupDetails(cupId: string) {
    setIsRefreshing(true);
    try {
      const details = await api.getDomesticCupDetails(cupId);
      setCupDetails(details);
    } catch (err: any) {
      showToast(err.message || `Failed to load details for ${cupId}`, 'error');
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handlePreviewBracket() {
    if (!selectedCupId) return;
    setIsPreviewLoading(true);
    try {
      const data = await api.previewDomesticCupBracket(selectedCupId);
      setPreview(data);
      setIsConfirmingGen(false);
    } catch (err: any) {
      showToast(err.message || 'Failed to generate bracket preview', 'error');
    } finally {
      setIsPreviewLoading(false);
    }
  }

  async function handleConfirmGenerate() {
    if (!selectedCupId) return;
    setIsGenerating(true);
    try {
      const res = await api.generateDomesticCupBracket(selectedCupId, true);
      showToast(res.message || 'Successfully created domestic cup fixtures!', 'success');
      setPreview(null);
      setIsConfirmingGen(false);
      await loadCupDetails(selectedCupId);
    } catch (err: any) {
      showToast(err.message || 'Failed to generate cup bracket', 'error');
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleAdvanceWinner(fixtureId: string) {
    setAdvancingFixtureId(fixtureId);
    try {
      const res = await api.advanceDomesticCupWinner(fixtureId);
      showToast(res.message || 'Winner advanced to the next round!', 'success');
      await loadCupDetails(selectedCupId);
    } catch (err: any) {
      showToast(err.message || 'Failed to advance winner', 'error');
    } finally {
      setAdvancingFixtureId(null);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Policy banner */}
      <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <Trophy className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-white text-sm">Domestic Cup Tournament Center</h4>
            <p className="text-slate-400 text-[11px] mt-0.5">
              Production knockout fixtures with safe bracket previews. EFL Cup is strictly excluded by design.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            5 Domestic Cups Supported
          </span>
        </div>
      </div>

      {/* Cup Selector Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {cups.map((cup) => {
          const isSelected = cup.id === selectedCupId;
          return (
            <button
              key={cup.id}
              onClick={() => setSelectedCupId(cup.id)}
              className={`p-3.5 rounded-2xl text-left transition-all border ${
                isSelected
                  ? 'bg-amber-500/10 border-amber-500/50 shadow-lg shadow-amber-500/10 scale-[1.02]'
                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900/90'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-lg">
                  {cup.country === 'England' && '🏴󠁧󠁢󠁥󠁮󠁧󠁿'}
                  {cup.country === 'Spain' && '🇪🇸'}
                  {cup.country === 'Italy' && '🇮🇹'}
                  {cup.country === 'Germany' && '🇩🇪'}
                  {cup.country === 'France' && '🇫🇷'}
                </span>
                <span className="text-[10px] font-bold text-slate-400 uppercase">
                  {cup.expectedTeams} Clubs
                </span>
              </div>
              <div className="mt-2 font-black text-white text-sm truncate">{cup.name}</div>
              <div className="text-[11px] text-slate-400 mt-0.5 truncate">{cup.country}</div>
            </button>
          );
        })}
      </div>

      {/* Selected Cup Administration View */}
      {cupDetails && (
        <div className="glass-panel p-5 sm:p-6 rounded-2xl border-slate-800 space-y-6">
          {/* Header & Controls */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                <Trophy className="w-3.5 h-3.5" />
                <span>{cupDetails.competition?.name || selectedCupId}</span>
                <span className="text-slate-500">•</span>
                <span className="text-slate-300">Season 2026/27</span>
              </div>
              <h3 className="text-xl font-black text-white mt-1 flex items-center gap-2">
                <span>{cupDetails.competition?.name}</span>
                {cupDetails.totalFixtures > 0 ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Active • {cupDetails.totalFixtures} Fixtures
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Awaiting Draw
                  </span>
                )}
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={() => loadCupDetails(selectedCupId)}
                disabled={isRefreshing}
                className="px-3.5 py-2 glass-card text-slate-300 hover:text-white rounded-xl text-xs font-bold flex items-center gap-2"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>

              {cupDetails.totalFixtures === 0 ? (
                <button
                  onClick={handlePreviewBracket}
                  disabled={isPreviewLoading}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-black flex items-center gap-2 shadow-lg shadow-amber-500/20"
                >
                  <Eye className="w-4 h-4" />
                  <span>Preview & Generate Bracket</span>
                </button>
              ) : (
                <div className="px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 text-xs font-semibold text-slate-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Bracket Active ({cupDetails.completedFixtures}/{cupDetails.totalFixtures} played)</span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="glass-card p-3.5 rounded-xl">
              <div className="text-[10px] font-bold uppercase text-slate-400">Participants</div>
              <div className="text-lg font-black text-white mt-1">
                {cupDetails.totalParticipants} / {cupDetails.expectedTeams}
              </div>
              <div className="text-[10px] text-emerald-400 font-semibold mt-0.5">
                {cupDetails.totalParticipants >= cupDetails.expectedTeams ? '100% Seeded' : 'Seeding incomplete'}
              </div>
            </div>

            <div className="glass-card p-3.5 rounded-xl">
              <div className="text-[10px] font-bold uppercase text-slate-400">Current Phase</div>
              <div className="text-lg font-black text-amber-400 mt-1 truncate">
                {cupDetails.currentRoundName}
              </div>
              <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                {cupDetails.rounds?.length || 0} Total Rounds
              </div>
            </div>

            <div className="glass-card p-3.5 rounded-xl">
              <div className="text-[10px] font-bold uppercase text-slate-400">Matches Progress</div>
              <div className="text-lg font-black text-white mt-1">
                {cupDetails.completedFixtures} / {cupDetails.totalFixtures}
              </div>
              <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                {cupDetails.totalFixtures > 0
                  ? `${Math.round((cupDetails.completedFixtures / cupDetails.totalFixtures) * 100)}% Complete`
                  : 'Not drawn'}
              </div>
            </div>

            <div className="glass-card p-3.5 rounded-xl">
              <div className="text-[10px] font-bold uppercase text-slate-400">Matchday Status</div>
              <div className="text-lg font-black text-white mt-1">
                {cupDetails.isMatchdayLocked ? 'Locked' : 'Open'}
              </div>
              <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                {cupDetails.isMatchdayLocked ? 'Awaiting kickoff window' : 'Active for play'}
              </div>
            </div>
          </div>

          {/* Rounds & Fixtures Tree */}
          {cupDetails.rounds && cupDetails.rounds.length > 0 ? (
            <div className="space-y-6">
              <h4 className="text-sm font-black text-white flex items-center gap-2">
                <span>Tournament Knockout Rounds</span>
                <span className="text-xs text-slate-400 font-normal">
                  ({cupDetails.rounds.length} rounds)
                </span>
              </h4>

              <div className="space-y-4">
                {cupDetails.rounds.map((round, rIdx) => (
                  <div key={rIdx} className="glass-card p-4 rounded-xl border-slate-800/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-black">
                          {rIdx + 1}
                        </span>
                        <h5 className="text-sm font-black text-white">{round.roundName}</h5>
                        <span className="text-xs text-slate-400 font-semibold">
                          ({round.completedMatches} / {round.totalMatches} finished)
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {round.fixtures.map((fixture) => {
                        const isFinished = fixture.status === 'CONFIRMED';
                        const canAdvance = isFinished && rIdx < cupDetails.rounds.length - 1;

                        return (
                          <div
                            key={fixture.id}
                            className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl flex items-center justify-between gap-3 text-xs"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between font-bold text-slate-200">
                                <span className="truncate">{fixture.homeClubName}</span>
                                <span className="font-mono text-amber-400 ml-2">
                                  {fixture.homeScore !== null && fixture.homeScore !== undefined ? fixture.homeScore : '-'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between font-bold text-slate-200 mt-1">
                                <span className="truncate">{fixture.awayClubName}</span>
                                <span className="font-mono text-amber-400 ml-2">
                                  {fixture.awayScore !== null && fixture.awayScore !== undefined ? fixture.awayScore : '-'}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1.5">
                                <span className={`px-1.5 py-0.2 rounded font-black ${
                                  isFinished ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'
                                }`}>
                                  {fixture.status}
                                </span>
                                {fixture.winnerClubId && (
                                  <span className="text-amber-400 font-semibold">
                                    Winner: {fixture.winnerClubId === fixture.homeClubId ? fixture.homeClubName : fixture.awayClubName}
                                  </span>
                                )}
                              </div>
                            </div>

                            {canAdvance && (
                              <button
                                onClick={() => handleAdvanceWinner(fixture.id)}
                                disabled={advancingFixtureId === fixture.id}
                                className="px-2.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-lg text-[11px] font-bold shrink-0 flex items-center gap-1"
                              >
                                <span>Advance</span>
                                <ChevronRight className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-slate-400 space-y-3">
              <Trophy className="w-12 h-12 text-slate-600 mx-auto" />
              <p className="text-sm font-semibold">No bracket fixtures have been generated for {cupDetails.competition?.name} yet.</p>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                All {cupDetails.totalParticipants} domestic league clubs are eligible. Click "Preview & Generate Bracket" to review the schedule safely before saving.
              </p>
              <button
                onClick={handlePreviewBracket}
                disabled={isPreviewLoading}
                className="mt-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-black inline-flex items-center gap-2"
              >
                <Eye className="w-4 h-4" />
                <span>Preview Draw</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bracket Preview & Confirmation Modal */}
      {preview && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border-slate-700 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black uppercase text-amber-400 tracking-wider">
                  Bracket Generation Preview
                </div>
                <h3 className="text-lg font-black text-white mt-0.5">{preview.competitionName}</h3>
              </div>
              <button
                onClick={() => setPreview(null)}
                className="w-8 h-8 rounded-lg bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong>Safety Precondition Checked:</strong> This preview generates {preview.roundsCount} knockout rounds for {preview.totalParticipants} clubs. Existing league matches and user records are completely untouched.
                </div>
              </div>

              <div className="space-y-3">
                {preview.rounds.map((round) => (
                  <div key={round.roundNumber} className="glass-card p-3.5 rounded-xl space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-white">
                      <span className="text-amber-400">{round.roundName}</span>
                      <span className="text-slate-400">{round.matchesCount} matches</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {round.pairings.map((pair, idx) => (
                        <div key={idx} className="p-2 bg-slate-900/80 rounded-lg border border-slate-800">
                          <div className="font-semibold text-slate-200 truncate">{pair.homeClub.name}</div>
                          <div className="text-[10px] text-slate-500">vs</div>
                          <div className="font-semibold text-slate-200 truncate">{pair.awayClub.name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Footer with Explicit Confirmation */}
            <div className="p-5 border-t border-slate-800 bg-slate-900/50 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                {isConfirmingGen ? (
                  <span className="text-rose-400 font-bold">
                    ⚠️ Are you sure? This will create production cup fixtures.
                  </span>
                ) : (
                  <span>Review pairings carefully before generating official schedule.</span>
                )}
              </div>

              <div className="flex items-center gap-2.5 w-full sm:w-auto">
                <button
                  onClick={() => setPreview(null)}
                  className="flex-1 sm:flex-none px-4 py-2 glass-card text-slate-300 hover:text-white rounded-xl text-xs font-bold"
                >
                  Cancel
                </button>

                {!isConfirmingGen ? (
                  <button
                    onClick={() => setIsConfirmingGen(true)}
                    className="flex-1 sm:flex-none px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-black shadow-lg shadow-amber-500/20"
                  >
                    Confirm & Apply Draw
                  </button>
                ) : (
                  <button
                    onClick={handleConfirmGenerate}
                    disabled={isGenerating}
                    className="flex-1 sm:flex-none px-4 py-2 bg-rose-500 hover:bg-rose-400 text-white rounded-xl text-xs font-black shadow-lg shadow-rose-500/20 flex items-center justify-center gap-1.5"
                  >
                    {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    <span>{isGenerating ? 'Writing Fixtures...' : 'Yes, Generate Fixtures'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
