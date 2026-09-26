import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { adminCupDrawApi } from '../../lib/adminCupDrawApi';
import { adminCupRoundOpsApi, CupBracketHealth } from '../../lib/adminCupRoundOpsApi';
import { useAuth } from '../../context/AuthContext';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Edit3,
  Eye,
  HeartPulse,
  Lock,
  Play,
  RefreshCw,
  ShieldCheck,
  Shuffle,
  Trophy,
  Unlock,
  Wrench,
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
  participants: Array<{ clubId: string; clubName: string }>;
  totalFixtures: number;
  completedFixtures: number;
  currentRound?: number;
  currentRoundName: string;
  isMatchdayLocked: boolean;
  rounds: Array<{
    roundNumber: number;
    roundName: string;
    totalMatches: number;
    completedMatches: number;
    fixtures: any[];
  }>;
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
  mode: 'CREATE' | 'REDRAW';
  canGenerate: boolean;
  blockReason?: string;
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
  const [selectedCupId, setSelectedCupId] = useState('comp-fa-cup-2026');
  const [details, setDetails] = useState<CupDetails | null>(null);
  const [health, setHealth] = useState<CupBracketHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<BracketPreview | null>(null);
  const [confirmDraw, setConfirmDraw] = useState(false);
  const [editingFixture, setEditingFixture] = useState<any | null>(null);
  const [homeClubId, setHomeClubId] = useState('');
  const [awayClubId, setAwayClubId] = useState('');

  const currentRound = health?.currentRound || details?.currentRound || details?.competition?.currentMatchday || 1;
  const currentRoundHealth = useMemo(
    () => health?.rounds.find((round) => round.roundNumber === currentRound),
    [health, currentRound]
  );

  async function loadCups() {
    const result = await api.getDomesticCups();
    setCups(result.cups || []);
  }

  async function loadCup(cupId = selectedCupId) {
    setLoading(true);
    try {
      const [cupDetails, cupHealth] = await Promise.all([
        api.getDomesticCupDetails(cupId),
        adminCupRoundOpsApi.health(cupId).catch(() => null),
      ]);
      setDetails(cupDetails);
      setHealth(cupHealth);
    } catch (err: any) {
      showToast(err.message || 'Failed to load domestic cup data', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCups().catch((err) => showToast(err.message || 'Failed to load cups', 'error'));
  }, []);

  useEffect(() => {
    if (selectedCupId) {
      setPreview(null);
      setEditingFixture(null);
      loadCup(selectedCupId);
    }
  }, [selectedCupId]);

  async function previewDraw(newDraw: boolean) {
    setBusy('preview');
    try {
      const result = await adminCupDrawApi.preview(selectedCupId, { newDraw });
      setPreview(result);
      setConfirmDraw(false);
    } catch (err: any) {
      showToast(err.message || 'Failed to preview draw', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function applyDraw() {
    if (!preview?.drawSeed) return;
    setBusy('draw');
    try {
      const result = await adminCupDrawApi.confirm(selectedCupId, preview.drawSeed);
      showToast(result.message || 'Draw applied successfully.', 'success');
      setPreview(null);
      setConfirmDraw(false);
      await loadCup();
    } catch (err: any) {
      showToast(err.message || 'Failed to apply draw', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function runHealthRepair() {
    setBusy('repair');
    try {
      const result = await adminCupRoundOpsApi.reconcile(selectedCupId);
      setHealth(result.health);
      showToast(
        result.blocked
          ? `Reconciled ${result.changed} fixture(s); ${result.blocked} protected mismatch(es) require manual review.`
          : `Bracket reconciled: ${result.changed} fixture(s) updated.`,
        result.blocked ? 'info' : 'success'
      );
      await loadCup();
    } catch (err: any) {
      showToast(err.message || 'Bracket reconcile failed', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function setRound(roundNumber: number, action: 'OPEN' | 'LOCK') {
    setBusy(`${action}-${roundNumber}`);
    try {
      await adminCupRoundOpsApi.setRound(selectedCupId, roundNumber, action);
      showToast(`${action === 'OPEN' ? 'Opened' : 'Locked'} ${details?.rounds.find((r) => r.roundNumber === roundNumber)?.roundName || `Round ${roundNumber}`}.`, 'success');
      await loadCup();
    } catch (err: any) {
      showToast(err.message || `Failed to ${action.toLowerCase()} round`, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function advanceRound() {
    setBusy('advance-round');
    try {
      const result = await adminCupRoundOpsApi.advanceRound(selectedCupId);
      showToast(`Advanced to ${result.roundName}.`, 'success');
      await loadCup();
    } catch (err: any) {
      showToast(err.message || 'Failed to advance round', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function manualAdvance(fixtureId: string) {
    setBusy(`advance-${fixtureId}`);
    try {
      const result = await api.advanceDomesticCupWinner(fixtureId);
      showToast(result.message || 'Winner advanced.', 'success');
      await loadCup();
    } catch (err: any) {
      showToast(err.message || 'Failed to advance winner', 'error');
    } finally {
      setBusy(null);
    }
  }

  function editPairing(fixture: any) {
    setEditingFixture(fixture);
    setHomeClubId(fixture.homeClubId || '');
    setAwayClubId(fixture.awayClubId || '');
  }

  async function savePairing() {
    if (!editingFixture) return;
    setBusy('pairing');
    try {
      const changes: { homeClubId?: string | null; awayClubId?: string | null } = {};
      if (!editingFixture.homeSourceFixtureId) changes.homeClubId = homeClubId || null;
      if (!editingFixture.awaySourceFixtureId) changes.awayClubId = awayClubId || null;
      await adminCupDrawApi.editPairing(selectedCupId, editingFixture.id, changes);
      showToast('Pairing updated.', 'success');
      setEditingFixture(null);
      await loadCup();
    } catch (err: any) {
      showToast(err.message || 'Failed to update pairing', 'error');
    } finally {
      setBusy(null);
    }
  }

  if (loading && !details) {
    return <div className="py-12 text-center text-slate-400"><RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-amber-400" />Loading domestic cups…</div>;
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400"><Trophy className="w-5 h-5" /></div>
          <div>
            <h3 className="font-black text-white">Domestic Cup Control Center</h3>
            <p className="text-[11px] text-slate-400">Seeded draw • automatic winner progression • round locks • bracket health</p>
          </div>
        </div>
        <button onClick={() => loadCup()} className="px-3 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-bold flex items-center gap-2 self-start lg:self-auto">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {cups.map((cup) => (
          <button key={cup.id} onClick={() => setSelectedCupId(cup.id)} className={`p-3 rounded-xl border text-left transition ${selectedCupId === cup.id ? 'bg-amber-500/10 border-amber-500/50' : 'bg-slate-900/60 border-slate-800'}`}>
            <div className="text-xs font-black text-white truncate">{cup.name}</div>
            <div className="text-[10px] text-slate-400 mt-1">{cup.expectedTeams} clubs</div>
          </button>
        ))}
      </div>

      {details && (
        <>
          <div className="glass-panel rounded-2xl p-4 sm:p-5 space-y-4 border-slate-800">
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-amber-400 font-black">{details.competition?.name}</div>
                <div className="text-xl text-white font-black mt-1">{details.currentRoundName || 'Awaiting Draw'}</div>
                <div className="text-xs text-slate-400 mt-1">{details.completedFixtures}/{details.totalFixtures} fixtures confirmed</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => previewDraw(details.totalFixtures > 0)} disabled={busy === 'preview'} className="px-3 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-black flex items-center gap-1.5 disabled:opacity-50">
                  {details.totalFixtures > 0 ? <Shuffle className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {details.totalFixtures > 0 ? 'Redraw Preview' : 'Preview Draw'}
                </button>
                {details.totalFixtures > 0 && (
                  <button onClick={advanceRound} disabled={!currentRoundHealth?.readyToAdvance || busy === 'advance-round'} className="px-3 py-2 rounded-xl bg-emerald-500 text-slate-950 text-xs font-black flex items-center gap-1.5 disabled:opacity-40">
                    <ChevronRight className="w-3.5 h-3.5" /> Open Next Round
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Participants" value={`${details.totalParticipants}/${details.expectedTeams}`} sub={details.expectedTeams === 20 ? '1–12 bye • 13–20 play-in' : '1–14 bye • 15–18 play-in'} />
              <Stat label="Current Round" value={`#${currentRound}`} sub={details.currentRoundName || '—'} />
              <Stat label="Round Status" value={details.isMatchdayLocked ? 'Locked' : 'Open'} sub={details.isMatchdayLocked ? 'Submissions blocked' : 'Ready for play'} />
              <Stat label="Bracket Health" value={health?.healthy ? 'Healthy' : `${health?.issues.length || 0} issue(s)`} sub={health?.healthy ? 'Sources synchronized' : 'Review recommended'} />
            </div>
          </div>

          <div className={`rounded-2xl border p-4 ${health?.healthy ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${health?.healthy ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
                  {health?.healthy ? <ShieldCheck className="w-5 h-5" /> : <HeartPulse className="w-5 h-5" />}
                </div>
                <div>
                  <div className="text-sm font-black text-white">Bracket Health</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {health?.healthy ? 'No missing sources, stale winners or duplicate clubs detected.' : 'Source/progression mismatches detected. Safe repair never overwrites started matches.'}
                  </div>
                </div>
              </div>
              {!health?.healthy && (
                <button onClick={runHealthRepair} disabled={busy === 'repair'} className="px-3 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-black flex items-center gap-1.5 self-start lg:self-auto">
                  <Wrench className="w-3.5 h-3.5" /> Repair Safe Mismatches
                </button>
              )}
            </div>
            {!health?.healthy && health?.issues?.length ? (
              <div className="mt-3 space-y-2 max-h-44 overflow-y-auto">
                {health.issues.map((issue, index) => (
                  <div key={`${issue.fixtureId}-${issue.code}-${index}`} className="text-[11px] bg-slate-950/50 border border-slate-800 rounded-lg p-2 flex items-start gap-2">
                    <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${issue.severity === 'error' ? 'text-rose-400' : 'text-amber-400'}`} />
                    <span className="text-slate-300">{issue.message}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            {(details.rounds || []).map((round) => {
              const roundHealth = health?.rounds.find((item) => item.roundNumber === round.roundNumber);
              const isCurrent = round.roundNumber === currentRound;
              return (
                <div key={round.roundNumber} className={`glass-card rounded-2xl p-4 border ${isCurrent ? 'border-amber-500/40' : 'border-slate-800'}`}>
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center text-xs font-black">{round.roundNumber}</span>
                        <div className="text-sm font-black text-white">{round.roundName}</div>
                        {isCurrent && <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-[9px] font-black uppercase">Current</span>}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1 ml-9">{round.completedMatches}/{round.totalMatches} confirmed{roundHealth?.readyToAdvance ? ' • ready to advance' : ''}</div>
                    </div>
                    <div className="flex gap-2 ml-9 md:ml-0">
                      <button onClick={() => setRound(round.roundNumber, 'OPEN')} disabled={busy === `OPEN-${round.roundNumber}`} className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 text-[10px] font-black flex items-center gap-1"><Unlock className="w-3 h-3" /> Open</button>
                      <button onClick={() => setRound(round.roundNumber, 'LOCK')} disabled={busy === `LOCK-${round.roundNumber}`} className="px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 text-[10px] font-black flex items-center gap-1"><Lock className="w-3 h-3" /> Lock</button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {(round.fixtures || []).map((fixture) => {
                      const finished = fixture.status === 'CONFIRMED';
                      const editable = fixture.status === 'SCHEDULED' && fixture.homeScore == null && fixture.awayScore == null;
                      return (
                        <div key={fixture.id} className="rounded-xl bg-slate-950/55 border border-slate-800 p-3 flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <TeamRow name={fixture.homeClubName || 'TBD'} score={fixture.homeScore} />
                            <TeamRow name={fixture.awayClubName || 'TBD'} score={fixture.awayScore} />
                            <div className="mt-1.5 flex items-center gap-2 text-[9px] uppercase font-black">
                              <span className={finished ? 'text-emerald-400' : 'text-slate-500'}>{fixture.status}</span>
                              {fixture.winnerClubId && <span className="text-amber-400">winner set</span>}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5 shrink-0">
                            {editable && <button onClick={() => editPairing(fixture)} className="px-2 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-[10px] font-bold flex items-center gap-1"><Edit3 className="w-3 h-3" /> Edit</button>}
                            {finished && round.roundNumber < (details.rounds?.length || 0) && <button onClick={() => manualAdvance(fixture.id)} disabled={busy === `advance-${fixture.id}`} className="px-2 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 text-[10px] font-bold flex items-center gap-1"><Play className="w-3 h-3" /> Retry advance</button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="w-full max-w-3xl max-h-[88vh] overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl flex flex-col">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-3">
              <div><div className="text-[10px] uppercase tracking-wider font-black text-amber-400">{preview.mode === 'REDRAW' ? 'Redraw Preview' : 'Draw Preview'}</div><div className="text-lg font-black text-white">{preview.competitionName}</div></div>
              <div className="flex gap-2"><button onClick={() => previewDraw(true)} className="px-3 py-2 rounded-lg bg-slate-800 text-xs text-slate-200 font-bold flex items-center gap-1"><Shuffle className="w-3.5 h-3.5" /> Shuffle</button><button onClick={() => setPreview(null)} className="w-8 h-8 rounded-lg bg-slate-800 text-slate-300">×</button></div>
            </div>
            <div className="p-4 overflow-y-auto space-y-3">
              {!preview.canGenerate && <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs text-rose-200 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{preview.blockReason}</div>}
              <div className="grid md:grid-cols-2 gap-3"><SeedList title="Direct R16 Byes" clubs={preview.byeTeams} tone="emerald" /><SeedList title="Play-in Pool" clubs={preview.playInTeams} tone="amber" /></div>
              {(preview.rounds || []).map((round) => <div key={round.roundNumber} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className="text-xs font-black text-amber-400 mb-2">{round.roundName}</div><div className="grid sm:grid-cols-2 gap-2">{round.pairings.map((pair, index) => <div key={index} className="rounded-lg bg-slate-900 border border-slate-800 p-2 text-[11px] text-slate-300"><div>{pair.homeClub.position ? `#${pair.homeClub.position} ` : ''}{pair.homeClub.name}</div><div className="text-slate-600">vs</div><div>{pair.awayClub.position ? `#${pair.awayClub.position} ` : ''}{pair.awayClub.name}</div></div>)}</div></div>)}
            </div>
            <div className="p-4 border-t border-slate-800 flex items-center justify-between gap-3"><div className="text-[11px] text-slate-400">Seed: <span className="font-mono">{preview.drawSeed?.slice(-12)}</span></div><div className="flex gap-2"><button onClick={() => setPreview(null)} className="px-3 py-2 rounded-lg bg-slate-800 text-xs text-slate-300 font-bold">Cancel</button>{preview.canGenerate && (!confirmDraw ? <button onClick={() => setConfirmDraw(true)} className="px-3 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-black">Confirm Draw</button> : <button onClick={applyDraw} disabled={busy === 'draw'} className="px-3 py-2 rounded-lg bg-rose-500 text-white text-xs font-black">Apply Exact Draw</button>)}</div></div>
          </div>
        </div>
      )}

      {editingFixture && details && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 space-y-4">
            <div><div className="text-[10px] uppercase font-black tracking-wider text-amber-400">Manual Pairing</div><div className="text-lg font-black text-white">{editingFixture.roundName}</div></div>
            <ClubSelect label="Home" value={homeClubId} disabled={Boolean(editingFixture.homeSourceFixtureId)} participants={details.participants} onChange={setHomeClubId} />
            <ClubSelect label="Away" value={awayClubId} disabled={Boolean(editingFixture.awaySourceFixtureId)} participants={details.participants} onChange={setAwayClubId} />
            <div className="text-[10px] text-slate-500">Winner-source slots are locked and cannot be manually overwritten.</div>
            <div className="flex justify-end gap-2"><button onClick={() => setEditingFixture(null)} className="px-3 py-2 rounded-lg bg-slate-800 text-xs text-slate-300 font-bold">Cancel</button><button onClick={savePairing} disabled={busy === 'pairing'} className="px-3 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-black">Save Pairing</button></div>
          </div>
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; sub: string }> = ({ label, value, sub }) => (
  <div className="glass-card rounded-xl p-3.5"><div className="text-[9px] uppercase font-black tracking-wider text-slate-500">{label}</div><div className="text-base font-black text-white mt-1">{value}</div><div className="text-[10px] text-slate-400 mt-0.5">{sub}</div></div>
);

const TeamRow: React.FC<{ name: string; score: number | null | undefined }> = ({ name, score }) => (
  <div className="flex items-center justify-between gap-2 text-xs font-bold text-slate-200 py-0.5"><span className="truncate">{name}</span><span className="font-mono text-amber-400">{score == null ? '-' : score}</span></div>
);

const SeedList: React.FC<{ title: string; clubs: SeededClub[]; tone: 'emerald' | 'amber' }> = ({ title, clubs, tone }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div className={`text-[10px] uppercase font-black tracking-wider mb-2 ${tone === 'emerald' ? 'text-emerald-400' : 'text-amber-400'}`}>{title}</div><div className="flex flex-wrap gap-1.5">{clubs.map((club) => <span key={club.id} className="px-2 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[10px] text-slate-300">#{club.position} {club.name}</span>)}</div></div>
);

const ClubSelect: React.FC<{
  label: string;
  value: string;
  disabled: boolean;
  participants: CupDetails['participants'];
  onChange: (value: string) => void;
}> = ({ label, value, disabled, participants, onChange }) => (
  <label className="block"><div className="text-[10px] uppercase tracking-wider font-black text-slate-500 mb-1.5">{label}</div><select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl bg-slate-950 border border-slate-700 px-3 py-2.5 text-sm text-white disabled:opacity-40"><option value="">TBD</option>{participants.map((participant) => <option key={participant.clubId} value={participant.clubId}>{participant.clubName}</option>)}</select></label>
);
