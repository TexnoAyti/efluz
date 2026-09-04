import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useUserProfile } from '../context/UserProfileContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
import { League, Club, Fixture, StandingsRow, Competition } from '../types';
import { ClubCrest } from './ClubCrest';
import confetti from 'canvas-confetti';
import {
  Shield,
  Search,
  CheckCircle2,
  Lock,
  MapPin,
  Sparkles,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Trophy,
  Swords,
} from 'lucide-react';

interface ClubsViewProps {
  onNavigateTab?: (tab: any) => void;
}

export const ClubsView: React.FC<ClubsViewProps> = ({ onNavigateTab }) => {
  const { user, currentClub, activeSeasonId, refreshUserData, showToast } = useAuth();
  const { openUserProfile } = useUserProfile();
  const { t } = useI18n();

  // League & Data states
  const [leagues, setLeagues] = useState<League[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>('league-premier-league');
  const [activeLeagueTab, setActiveLeagueTab] = useState<'CLUBS' | 'MATCHES' | 'STANDINGS'>('CLUBS');

  // Clubs state
  const [clubs, setClubs] = useState<Club[]>([]);
  const [isLoadingClubs, setIsLoadingClubs] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'ALL' | 'AVAILABLE' | 'CLAIMED'>('ALL');

  // Competition Fixtures & Standings state for the selected league
  const [leagueCompetitions, setLeagueCompetitions] = useState<Competition[]>([]);
  const [leagueFixtures, setLeagueFixtures] = useState<Fixture[]>([]);
  const [leagueStandings, setLeagueStandings] = useState<StandingsRow[]>([]);
  const [selectedMatchday, setSelectedMatchday] = useState<number>(1);
  const [isLoadingFixtures, setIsLoadingFixtures] = useState(false);
  const [isLoadingStandings, setIsLoadingStandings] = useState(false);

  // Global Error state
  const [error, setError] = useState<{ message: string; isQuota?: boolean } | null>(null);

  // Claim modal state
  const [clubToClaim, setClubToClaim] = useState<Club | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  // 1. Load clubs for selected league
  const loadClubsForLeague = useCallback(async (leagueId: string, forceRefresh = false) => {
    if (!leagueId) return;
    setIsLoadingClubs(true);
    setError(null);
    try {
      const res = await api.getLeagueClubs(leagueId, activeSeasonId, forceRefresh);
      if (res.clubs && res.clubs.length > 0) {
        setClubs(res.clubs);
      } else if (clubs.length === 0) {
        setClubs([]);
      }
    } catch (err: any) {
      console.error('Failed to load clubs:', err);
      const isQuota =
        err?.httpStatus === 429 ||
        err?.data?.error === 'RESOURCE_EXHAUSTED' ||
        err?.isQuota ||
        err?.message?.includes('quota') ||
        err?.message?.includes('RESOURCE_EXHAUSTED');

      setError({
        message: "Couldn't load data. Please try again.",
        isQuota,
      });
      // Do not wipe out existing clubs if we have them cached
    } finally {
      setIsLoadingClubs(false);
    }
  }, [activeSeasonId, clubs.length]);

  // 2. Load fixtures & standings for selected league on demand
  const loadLeagueStandings = useCallback(async (leagueId: string, compsList?: Competition[]) => {
    const list = compsList || leagueCompetitions;
    const matchingComp = list.find((c) => c.leagueId === leagueId && c.type === 'LEAGUE');
    if (!matchingComp) return;

    setIsLoadingStandings(true);
    try {
      const standRes = await api.getCompetitionStandings(matchingComp.id);
      if (standRes.standings && standRes.standings.length > 0) {
        setLeagueStandings(standRes.standings);
      }
    } catch (err) {
      console.error('Failed to load league standings:', err);
    } finally {
      setIsLoadingStandings(false);
    }
  }, [leagueCompetitions]);

  const loadLeagueFixtures = useCallback(async (leagueId: string, matchday?: number, compsList?: Competition[]) => {
    const list = compsList || leagueCompetitions;
    const matchingComp = list.find((c) => c.leagueId === leagueId && c.type === 'LEAGUE');
    if (!matchingComp) return;

    setIsLoadingFixtures(true);
    try {
      const targetMd = matchday ?? selectedMatchday;
      const fixRes = await api.getCompetitionFixtures(matchingComp.id, targetMd);
      if (fixRes.fixtures) {
        setLeagueFixtures(fixRes.fixtures);
      }
    } catch (err) {
      console.error('Failed to load league fixtures:', err);
    } finally {
      setIsLoadingFixtures(false);
    }
  }, [leagueCompetitions, selectedMatchday]);

  // 3. Load all 5 domestic leagues & competitions list
  const loadLeaguesAndComps = useCallback(async () => {
    setError(null);
    try {
      const [leaguesRes, compsRes] = await Promise.all([
        api.getLeagues(),
        api.getCompetitions(activeSeasonId).catch(() => ({ competitions: [] })),
      ]);

      const domesticLeagues = leaguesRes.leagues || [];
      if (domesticLeagues.length > 0) {
        setLeagues(domesticLeagues);
      }
      if (compsRes.competitions && compsRes.competitions.length > 0) {
        setLeagueCompetitions(compsRes.competitions);
      }

      if (domesticLeagues.length > 0) {
        setSelectedLeagueId((prev) => {
          const exists = domesticLeagues.some((l) => l.id === prev);
          const target = exists ? prev : domesticLeagues[0].id;
          loadClubsForLeague(target);
          return target;
        });
      }
    } catch (err: any) {
      console.error('Failed to load leagues:', err);
      const isQuota =
        err?.httpStatus === 429 ||
        err?.data?.error === 'RESOURCE_EXHAUSTED' ||
        err?.isQuota ||
        err?.message?.includes('quota') ||
        err?.message?.includes('RESOURCE_EXHAUSTED');

      setError({
        message: "Couldn't load data. Please try again.",
        isQuota,
      });
    }
  }, [activeSeasonId, loadClubsForLeague]);

  useEffect(() => {
    loadLeaguesAndComps();
  }, [loadLeaguesAndComps]);

  // Load tab-specific data when tab or league changes
  useEffect(() => {
    if (activeLeagueTab === 'MATCHES') {
      loadLeagueFixtures(selectedLeagueId, selectedMatchday);
    } else if (activeLeagueTab === 'STANDINGS') {
      loadLeagueStandings(selectedLeagueId);
    }
  }, [activeLeagueTab, selectedLeagueId, selectedMatchday, loadLeagueFixtures, loadLeagueStandings]);

  const handleSelectLeague = (leagueId: string) => {
    setSelectedLeagueId(leagueId);
    loadClubsForLeague(leagueId);
    if (activeLeagueTab === 'MATCHES') {
      loadLeagueFixtures(leagueId, selectedMatchday);
    } else if (activeLeagueTab === 'STANDINGS') {
      loadLeagueStandings(leagueId);
    }
  };

  const handleClaimClub = async () => {
    if (!clubToClaim) return;
    if (currentClub) {
      showToast(t.alreadyHaveClubMessage, 'error');
      setClubToClaim(null);
      return;
    }
    setIsClaiming(true);
    try {
      const res = await api.claimClub(clubToClaim.id, activeSeasonId);
      confetti({
        particleCount: 100,
        spread: 80,
        origin: { y: 0.6 },
      });
      showToast(res.message || t.claimSuccess, 'success');
      setClubToClaim(null);
      await refreshUserData();
      await loadClubsForLeague(selectedLeagueId);
    } catch (err: any) {
      const msg = err.data?.message || err.message || 'Failed to claim club.';
      showToast(msg, 'error');
    } finally {
      setIsClaiming(false);
    }
  };

  const isClubTaken = (c: typeof clubs[0]) =>
    Boolean(c.isTaken || c.claimedByUserId || c.occupancy?.status === 'occupied' || c.occupancy?.status === 'owned');

  const filteredClubs = clubs.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.shortName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.stadium && c.stadium.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (filterMode === 'AVAILABLE') return !isClubTaken(c);
    if (filterMode === 'CLAIMED') return isClubTaken(c);
    return true;
  });

  const availableCount = clubs.filter((c) => !isClubTaken(c)).length;
  const claimedCount = clubs.filter((c) => isClubTaken(c)).length;

  const currentLeague = leagues.find((l) => l.id === selectedLeagueId) || leagues[0];

  // Group fixtures by matchday
  const currentComp = leagueCompetitions.find((c) => c.leagueId === selectedLeagueId && c.type === 'LEAGUE');
  const totalLeagueMatchdays = currentComp?.totalMatchdays || (selectedLeagueId.includes('bundesliga') || selectedLeagueId.includes('ligue-1') ? 17 : 19);
  const matchdays: number[] = Array.from({ length: totalLeagueMatchdays }, (_, i) => i + 1);
  const currentMatchdayFixtures = leagueFixtures.filter((f) => (Number(f.matchday) || 1) === selectedMatchday);

  const isPLOrLL = selectedLeagueId.includes('premier-league') || selectedLeagueId.includes('la-liga');
  const uclThreshold = isPLOrLL ? 7 : 6;
  const uelThreshold = isPLOrLL ? 14 : 12;
  const relThreshold = selectedLeagueId.includes('bundesliga') || selectedLeagueId.includes('ligue-1') ? 16 : 18;

  const getPositionStyle = (position: number) => {
    if (position <= uclThreshold) {
      return {
        badgeColor: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
        barColor: 'bg-blue-500',
        label: t.uclZone,
      };
    }
    if (position <= uelThreshold) {
      return {
        badgeColor: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
        barColor: 'bg-indigo-500',
        label: t.uelZone,
      };
    }
    if (position >= relThreshold) {
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
    <div className="space-y-6 animate-in fade-in duration-300 pb-20">
      {/* Category Quick Switcher Hub */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black btn-glass-primary text-slate-950 shadow-md min-h-[36px]"
        >
          <Shield className="w-3.5 h-3.5" />
          <span>Domestic Leagues</span>
        </button>
        {onNavigateTab && (
          <>
            <button
              onClick={() => onNavigateTab('cups')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold glass-card text-slate-300 hover:text-white min-h-[36px]"
            >
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <span>National Cups</span>
            </button>
            <button
              onClick={() => onNavigateTab('champions-league')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold glass-card text-slate-300 hover:text-white min-h-[36px]"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span>Champions League</span>
            </button>
          </>
        )}
      </div>

      {/* 1. Domestic Leagues Selector Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>Domestic Leagues (2026/27)</span>
          </div>
          <button
            id="btn-refresh-clubs-view"
            onClick={() => {
              loadClubsForLeague(selectedLeagueId, true);
              if (activeLeagueTab === 'MATCHES') {
                loadLeagueFixtures(selectedLeagueId, selectedMatchday);
              } else if (activeLeagueTab === 'STANDINGS') {
                loadLeagueStandings(selectedLeagueId);
              }
            }}
            disabled={isLoadingClubs}
            className="px-2.5 py-1 glass-card glass-card-interactive text-slate-300 font-bold text-[11px] flex items-center gap-1 transition-colors disabled:opacity-50 min-h-[32px]"
          >
            <RefreshCw className={`w-3 h-3 ${isLoadingClubs ? 'animate-spin text-emerald-400' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {leagues.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
            {leagues.map((league) => {
              const isSelected = selectedLeagueId === league.id;
              const flag =
                league.country === 'England'
                  ? '🏴󠁧󠁢󠁥󠁮󠁧󠁿'
                  : league.country === 'Spain'
                  ? '🇪🇸'
                  : league.country === 'Italy'
                  ? '🇮🇹'
                  : league.country === 'Germany'
                  ? '🇩🇪'
                  : '🇫🇷';

              return (
                <button
                  key={league.id}
                  id={`btn-league-${league.id}`}
                  onClick={() => handleSelectLeague(league.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl font-bold text-xs shrink-0 transition-all min-h-[42px] ${
                    isSelected
                      ? 'btn-glass-primary text-slate-950 font-black shadow-lg shadow-emerald-500/20 scale-[1.02]'
                      : 'glass-card text-slate-300 hover:text-white'
                  }`}
                >
                  <img
                    src={league.logoUrl}
                    alt={league.name}
                    className="w-4 h-4 object-contain shrink-0"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <span>{flag}</span>
                  <span>{league.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-black ${
                      isSelected ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {league.totalClubs || (league.name === 'Bundesliga' || league.name === 'Ligue 1' ? 18 : 20)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. Dedicated Selected League Header Banner */}
      {currentLeague && (
        <div className="relative overflow-hidden glass-panel p-4 sm:p-6 shadow-2xl border-emerald-500/30">
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-slate-950/90 p-2.5 border border-white/[0.1] flex items-center justify-center shadow-xl shrink-0">
                <img
                  src={currentLeague.logoUrl}
                  alt={currentLeague.name}
                  className="w-10 h-10 object-contain"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    {currentLeague.country} • Tier {currentLeague.tier}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    2026/27 Active
                  </span>
                </div>
                <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight mt-0.5">
                  {currentLeague.name}
                </h1>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-300">
                  <span className="flex items-center gap-1 font-semibold">
                    <Shield className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{clubs.length} Clubs</span>
                  </span>
                  <span>•</span>
                  <span className="text-emerald-400 font-bold">{availableCount} Available</span>
                  <span>•</span>
                  <span className="text-indigo-300 font-bold">{claimedCount} Claimed</span>
                </div>
              </div>
            </div>

            {/* User Active Club Badge if belongs to this league */}
            {currentClub && currentClub.leagueId === selectedLeagueId && (
              <div className="flex items-center gap-3 glass-card bg-emerald-950/40 border-emerald-500/30 p-2.5 px-3.5 shadow-md">
                <ClubCrest
                  clubId={currentClub.id}
                  logoUrl={currentClub.logoUrl}
                  name={currentClub.name}
                  shortName={currentClub.shortName}
                  size="sm"
                  className="w-7 h-7"
                />
                <div className="min-w-0">
                  <div className="text-[9px] uppercase font-black text-emerald-400 flex items-center gap-1">
                    <Lock className="w-2.5 h-2.5" />
                    <span>{t.myClub} ({t.clubLocked})</span>
                  </div>
                  <div className="text-xs font-bold text-white truncate max-w-[140px]">{currentClub.name}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Sub-Navigation Tabs: Clubs | Matches | Standings */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] pb-2 overflow-x-auto scrollbar-none">
        <button
          onClick={() => setActiveLeagueTab('CLUBS')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all min-h-[38px] ${
            activeLeagueTab === 'CLUBS'
              ? 'btn-glass-primary text-slate-950 font-black shadow-md'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Clubs ({clubs.length})</span>
        </button>

        <button
          onClick={() => setActiveLeagueTab('MATCHES')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all min-h-[38px] ${
            activeLeagueTab === 'MATCHES'
              ? 'btn-glass-primary text-slate-950 font-black shadow-md'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <Swords className="w-4 h-4" />
          <span>Matches ({leagueFixtures.length})</span>
        </button>

        <button
          onClick={() => setActiveLeagueTab('STANDINGS')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all min-h-[38px] ${
            activeLeagueTab === 'STANDINGS'
              ? 'btn-glass-primary text-slate-950 font-black shadow-md'
              : 'glass-card text-slate-300 hover:text-white'
          }`}
        >
          <Trophy className="w-4 h-4" />
          <span>Standings Table</span>
        </button>
      </div>

      {/* 4. Sub-Tab Content */}

      {/* TAB A: CLUBS LIST */}
      {activeLeagueTab === 'CLUBS' && (
        <div className="space-y-4">
          {/* Search & Filter Toolbar */}
          <div className="glass-panel p-3 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md bg-[#0b101c]">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder={t.search}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 glass-input rounded-lg text-xs text-slate-200 placeholder-slate-500 min-h-[38px]"
              />
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end overflow-x-auto scrollbar-none">
              <button
                onClick={() => setFilterMode('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors min-h-[36px] ${
                  filterMode === 'ALL'
                    ? 'bg-slate-800 text-white border border-slate-600'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.filterAll} ({clubs.length})
              </button>
              <button
                onClick={() => setFilterMode('AVAILABLE')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors min-h-[36px] ${
                  filterMode === 'AVAILABLE'
                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.available} ({availableCount})
              </button>
              <button
                onClick={() => setFilterMode('CLAIMED')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors min-h-[36px] ${
                  filterMode === 'CLAIMED'
                    ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t.claimed} ({claimedCount})
              </button>
            </div>
          </div>

          {/* Clubs Grid */}
          {isLoadingClubs && clubs.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 animate-pulse">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div key={i} className="h-44 rounded-2xl bg-white/[0.04] border border-white/[0.06]" />
              ))}
            </div>
          ) : error && clubs.length === 0 ? (
            <div className="p-8 text-center glass-panel border-rose-500/30 bg-rose-950/30 rounded-3xl max-w-md mx-auto my-6 shadow-xl">
              <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-rose-400" />
              <h4 className="text-sm font-bold text-white mb-1">Couldn't load data</h4>
              <p className="text-xs text-rose-200/80 mb-5">Please try again.</p>
              <button
                onClick={() => loadClubsForLeague(selectedLeagueId, true)}
                className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all shadow-md inline-flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            </div>
          ) : filteredClubs.length === 0 ? (
            <div className="py-16 text-center glass-panel rounded-3xl border border-white/[0.06]">
              <Shield className="w-10 h-10 text-slate-500 mx-auto mb-2 opacity-60" />
              <h4 className="text-sm font-bold text-slate-200">No clubs found</h4>
              <p className="text-xs text-slate-400 mt-1">Try adjusting your search or filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
              {filteredClubs.map((club) => {
                const isUserClub =
                  club.isCurrentUserClub ||
                  club.claimedByUserId === user?.id ||
                  club.occupancy?.status === 'owned' ||
                  (currentClub && currentClub.id === club.id);
                const isClaimedByOther = isClubTaken(club) && !isUserClub;
                const managerName =
                  club.claimedByUsername || club.managerUsername || club.occupancy?.username || 'player';

                return (
                  <div
                    key={club.id}
                    className={`glass-panel p-4 flex flex-col justify-between shadow-lg transition-all relative overflow-hidden ${
                      isUserClub
                        ? 'border-emerald-500/60 bg-emerald-950/20 shadow-emerald-500/10'
                        : isClaimedByOther
                        ? 'opacity-85'
                        : 'hover:border-white/[0.2] hover:shadow-xl'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-2.5">
                        <div className="w-12 h-12 rounded-xl bg-slate-950/80 p-2 border border-white/[0.08] flex items-center justify-center shadow-inner shrink-0">
                          <ClubCrest
                            clubId={club.id}
                            logoUrl={club.logoUrl}
                            name={club.name}
                            shortName={club.shortName}
                            size="md"
                            className="w-8 h-8"
                          />
                        </div>

                        <div className="text-right">
                          <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider glass-card text-slate-300">
                            {club.shortName}
                          </span>
                          {isUserClub ? (
                            <div className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                              <CheckCircle2 className="w-3 h-3" /> {t.myClub}
                            </div>
                          ) : isClaimedByOther ? (
                            <div className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-slate-400 glass-card px-2 py-0.5 rounded-full">
                              <Lock className="w-3 h-3 text-slate-400" /> {t.claimed}
                            </div>
                          ) : (
                            <div className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/30">
                              <Sparkles className="w-3 h-3 text-amber-400" /> User kerak
                            </div>
                          )}
                        </div>
                      </div>

                      <h3 className="font-black text-xs sm:text-sm text-slate-100 line-clamp-1 mb-0.5">{club.name}</h3>
                      <div className="mb-2">
                        {isUserClub ? (
                          <span className="text-[11px] font-bold text-emerald-400 truncate block">
                            @{user?.username || 'siz'}
                          </span>
                        ) : isClaimedByOther && managerName ? (
                          <span className="text-[11px] font-semibold text-slate-300 truncate block">
                            @{managerName}
                          </span>
                        ) : (
                          <span className="text-[11px] font-bold text-amber-400/90 truncate block">
                            User kerak
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-2.5">
                        <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                        <span className="truncate">{club.stadium || 'Home Stadium'}</span>
                      </div>
                    </div>

                    <div className="pt-2.5 border-t border-white/[0.06] mt-1">
                      {isUserClub ? (
                        <div className="text-[11px] font-bold text-emerald-400 text-center py-1.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                          {t.manager}: @{user?.username}
                        </div>
                      ) : isClaimedByOther ? (
                        <div className="flex items-center justify-between text-[11px] text-slate-400 glass-card p-2 rounded-xl">
                          <span className="text-[10px] uppercase font-bold text-slate-500">{t.manager}:</span>
                          {club.claimedByUserId || club.managerUserId || club.occupancy?.userId ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const uid = club.claimedByUserId || club.managerUserId || club.occupancy?.userId;
                                if (uid) openUserProfile(uid);
                              }}
                              className="font-semibold text-slate-300 hover:text-emerald-400 transition-colors truncate underline decoration-slate-600 hover:decoration-emerald-500 underline-offset-2 max-w-[140px]"
                            >
                              @{managerName}
                            </button>
                          ) : (
                            <span className="font-semibold text-slate-300 truncate">@{managerName}</span>
                          )}
                        </div>
                      ) : currentClub ? (
                        <button
                          disabled={true}
                          className="w-full py-2 glass-card text-slate-500 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 cursor-not-allowed opacity-75 min-h-[38px]"
                        >
                          <Lock className="w-3.5 h-3.5 text-slate-600" />
                          <span>{t.clubLocked}</span>
                        </button>
                      ) : (
                        <button
                          id={`btn-claim-club-${club.id}`}
                          onClick={() => setClubToClaim(club)}
                          className="w-full py-2 btn-glass-primary text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 min-h-[40px] touch-manipulation"
                        >
                          <Shield className="w-3.5 h-3.5 text-slate-950" />
                          <span>{t.claimClub}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB B: MATCHES / FIXTURES */}
      {activeLeagueTab === 'MATCHES' && (
        <div className="space-y-4">
          {/* Matchday Selector */}
          {matchdays.length > 0 && (
            <div className="glass-panel p-3 flex items-center gap-2 overflow-x-auto scrollbar-none">
              <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider shrink-0 mr-1">
                Matchday:
              </span>
              {matchdays.map((md) => (
                <button
                  key={md}
                  onClick={() => setSelectedMatchday(md)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-all min-h-[34px] ${
                    selectedMatchday === md
                      ? 'bg-emerald-500 text-slate-950 font-black shadow-md'
                      : 'glass-card text-slate-300 hover:text-white'
                  }`}
                >
                  MD {md}
                </button>
              ))}
            </div>
          )}

          {/* Fixtures List */}
          {isLoadingFixtures && leagueFixtures.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 rounded-2xl bg-white/[0.04] border border-white/[0.06]" />
              ))}
            </div>
          ) : currentMatchdayFixtures.length === 0 ? (
            <div className="py-12 text-center glass-panel rounded-2xl border border-white/[0.06] text-slate-400 text-xs">
              No fixtures scheduled for this matchday.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {currentMatchdayFixtures.map((fix) => {
                const isConfirmed = fix.status === 'CONFIRMED';
                return (
                  <div key={fix.id} className="glass-panel p-4 flex flex-col justify-between gap-3 shadow-md">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-white/[0.06] pb-2">
                      <span className="font-bold">{fix.roundName || `Matchday ${fix.matchday}`}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                          isConfirmed
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : fix.status === 'PENDING_CONFIRMATION'
                            ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {isConfirmed ? 'CONFIRMED' : fix.status || 'UPCOMING'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      {/* Home */}
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <ClubCrest
                          clubId={fix.homeClub?.id}
                          logoUrl={fix.homeClub?.logoUrl}
                          name={fix.homeClub?.name}
                          shortName={fix.homeClub?.shortName}
                          size="sm"
                          className="w-6 h-6"
                        />
                        <span className="text-xs font-bold text-white truncate">
                          {fix.homeClub?.shortName || fix.homeClub?.name}
                        </span>
                      </div>

                      {/* Score / VS */}
                      <div className="px-3 py-1.5 rounded-xl bg-slate-950/80 border border-white/[0.1] font-black text-xs sm:text-sm text-white shrink-0">
                        {isConfirmed ? `${fix.homeScore} : ${fix.awayScore}` : 'vs'}
                      </div>

                      {/* Away */}
                      <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
                        <span className="text-xs font-bold text-white truncate text-right">
                          {fix.awayClub?.shortName || fix.awayClub?.name}
                        </span>
                        <ClubCrest
                          clubId={fix.awayClub?.id}
                          logoUrl={fix.awayClub?.logoUrl}
                          name={fix.awayClub?.name}
                          shortName={fix.awayClub?.shortName}
                          size="sm"
                          className="w-6 h-6"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB C: STANDINGS TABLE */}
      {activeLeagueTab === 'STANDINGS' && (
        <div className="space-y-4">
          {isLoadingStandings && leagueStandings.length === 0 ? (
            <div className="glass-panel p-4 space-y-3 animate-pulse">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-10 rounded-xl bg-white/[0.04] border border-white/[0.04]" />
              ))}
            </div>
          ) : leagueStandings.length === 0 ? (
            <div className="py-12 text-center glass-panel rounded-2xl border border-white/[0.06] text-slate-400 text-xs">
              Standings are not available yet.
            </div>
          ) : (
            <div className="glass-panel overflow-hidden shadow-2xl border-white/[0.08]">
              <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 bg-slate-950/70 border-b border-white/[0.08] text-[10px]">
                <div className="font-bold text-slate-300">
                  {currentComp?.name || 'League Table'} • {totalLeagueMatchdays} Tur
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="flex items-center gap-1.5 text-slate-300">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <span>{t.uclZone} (1–{uclThreshold})</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-300">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    <span>{t.uelZone} ({uclThreshold + 1}–{uelThreshold})</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-300">
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    <span>{t.relegationZone} ({relThreshold}–{relThreshold === 16 ? 18 : 20})</span>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto scrollbar-none">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/[0.08] bg-slate-950/60 text-slate-400 font-bold uppercase text-[10px] tracking-wider">
                      <th className="py-3 px-3 w-12 text-center">#</th>
                      <th className="py-3 px-3">{t.club}</th>
                      <th className="py-3 px-2 text-center font-bold text-slate-300">P</th>
                      <th className="py-3 px-2 text-center">W</th>
                      <th className="py-3 px-2 text-center">D</th>
                      <th className="py-3 px-2 text-center">L</th>
                      <th className="py-3 px-2 text-center hidden sm:table-cell">GF</th>
                      <th className="py-3 px-2 text-center hidden sm:table-cell">GA</th>
                      <th className="py-3 px-2 text-center">GD</th>
                      <th className="py-3 px-3 text-center font-black text-emerald-400">PTS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {leagueStandings.map((row) => {
                      const posStyle = getPositionStyle(row.position);
                      const isMyClub = currentClub && currentClub.id === row.clubId;

                      return (
                        <tr
                          key={row.clubId}
                          className={`transition-colors ${
                            isMyClub ? 'bg-emerald-950/30 font-bold' : 'hover:bg-white/[0.02]'
                          }`}
                        >
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <span
                                className={`w-1.5 h-4 rounded-full ${posStyle.barColor}`}
                                title={posStyle.label}
                              />
                              <span className="font-black text-slate-300 text-xs">{row.position}</span>
                            </div>
                          </td>

                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2.5 min-w-[140px]">
                              <ClubCrest
                                clubId={row.clubId}
                                logoUrl={row.clubLogoUrl}
                                name={row.clubName}
                                size="xs"
                                className="w-5 h-5"
                              />
                              <span className="font-bold text-white text-xs truncate max-w-[160px]">
                                {row.clubName}
                              </span>
                              {isMyClub && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-emerald-500 text-slate-950 uppercase">
                                  You
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-2.5 px-2 text-center font-semibold text-slate-300">{row.played}</td>
                          <td className="py-2.5 px-2 text-center text-slate-400">{row.won}</td>
                          <td className="py-2.5 px-2 text-center text-slate-400">{row.drawn}</td>
                          <td className="py-2.5 px-2 text-center text-slate-400">{row.lost}</td>
                          <td className="py-2.5 px-2 text-center text-slate-400 hidden sm:table-cell">
                            {row.goalsFor}
                          </td>
                          <td className="py-2.5 px-2 text-center text-slate-400 hidden sm:table-cell">
                            {row.goalsAgainst}
                          </td>
                          <td className="py-2.5 px-2 text-center font-bold text-slate-300">
                            {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                          </td>
                          <td className="py-2.5 px-3 text-center font-black text-emerald-400 text-sm">{row.points}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Claim Confirmation Modal */}
      {clubToClaim && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md shadow-2xl p-6 text-white text-center border-emerald-500/30">
            <div className="w-16 h-16 rounded-2xl bg-slate-950/90 p-2.5 border border-white/[0.1] mx-auto mb-3 flex items-center justify-center shadow-lg">
              <ClubCrest
                clubId={clubToClaim.id}
                logoUrl={clubToClaim.logoUrl}
                name={clubToClaim.name}
                shortName={clubToClaim.shortName}
                size="lg"
                className="w-11 h-11"
              />
            </div>

            <h3 className="text-lg font-black text-white">{clubToClaim.name}</h3>
            <p className="text-xs text-slate-300 mt-2 mb-4 leading-relaxed">{t.claimConfirmationDesc}</p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setClubToClaim(null)}
                className="flex-1 py-2.5 glass-card glass-card-interactive text-slate-300 font-semibold text-xs min-h-[44px] touch-manipulation"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                id="btn-confirm-claim-action"
                disabled={isClaiming}
                onClick={handleClaimClub}
                className="flex-1 py-2.5 btn-glass-primary disabled:opacity-50 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5 min-h-[44px] touch-manipulation"
              >
                {isClaiming ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                    <span>{t.loading}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-slate-950" />
                    <span>{t.confirm}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
