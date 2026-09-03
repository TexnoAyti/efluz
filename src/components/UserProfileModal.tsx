import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ClubCrest } from './ClubCrest';
import {
  User as UserIcon,
  X,
  Shield,
  Trophy,
  Loader2,
  Flame,
  Award,
  Calendar,
  ExternalLink,
} from 'lucide-react';

interface UserProfileModalProps {
  userId: string | null;
  onClose: () => void;
  onSelectClub?: (clubId: string) => void;
}

interface UserProfileData {
  user: {
    id: string;
    username: string;
    firstName: string;
    lastName?: string;
    photoUrl?: string;
    isAdmin?: boolean;
    createdAt?: string;
  };
  currentClub?: {
    id: string;
    name: string;
    shortName: string;
    logoUrl?: string;
    leagueId?: string;
  };
  stats: {
    matchesPlayed: number;
    wins: number;
    draws: number;
    losses: number;
    goalsScored: number;
    goalsConceded: number;
    points: number;
  };
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  userId,
  onClose,
  onSelectClub,
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileData, setProfileData] = useState<UserProfileData | null>(null);

  useEffect(() => {
    if (!userId) {
      setProfileData(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    api
      .getUserProfile(userId)
      .then((data) => {
        if (isMounted) {
          setProfileData(data);
          setLoading(false);
        }
      })
      .catch((err: any) => {
        if (isMounted) {
          console.error('Failed to load user profile:', err);
          setError(err.message || 'Foydalanuvchi ma’lumotlarini yuklab bo‘lmadi.');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [userId]);

  if (!userId) return null;

  const winRate =
    profileData?.stats && profileData.stats.matchesPlayed > 0
      ? Math.round((profileData.stats.wins / profileData.stats.matchesPlayed) * 100)
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-md glass-panel p-6 shadow-2xl relative border border-white/[0.1] bg-slate-900/95 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {loading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
            <span className="text-xs font-semibold text-slate-400">Profil yuklanmoqda...</span>
          </div>
        ) : error || !profileData ? (
          <div className="py-12 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-400 flex items-center justify-center mx-auto">
              <UserIcon className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-slate-300">{error || 'Foydalanuvchi topilmadi.'}</p>
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-bold hover:bg-slate-700 transition-colors"
            >
              Yopish
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* User Header */}
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-slate-950 p-1 border border-white/[0.1] flex items-center justify-center text-slate-300 font-bold text-xl shrink-0 overflow-hidden shadow-inner">
                {profileData.user.photoUrl ? (
                  <img
                    src={profileData.user.photoUrl}
                    alt={profileData.user.username}
                    className="w-full h-full object-cover rounded-xl"
                  />
                ) : (
                  <UserIcon className="w-8 h-8 text-slate-500" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {profileData.user.isAdmin ? 'Admin' : 'Player'}
                  </span>
                </div>
                <h3 className="text-lg font-black text-white truncate mt-1">
                  {profileData.user.firstName} {profileData.user.lastName || ''}
                </h3>
                <p className="text-xs font-semibold text-emerald-400">
                  {profileData.user.username ? `@${profileData.user.username}` : 'No Telegram handle'}
                </p>
              </div>
            </div>

            {/* Current Club */}
            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Amaldagi Klub
              </div>
              {profileData.currentClub ? (
                <div
                  onClick={() => {
                    if (onSelectClub && profileData.currentClub) {
                      onSelectClub(profileData.currentClub.id);
                      onClose();
                    }
                  }}
                  className="flex items-center gap-3 p-3 rounded-2xl bg-slate-950/60 border border-white/[0.08] hover:border-emerald-500/30 transition-all cursor-pointer group"
                >
                  <ClubCrest
                    clubId={profileData.currentClub.id}
                    logoUrl={profileData.currentClub.logoUrl}
                    name={profileData.currentClub.name}
                    shortName={profileData.currentClub.shortName}
                    size="md"
                    className="w-8 h-8"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors truncate">
                      {profileData.currentClub.name}
                    </div>
                    <div className="text-[10px] text-slate-400 font-medium">
                      {profileData.currentClub.leagueId
                        ? profileData.currentClub.leagueId.replace('league-', '').replace('-', ' ').toUpperCase()
                        : 'EFL UZ'}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-2xl bg-slate-950/40 border border-white/[0.05] text-xs text-slate-500 italic">
                  User qo‘yilmagan / Klub tanlanmagan
                </div>
              )}
            </div>

            {/* Stats Grid */}
            <div>
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                Mavsumiy Ko‘rsatkichlar
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.06]">
                  <div className="text-xs text-slate-400 font-semibold">O‘yin</div>
                  <div className="text-base font-black text-white mt-0.5">{profileData.stats.matchesPlayed}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.06]">
                  <div className="text-xs text-emerald-400 font-semibold">G‘alaba</div>
                  <div className="text-base font-black text-emerald-400 mt-0.5">{profileData.stats.wins}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.06]">
                  <div className="text-xs text-amber-400 font-semibold">Durang</div>
                  <div className="text-base font-black text-amber-400 mt-0.5">{profileData.stats.draws}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.06]">
                  <div className="text-xs text-rose-400 font-semibold">Mag‘lub</div>
                  <div className="text-base font-black text-rose-400 mt-0.5">{profileData.stats.losses}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center mt-2">
                <div className="p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.06]">
                  <div className="text-[11px] text-slate-400 font-semibold">Gollar (Ur/O‘t)</div>
                  <div className="text-sm font-black text-slate-200 mt-0.5">
                    {profileData.stats.goalsScored} - {profileData.stats.goalsConceded}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.06]">
                  <div className="text-[11px] text-slate-400 font-semibold">Ochko</div>
                  <div className="text-sm font-black text-emerald-400 mt-0.5">{profileData.stats.points}</div>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-950/60 border border-white/[0.06]">
                  <div className="text-[11px] text-slate-400 font-semibold">G‘alaba %</div>
                  <div className="text-sm font-black text-teal-400 mt-0.5">{winRate}%</div>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="pt-2 flex justify-end">
              <button
                onClick={onClose}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-colors shadow"
              >
                Yopish
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
