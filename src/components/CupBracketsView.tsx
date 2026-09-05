import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useUserProfile } from '../context/UserProfileContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { Competition, Fixture } from '../types';
import { ResultSubmissionModal } from './ResultSubmissionModal';
import { TournamentBracket } from './TournamentBracket';
import {
  Award,
  Trophy,
  Shield,
  Sparkles,
  Loader2,
  AlertTriangle,
  Users,
  Info,
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
          (c) =>
            c.type === 'KNOCKOUT' ||
            c.type === 'SUPER_CUP' ||
            (c.type !== 'LEAGUE' && c.type !== 'EUROPEAN_LEAGUE_PHASE')
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

  // Dynamic domestic cup participant count derived from the active competition
  const distinctClubsCount = useMemo(() => {
    const ids = new Set<string>();
    cupFixtures.forEach((f) => {
      if (f.homeClubId && f.homeClubId !== 'TBD') ids.add(f.homeClubId);
      if (f.awayClubId && f.awayClubId !== 'TBD') ids.add(f.awayClubId);
    });
    return ids.size;
  }, [cupFixtures]);

  const leagueDefaultCount = useMemo(() => {
    if (!activeCup) return 20;
    const name = (activeCup.name || '').toLowerCase();
    const id = (activeCup.id || '').toLowerCase();
    if (id.includes('bundesliga') || id.includes('dfb') || name.includes('dfb') || name.includes('pokal')) {
      return 18;
    }
    if (id.includes('ligue-1') || id.includes('coupe-de-france') || name.includes('coupe de france')) {
      return 18;
    }
    return 20;
  }, [activeCup]);

  const totalParticipantCount = distinctClubsCount > 0 ? distinctClubsCount : leagueDefaultCount;

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
          <button className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black bg-amber-500 text-slate-950 shadow-md min-h-[36px]">
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

      {/* Header & Cup Selector */}
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

      {/* Competition Info Ribbon: Dynamic Participant Count */}
      {activeCup && (
        <div className="glass-panel p-3.5 sm:p-4 border-amber-500/30 bg-amber-950/15 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center shrink-0">
              <Trophy className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="text-sm font-black text-white flex items-center gap-2">
                <span>{activeCup.name}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  {totalParticipantCount} Jamoa
                </span>
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5 flex items-center gap-2 flex-wrap">
                {totalParticipantCount === 20 ? (
                  <span>
                    Format: 4 ta jamoa Dastlabki saralashda + 12 ta jamoa to‘g‘ridan-to‘g‘ri Nimchorak finalda
                  </span>
                ) : totalParticipantCount === 18 ? (
                  <span>
                    Format: 2 ta jamoa Dastlabki saralashda + 14 ta jamoa to‘g‘ridan-to‘g‘ri Nimchorak finalda
                  </span>
                ) : (
                  <span>Format: To‘g‘ridan-to‘g‘ri olimpiada tizimi ({totalParticipantCount} ishtirokchi)</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto text-xs font-bold text-slate-400">
            <Users className="w-4 h-4 text-slate-400" />
            <span>Ishtirokchilar: <strong className="text-white">{totalParticipantCount}</strong></span>
          </div>
        </div>
      )}

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

      {/* Loading Skeleton */}
      {isLoading && cupFixtures.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-44 rounded-2xl bg-white/[0.04] border border-white/[0.06]" />
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
        /* Real Tournament Bracket Layout */
        <TournamentBracket
          fixtures={cupFixtures}
          currentClubId={currentClub?.id}
          userId={user?.id}
          onSelectFixture={(f) => setSelectedFixtureForSubmit(f)}
          competition={activeCup}
        />
      )}

      {/* Modal for match result submission / viewing */}
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
