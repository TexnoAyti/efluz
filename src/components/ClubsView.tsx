import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { api } from '../lib/api';
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
} from 'lucide-react';

export const ClubsView: React.FC = () => {
  const { user, currentClub, activeSeasonId, refreshUserData, showToast } = useAuth();
  const { t } = useI18n();

  const [leagues, setLeagues] = useState<League[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string>('league-premier-league');
  const [clubs, setClubs] = useState<Club[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'ALL' | 'AVAILABLE' | 'CLAIMED'>('ALL');

  // Claim modal state
  const [clubToClaim, setClubToClaim] = useState<Club | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  useEffect(() => {
    async function loadLeagues() {
      try {
        const res = await api.getLeagues();
        setLeagues(res.leagues);
        if (res.leagues.length > 0) {
          setSelectedLeagueId((prev) => {
            const exists = res.leagues.some((l) => l.id === prev);
            return exists ? prev : res.leagues[0].id;
          });
        }
      } catch (err: any) {
        console.error('Failed to load leagues:', err);
        setError('Failed to load leagues');
      }
    }
    loadLeagues();
  }, []);

  const loadClubs = async (leagueId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getLeagueClubs(leagueId, activeSeasonId);
      setClubs(res.clubs || []);
    } catch (err: any) {
      console.error('Failed to load clubs:', err);
      setError(err.message || 'Failed to load clubs');
      setClubs([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedLeagueId) {
      loadClubs(selectedLeagueId);
    }
  }, [selectedLeagueId, activeSeasonId]);

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
      showToast(t.claimSuccess, 'success');
      setClubToClaim(null);
      await refreshUserData();
      await loadClubs(selectedLeagueId);
    } catch (err: any) {
      showToast(err.message || 'Failed to claim club.', 'error');
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Shield className="w-6 h-6 text-emerald-400" />
            <span>{t.topLeagues}</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {t.claimConfirmationDesc}
          </p>
        </div>

        {/* User Active Club Badge */}
        {currentClub && (
          <div className="flex items-center gap-3 bg-emerald-950/40 border border-emerald-500/30 rounded-2xl p-2.5 px-4 shadow-md">
            <img
              src={currentClub.logoUrl}
              alt={currentClub.name}
              className="w-7 h-7 object-contain"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
            <div>
              <div className="text-[10px] uppercase font-bold text-emerald-400 flex items-center gap-1">
                <Lock className="w-3 h-3" />
                <span>{t.myClub} ({t.clubLocked})</span>
              </div>
              <div className="text-xs font-bold text-white">{currentClub.name}</div>
            </div>
          </div>
        )}
      </div>

      {/* Season Lock Notification Banner if club already chosen */}
      {currentClub && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 px-4 flex items-center gap-3 text-xs text-slate-300 shadow-sm">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <span className="font-bold text-emerald-300">{t.alreadyHaveClubMessage}</span>
          </div>
        </div>
      )}

      {/* League Selection Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        {leagues.map((league) => {
          const isSelected = selectedLeagueId === league.id;
          return (
            <button
              key={league.id}
              id={`btn-league-${league.id}`}
              onClick={() => setSelectedLeagueId(league.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-xs shrink-0 transition-all ${
                isSelected
                  ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20 scale-[1.02] font-black'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
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

      {/* Search & Filter Toolbar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-md">
        {/* Search Bar */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={t.search}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Filter Chips */}
        <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end">
          <button
            onClick={() => setFilterMode('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              filterMode === 'ALL'
                ? 'bg-slate-800 text-white border border-slate-600'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.filterAll} ({clubs.length})
          </button>
          <button
            onClick={() => setFilterMode('AVAILABLE')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              filterMode === 'AVAILABLE'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.available} ({availableCount})
          </button>
          <button
            onClick={() => setFilterMode('CLAIMED')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              filterMode === 'CLAIMED'
                ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.claimed} ({claimedCount})
          </button>
        </div>
      </div>

      {/* Clubs Grid */}
      {isLoading ? (
        <div className="py-20 flex flex-col items-center justify-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-400 mb-2" />
          <span className="text-xs">{t.loading}</span>
        </div>
      ) : error ? (
        <div className="py-12 px-6 text-center bg-rose-950/20 border border-rose-800/40 rounded-3xl">
          <Shield className="w-10 h-10 text-rose-500 mx-auto mb-2 opacity-80" />
          <h4 className="text-sm font-bold text-rose-200">{error}</h4>
          <button
            onClick={() => loadClubs(selectedLeagueId)}
            className="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold transition-all"
          >
            Retry
          </button>
        </div>
      ) : filteredClubs.length === 0 ? (
        <div className="py-16 text-center bg-slate-900 border border-slate-800 rounded-3xl">
          <Shield className="w-12 h-12 text-slate-600 mx-auto mb-2 opacity-60" />
          <h4 className="text-sm font-bold text-slate-200">No clubs found</h4>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
                className={`bg-slate-900 border rounded-3xl p-5 flex flex-col justify-between shadow-lg transition-all relative overflow-hidden ${
                  isUserClub
                    ? 'border-emerald-500/50 bg-gradient-to-b from-slate-900 to-emerald-950/20 shadow-emerald-500/10'
                    : isClaimedByOther
                    ? 'border-slate-800/80 opacity-90'
                    : 'border-slate-800 hover:border-slate-700 hover:shadow-xl'
                }`}
              >
                {/* Top Row: Club Crest & Short code */}
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="w-14 h-14 rounded-2xl bg-slate-950 p-2.5 border border-slate-800 flex items-center justify-center shadow-inner shrink-0">
                      <img
                        src={club.logoUrl}
                        alt={club.name}
                        className="w-10 h-10 object-contain"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    </div>

                    <div className="text-right">
                      <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                        {club.shortName}
                      </span>
                      {isUserClub ? (
                        <div className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3" /> {t.myClub}
                        </div>
                      ) : isClaimedByOther ? (
                        <div className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full border border-slate-700">
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
                  <h3 className="font-black text-sm text-slate-100 line-clamp-1 mb-1">{club.name}</h3>
                  <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-3">
                    <MapPin className="w-3 h-3 text-slate-500 shrink-0" />
                    <span className="truncate">{club.stadium || 'Home Stadium'}</span>
                  </div>
                </div>

                {/* Bottom Row: Manager Status or Claim Button */}
                <div className="pt-3 border-t border-slate-800/80 mt-2">
                  {isUserClub ? (
                    <div className="text-[11px] font-bold text-emerald-400 text-center py-1.5 bg-emerald-500/10 rounded-xl">
                      {t.manager}: @{user?.username}
                    </div>
                  ) : isClaimedByOther ? (
                    <div className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60">
                      <span className="text-[10px] uppercase font-bold text-slate-500">{t.manager}:</span>
                      <span className="font-semibold text-slate-300 truncate">
                        @{managerName}
                      </span>
                    </div>
                  ) : currentClub ? (
                    <button
                      disabled={true}
                      className="w-full py-2 bg-slate-950 text-slate-500 font-bold text-xs rounded-xl border border-slate-800 flex items-center justify-center gap-1.5 cursor-not-allowed opacity-80"
                    >
                      <Lock className="w-3.5 h-3.5 text-slate-600" />
                      <span>{t.clubLocked}</span>
                    </button>
                  ) : (
                    <button
                      id={`btn-claim-club-${club.id}`}
                      onClick={() => setClubToClaim(club)}
                      className="w-full py-2 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 font-black text-xs rounded-xl shadow-md shadow-emerald-500/10 flex items-center justify-center gap-1.5 transition-all"
                    >
                      <Shield className="w-3.5 h-3.5" />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl w-full max-w-md shadow-2xl p-6 text-white text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-950 p-2.5 border border-slate-700 mx-auto mb-3 flex items-center justify-center shadow-lg">
              <img
                src={clubToClaim.logoUrl}
                alt={clubToClaim.name}
                className="w-12 h-12 object-contain"
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
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs transition-colors"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                id="btn-confirm-claim-action"
                disabled={isClaiming}
                onClick={handleClaimClub}
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 text-slate-950 font-black rounded-xl text-xs shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-1.5 transition-all"
              >
                {isClaiming ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t.loading}</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
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
