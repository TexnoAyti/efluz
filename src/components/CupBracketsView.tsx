import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Competition, Fixture } from '../types';
import { ResultSubmissionModal } from './ResultSubmissionModal';
import { ClubCrest } from './ClubCrest';
import { openTelegramChat, isValidTelegramUsername } from '../lib/telegramUtils';
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
  Send,
} from 'lucide-react';

interface CupBracketsViewProps {
  onNavigateTab?: (tab: any) => void;
}

export const CupBracketsView: React.FC<CupBracketsViewProps> = ({ onNavigateTab }) => {
  const { user, currentClub, activeSeasonId } = useAuth();
  const { t } = useI18n();

  const [cupCompetitions, setCupCompetitions] = useState<Competition[]>([]);
  const [selectedCupId, setSelectedCupId] = useState<string>('');
  const [cupFixtures, setCupFixtures] = useState<Fixture[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFixtureForSubmit, setSelectedFixtureForSubmit] = useState<Fixture | null>(null);

  useEffect(() => {
    async function loadCups() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.getCompetitions(activeSeasonId);
        const cups = (res.competitions || []).filter(
          (c) => c.type === 'KNOCKOUT' || c.type === 'SUPER_CUP' || (c.type !== 'LEAGUE' && c.type !== 'EUROPEAN_LEAGUE_PHASE')
        );
        setCupCompetitions(cups);
        if (cups.length > 0) {
          const domesticCup = cups.find((c) => c.type === 'KNOCKOUT') || cups[0];
          setSelectedCupId(domesticCup.id);
        } else {
          setIsLoading(false);
        }
      } catch (err: any) {
        console.error('Failed to load cups:', err);
        setError("Couldn't load data. Please try again.");
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
    setError(null);
    try {
      const res = await api.getCompetitionFixtures(selectedCupId);
      setCupFixtures(res.fixtures || []);
    } catch (err: any) {
      console.error('Failed to load cup fixtures:', err);
      setError("Couldn't load data. Please try again.");
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
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black bg-amber-500 text-slate-950 shadow-md min-h-[36px]"
          >
            <Trophy className="w-3.5 h-3.5" />
            <span>National Cups</span>
          </button>
          <button
            onClick={() => onNavigateTab('champions-league')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold glass-card text-slate-300 hover:text-white min-h-[36px]"
          >
            <Sparkles className="w-3.5 h-3.5 text-blue-400" />
            <span>Champions League</span>
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel p-4 sm:p-5 shadow-xl">
        <div>
          <h2 className="text-base sm:text-xl font-black text-white tracking-tight flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-400" />
            <span>{t.navCups}</span>
          </h2>
          <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
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
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-bold text-xs shrink-0 transition-all min-h-[38px] ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 scale-[1.02] font-black'
                      : 'glass-card text-slate-300 hover:text-white'
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

      {/* Error State */}
      {error && cupFixtures.length === 0 && !isLoading && (
        <div className="p-6 rounded-2xl glass-panel border-rose-500/30 bg-rose-950/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-rose-200 text-xs shadow-xl">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <div>
              <div className="font-bold text-sm text-white">Couldn't load data</div>
              <div className="text-xs text-rose-300/80 mt-0.5">Please try again.</div>
            </div>
          </div>
          <button
            onClick={loadCupFixtures}
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold flex items-center gap-1.5 shrink-0 shadow-md transition-colors"
          >
            <span>Retry</span>
          </button>
        </div>
      )}

      {isLoading && cupFixtures.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 rounded-2xl bg-white/[0.04] border border-white/[0.06]" />
          ))}
        </div>
      ) : cupFixtures.length === 0 ? (
        <div className="py-16 text-center glass-panel shadow-xl rounded-2xl border border-white/[0.06]">
          <Award className="w-10 h-10 text-slate-500 mx-auto mb-2 opacity-60" />
          <h4 className="text-sm font-bold text-slate-200">No cup fixtures scheduled yet</h4>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Cup brackets and knockout rounds will be seeded and scheduled as the season progresses.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(fixturesByRound).map(([roundName, fixtures]) => (
            <div key={roundName} className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <h3 className="font-black text-xs uppercase tracking-wider text-slate-200">{roundName}</h3>
                <span className="text-[11px] font-semibold text-slate-400">({fixtures.length} matches)</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                      className={`glass-panel p-3.5 flex flex-col justify-between shadow-md transition-all ${
                        isUserInvolved
                          ? 'border-amber-500/50 bg-amber-950/20'
                          : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2.5">
                        <span className="text-[10px] font-bold text-slate-400">
                          Match #{fixture.id.slice(-4)}
                        </span>
                        {getStatusBadge(fixture.status)}
                      </div>

                      {/* Teams & Scores */}
                      <div className="space-y-2 mb-2.5">
                        {/* Home Team */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-lg bg-slate-950/80 p-1 border border-white/[0.08] flex items-center justify-center shrink-0">
                              <ClubCrest
                                clubId={fixture.homeClub?.id}
                                logoUrl={homeLogo}
                                name={homeName}
                                shortName={fixture.homeClub?.shortName}
                                size="xs"
                                className="w-full h-full"
                              />
                            </div>
                            <span className={`text-xs font-bold truncate ${isHome ? 'text-amber-400' : 'text-slate-200'}`}>
                              {homeName}
                            </span>
                            {homeManager ? (
                              <span className="text-[10px] text-slate-400 truncate">@{homeManager}</span>
                            ) : (
                              <span className="text-[10px] text-amber-400/90 font-bold truncate">User kerak</span>
                            )}
                          </div>
                          <span className="text-xs font-black text-white px-2 py-0.5 glass-card shrink-0 ml-2">
                            {fixture.homeScore !== null && fixture.homeScore !== undefined ? fixture.homeScore : '-'}
                          </span>
                        </div>

                        {/* Away Team */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-lg bg-slate-950/80 p-1 border border-white/[0.08] flex items-center justify-center shrink-0">
                              <ClubCrest
                                clubId={fixture.awayClub?.id}
                                logoUrl={awayLogo}
                                name={awayName}
                                shortName={fixture.awayClub?.shortName}
                                size="xs"
                                className="w-full h-full"
                              />
                            </div>
                            <span className={`text-xs font-bold truncate ${isAway ? 'text-amber-400' : 'text-slate-200'}`}>
                              {awayName}
                            </span>
                            {awayManager ? (
                              <span className="text-[10px] text-slate-400 truncate">@{awayManager}</span>
                            ) : (
                              <span className="text-[10px] text-amber-400/90 font-bold truncate">User kerak</span>
                            )}
                          </div>
                          <span className="text-xs font-black text-white px-2 py-0.5 glass-card shrink-0 ml-2">
                            {fixture.awayScore !== null && fixture.awayScore !== undefined ? fixture.awayScore : '-'}
                          </span>
                        </div>
                      </div>

                      {/* Action Button for participant */}
                      {isUserInvolved && (
                        <div className="flex flex-col sm:flex-row gap-2 pt-1 border-t border-white/[0.06]">
                          {(() => {
                            const oppManager = isHome ? awayManager : homeManager;
                            const hasOppTg = isValidTelegramUsername(oppManager);
                            return hasOppTg ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openTelegramChat(oppManager);
                                }}
                                className="flex-1 py-1.5 px-2.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-md min-h-[36px] touch-manipulation"
                              >
                                <Send className="w-3 h-3" />
                                <span>Raqibga yozish</span>
                              </button>
                            ) : null;
                          })()}
                          {fixture.status !== 'CONFIRMED' && (
                            <button
                              onClick={() => setSelectedFixtureForSubmit(fixture)}
                              className="flex-1 py-1.5 px-2.5 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-black text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5 min-h-[36px] touch-manipulation"
                            >
                              <Swords className="w-3.5 h-3.5 text-slate-950" />
                              <span>{t.submitResult}</span>
                            </button>
                          )}
                        </div>
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
