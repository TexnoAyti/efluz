import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Competition, StandingsRow, Fixture } from '../types';
import {
  Globe2,
  Trophy,
  Award,
  Shield,
  Calendar,
  Sparkles,
  ChevronRight,
  Info,
  CheckCircle2,
} from 'lucide-react';

export const ChampionsLeagueView: React.FC = () => {
  const { activeSeasonId } = useAuth();
  const { t } = useI18n();

  const [tournaments, setTournaments] = useState<Competition[]>([]);
  const [selectedTournament, setSelectedTournament] = useState<Competition | null>(null);
  const [standings, setStandings] = useState<StandingsRow[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [activeTab, setActiveTab] = useState<'STANDINGS' | 'BRACKET' | 'QUALIFICATION'>('STANDINGS');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadEuropeanData() {
      setIsLoading(true);
      try {
        const compsRes = await api.getCompetitions(activeSeasonId);
        const uefaComps = compsRes.competitions.filter(
          (c) =>
            c.type === 'EUROPEAN_LEAGUE_PHASE' ||
            c.type === 'EUROPEAN_KNOCKOUT' ||
            c.id.includes('champions') ||
            c.id.includes('europa') ||
            c.id.includes('conference')
        );
        setTournaments(uefaComps);

        if (uefaComps.length > 0) {
          const defaultComp = uefaComps.find((c) => c.id.includes('champions')) || uefaComps[0];
          setSelectedTournament(defaultComp);
          loadTournamentDetails(defaultComp.id);
        }
      } catch (err: any) {
        console.error('Failed to load European tournament data:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadEuropeanData();
  }, [activeSeasonId]);

  const loadTournamentDetails = async (compId: string) => {
    try {
      const [standRes, partRes, fixRes] = await Promise.all([
        api.getCompetitionStandings(compId).catch(() => ({ standings: [] })),
        api.getCompetitionParticipants(compId).catch(() => ({ participants: [] })),
        api.getCompetitionFixtures(compId).catch(() => ({ fixtures: [] })),
      ]);
      setStandings(standRes.standings || []);
      setParticipants(partRes.participants || []);
      setFixtures(fixRes.fixtures || []);
    } catch (err: any) {
      console.error('Error fetching tournament details:', err);
    }
  };

  const handleSelectTournament = (comp: Competition) => {
    setSelectedTournament(comp);
    loadTournamentDetails(comp.id);
  };

  // Group fixtures by roundName
  const fixturesByRound: Record<string, Fixture[]> = {};
  fixtures.forEach((f) => {
    const round = f.roundName || `Matchday ${f.matchday}`;
    if (!fixturesByRound[round]) {
      fixturesByRound[round] = [];
    }
    fixturesByRound[round].push(f);
  });

  const rounds = Object.keys(fixturesByRound);

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-20">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-blue-950 via-indigo-950 to-slate-900 border border-blue-900/60 p-6 sm:p-8 shadow-2xl">
        <div className="absolute top-0 right-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-300 text-xs font-black uppercase tracking-wider mb-2 backdrop-blur-sm">
              <Sparkles className="w-3.5 h-3.5" />
              <span>UEFA Club Competitions 2026/27</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
              {selectedTournament?.name || t.uefaChampionsLeague}
            </h1>
            <p className="text-xs sm:text-sm text-blue-200 mt-1 max-w-xl">
              Europe’s premier club competition. Qualified purely through user results and domestic league standings.
            </p>
          </div>

          {/* Tournament Switcher Buttons */}
          <div className="flex flex-wrap gap-2">
            {tournaments.map((comp) => {
              const isSelected = selectedTournament?.id === comp.id;
              return (
                <button
                  key={comp.id}
                  onClick={() => handleSelectTournament(comp)}
                  className={`px-4 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center gap-2 border ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-400 shadow-lg shadow-blue-600/30 scale-105'
                      : 'bg-slate-900/80 text-slate-300 border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  <Trophy className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-blue-400'}`} />
                  <span>{comp.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        <button
          onClick={() => setActiveTab('STANDINGS')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'STANDINGS'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 bg-slate-900'
          }`}
        >
          {t.leaguePhase} ({participants.length > 0 ? `${participants.length} Clubs` : 'Overview'})
        </button>
        <button
          onClick={() => setActiveTab('BRACKET')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'BRACKET'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 bg-slate-900'
          }`}
        >
          {t.knockoutBracket} {fixtures.length > 0 ? `(${fixtures.length})` : ''}
        </button>
        <button
          onClick={() => setActiveTab('QUALIFICATION')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'QUALIFICATION'
              ? 'bg-blue-600 text-white shadow-md'
              : 'text-slate-400 hover:text-slate-200 bg-slate-900'
          }`}
        >
          Qualification Rules
        </button>
      </div>

      {/* TAB 1: League Phase Table & Participants */}
      {activeTab === 'STANDINGS' && (
        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                <Globe2 className="w-4 h-4 text-blue-400" />
                <span>{selectedTournament?.name || 'Champions League'} - {t.leaguePhase}</span>
              </h3>
              <span className="text-xs text-slate-400">
                Top 8 advance to Round of 16 directly
              </span>
            </div>

            {standings.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-xs">
                {participants.length === 0 ? (
                  <div>
                    <p className="font-semibold text-slate-300 mb-1">No European participants qualified yet</p>
                    <p className="text-slate-500">
                      Clubs earn qualification dynamically based on final domestic league standings and cup results.
                    </p>
                  </div>
                ) : (
                  <p>Matches are being scheduled for qualified clubs.</p>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400">
                      <th className="py-3 px-3 w-12">{t.pos}</th>
                      <th className="py-3 px-3">{t.club}</th>
                      <th className="py-3 px-3 text-center">{t.p}</th>
                      <th className="py-3 px-3 text-center">{t.w}</th>
                      <th className="py-3 px-3 text-center">{t.d}</th>
                      <th className="py-3 px-3 text-center">{t.l}</th>
                      <th className="py-3 px-3 text-center">{t.gf}</th>
                      <th className="py-3 px-3 text-center">{t.ga}</th>
                      <th className="py-3 px-3 text-center">{t.gd}</th>
                      <th className="py-3 px-3 text-center font-black text-blue-400">{t.pts}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-semibold text-slate-300">
                    {standings.map((row, idx) => {
                      const isDirectRO16 = idx < 8;
                      const isPlayoff = idx >= 8 && idx < 24;

                      return (
                        <tr
                          key={row.clubId}
                          className={`hover:bg-slate-800/40 transition-colors ${
                            isDirectRO16
                              ? 'bg-blue-500/5'
                              : isPlayoff
                              ? 'bg-indigo-500/5'
                              : ''
                          }`}
                        >
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`w-1.5 h-4 rounded-full ${
                                  isDirectRO16
                                    ? 'bg-blue-400'
                                    : isPlayoff
                                    ? 'bg-indigo-400'
                                    : 'bg-transparent'
                                }`}
                              />
                              <span className="font-bold text-slate-200">{row.position}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2.5">
                              <img
                                src={row.clubLogoUrl}
                                alt={row.clubName}
                                className="w-5 h-5 object-contain"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                              <span className="font-bold text-white truncate max-w-[140px] sm:max-w-[220px]">
                                {row.clubName}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center">{row.played}</td>
                          <td className="py-3 px-3 text-center text-emerald-400">{row.won}</td>
                          <td className="py-3 px-3 text-center text-amber-400">{row.drawn}</td>
                          <td className="py-3 px-3 text-center text-rose-400">{row.lost}</td>
                          <td className="py-3 px-3 text-center">{row.goalsFor}</td>
                          <td className="py-3 px-3 text-center">{row.goalsAgainst}</td>
                          <td className="py-3 px-3 text-center font-bold">
                            {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                          </td>
                          <td className="py-3 px-3 text-center font-black text-blue-400 text-sm">
                            {row.points}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Qualified Participants Snapshot List */}
          {participants.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
              <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-400" />
                <span>Qualified Club Roster ({participants.length} Clubs)</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {participants.map((p) => (
                  <div
                    key={p.id}
                    className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 p-1.5 flex items-center justify-center shrink-0">
                        <img
                          src={p.clubLogoUrl}
                          alt={p.clubName}
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-black text-white truncate">{p.clubName}</div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {p.qualificationReason || p.sourceCompetitionName || 'Domestic Qualification'}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        Seed #{p.seedNumber || '-'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Knockout Bracket & Matches */}
      {activeTab === 'BRACKET' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span>Knockout Elimination Rounds</span>
            </h3>
            <span className="text-xs text-slate-400">Play-offs → R16 → QF → SF → Final</span>
          </div>

          {fixtures.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              <p className="font-semibold text-slate-300 mb-1">Knockout bracket has not commenced</p>
              <p className="text-slate-500">
                Knockout pairings will be generated upon completion of the league phase or qualification draw.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {rounds.map((round) => (
                <div key={round} className="space-y-3">
                  <div className="text-xs font-black uppercase text-blue-400 tracking-wider">
                    {round}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {fixturesByRound[round].map((f) => (
                      <div
                        key={f.id}
                        className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <img
                              src={f.homeClub?.logoUrl}
                              alt={f.homeClub?.name || 'Home Club'}
                              className="w-5 h-5 object-contain"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                            <span className="font-bold text-slate-200 truncate">{f.homeClub?.name || 'Home Club'}</span>
                          </div>
                          <span className="font-black text-white text-sm">
                            {f.status === 'CONFIRMED' ? f.homeScore : '-'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between border-t border-slate-800/60 pt-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <img
                              src={f.awayClub?.logoUrl}
                              alt={f.awayClub?.name || 'Away Club'}
                              className="w-5 h-5 object-contain"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                            <span className="font-bold text-slate-200 truncate">{f.awayClub?.name || 'Away Club'}</span>
                          </div>
                          <span className="font-black text-white text-sm">
                            {f.status === 'CONFIRMED' ? f.awayScore : '-'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between pt-1 text-[10px] text-slate-500">
                          <span>Status: {f.status}</span>
                          {f.winnerClubId && (
                            <span className="text-emerald-400 font-bold">Winner Confirmed</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: European Qualification Breakdown */}
      {activeTab === 'QUALIFICATION' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-4">
          <h3 className="text-base font-black text-white flex items-center gap-2">
            <Info className="w-5 h-5 text-blue-400" />
            <span>European Allocation Formula</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-300">
            <div className="bg-slate-950 p-4 rounded-2xl border border-blue-500/30 space-y-2">
              <div className="font-black text-blue-400 text-sm">UEFA Champions League</div>
              <ul className="space-y-1.5 text-slate-400">
                <li>• Premier League: Top 4 clubs</li>
                <li>• La Liga: Top 4 clubs</li>
                <li>• Serie A: Top 4 clubs</li>
                <li>• Bundesliga: Top 4 clubs</li>
                <li>• Ligue 1: Top 3 clubs</li>
              </ul>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-indigo-500/30 space-y-2">
              <div className="font-black text-indigo-400 text-sm">UEFA Europa League</div>
              <ul className="space-y-1.5 text-slate-400">
                <li>• Domestic Cup Winners (FA Cup, Copa del Rey, etc.)</li>
                <li>• 5th & 6th Place in Premier League, La Liga, Serie A, Bundesliga</li>
                <li>• 4th Place in Ligue 1</li>
              </ul>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-teal-500/30 space-y-2">
              <div className="font-black text-teal-400 text-sm">UEFA Conference League</div>
              <ul className="space-y-1.5 text-slate-400">
                <li>• 7th Place in top leagues</li>
                <li>• 5th Place in Ligue 1</li>
                <li>• Domestic qualification play-off spots</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
