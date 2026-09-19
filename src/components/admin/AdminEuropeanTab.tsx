import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import {
  Trophy,
  RefreshCw,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Shield,
  ArrowRight,
  TrendingUp,
  Info,
  Play,
  Lock,
} from 'lucide-react';

interface EuropeanStandingsRow {
  position: number;
  clubId: string;
  clubName: string;
  badgeUrl?: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  zone: 'DIRECT_R16' | 'KNOCKOUT_PLAYOFF' | 'ELIMINATED';
  zoneLabel: string;
}

interface QualificationPreviewData {
  previewToken: string;
  seasonId: string;
  mode: 'provisional' | 'final';
  canApply: boolean;
  blockReason?: string;
  domesticLeaguesCompleted: boolean;
  unplayedLeagueMatchesCount: number;
  hasEuropeanStarted: boolean;
  summary: {
    ucl: { totalTarget: number; retainedCount: number; addedCount: number; removedCount: number };
    uel: { totalTarget: number; retainedCount: number; addedCount: number; removedCount: number };
  };
  diff: {
    ucl: {
      competitionName: string;
      totalTarget: number;
      retained: Array<{ clubId: string; clubName: string; rank: number; sourceLeague: string }>;
      added: Array<{ clubId: string; clubName: string; rank: number; sourceLeague: string }>;
      removed: Array<{ clubId: string; clubName: string; previousReason?: string }>;
    };
    uel: {
      competitionName: string;
      totalTarget: number;
      retained: Array<{ clubId: string; clubName: string; rank: number; sourceLeague: string }>;
      added: Array<{ clubId: string; clubName: string; rank: number; sourceLeague: string }>;
      removed: Array<{ clubId: string; clubName: string; previousReason?: string }>;
    };
  };
  generatedAt: string;
  expiresAt: string;
}

