import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { adminCupDrawApi } from '../../lib/adminCupDrawApi';
import { useAuth } from '../../context/AuthContext';
import {
  Trophy,
  Play,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ChevronRight,
  Eye,
  Info,
  Edit3,
  Shuffle,
  Lock,
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

interface SeededClub {
  id: string;
  name: string;
  position: number;
}

interface BracketPreview {
  competitionId: string;
  competitionName: string;
  totalParticipants: number;
  roundsCount: number;
  drawSeed: string;
  seedingPolicy: string;
  mode: 'CREATE' | 'REDRAW';
  canGenerate: boolean;
  canRedraw: boolean;
  blockReason?: string;
  protectedFixturesCount: number;
  byeTeams: SeededClub[];
  playInTeams: SeededClub[];
  rounds: Array<{
    roundNumber: number;
    roundName: string;
    matchesCount: number;
    pairings: Array<{
      homeClub: { id: string | null; name: string; position?: number };
      awayClub: { id: string | null; name: string; position?: number };
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

  const [preview, setPreview] = useState<BracketPreview | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [isConfirmingGen, setIsConfirmingGen] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const [advancingFixtureId, setAdvancingFixtureId] = useState<string | null>(null);

  const [editingFixture, setEditingFixture] = useState<any | null>(null);
  const [editHomeClubId, setEditHomeClubId] = useState<string>('');
  const [editAwayClubId, setEditAwayClubId] = useState<string>('');
  const [isSavingPairing, setIsSavingPairing] = useState(false);

  useEffect(() => {
    loadCups();
  }, []);

  useEffect(() => {
    if (selectedCupId) {
      loadCupDetails(selectedCupId);
      setPreview(null);
      setEditingFixture(null);
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

  async function handlePreviewBracket(newDraw = false) {
    if (!selectedCupId) return;
    setIsPreviewLoading(true);
    try {
      const data = await adminCupDrawApi.preview(selectedCupId, { newDraw });
      setPreview(data);
      setIsConfirmingGen(false);
    } catch (err: any) {
      showToast(err.message || 'Failed to generate bracket preview', 'error');
    } finally {
      setIsPreviewLoading(false);
    }
  }

  async function handleConfirmGenerate() {
    if (!selectedCupId || !preview?.drawSeed) return;
    setIsGenerating(true);
    try {
      const res = await adminCupDrawApi.confirm(selectedCupId, preview.drawSeed);
      showToast(res.message || 'Domestic cup draw saved successfully.', 'success');
      setPreview(null);
      setIsConfirmingGen(false);
      await loadCupDetails(selectedCupId);
    } catch (err: any) {
      showToast(err.message || 'Failed to save cup draw', 'error');
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

  function openPairingEditor(fixture: any) {
    setEditingFixture(fixture);
    setEditHomeClubId(fixture.homeClubId || '');
    setEditAwayClubId(fixture.awayClubId || '');
  }

  async function handleSavePairing() {
    if (!editingFixture || !selectedCupId) return;
    setIsSavingPairing(true);
    try {
      const changes: { homeClubId?: string | null; awayClubId?: string | null } = {};
      if (!editingFixture.homeSourceFixtureId) changes.homeClubId = editHomeClubId || null;
      if (!editingFixture.awaySourceFixtureId) changes.awayClubId = editAwayClubId || null;
      await adminCupDrawApi.editPairing(selectedCupId, editingFixture.id, changes);
      showToast('Pairing updated safely.', 'success');
      setEditingFixture(null);
      await loadCupDetails(selectedCupId);
    } catch (err: any) {
      showToast(err.message || 'Failed to update pairing', 'error');
    } finally {
      setIsSavingPairing(false);
    }
  }

  if (isLoading && cups.length === 0) {
    return (
      <div className="py-12 text-center text-slate-400">
        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-amber-400" />
        Loading domestic cups…
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <Trophy className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-white text-sm">Domestic Cup Draw Manager</h4>
            <p className="text-slate-400 text-[11px] mt-0.5">
              League-position seeding, safe redraws, preview confirmation and manual pairing control.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            5 Domestic Cups Supported
          </span>
        </div>
      </div>

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
                <span className="text-[10px] font-bold text-slate-400 uppercase">{cup.expectedTeams} Clubs</span>
              </div>
              <div className="mt-2 font-black text-white text-sm truncate">{cup.name}</div>
              <div className="text-[11px] text-slate-400 mt-0.5 truncate">{cup.country}</div>
            </button>
          );
        })}
      </div>

      {cupDetails && (
        <div className="glass-panel p-5 sm:p-6 rounded-2xl border-slate-800 space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                <Trophy className="w-3.5 h-3.5" />
                <span>{cupDetails.competition?.name || selectedCupId}</span>
                <span className="text-slate-500">•</span>
                <span className="text-slate-300">Season 2026/27</span>
              </div>
              <h3 className="text-xl font-black text-white mt-1 flex items-center gap-2 flex-wrap">
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

              <button
                onClick={() => handlePreviewBracket(cupDetails.totalFixtures > 0)}
                disabled={isPreviewLoading}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-black flex items-center gap-2 shadow-lg shadow-amber-500/20 disabled:opacity-50"
              >
                {cupDetails.totalFixtures > 0 ? <Shuffle className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                <span>{cupDetails.totalFixtures > 0 ? 'Redraw Preview' : 'Preview Draw'}</span>
              </button>

              {cupDetails.totalFixtures > 0 && (
                <div className="px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700 text-xs font-semibold text-slate-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>{cupDetails.completedFixtures}/{cupDetails.totalFixtures} played</span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="glass-card p-3.5 rounded-xl">
              <div className="text-[10px] font-bold uppercase text-slate-400">Participants</div>
              <div className="text-lg font-black text-white mt-1">{cupDetails.totalParticipants} / {cupDetails.expectedTeams}</div>
              <div className="text-[10px] text-emerald-400 font-semibold mt-0.5">
                {cupDetails.totalParticipants >= cupDetails.expectedTeams ? '100% Seeded' : 'Seeding incomplete'}
              </div>
            </div>
            <div className="glass-card p-3.5 rounded-xl">
              <div className="text-[10px] font-bold uppercase text-slate-400">Current Phase</div>
              <div className="text-lg font-black text-amber-400 mt-1 truncate">{cupDetails.currentRoundName}</div>
              <div className="text-[10px] text-slate-400 font-semibold mt-0.5">{cupDetails.rounds?.length || 0} Total Rounds</div>
            </div>
            <div className="glass-card p-3.5 rounded-xl">
              <div className="text-[10px] font-bold uppercase text-slate-400">Matches Progress</div>
              <div className="text-lg font-black text-white mt-1">{cupDetails.completedFixtures} / {cupDetails.totalFixtures}</div>
              <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                {cupDetails.totalFixtures > 0 ? `${Math.round((cupDetails.completedFixtures / cupDetails.totalFixtures) * 100)}% Complete` : 'Not drawn'}
              </div>
            </div>
            <div className="glass-card p-3.5 rounded-xl">
              <div className="text-[10px] font-bold uppercase text-slate-400">Draw Policy</div>
              <div className="text-sm font-black text-white mt-1">Standings Seeded</div>
              <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                {cupDetails.expectedTeams === 20 ? '1–12 bye • 13–20 play-in' : '1–14 bye • 15–18 play-in'}
              </div>
            </div>
          </div>

          {cupDetails.rounds && cupDetails.rounds.length > 0 ? (
            <div className="space-y-6">
              <h4 className="text-sm font-black text-white flex items-center gap-2">
                <span>Tournament Knockout Rounds</span>
                <span className="text-xs text-slate-400 font-normal">({cupDetails.rounds.length} rounds)</span>
              </h4>

              <div className="space-y-4">
                {cupDetails.rounds.map((round, rIdx) => (
                  <div key={rIdx} className="glass-card p-4 rounded-xl border-slate-800/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-black">{rIdx + 1}</span>
                        <h5 className="text-sm font-black text-white">{round.roundName}</h5>
                        <span className="text-xs text-slate-400 font-semibold">({round.completedMatches} / {round.totalMatches} finished)</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {round.fixtures.map((fixture) => {
                        const isFinished = fixture.status === 'CONFIRMED';
                        const canAdvance = isFinished && rIdx < cupDetails.rounds.length - 1;
                        const canEditPairing = fixture.status === 'SCHEDULED' && fixture.homeScore == null && fixture.awayScore == null;

                        return (
                          <div key={fixture.id} className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl flex items-center justify-between gap-3 text-xs">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between font-bold text-slate-200">
                                <span className="truncate">{fixture.homeClubName}</span>
                                <span className="font-mono text-amber-400 ml-2">{fixture.homeScore !== null && fixture.homeScore !== undefined ? fixture.homeScore : '-'}</span>
                              </div>
                              <div className="flex items-center justify-between font-bold text-slate-200 mt-1">
                                <span className="truncate">{fixture.awayClubName}</span>
                                <span className="font-mono text-amber-400 ml-2">{fixture.awayScore !== null && fixture.awayScore !== undefined ? fixture.awayScore : '-'}</span>
                              </div>
                              <div className="text-[10px] text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
                                <span className={`px-1.5 py-0.5 rounded font-black ${isFinished ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>{fixture.status}</span>
                                {fixture.winnerClubId && (
                                  <span className="text-amber-400 font-semibold">Winner: {fixture.winnerClubId === fixture.homeClubId ? fixture.homeClubName : fixture.awayClubName}</span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {canEditPairing && (
                                <button
                                  onClick={() => openPairingEditor(fixture)}
                                  className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-[11px] font-bold flex items-center gap-1"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span>Edit</span>
                                </button>
                              )}
                              {canAdvance && (
                                <button
                                  onClick={() => handleAdvanceWinner(fixture.id)}
                                  disabled={advancingFixtureId === fixture.id}
                                  className="px-2.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-lg text-[11px] font-bold flex items-center gap-1"
                                >
                                  <span>Advance</span>
                                  <ChevronRight className="w-3 h-3" />
                                </button>
                              )}
                            </div>
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
                Draw seeding is taken from the current league table. Top positions receive byes; lower positions enter the play-in.
              </p>
              <button
                onClick={() => handlePreviewBracket(false)}
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

      {preview && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl border-slate-700 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase text-amber-400 tracking-wider">
                  {preview.mode === 'REDRAW' ? 'Safe Redraw Preview' : 'Bracket Generation Preview'}
                </div>
                <h3 className="text-lg font-black text-white mt-0.5">{preview.competitionName}</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePreviewBracket(true)}
                  disabled={isPreviewLoading}
                  className="px-3 py-2 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs font-bold flex items-center gap-1.5"
                >
                  <Shuffle className={`w-3.5 h-3.5 ${isPreviewLoading ? 'animate-spin' : ''}`} />
                  Shuffle Again
                </button>
                <button onClick={() => setPreview(null)} className="w-8 h-8 rounded-lg bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold">✕</button>
              </div>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {preview.canGenerate ? (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-200 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong>Safe to {preview.mode === 'REDRAW' ? 'redraw' : 'generate'}.</strong>{' '}
                    {preview.mode === 'REDRAW'
                      ? 'All existing cup fixtures are still untouched SCHEDULED matches, so replacing the draw will not delete played results.'
                      : 'No existing cup fixtures will be overwritten.'}
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-200 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div><strong>Redraw locked.</strong> {preview.blockReason}</div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="glass-card p-3.5 rounded-xl">
                  <div className="text-[10px] font-black uppercase tracking-wider text-emerald-400 mb-2">Direct R16 Byes</div>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.byeTeams.map((club) => (
                      <span key={club.id} className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-slate-200 font-semibold">
                        #{club.position} {club.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="glass-card p-3.5 rounded-xl">
                  <div className="text-[10px] font-black uppercase tracking-wider text-amber-400 mb-2">Play-in Pool</div>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.playInTeams.map((club) => (
                      <span key={club.id} className="px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-slate-200 font-semibold">
                        #{club.position} {club.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-200 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong>Seed policy:</strong> {preview.totalParticipants === 20 ? 'positions 1–12 receive byes; positions 13–20 play the preliminary round.' : 'positions 1–14 receive byes; positions 15–18 play the preliminary round.'}
                  {' '}Pairings inside each pool are shuffled. Draw seed: <span className="font-mono text-[10px]">{preview.drawSeed.slice(-12)}</span>.
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
                          <div className="font-semibold text-slate-200 truncate">
                            {pair.homeClub.position ? `#${pair.homeClub.position} ` : ''}{pair.homeClub.name}
                          </div>
                          <div className="text-[10px] text-slate-500">vs</div>
                          <div className="font-semibold text-slate-200 truncate">
                            {pair.awayClub.position ? `#${pair.awayClub.position} ` : ''}{pair.awayClub.name}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-5 border-t border-slate-800 bg-slate-900/50 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                {!preview.canGenerate ? (
                  <span className="text-rose-400 font-bold flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> Protected match activity prevents redraw.</span>
                ) : isConfirmingGen ? (
                  <span className="text-rose-400 font-bold">⚠️ Confirm this exact seeded draw?</span>
                ) : (
                  <span>Preview and shuffle until the draw is correct, then confirm once.</span>
                )}
              </div>

              <div className="flex items-center gap-2.5 w-full sm:w-auto">
                <button onClick={() => setPreview(null)} className="flex-1 sm:flex-none px-4 py-2 glass-card text-slate-300 hover:text-white rounded-xl text-xs font-bold">Cancel</button>
                {preview.canGenerate && (!isConfirmingGen ? (
                  <button onClick={() => setIsConfirmingGen(true)} className="flex-1 sm:flex-none px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-black shadow-lg shadow-amber-500/20">
                    {preview.mode === 'REDRAW' ? 'Confirm Redraw' : 'Confirm & Apply Draw'}
                  </button>
                ) : (
                  <button
                    onClick={handleConfirmGenerate}
                    disabled={isGenerating}
                    className="flex-1 sm:flex-none px-4 py-2 bg-rose-500 hover:bg-rose-400 text-white rounded-xl text-xs font-black shadow-lg shadow-rose-500/20 flex items-center justify-center gap-1.5"
                  >
                    {isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    <span>{isGenerating ? 'Saving Draw...' : preview.mode === 'REDRAW' ? 'Yes, Replace Draw' : 'Yes, Generate Fixtures'}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {editingFixture && cupDetails && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-lg rounded-2xl border-slate-700 shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black uppercase text-amber-400 tracking-wider">Manual Pairing Control</div>
                <h3 className="text-base font-black text-white mt-0.5">{editingFixture.roundName} • {editingFixture.id}</h3>
              </div>
              <button onClick={() => setEditingFixture(null)} className="w-8 h-8 rounded-lg bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold">✕</button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-400">
                Only untouched SCHEDULED fixtures can be edited. Winner-source slots are locked automatically so bracket progression cannot be broken.
              </div>

              <label className="block space-y-1.5">
                <span className="text-[11px] font-black uppercase text-slate-400">Home club</span>
                {editingFixture.homeSourceFixtureId ? (
                  <div className="px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5" /> Winner source: {editingFixture.homeSourceFixtureId}
                  </div>
                ) : (
                  <select value={editHomeClubId} onChange={(e) => setEditHomeClubId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white">
                    <option value="">TBD / Empty</option>
                    {cupDetails.participants.map((club) => <option key={club.clubId} value={club.clubId}>{club.clubName}</option>)}
                  </select>
                )}
              </label>

              <label className="block space-y-1.5">
                <span className="text-[11px] font-black uppercase text-slate-400">Away club</span>
                {editingFixture.awaySourceFixtureId ? (
                  <div className="px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400 flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5" /> Winner source: {editingFixture.awaySourceFixtureId}
                  </div>
                ) : (
                  <select value={editAwayClubId} onChange={(e) => setEditAwayClubId(e.target.value)} className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm text-white">
                    <option value="">TBD / Empty</option>
                    {cupDetails.participants.map((club) => <option key={club.clubId} value={club.clubId}>{club.clubName}</option>)}
                  </select>
                )}
              </label>
            </div>

            <div className="p-5 border-t border-slate-800 bg-slate-900/50 flex justify-end gap-2.5">
              <button onClick={() => setEditingFixture(null)} className="px-4 py-2 glass-card text-slate-300 rounded-xl text-xs font-bold">Cancel</button>
              <button
                onClick={handleSavePairing}
                disabled={isSavingPairing}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-black flex items-center gap-2 disabled:opacity-50"
              >
                {isSavingPairing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Edit3 className="w-4 h-4" />}
                Save Pairing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
