import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Competition, Fixture } from '../types';
import { ResultSubmissionModal } from './ResultSubmissionModal';
import {
  Award,
  Trophy,
  Shield,
  Calendar,
  CheckCircle2,
  Clock,
  Sparkles,
  Loader2,
  Swords,
  AlertTriangle,
} from 'lucide-react';

export const CupBracketsView: React.FC = () => {
  const { user, currentClub, activeSeasonId } = useAuth();
  const { t } = useI18n();

  const [cupCompetitions, setCupCompetitions] = useState<Competition[]>([]);
  const [selectedCupId, setSelectedCupId] = useState<string>('');
  const [cupFixtures, setCupFixtures] = useState<Fixture[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedFixtureForSubmit, setSelectedFixtureForSubmit] = useState<Fixture | null>(null);

  useEffect(() => {
    async function loadCups() {
      setIsLoading(true);
      try {
        const res = await api.getCompetitions(activeSeasonId);
        const cups = (res.competitions || []).filter((c) => c.type !== 'LEAGUE');
        setCupCompetitions(cups);
        if (cups.length > 0) {
          const domesticCup = cups.find((c) => c.type === 'KNOCKOUT') || cups[0];
          setSelectedCupId(domesticCup.id);
        } else {
          setIsLoading(false);
        }
      } catch (err: any) {
        console.error('Failed to load cups:', err);
        setIsLoading(false);
      }
    }
    loadCups();
  }, [activeSeasonId]);

  const loadCupFixtures = async () => {
    if (!selectedCupId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const res = await api.getCompetitionFixtures(selectedCupId);
      setCupFixtures(res.fixtures || []);
    } catch (err: any) {
      console.error('Failed to load cup fixtures:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedCupId) {
      loadCupFixtures();
    }
  }, [selectedCupId, activeSeasonId]);

  const activeCup = cupCompetitions.find((c) => c.id === selectedCupId);

  // Group fixtures by roundName
  const fixturesByRound: Record<string, Fixture[]> = {};
  cupFixtures.forEach((f) => {
    const round = f.roundName || 'Knockout Stage';
    if (!fixturesByRound[round]) {
      fixturesByRound[round] = [];
    }
    fixturesByRound[round].push(f);
  });

  const getStatusBadge = (status: Fixture['status']) => {
    switch (status) {
      case 'CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3 h-3" /> {t.matchStatusConfirmed}
          </span>
        );
      case 'PENDING_CONFIRMATION':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse">
            <Clock className="w-3 h-3" /> {t.matchStatusPending}
          </span>
        );
      case 'DISPUTED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <AlertTriangle className="w-3 h-3" /> {t.matchStatusDisputed}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold text-slate-300 bg-slate-800 border border-slate-700">
            <Calendar className="w-3 h-3" /> {t.matchStatusUpcoming}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Award className="w-6 h-6 text-amber-400" />
            <span>{t.navCups}</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Single-elimination domestic knockout tournaments for the active 2026/27 campaign.
          </p>
        </div>

        {/* Cup selector tabs */}
        {cupCompetitions.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {cupCompetitions.map((cup) => {
              const isSelected = selectedCupId === cup.id;
              return (
                <button
                  key={cup.id}
                  onClick={() => setSelectedCupId(cup.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-2xl font-bold text-xs shrink-0 transition-all ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 scale-[1.02] font-black'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                  }`}
                >
                  <Trophy className="w-3.5 h-3.5" />
                  <span>{cup.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-amber-400 mb-2" />
          <span className="text-xs">{t.loading}</span>
        </div>
      ) : cupFixtures.length === 0 ? (
        <div className="py-16 text-center bg-slate-900 border border-slate-800 rounded-3xl">
          <Award className="w-12 h-12 text-slate-600 mx-auto mb-2 opacity-60" />
          <h4 className="text-sm font-bold text-slate-200">No cup fixtures scheduled yet</h4>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Cup brackets and knockout rounds will be seeded and scheduled as the season progresses.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(fixturesByRound).map(([roundName, fixtures]) => (
            <div key={roundName} className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <h3 className="font-black text-sm uppercase tracking-wider text-slate-200">{roundName}</h3>
                <span className="text-xs font-semibold text-slate-400">({fixtures.length} matches)</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {fixtures.map((fixture) => {
                  const isHome = fixture.homeOwnerId === user?.id || fixture.homeClubId === currentClub?.id;
                  const isAway = fixture.awayOwnerId === user?.id || fixture.awayClubId === currentClub?.id;
                  const isUserInvolved = isHome || isAway;
                  const homeName = fixture.homeClub?.name || 'Home Club';
                  const awayName = fixture.awayClub?.name || 'Away Club';
                  const homeLogo = fixture.homeClub?.logoUrl;
                  const awayLogo = fixture.awayClub?.logoUrl;
                  const homeManager = fixture.homeClub?.claimedByUsername || fixture.homeClub?.managerUsername;
                  const awayManager = fixture.awayClub?.claimedByUsername || fixture.awayClub?.managerUsername;

                  return (
                    <div
                      key={fixture.id}
                      className={`bg-slate-900 border rounded-2xl p-4 flex flex-col justify-between shadow-md transition-all ${
                        isUserInvolved
                          ? 'border-amber-500/40 bg-gradient-to-br from-slate-900 to-amber-950/20'
                          : 'border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className="text-[10px] font-bold text-slate-400">
                          Match #{fixture.id.slice(-4)}
                        </span>
                        {getStatusBadge(fixture.status)}
                      </div>

                      {/* Teams & Scores */}
                      <div className="space-y-2 mb-3">
                        {/* Home Team */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className="w-6 h-6 rounded-lg bg-slate-950 p-1 border border-slate-800 flex items-center justify-center shrink-0">
                              <img
                                src={homeLogo}
                                alt={homeName}
                                className="w-full h-full object-contain"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                            </div>
                            <span className={`text-xs font-bold ${isHome ? 'text-amber-400' : 'text-slate-200'}`}>
                              {homeName}
                            </span>
                            {homeManager && (
                              <span className="text-[10px] text-slate-400">@{homeManager}</span>
                            )}
                          </div>
                          <span className="text-sm font-black text-white px-2 py-0.5 bg-slate-950 rounded-lg border border-slate-800">
                            {fixture.homeScore !== null && fixture.homeScore !== undefined ? fixture.homeScore : '-'}
                          </span>
                        </div>

                        {/* Away Team */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className="w-6 h-6 rounded-lg bg-slate-950 p-1 border border-slate-800 flex items-center justify-center shrink-0">
                              <img
                                src={awayLogo}
                                alt={awayName}
                                className="w-full h-full object-contain"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                            </div>
                            <span className={`text-xs font-bold ${isAway ? 'text-amber-400' : 'text-slate-200'}`}>
                              {awayName}
                            </span>
                            {awayManager && (
                              <span className="text-[10px] text-slate-400">@{awayManager}</span>
                            )}
                          </div>
                          <span className="text-sm font-black text-white px-2 py-0.5 bg-slate-950 rounded-lg border border-slate-800">
                            {fixture.awayScore !== null && fixture.awayScore !== undefined ? fixture.awayScore : '-'}
                          </span>
                        </div>
                      </div>

                      {/* Action Button for participant */}
                      {isUserInvolved && fixture.status !== 'CONFIRMED' && (
                        <button
                          onClick={() => setSelectedFixtureForSubmit(fixture)}
                          className="w-full py-1.5 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-black text-[11px] rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5"
                        >
                          <Swords className="w-3 h-3" />
                          <span>{t.submitResult}</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedFixtureForSubmit && (
        <ResultSubmissionModal
          fixture={selectedFixtureForSubmit}
          onClose={() => setSelectedFixtureForSubmit(null)}
          onSuccess={() => {
            setSelectedFixtureForSubmit(null);
            loadCupFixtures();
          }}
        />
      )}
    </div>
  );
};