export const AdminEuropeanTab: React.FC = () => {
  const { showToast } = useAuth();

  const [selectedCompId, setSelectedCompId] = useState<string>('comp-champions-league-2026');
  const [standings, setStandings] = useState<EuropeanStandingsRow[]>([]);
  const [standingsSource, setStandingsSource] = useState<string>('redis-read-model');
  const [isLoadingStandings, setIsLoadingStandings] = useState<boolean>(true);
  const [isRebuilding, setIsRebuilding] = useState<boolean>(false);

  // Qualification Sync States
  const [syncMode, setSyncMode] = useState<'provisional' | 'final'>('provisional');
  const [preview, setPreview] = useState<QualificationPreviewData | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [hasConfirmedApply, setHasConfirmedApply] = useState<boolean>(false);

  useEffect(() => {
    loadStandings(selectedCompId);
  }, [selectedCompId]);

  async function loadStandings(compId: string) {
    setIsLoadingStandings(true);
    try {
      const res = await api.getEuropeanStandings(compId);
      setStandings(res.standings || []);
      setStandingsSource(res.source || 'redis-read-model');
    } catch (err: any) {
      showToast(err.message || 'Failed to load European standings', 'error');
    } finally {
      setIsLoadingStandings(false);
    }
  }

  async function handleRebuildStandings() {
    setIsRebuilding(true);
    try {
      const res = await api.rebuildEuropeanStandings(selectedCompId);
      setStandings(res.standings || []);
      setStandingsSource('rebuilt-firestore');
      showToast(res.message || 'Standings recalculated from confirmed fixtures', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to recalculate European standings', 'error');
    } finally {
      setIsRebuilding(false);
    }
  }

  async function handleGeneratePreview() {
    setIsPreviewLoading(true);
    try {
      const data = await api.previewEuropeanQualification('season-2026-27', syncMode);
      setPreview(data);
      setHasConfirmedApply(false);
    } catch (err: any) {
      showToast(err.message || 'Failed to generate qualification preview', 'error');
    } finally {
      setIsPreviewLoading(false);
    }
  }

  async function handleApplySync() {
    if (!preview || !preview.previewToken) return;
    if (!hasConfirmedApply) {
      showToast('Please check the confirmation box before applying sync', 'info');
      return;
    }

    setIsApplying(true);
    try {
      const res = await api.applyEuropeanQualification({
        previewToken: preview.previewToken,
        confirmation: true,
        seasonId: 'season-2026-27',
      });
      showToast(res.message || 'Successfully applied European qualifications!', 'success');
      setPreview(null);
      await loadStandings(selectedCompId);
    } catch (err: any) {
      showToast(err.message || 'Failed to apply qualification sync', 'error');
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Banner */}
      <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
            <Trophy className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-white text-sm">UEFA European Competitions</h4>
            <p className="text-slate-400 text-[11px] mt-0.5">
              Jadval va saralash zonalari turnirning saqlangan sozlamalari asosida ko‘rsatiladi.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-500/15 text-blue-400 border border-blue-500/30">
            UCL & UEL
          </span>
        </div>
      </div>

      {/* Competition Toggle */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => setSelectedCompId('comp-champions-league-2026')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${
            selectedCompId === 'comp-champions-league-2026'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30 scale-[1.02]'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <Trophy className="w-4 h-4 text-amber-300" />
          <span>UEFA Champions League</span>
        </button>

        <button
          onClick={() => setSelectedCompId('comp-europa-league-2026')}
          className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 ${
            selectedCompId === 'comp-europa-league-2026'
              ? 'bg-amber-600 text-white shadow-lg shadow-amber-600/30 scale-[1.02]'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <Trophy className="w-4 h-4 text-amber-200" />
          <span>UEFA Europa League</span>
        </button>
      </div>

      {/* Standings Table Card */}
      <div className="glass-panel p-5 rounded-2xl border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-black text-white flex items-center gap-2">
              <span>{selectedCompId.includes('champions') ? 'UEFA Champions League' : 'UEFA Europa League'} Standings</span>
              <span className="text-xs text-slate-400 font-semibold">({standings.length} Teams)</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Source: <span className="font-mono text-emerald-400 font-bold">{standingsSource}</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRebuildStandings}
              disabled={isRebuilding}
              className="px-3 py-1.5 glass-card text-slate-300 hover:text-white rounded-xl text-xs font-bold flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isRebuilding ? 'animate-spin' : ''}`} />
              <span>Rebuild Standings</span>
            </button>
          </div>
        </div>

        {/* Standings Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[10px] font-bold uppercase text-slate-400">
                <th className="py-2.5 px-3">#</th>
                <th className="py-2.5 px-3">Club</th>
                <th className="py-2.5 px-2 text-center">P</th>
                <th className="py-2.5 px-2 text-center">W</th>
                <th className="py-2.5 px-2 text-center">D</th>
                <th className="py-2.5 px-2 text-center">L</th>
                <th className="py-2.5 px-2 text-center">GF</th>
                <th className="py-2.5 px-2 text-center">GA</th>
                <th className="py-2.5 px-2 text-center">GD</th>
                <th className="py-2.5 px-3 text-center font-black text-white">PTS</th>
                <th className="py-2.5 px-3 text-right">Qualification Zone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {standings.map((row) => {
                const isR16 = row.zone === 'DIRECT_R16';
                const isPlayoff = row.zone === 'KNOCKOUT_PLAYOFF';

                return (
                  <tr
                    key={row.clubId}
                    className={`hover:bg-slate-900/60 transition-colors ${
                      isR16 ? 'bg-emerald-950/20' : isPlayoff ? 'bg-blue-950/20' : ''
                    }`}
                  >
                    <td className="py-2 px-3 font-mono font-bold text-slate-400">
                      <span
                        className={`inline-block w-5 text-center ${
                          isR16 ? 'text-emerald-400' : isPlayoff ? 'text-blue-400' : 'text-slate-500'
                        }`}
                      >
                        {row.position}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-bold text-white flex items-center gap-2">
                      {row.badgeUrl ? (
                        <img src={row.badgeUrl} alt="" className="w-4 h-4 object-contain" referrerPolicy="no-referrer" />
                      ) : (
                        <Shield className="w-4 h-4 text-slate-500" />
                      )}
                      <span className="truncate max-w-[200px]">{row.clubName}</span>
                    </td>
                    <td className="py-2 px-2 text-center text-slate-300 font-mono">{row.played}</td>
                    <td className="py-2 px-2 text-center text-slate-300 font-mono">{row.won}</td>
                    <td className="py-2 px-2 text-center text-slate-300 font-mono">{row.drawn}</td>
                    <td className="py-2 px-2 text-center text-slate-300 font-mono">{row.lost}</td>
                    <td className="py-2 px-2 text-center text-slate-400 font-mono">{row.goalsFor}</td>
                    <td className="py-2 px-2 text-center text-slate-400 font-mono">{row.goalsAgainst}</td>
                    <td className="py-2 px-2 text-center font-mono font-bold text-slate-300">
                      {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                    </td>
                    <td className="py-2 px-3 text-center font-mono font-black text-amber-400 text-sm">
                      {row.points}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isR16
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : isPlayoff
                            ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {isR16 ? 'Round of 16' : isPlayoff ? 'Play-offs (9-24)' : 'Eliminated'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* European Qualification Sync Section */}
      <div className="glass-panel p-5 rounded-2xl border-slate-800 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-base font-black text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span>European Qualification Projections & Sync</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Saralash hozirgi tasdiqlangan natijalar va bazada belgilangan liga kvotalari asosida hisoblanadi.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-900 rounded-xl p-1 border border-slate-800">
              <button
                onClick={() => setSyncMode('provisional')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  syncMode === 'provisional'
                    ? 'bg-amber-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Provisional
              </button>
              <button
                onClick={() => setSyncMode('final')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  syncMode === 'final'
                    ? 'bg-emerald-500 text-slate-950 shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Final (Post-Season)
              </button>
            </div>

            <button
              onClick={handleGeneratePreview}
              disabled={isPreviewLoading}
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-blue-600/20"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Preview Sync Diff</span>
            </button>
          </div>
        </div>

        {/* Preview Output */}
        {preview && (
          <div className="space-y-4 p-4 bg-slate-900/80 border border-slate-800 rounded-xl">
            {/* Safety status banner */}
            <div
              className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
                preview.canApply
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}
            >
              {preview.canApply ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="font-bold">
                  {preview.canApply ? 'Preconditions Passed: Ready to Apply' : 'Precondition Blocked'}
                </div>
                <div className="text-[11px] opacity-90 mt-0.5">
                  {preview.blockReason ||
                    `Domestic leagues finished: ${preview.domesticLeaguesCompleted ? 'Yes' : 'In Progress'}. European competitions active: ${preview.hasEuropeanStarted ? 'Yes' : 'No'}.`}
                </div>
              </div>
            </div>

            {/* Diffs Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* UCL Diff */}
              <div className="glass-card p-3.5 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between font-bold text-xs">
                  <span className="text-blue-400 font-black">UEFA Champions League ({preview.summary.ucl.totalTarget})</span>
                  <span className="text-slate-400">
                    {preview.summary.ucl.retainedCount} Retained • {preview.summary.ucl.addedCount} Added
                  </span>
                </div>

                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {preview.diff.ucl.added.map((item) => (
                    <div key={item.clubId} className="p-1.5 bg-emerald-950/30 border border-emerald-500/30 rounded text-xs flex items-center justify-between">
                      <span className="font-bold text-emerald-300">{item.clubName}</span>
                      <span className="text-[10px] text-emerald-400 font-mono">+{item.sourceLeague} #{item.rank}</span>
                    </div>
                  ))}
                  {preview.diff.ucl.retained.map((item) => (
                    <div key={item.clubId} className="p-1.5 bg-slate-900/60 rounded text-xs flex items-center justify-between text-slate-300">
                      <span>{item.clubName}</span>
                      <span className="text-[10px] text-slate-500 font-mono">{item.sourceLeague} #{item.rank}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* UEL Diff */}
              <div className="glass-card p-3.5 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between font-bold text-xs">
                  <span className="text-amber-400 font-black">UEFA Europa League ({preview.summary.uel.totalTarget})</span>
                  <span className="text-slate-400">
                    {preview.summary.uel.retainedCount} Retained • {preview.summary.uel.addedCount} Added
                  </span>
                </div>

                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {preview.diff.uel.added.map((item) => (
                    <div key={item.clubId} className="p-1.5 bg-emerald-950/30 border border-emerald-500/30 rounded text-xs flex items-center justify-between">
                      <span className="font-bold text-emerald-300">{item.clubName}</span>
                      <span className="text-[10px] text-emerald-400 font-mono">+{item.sourceLeague} #{item.rank}</span>
                    </div>
                  ))}
                  {preview.diff.uel.retained.map((item) => (
                    <div key={item.clubId} className="p-1.5 bg-slate-900/60 rounded text-xs flex items-center justify-between text-slate-300">
                      <span>{item.clubName}</span>
                      <span className="text-[10px] text-slate-500 font-mono">{item.sourceLeague} #{item.rank}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Apply Action Bar */}
            {preview.canApply && (
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
                <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasConfirmedApply}
                    onChange={(e) => setHasConfirmedApply(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-700 text-emerald-500 focus:ring-0"
                  />
                  <span>I confirm this European qualification synchronization for Season 2026/27.</span>
                </label>

                <button
                  onClick={handleApplySync}
                  disabled={!hasConfirmedApply || isApplying}
                  className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all ${
                    hasConfirmedApply
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  {isApplying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>{isApplying ? 'Applying Sync...' : 'Apply Qualifications'}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
