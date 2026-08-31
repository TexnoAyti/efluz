import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Competition, StandingsRow, Fixture } from '../types';
import { ClubCrest } from './ClubCrest';
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
  AlertTriangle,
} from 'lucide-react';

interface ChampionsLeagueViewProps {
  onNavigateTab?: (tab: any) => void;
}

export const ChampionsLeagueView: React.FC<ChampionsLeagueViewProps> = ({ onNavigateTab }) => {
  const { activeSeasonId } = useAuth();
  const { t } = useI18n();

  const [tournaments, setTournaments] = useState<Competition[]>([]);
  const [selectedTournament, setSelectedTournament] = useState<Competition | null>(null);
  const [standings, setStandings] = useState<StandingsRow[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [activeTab, setActiveTab] = useState<'STANDINGS' | 'BRACKET' | 'QUALIFICATION'>('STANDINGS');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEuropeanData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const compsRes = await api.getCompetitions(activeSeasonId);
      const uefaComps = (compsRes.competitions || []).filter(
        (c) =>
          ((c.type === 'EUROPEAN_LEAGUE_PHASE' ||
            c.type === 'EUROPEAN_KNOCKOUT' ||
            c.id.includes('champions') ||
            c.id.includes('europa') ||
            c.id.includes('ucl') ||
            c.id.includes('uel')) &&
          !c.id.includes('conference') &&
          !c.id.includes('uecl'))
      );
      setTournaments(uefaComps);

      if (uefaComps.length > 0) {
        const defaultComp = uefaComps.find((c) => c.id.includes('champions')) || uefaComps[0];
        setSelectedTournament(defaultComp);
        loadTournamentDetails(defaultComp.id);
      }
    } catch (err: any) {
      console.error('Failed to load European tournament data:', err);
      setError("Couldn't load data. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
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
      {/* Category Quick Switcher Hub */}
      {onNavigateTab && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => onNavigateTab('leagues')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold glass-card text-slate-300 hover:text-white min-h-[36px]"
          >
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>Domestic Leagues</span>
          </button>
          <button
            onClick={() => onNavigateTab('cups')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold glass-card text-slate-300 hover:text-white min-h-[36px]"
          >
            <Trophy className="w-3.5 h-3.5 text-amber-400" />
            <span>National Cups</span>
          </button>
          <button
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black bg-blue-600 text-white shadow-md min-h-[36px]"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Champions League</span>
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div className="relative overflow-hidden glass-panel p-5 sm:p-7 shadow-2xl border-blue-500/30">
        <div className="absolute top-0 right-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-300 text-xs font-black uppercase tracking-wider mb-2 backdrop-blur-sm">
              <Sparkles className="w-3.5 h-3.5" />
              <span>UEFA Club Competitions 2026/27</span>
            </div>
            <h1 className="text-xl sm:text-3xl font-black text-white tracking-tight">
              {selectedTournament?.name || t.uefaChampionsLeague}
            </h1>
            <p className="text-[11px] sm:text-xs text-blue-200 mt-1 max-w-xl">
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
                  className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 min-h-[38px] ${
                    isSelected
                      ? 'bg-blue-600 text-white border border-blue-400 shadow-lg shadow-blue-600/30 scale-102 font-black'
                      : 'glass-card text-slate-300 hover:text-white'
                  }`}
                >
                  <Trophy className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-blue-400'}`} />
                  <span>{comp.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      {/* Error State */}
      {error && tournaments.length === 0 && !isLoading && (
        <div className="p-6 rounded-2xl glass-panel border-rose-500/30 bg-rose-950/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-rose-200 text-xs shadow-xl">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <div className="font-bold text-sm text-white">Couldn't load data</div>
              <div className="text-xs text-rose-300/80 mt-0.5">Please try again.</div>
            </div>
          </div>
          <button
            onClick={loadEuropeanData}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center gap-1.5 shrink-0 shadow-md transition-colors"
          >
            <span>Retry</span>
          </button>
        </div>
      )}

      {isLoading && tournaments.length === 0 ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-10 rounded-xl bg-white/[0.04] w-1/3" />
          <div className="h-64 rounded-2xl bg-white/[0.04] border border-white/[0.06]" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => setActiveTab('STANDINGS')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all min-h-[38px] ${
                activeTab === 'STANDINGS'
                  ? 'bg-blue-600 text-white shadow-md font-black'
                  : 'glass-card text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.leaguePhase} ({participants.length > 0 ? `${participants.length} Clubs` : 'Overview'})
            </button>
            <button
              onClick={() => setActiveTab('BRACKET')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all min-h-[38px] ${
                activeTab === 'BRACKET'
                  ? 'bg-blue-600 text-white shadow-md font-black'
                  : 'glass-card text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.knockoutBracket} {fixtures.length > 0 ? `(${fixtures.length})` : ''}
            </button>
            <button
              onClick={() => setActiveTab('QUALIFICATION')}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all min-h-[38px] ${
                activeTab === 'QUALIFICATION'
                  ? 'bg-blue-600 text-white shadow-md font-black'
                  : 'glass-card text-slate-400 hover:text-slate-200'
              }`}
            >
              Qualification Rules
            </button>
          </div>

      {/* TAB 1: League Phase Table & Participants */}
      {activeTab === 'STANDINGS' && (
        <div className="space-y-6">
          <div className="glass-panel p-4 sm:p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                <Globe2 className="w-4 h-4 text-blue-400" />
                <span>{selectedTournament?.name || 'Champions League'} - {t.leaguePhase}</span>
              </h3>
              <span className="text-[10px] sm:text-xs text-slate-400">
                Top 8 advance to R16 directly
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
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full text-left text-xs border-collapse min-w-[320px]">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-[10px] font-black uppercase tracking-wider text-slate-400">
                      <th className="py-2.5 px-2.5 w-8 sm:w-10">#</th>
                      <th className="py-2.5 px-2.5">{t.club}</th>
                      <th className="py-2.5 px-2 text-center w-8">{t.p}</th>
                      <th className="py-2.5 px-2 text-center w-8">{t.w}</th>
                      <th className="py-2.5 px-2 text-center w-8 hidden sm:table-cell">{t.d}</th>
                      <th className="py-2.5 px-2 text-center w-8 hidden sm:table-cell">{t.l}</th>
                      <th className="py-2.5 px-2 text-center w-8 hidden md:table-cell">{t.gf}</th>
                      <th className="py-2.5 px-2 text-center w-8 hidden md:table-cell">{t.ga}</th>
                      <th className="py-2.5 px-2 text-center w-9">{t.gd}</th>
                      <th className="py-2.5 px-2.5 text-center w-10 font-black text-blue-400">{t.pts}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04] font-semibold text-slate-300">
                    {standings.map((row, idx) => {
                      const isDirectRO16 = idx < 8;
                      const isPlayoff = idx >= 8 && idx < 24;

                      return (
                        <tr
                          key={row.clubId}
                          className={`hover:bg-white/[0.03] transition-colors ${
                            isDirectRO16
                              ? 'bg-blue-500/10'
                              : isPlayoff
                              ? 'bg-indigo-500/5'
                              : ''
                          }`}
                        >
                          <td className="py-2.5 px-2.5">
                            <div className="flex items-center gap-1">
                              <span
                                className={`w-1 h-3.5 rounded-full ${
                                  isDirectRO16
                                    ? 'bg-blue-400'
                                    : isPlayoff
                                    ? 'bg-indigo-400'
                                    : 'bg-transparent'
                                }`}
                              />
                              <span className="font-bold text-slate-200 text-xs">{row.position}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <ClubCrest
                                clubId={row.clubId}
                                logoUrl={row.clubLogoUrl}
                                name={row.clubName}
                                size="xs"
                                className="w-4 h-4 sm:w-5 sm:h-5"
                              />
                              <span className="font-bold text-white truncate max-w-[120px] sm:max-w-[200px]">
                                {row.clubName}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-2 text-center text-slate-400 text-xs">{row.played}</td>
                          <td className="py-2.5 px-2 text-center text-emerald-400 text-xs">{row.won}</td>
                          <td className="py-2.5 px-2 text-center text-amber-400 text-xs hidden sm:table-cell">{row.drawn}</td>
                          <td className="py-2.5 px-2 text-center text-rose-400 text-xs hidden sm:table-cell">{row.lost}</td>
                          <td className="py-2.5 px-2 text-center text-slate-400 text-xs hidden md:table-cell">{row.goalsFor}</td>
                          <td className="py-2.5 px-2 text-center text-slate-400 text-xs hidden md:table-cell">{row.goalsAgainst}</td>
                          <td className="py-2.5 px-2 text-center font-bold text-xs">
                            {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                          </td>
                          <td className="py-2.5 px-2.5 text-center font-black text-blue-400 text-xs sm:text-sm">
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
            <div className="glass-panel p-4 sm:p-6 shadow-xl space-y-4">
              <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-400" />
                <span>Qualified Club Roster ({participants.length} Clubs)</span>
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {participants.map((p) => (
                  <div
                    key={p.id}
                    className="p-3 glass-card flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-slate-950/80 border border-white/[0.08] p-1.5 flex items-center justify-center shrink-0">
                        <ClubCrest
                          clubId={p.clubId}
                          logoUrl={p.clubLogoUrl}
                          name={p.clubName}
                          size="xs"
                          className="w-full h-full"
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
        <div className="glass-panel p-4 sm:p-6 shadow-xl space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span>Knockout Elimination Rounds</span>
            </h3>
            <span className="text-[10px] sm:text-xs text-slate-400">Play-offs → R16 → QF → SF → Final</span>
          </div>

          {fixtures.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">
              <p className="font-semibold text-slate-300 mb-1">Knockout bracket has not commenced</p>
              <p className="text-slate-500">
                Knockout pairings will be generated upon completion of the league phase or qualification draw.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {rounds.map((round) => (
                <div key={round} className="space-y-3">
                  <div className="text-xs font-black uppercase text-blue-400 tracking-wider px-1">
                    {round}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {fixturesByRound[round].map((f) => (
                      <div
                        key={f.id}
                        className="p-3.5 glass-card space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <ClubCrest
                              clubId={f.homeClub?.id}
                              logoUrl={f.homeClub?.logoUrl}
                              name={f.homeClub?.name || 'Home Club'}
                              shortName={f.homeClub?.shortName}
                              size="xs"
                              className="w-4 h-4 sm:w-5 sm:h-5"
                            />
                            <span className="font-bold text-slate-200 truncate">{f.homeClub?.name || 'Home Club'}</span>
                          </div>
                          <span className="font-black text-white text-xs sm:text-sm ml-2">
                            {f.status === 'CONFIRMED' ? f.homeScore : '-'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between border-t border-white/[0.06] pt-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <ClubCrest
                              clubId={f.awayClub?.id}
                              logoUrl={f.awayClub?.logoUrl}
                              name={f.awayClub?.name || 'Away Club'}
                              shortName={f.awayClub?.shortName}
                              size="xs"
                              className="w-4 h-4 sm:w-5 sm:h-5"
                            />
                            <span className="font-bold text-slate-200 truncate">{f.awayClub?.name || 'Away Club'}</span>
                          </div>
                          <span className="font-black text-white text-xs sm:text-sm ml-2">
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
        <div className="glass-panel p-4 sm:p-6 shadow-xl space-y-4">
          <h3 className="text-sm sm:text-base font-black text-white flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-400" />
            <span>European Allocation Formula</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 text-xs text-slate-300">
            <div className="glass-card p-4 border-blue-500/30 space-y-2">
              <div className="font-black text-blue-400 text-sm">UEFA Champions League (32 Clubs)</div>
              <ul className="space-y-1.5 text-slate-400 text-xs">
                <li>• Premier League: Top 4 clubs (1st – 4th)</li>
                <li>• La Liga: Top 4 clubs (1st – 4th)</li>
                <li>• Serie A: Top 4 clubs (1st – 4th)</li>
                <li>• Bundesliga: Top 4 clubs (1st – 4th)</li>
                <li>• Ligue 1: Top 3 clubs (1st – 3rd)</li>
                <li>• Defending Champions & League Phase Qualifiers</li>
                <li>• Format: 32-Team Single League Phase, 8 Matchdays (4H / 4A)</li>
              </ul>
            </div>

            <div className="glass-card p-4 border-indigo-500/30 space-y-2">
              <div className="font-black text-indigo-400 text-sm">UEFA Europa League (32 Clubs)</div>
              <ul className="space-y-1.5 text-slate-400 text-xs">
                <li>• Domestic Cup Winners (FA Cup, Copa del Rey, Coppa Italia, DFB-Pokal, Coupe de France)</li>
                <li>• 5th, 6th & 7th Place in Premier League, La Liga, Serie A, Bundesliga</li>
                <li>• 4th & 5th Place in Ligue 1</li>
                <li>• Format: 32-Team Single League Phase, 8 Matchdays (4H / 4A)</li>
              </ul>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
};
