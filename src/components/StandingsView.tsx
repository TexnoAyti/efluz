import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Competition, StandingsRow } from '../types';
import {
  Trophy,
  Shield,
  Loader2,
  TrendingUp,
  Award,
  Globe2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

export const StandingsView: React.FC = () => {
  const { currentClub, activeSeasonId } = useAuth();
  const { t } = useI18n();

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string>('comp-premier-league-2026');
  const [standings, setStandings] = useState<StandingsRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadComps() {
      setIsLoading(true);
      try {
        const res = await api.getCompetitions(activeSeasonId);
        // Prioritize leagues
        const leagues = (res.competitions || []).filter((c) => c.type === 'LEAGUE');
        setCompetitions(leagues.length > 0 ? leagues : res.competitions || []);
        if (leagues.length > 0) {
          setSelectedCompetitionId(leagues[0].id);
        } else if (res.competitions && res.competitions.length > 0) {
          setSelectedCompetitionId(res.competitions[0].id);
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

  const loadStandings = async (skipCache = false) => {
    if (!selectedCompetitionId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getCompetitionStandings(selectedCompetitionId, skipCache);
      setStandings(res.standings || []);
    } catch (err: any) {
      console.error('Failed to load standings:', err);
      setError(err.message || 'Failed to load standings.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStandings();
  }, [selectedCompetitionId, activeSeasonId]);

  const activeComp = competitions.find((c) => c.id === selectedCompetitionId);

  const getPositionStyle = (position: number, totalTeams: number) => {
    if (position <= 4) {
      return {
        badgeColor: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
        barColor: 'bg-blue-500',
        label: t.uclZone,
      };
    }
    if (position === 5) {
      return {
        badgeColor: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
        barColor: 'bg-indigo-500',
        label: t.uelZone,
      };
    }
    if (position === 6) {
      return {
        badgeColor: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
        barColor: 'bg-teal-500',
        label: t.ueclZone,
      };
    }
    if (position > totalTeams - 3) {
      return {
        badgeColor: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
        barColor: 'bg-rose-500',
        label: t.relegationZone,
      };
    }
    return {
      badgeColor: 'bg-slate-800 text-slate-400 border-slate-700',
      barColor: 'bg-transparent',
      label: '',
    };
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-300 pb-20 max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 glass-panel p-4 sm:p-5 shadow-xl">
        <div className="min-w-0">
          <h2 className="text-base sm:text-xl font-black text-white tracking-tight flex items-center gap-2 truncate">
            <Trophy className="w-5 h-5 text-amber-400 shrink-0" />
            <span>{t.leagueStandings}</span>
          </h2>
          <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
            Real-time standings calculated from verified two-party match results.
          </p>
        </div>

        {/* Competition Dropdown */}
        <div className="w-full sm:w-64 shrink-0">
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            {t.topLeagues}
          </label>
          <select
            id="select-standings-competition"
            value={selectedCompetitionId}
            onChange={(e) => setSelectedCompetitionId(e.target.value)}
            className="w-full px-3 py-2 glass-input rounded-xl text-xs font-bold text-white focus:outline-none focus:border-emerald-500/60 min-h-[40px]"
          >
            {competitions.map((comp) => (
              <option key={comp.id} value={comp.id} className="bg-slate-900 text-white">
                {comp.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Standings Table Container */}
      <div className="glass-panel shadow-xl overflow-hidden max-w-full">
        {/* Table Title Bar */}
        <div className="p-3.5 sm:p-4 border-b border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-white/[0.02]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-xs shrink-0">
              🏆
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-xs sm:text-sm text-slate-100 truncate">{activeComp?.name || 'League Table'}</h3>
              <p className="text-[10px] text-slate-400">Season 2026/27 • Double Round-Robin</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-[10px]">
            <div className="flex items-center gap-1 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span>{t.uclZone} (1-4)</span>
            </div>
            <div className="flex items-center gap-1 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-indigo-500" />
              <span>{t.uelZone} (5)</span>
            </div>
            <div className="flex items-center gap-1 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>{t.relegationZone}</span>
            </div>
          </div>
        </div>

        {error && !isLoading && (
          <div className="m-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-between gap-2 text-rose-300 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span className="truncate">{error}</span>
            </div>
            <button
              onClick={() => loadStandings(true)}
              className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-bold text-xs flex items-center gap-1 shrink-0"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center text-slate-400">
            <Loader2 className="w-7 h-7 animate-spin text-emerald-400 mb-2" />
            <span className="text-xs">{t.loading}</span>
          </div>
        ) : standings.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-xs">
            No standings data recorded for this tournament yet.
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-left text-xs border-collapse min-w-[320px]">
              <thead>
                <tr className="bg-slate-950/70 border-b border-white/[0.06] text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-2.5 px-2 w-8 text-center">{t.pos}</th>
                  <th className="py-2.5 px-2 min-w-[120px] sm:min-w-[160px]">{t.club}</th>
                  <th className="py-2.5 px-1.5 text-center w-8">{t.p}</th>
                  <th className="py-2.5 px-1.5 text-center w-8 hidden sm:table-cell">{t.w}</th>
                  <th className="py-2.5 px-1.5 text-center w-8 hidden sm:table-cell">{t.d}</th>
                  <th className="py-2.5 px-1.5 text-center w-8 hidden sm:table-cell">{t.l}</th>
                  <th className="py-2.5 px-1.5 text-center w-9 hidden md:table-cell">{t.gf}</th>
                  <th className="py-2.5 px-1.5 text-center w-9 hidden md:table-cell">{t.ga}</th>
                  <th className="py-2.5 px-1.5 text-center w-10">{t.gd}</th>
                  <th className="py-2.5 px-2.5 text-center w-12 font-black text-emerald-400">{t.pts}</th>
                  <th className="py-2.5 px-3 min-w-[100px] hidden lg:table-cell text-center">{t.recentForm}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04] font-semibold tabular-nums">
                {standings.map((row) => {
                  const isUserClub = row.clubId === currentClub?.id;
                  const posStyle = getPositionStyle(row.position, standings.length);

                  return (
                    <tr
                      key={row.clubId}
                      className={`hover:bg-white/[0.04] transition-colors ${
                        isUserClub ? 'bg-emerald-500/10 font-bold' : ''
                      }`}
                    >
                      {/* Pos */}
                      <td className="py-2.5 px-2 text-center relative">
                        <div className={`w-1 absolute left-0 top-0 bottom-0 ${posStyle.barColor}`} />
                        <span
                          className={`inline-flex items-center justify-center w-5 h-5 rounded-md text-[10px] font-black border ${
                            posStyle.badgeColor
                          }`}
                        >
                          {row.position}
                        </span>
                      </td>

                      {/* Club Name & Manager */}
                      <td className="py-2.5 px-2">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-md bg-slate-950/80 p-0.5 border border-white/[0.08] flex items-center justify-center shrink-0">
                            <img
                              src={row.clubLogoUrl}
                              alt={row.clubName}
                              className="w-4 h-4 object-contain"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`font-bold truncate text-slate-100 text-xs ${isUserClub ? 'text-emerald-400 font-black' : ''}`}>
                                {row.clubName}
                              </span>
                              {isUserClub && (
                                <span className="px-1 py-0.2 rounded text-[8px] font-black uppercase tracking-wider bg-emerald-500 text-slate-950 shrink-0">
                                  YOU
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 font-medium truncate">
                              @{row.managerUsername || 'open'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* P */}
                      <td className="py-2.5 px-1.5 text-center text-slate-300 text-xs">{row.played}</td>
                      
                      {/* W, D, L */}
                      <td className="py-2.5 px-1.5 text-center text-emerald-400 font-bold hidden sm:table-cell text-xs">{row.won}</td>
                      <td className="py-2.5 px-1.5 text-center text-amber-400 font-bold hidden sm:table-cell text-xs">{row.drawn}</td>
                      <td className="py-2.5 px-1.5 text-center text-rose-400 font-bold hidden sm:table-cell text-xs">{row.lost}</td>

                      {/* GF, GA */}
                      <td className="py-2.5 px-1.5 text-center text-slate-400 hidden md:table-cell text-xs">{row.goalsFor}</td>
                      <td className="py-2.5 px-1.5 text-center text-slate-400 hidden md:table-cell text-xs">{row.goalsAgainst}</td>

                      {/* GD */}
                      <td className="py-2.5 px-1.5 text-center text-slate-200 text-xs font-bold">
                        {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                      </td>

                      {/* Points */}
                      <td className="py-2.5 px-2.5 text-center font-black text-xs text-emerald-400 bg-emerald-500/5">
                        {row.points}
                      </td>

                      {/* Form */}
                      <td className="py-2.5 px-3 hidden lg:table-cell text-center">
                        <div className="flex items-center justify-center gap-1">
                          {row.recentForm && row.recentForm.length > 0 ? (
                            row.recentForm.split('').map((char, i) => (
                              <span
                                key={i}
                                className={`w-3.5 h-3.5 rounded text-[8px] font-black flex items-center justify-center ${
                                  char === 'W'
                                    ? 'bg-emerald-500 text-slate-950 shadow-[0_0_6px_rgba(16,185,129,0.3)]'
                                    : char === 'D'
                                    ? 'bg-amber-500 text-slate-950'
                                    : 'bg-rose-500 text-white'
                                }`}
                              >
                                {char}
                              </span>
                            ))
                          ) : (
                            <span className="text-[10px] text-slate-600">-</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
