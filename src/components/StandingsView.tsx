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
} from 'lucide-react';

export const StandingsView: React.FC = () => {
  const { currentClub, activeSeasonId } = useAuth();
  const { t } = useI18n();

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string>('comp-premier-league-2026');
  const [standings, setStandings] = useState<StandingsRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadComps() {
      try {
        const res = await api.getCompetitions(activeSeasonId);
        // Prioritize leagues
        const leagues = res.competitions.filter((c) => c.type === 'LEAGUE');
        setCompetitions(leagues.length > 0 ? leagues : res.competitions);
        if (leagues.length > 0) {
          setSelectedCompetitionId(leagues[0].id);
        }
      } catch (err: any) {
        console.error('Failed to load competitions:', err);
      }
    }
    loadComps();
  }, [activeSeasonId]);

  const loadStandings = async () => {
    if (!selectedCompetitionId) return;
    setIsLoading(true);
    try {
      const res = await api.getCompetitionStandings(selectedCompetitionId);
      setStandings(res.standings);
    } catch (err: any) {
      console.error('Failed to load standings:', err);
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
    <div className="space-y-4 animate-in fade-in duration-300 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-5 sm:p-6 shadow-xl">
        <div>
          <h2 className="text-lg sm:text-xl font-black text-white tracking-tight flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-400" />
            <span>{t.leagueStandings}</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Dynamic real-time standings calculated from verified two-party match results.
          </p>
        </div>

        {/* Competition Dropdown */}
        <div className="w-full sm:w-72">
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            {t.topLeagues}
          </label>
          <select
            id="select-standings-competition"
            value={selectedCompetitionId}
            onChange={(e) => setSelectedCompetitionId(e.target.value)}
            className="w-full px-3 py-2 glass-input rounded-xl text-xs font-bold text-white focus:outline-none focus:border-emerald-500/60"
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
      <div className="glass-panel shadow-xl overflow-hidden">
        {/* Table Title Bar */}
        <div className="p-4 sm:p-5 border-b border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-sm">
              🏆
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-100">{activeComp?.name || 'League Table'}</h3>
              <p className="text-[10px] text-slate-400">Season 2026/27 • Double Round-Robin</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[10px]">
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
              <span>{t.uclZone} (1-4)</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
              <span>{t.uelZone} (5)</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
              <span>{t.relegationZone} (18-20)</span>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="py-20 flex flex-col items-center justify-center text-slate-400">
            <Loader2 className="w-7 h-7 animate-spin text-emerald-400 mb-2" />
            <span className="text-xs">{t.loading}</span>
          </div>
        ) : standings.length === 0 ? (
          <div className="py-16 text-center text-slate-500 text-xs">
            No standings data recorded for this tournament yet.
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950/60 border-b border-white/[0.06] text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-12 text-center">{t.pos}</th>
                  <th className="py-2.5 px-4 min-w-[180px]">{t.club}</th>
                  <th className="py-2.5 px-2 text-center w-10">{t.p}</th>
                  <th className="py-2.5 px-2 text-center w-10">{t.w}</th>
                  <th className="py-2.5 px-2 text-center w-10">{t.d}</th>
                  <th className="py-2.5 px-2 text-center w-10">{t.l}</th>
                  <th className="py-2.5 px-2 text-center w-12 hidden md:table-cell">{t.gf}</th>
                  <th className="py-2.5 px-2 text-center w-12 hidden md:table-cell">{t.ga}</th>
                  <th className="py-2.5 px-2 text-center w-12">{t.gd}</th>
                  <th className="py-2.5 px-3 text-center w-14 font-black text-emerald-400">{t.pts}</th>
                  <th className="py-2.5 px-4 min-w-[120px] hidden lg:table-cell text-center">{t.recentForm}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04] font-semibold">
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
                      <td className="py-2.5 px-3 text-center relative">
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
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-6 h-6 rounded-lg bg-slate-950/80 p-0.5 border border-white/[0.08] flex items-center justify-center shrink-0">
                            <img
                              src={row.clubLogoUrl}
                              alt={row.clubName}
                              className="w-4 h-4 object-contain"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`font-bold truncate text-slate-100 ${isUserClub ? 'text-emerald-400 font-black' : ''}`}>
                                {row.clubName}
                              </span>
                              {isUserClub && (
                                <span className="px-1.5 py-0.2 rounded text-[8px] font-black uppercase tracking-wider bg-emerald-500 text-slate-950">
                                  YOU
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 font-medium">
                              @{row.managerUsername || 'open'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* P, W, D, L */}
                      <td className="py-2.5 px-2 text-center text-slate-300">{row.played}</td>
                      <td className="py-2.5 px-2 text-center text-emerald-400 font-bold">{row.won}</td>
                      <td className="py-2.5 px-2 text-center text-amber-400 font-bold">{row.drawn}</td>
                      <td className="py-2.5 px-2 text-center text-rose-400 font-bold">{row.lost}</td>

                      {/* GF, GA, GD */}
                      <td className="py-2.5 px-2 text-center text-slate-400 hidden md:table-cell">{row.goalsFor}</td>
                      <td className="py-2.5 px-2 text-center text-slate-400 hidden md:table-cell">{row.goalsAgainst}</td>
                      <td className="py-2.5 px-2 text-center font-bold text-slate-200">
                        {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                      </td>

                      {/* Points */}
                      <td className="py-2.5 px-3 text-center font-black text-xs text-emerald-400 bg-slate-950/30">
                        {row.points}
                      </td>

                      {/* Form */}
                      <td className="py-2.5 px-4 hidden lg:table-cell text-center">
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
