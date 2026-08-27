import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api, ApiError } from '../lib/api';
import { League, Club } from '../types';
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
} from 'lucide-react';

export const ClubsView: React.FC = () => {
  const { user, currentClub, activeSeasonId, refreshUserData, showToast } = useAuth();
  const { t } = useI18n();

  const [leagues, setLeagues] = useState<League[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>('league-premier-league');
  const [clubs, setClubs] = useState<Club[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<{ message: string; isQuota?: boolean } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'ALL' | 'AVAILABLE' | 'CLAIMED'>('ALL');

  // Claim modal state
  const [clubToClaim, setClubToClaim] = useState<Club | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  const loadClubsForLeague = useCallback(async (leagueId: string) => {
    if (!leagueId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getLeagueClubs(leagueId, activeSeasonId, true);
      setClubs(res.clubs || []);
    } catch (err: any) {
      console.error('Failed to load clubs:', err);
      const isQuota =
        err?.httpStatus === 429 ||
        err?.data?.error === 'RESOURCE_EXHAUSTED' ||
        err?.message?.includes('quota') ||
        err?.message?.includes('RESOURCE_EXHAUSTED');

      setError({
        message: err.message || 'Failed to load clubs from Firestore database',
        isQuota,
      });
      setClubs([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeSeasonId]);

  const loadLeagues = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getLeagues();
      setLeagues(res.leagues || []);
      if (res.leagues && res.leagues.length > 0) {
        setSelectedLeagueId((prev) => {
          const exists = res.leagues.some((l) => l.id === prev);
          const target = exists ? prev : res.leagues[0].id;
          loadClubsForLeague(target);
          return target;
        });
      } else {
        setIsLoading(false);
      }
    } catch (err: any) {
      console.error('Failed to load leagues:', err);
      const isQuota =
        err?.httpStatus === 429 ||
        err?.data?.error === 'RESOURCE_EXHAUSTED' ||
        err?.message?.includes('quota') ||
        err?.message?.includes('RESOURCE_EXHAUSTED');

      setError({
        message: err.message || 'Failed to load leagues from Firestore database',
        isQuota,
      });
      setIsLoading(false);
    }
  }, [loadClubsForLeague]);

  useEffect(() => {
    loadLeagues();
  }, [loadLeagues]);

  const handleSelectLeague = (leagueId: string) => {
    setSelectedLeagueId(leagueId);
    loadClubsForLeague(leagueId);
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

  return (
    <div className="space-y-6 animate-in fade-in duration-300 pb-20">
      {/* Title & Info Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel p-4 sm:p-5 shadow-xl">
        <div>
          <h2 className="text-base sm:text-xl font-black text-white tracking-tight flex items-center gap-2">
            <Shield className="w-5 h-5 text-emerald-400" />
            <span>{t.topLeagues}</span>
          </h2>
          <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
            {t.claimConfirmationDesc}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Refresh Button */}
          <button
            id="btn-refresh-clubs-view"
            onClick={() => loadClubsForLeague(selectedLeagueId)}
            disabled={isLoading}
            className="px-3 py-1.5 glass-card glass-card-interactive text-slate-300 font-bold text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 min-h-[38px]"
            title="Refresh Clubs from Firestore"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
            <span>Refresh</span>
          </button>

          {/* User Active Club Badge */}
          {currentClub && (
            <div className="flex items-center gap-2.5 glass-card bg-emerald-950/40 border-emerald-500/30 p-2 px-3 shadow-md">
              <img
                src={currentClub.logoUrl}
                alt={currentClub.name}
                className="w-6 h-6 object-contain shrink-0"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <div className="min-w-0">
                <div className="text-[9px] uppercase font-black text-emerald-400 flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5" />
                  <span>{t.myClub} ({t.clubLocked})</span>
                </div>
                <div className="text-xs font-bold text-white truncate max-w-[120px]">{currentClub.name}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Season Lock Notification Banner if club already chosen */}
      {currentClub && (
        <div className="glass-card bg-slate-900/90 border-emerald-500/20 p-3 px-4 flex items-center gap-2.5 text-xs text-slate-300 shadow-sm">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <Lock className="w-3.5 h-3.5" />
          </div>
          <div>
            <span className="font-bold text-emerald-300">{t.alreadyHaveClubMessage}</span>
          </div>
        </div>
      )}

      {/* League Selection Tabs */}
      {leagues.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {leagues.map((league) => {
            const isSelected = selectedLeagueId === league.id;
            return (
              <button
                key={league.id}
                id={`btn-league-${league.id}`}
                onClick={() => handleSelectLeague(league.id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-bold text-xs shrink-0 transition-all min-h-[38px] ${
                  isSelected
                    ? 'btn-glass-primary text-slate-950 font-black shadow-md'
                    : 'glass-card text-slate-300 hover:text-white'
                }`}
              >
                <span>{league.country === 'England' ? '🏴󠁧󠁢󠁥󠁮󠁧󠁿' : league.country === 'Spain' ? '🇪🇸' : league.country === 'Italy' ? '🇮🇹' : league.country === 'Germany' ? '🇩🇪' : '🇫🇷'}</span>
                <span>{league.name}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded font-black ${isSelected ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
                  {league.totalClubs}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="glass-panel p-3 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md bg-[#0b101c]">
        {/* Search Bar */}
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

        {/* Filter Chips */}
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

      {/* Clubs Grid / Loading / Error */}
      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mb-2" />
          <span className="text-xs">{t.loading}</span>
        </div>
      ) : error ? (
        <div className={`py-10 px-6 text-center border rounded-3xl ${error.isQuota ? 'bg-amber-950/20 border-amber-800/40' : 'bg-rose-950/20 border-rose-800/40'}`}>
          <AlertTriangle className={`w-10 h-10 mx-auto mb-2 opacity-90 ${error.isQuota ? 'text-amber-400' : 'text-rose-500'}`} />
          <h4 className="text-sm font-bold text-white mb-1">
            {error.isQuota ? 'Firestore Quota Exceeded (RESOURCE_EXHAUSTED)' : 'Failed to Load Data'}
          </h4>
          <p className="text-xs text-slate-300 max-w-md mx-auto mb-4">
            {error.message}
          </p>
          <button
            onClick={() => {
              if (leagues.length === 0) {
                loadLeagues();
              } else {
                loadClubsForLeague(selectedLeagueId);
              }
            }}
            className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-black transition-all shadow-md"
          >
            Retry Loading
          </button>
        </div>
      ) : filteredClubs.length === 0 ? (
        <div className="py-16 text-center bg-slate-900 border border-slate-800 rounded-3xl">
          <Shield className="w-12 h-12 text-slate-600 mx-auto mb-2 opacity-60" />
          <h4 className="text-sm font-bold text-slate-200">No clubs found</h4>
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
            const managerName = club.claimedByUsername || club.managerUsername || club.occupancy?.username || 'player';

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
                {/* Top Row: Club Crest & Short code */}
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2.5">
                    <div className="w-12 h-12 rounded-xl bg-slate-950/80 p-2 border border-white/[0.08] flex items-center justify-center shadow-inner shrink-0">
                      <img
                        src={club.logoUrl}
                        alt={club.name}
                        className="w-8 h-8 object-contain"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
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
                        <div className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/30">
                          <Sparkles className="w-3 h-3" /> {t.available}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Club Info */}
                  <h3 className="font-black text-xs sm:text-sm text-slate-100 line-clamp-1 mb-0.5">{club.name}</h3>
                  <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-2.5">
                    <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                    <span className="truncate">{club.stadium || 'Home Stadium'}</span>
                  </div>
                </div>

                {/* Bottom Row: Manager Status or Claim Button */}
                <div className="pt-2.5 border-t border-white/[0.06] mt-1">
                  {isUserClub ? (
                    <div className="text-[11px] font-bold text-emerald-400 text-center py-1.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                      {t.manager}: @{user?.username}
                    </div>
                  ) : isClaimedByOther ? (
                    <div className="flex items-center justify-between text-[11px] text-slate-400 glass-card p-2 rounded-xl">
                      <span className="text-[10px] uppercase font-bold text-slate-500">{t.manager}:</span>
                      <span className="font-semibold text-slate-300 truncate">
                        @{managerName}
                      </span>
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

      {/* Claim Confirmation Modal */}
      {clubToClaim && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="glass-panel w-full max-w-md shadow-2xl p-6 text-white text-center border-emerald-500/30">
            <div className="w-16 h-16 rounded-2xl bg-slate-950/90 p-2.5 border border-white/[0.1] mx-auto mb-3 flex items-center justify-center shadow-lg">
              <img
                src={clubToClaim.logoUrl}
                alt={clubToClaim.name}
                className="w-11 h-11 object-contain"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>

            <h3 className="text-lg font-black text-white">{clubToClaim.name}</h3>
            <p className="text-xs text-slate-300 mt-2 mb-4 leading-relaxed">
              {t.claimConfirmationDesc}
            </p>

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
