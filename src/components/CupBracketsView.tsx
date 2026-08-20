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
      try {
        const res = await api.getCompetitions(activeSeasonId);
        const cups = res.competitions.filter((c) => c.type !== 'LEAGUE');
        setCupCompetitions(cups);
        if (cups.length > 0) {
          // default to domestic cup or first cup
          const domesticCup = cups.find((c) => c.type === 'KNOCKOUT') || cups[0];
          setSelectedCupId(domesticCup.id);
        }
      } catch (err: any) {
        console.error('Failed to load cups:', err);
      }
    }
    loadCups();
  }, [activeSeasonId]);

  const loadCupFixtures = async () => {
    if (!selectedCupId) return;
    setIsLoading(true);
    try {
      const res = await api.getCompetitionFixtures(selectedCupId);
      setCupFixtures(res.fixtures);
    } catch (err: any) {
      console.error('Failed to load cup fixtures:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCupFixtures();
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

  const rounds = Object.keys(fixturesByRound);

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-20">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Award className="w-6 h-6 text-amber-400" />
            <span>{t.navCups} & {t.superCup}</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Knockout elimination cups across England, Spain, Italy, Germany, and France.
          </p>
        </div>

        {/* Cup Selector */}
        <div className="w-full sm:w-72">
          <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            {t.navCups}
          </label>
          <select
            id="select-cup-competition"
            value={selectedCupId}
            onChange={(e) => setSelectedCupId(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs font-bold text-white focus:outline-none focus:border-emerald-500 shadow-inner"
          >
            {cupCompetitions.map((cup) => (
              <option key={cup.id} value={cup.id}>
                {cup.name} ({cup.type.replace('_', ' ')})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Rounds Container */}
      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-amber-400 mb-2" />
          <span className="text-xs">{t.loading}</span>
        </div>
      ) : rounds.length === 0 ? (
        <div className="py-16 text-center bg-slate-900 border border-slate-800 rounded-3xl shadow-xl">
          <Trophy className="w-12 h-12 text-slate-600 mx-auto mb-2 opacity-60" />
          <h4 className="text-sm font-bold text-slate-200">No cup fixtures scheduled yet</h4>
          <p className="text-xs text-slate-500 mt-1">Knockout fixtures will be generated for this season.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {rounds.map((roundName) => {
            const matches = fixturesByRound[roundName];
            return (
              <div key={roundName} className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-amber-400" />
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">
                      {roundName}
                    </h3>
                  </div>
                  <span className="text-xs text-slate-400 font-semibold">
                    {matches.length} {matches.length === 1 ? 'Match' : 'Matches'}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {matches.map((fixture) => {
                    const isUserMatch =
                      fixture.homeOwnerId === user?.id || fixture.awayOwnerId === user?.id;

                    return (
                      <div
                        key={fixture.id}
                        className={`p-4 rounded-2xl border transition-all ${
                          isUserMatch
                            ? 'bg-slate-950 border-emerald-500/60 shadow-lg shadow-emerald-500/10'
                            : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-3">
                          <span className="font-bold text-slate-300">
                            {fixture.competitionName}
                          </span>
                          {fixture.status === 'CONFIRMED' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                              <CheckCircle2 className="w-3.5 h-3.5" /> {t.matchStatusConfirmed}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-slate-400 font-medium">
                              <Clock className="w-3.5 h-3.5" /> {t.matchStatusUpcoming}
                            </span>
                          )}
                        </div>

                        {/* Matchup row */}
                        <div className="space-y-2.5">
                          {/* Home team */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <img
                                src={fixture.homeClub?.logoUrl}
                                alt={fixture.homeClub?.name}
                                className="w-6 h-6 object-contain shrink-0"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                              <span className="text-xs font-bold text-white truncate">
                                {fixture.homeClub?.name}
                              </span>
                            </div>
                            <span className="text-sm font-black text-slate-200">
                              {fixture.status === 'CONFIRMED' ? fixture.homeScore : '-'}
                            </span>
                          </div>

                          {/* Away team */}
                          <div className="flex items-center justify-between border-t border-slate-800/60 pt-2.5">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <img
                                src={fixture.awayClub?.logoUrl}
                                alt={fixture.awayClub?.name}
                                className="w-6 h-6 object-contain shrink-0"
                                onError={(e) => {
                                  (e.target as HTMLElement).style.display = 'none';
                                }}
                              />
                              <span className="text-xs font-bold text-white truncate">
                                {fixture.awayClub?.name}
                              </span>
                            </div>
                            <span className="text-sm font-black text-slate-200">
                              {fixture.status === 'CONFIRMED' ? fixture.awayScore : '-'}
                            </span>
                          </div>
                        </div>

                        {/* Match action if user match */}
                        {isUserMatch && fixture.status !== 'CONFIRMED' && (
                          <div className="mt-3 pt-3 border-t border-slate-800">
                            <button
                              onClick={() => setSelectedFixtureForSubmit(fixture)}
                              className="w-full py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
                            >
                              <Swords className="w-3.5 h-3.5" />
                              <span>{t.submitResult}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Result Submission Modal */}
      {selectedFixtureForSubmit && (
        <ResultSubmissionModal
          fixture={selectedFixtureForSubmit}
          isOpen={true}
          onClose={() => setSelectedFixtureForSubmit(null)}
          onSuccess={() => {
            loadCupFixtures();
          }}
        />
      )}
    </div>
  );
};
