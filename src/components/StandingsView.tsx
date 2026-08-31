import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Competition, StandingsRow } from '../types';
import { ClubCrest } from './ClubCrest';
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
        <div className="p-3 sm:p-3.5 border-b border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-[#090e18]">
          <div className="flex items-center gap-2 min-w-0">
            <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-bold text-xs sm:text-sm text-slate-100 truncate">{activeComp?.name || 'League Table'}</h3>
              <p className="text-[10px] text-slate-400">Season 2026/27 • Double Round-Robin</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-[10px]">
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span>{t.uclZone} (1-4)</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-indigo-500" />
              <span>{t.uelZone} (5)</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>{t.relegationZone}</span>
            </div>
          </div>
        </div>

        {error && standings.length === 0 && !isLoading && (
          <div className="m-4 p-6 rounded-2xl glass-panel border-rose-500/30 bg-rose-950/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-rose-200 text-xs shadow-xl">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
              <div>
                <div className="font-bold text-sm text-white">Couldn't load data</div>
                <div className="text-xs text-rose-300/80 mt-0.5">Please try again.</div>
              </div>
            </div>
            <button
              onClick={() => loadStandings(true)}
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center gap-1.5 shrink-0 shadow-md transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {isLoading && standings.length === 0 ? (
          <div className="p-4 space-y-2 animate-pulse">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="h-9 rounded-xl bg-white/[0.04] border border-white/[0.04]" />
            ))}
          </div>
        ) : standings.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs">
            No standings data recorded for this tournament yet.
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-left text-xs border-collapse min-w-[320px]">
              <thead>
                <tr className="bg-[#0b101c] border-b border-white/[0.06] text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-2 px-2 w-7 text-center">#</th>
                  <th className="py-2 px-2 min-w-[120px] sm:min-w-[160px]">TEAM</th>
                  <th className="py-2 px-1 text-center w-7">P</th>
                  <th className="py-2 px-1 text-center w-7 hidden sm:table-cell">W</th>
                  <th className="py-2 px-1 text-center w-7 hidden sm:table-cell">D</th>
                  <th className="py-2 px-1 text-center w-7 hidden sm:table-cell">L</th>
                  <th className="py-2 px-1 text-center w-8 hidden md:table-cell">GF</th>
                  <th className="py-2 px-1 text-center w-8 hidden md:table-cell">GA</th>
                  <th className="py-2 px-1.5 text-center w-9">GD</th>
                  <th className="py-2 px-2 text-center w-10 font-bold text-emerald-400">PTS</th>
                  <th className="py-2 px-2.5 min-w-[90px] hidden lg:table-cell text-center">FORM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04] tabular-nums text-xs">
                {standings.map((row) => {
                  const isUserClub = row.clubId === currentClub?.id;
                  const posStyle = getPositionStyle(row.position, standings.length);

                  return (
                    <tr
                      key={row.clubId}
                      className={`hover:bg-white/[0.03] transition-colors ${
                        isUserClub ? 'bg-emerald-500/[0.08]' : ''
                      }`}
                    >
                      {/* Pos */}
                      <td className="py-2 px-2 text-center relative font-bold text-[11px]">
                        <div className={`w-0.5 absolute left-0 top-0 bottom-0 ${posStyle.barColor}`} />
                        <span className={`text-slate-300 ${row.position <= 4 ? 'text-blue-400 font-black' : row.position === 5 ? 'text-indigo-400' : ''}`}>
                          {row.position}
                        </span>
                      </td>

                      {/* Club Name & Badge */}
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded bg-slate-950/80 p-0.5 border border-white/[0.06] flex items-center justify-center shrink-0">
                            <ClubCrest
                              clubId={row.clubId}
                              logoUrl={row.clubLogoUrl}
                              name={row.clubName}
                              size="xs"
                              className="w-4 h-4"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className={`font-semibold truncate text-slate-100 text-xs ${isUserClub ? 'text-emerald-400 font-bold' : ''}`}>
                                {row.clubName}
                              </span>
                              {isUserClub && (
                                <span className="px-1 py-0.2 rounded text-[8px] font-black uppercase bg-emerald-500 text-slate-950 shrink-0">
                                  YOU
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">
                              @{row.managerUsername || 'open'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* P */}
                      <td className="py-2 px-1 text-center text-slate-300">{row.played}</td>
                      
                      {/* W, D, L */}
                      <td className="py-2 px-1 text-center text-slate-300 hidden sm:table-cell">{row.won}</td>
                      <td className="py-2 px-1 text-center text-slate-400 hidden sm:table-cell">{row.drawn}</td>
                      <td className="py-2 px-1 text-center text-slate-400 hidden sm:table-cell">{row.lost}</td>

                      {/* GF, GA */}
                      <td className="py-2 px-1 text-center text-slate-400 hidden md:table-cell">{row.goalsFor}</td>
                      <td className="py-2 px-1 text-center text-slate-400 hidden md:table-cell">{row.goalsAgainst}</td>

                      {/* GD */}
                      <td className="py-2 px-1.5 text-center text-slate-200 font-medium">
                        {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                      </td>

                      {/* Points */}
                      <td className="py-2 px-2 text-center font-black text-emerald-400 bg-emerald-500/[0.04]">
                        {row.points}
                      </td>

                      {/* Form */}
                      <td className="py-2 px-2.5 hidden lg:table-cell text-center">
                        <div className="flex items-center justify-center gap-1">
                          {row.recentForm && row.recentForm.length > 0 ? (
                            row.recentForm.split('').map((char, i) => (
                              <span
                                key={i}
                                className={`w-3.5 h-3.5 rounded text-[8px] font-black flex items-center justify-center ${
                                  char === 'W'
                                    ? 'bg-emerald-500 text-slate-950'
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
