import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Shield, Bell, UserCircle, ChevronDown, CheckCircle2, Trophy, Sparkles, Terminal } from 'lucide-react';
import { ClubCrest } from './ClubCrest';

interface HeaderProps {
  onOpenNotifications: () => void;
  onOpenDiagnostics?: () => void;
  onOpenProfile?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenNotifications, onOpenDiagnostics, onOpenProfile }) => {
  const {
    user,
    currentClub,
    seasons,
    activeSeasonId,
    setActiveSeasonId,
    isDevMode,
    devProfiles,
    switchDevUser,
    unreadNotificationCount,
  } = useAuth();

  const [showDevMenu, setShowDevMenu] = useState(false);
  const [showSeasonMenu, setShowSeasonMenu] = useState(false);

  const activeSeason = seasons.find((s) => s.id === activeSeasonId);

  return (
    <header className="sticky top-0 z-40 bg-[#06090e]/90 backdrop-blur-xl border-b border-white/[0.08] text-white">
      {/* Sandbox Dev Switcher Banner (Collapsed & compact on mobile) */}
      {isDevMode && (
        <div className="bg-gradient-to-r from-emerald-950/80 via-slate-900/90 to-indigo-950/80 border-b border-emerald-500/20 px-3 py-1 text-xs backdrop-blur-md">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-emerald-400 font-medium truncate">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0 animate-pulse" />
              <span className="font-bold text-[11px] sm:text-xs">Sandbox</span>
              <span className="text-slate-400 hidden md:inline text-[11px]">— Multi-player match consensus & dispute tester</span>
            </div>

            <div className="relative">
              <button
                id="btn-dev-switch"
                onClick={() => setShowDevMenu(!showDevMenu)}
                className="flex items-center gap-1.5 px-2 py-0.5 glass-button text-slate-200 text-[11px] font-bold min-h-[28px]"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" />
                <span className="truncate max-w-[90px] sm:max-w-none">@{user?.username}</span>
                <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
              </button>

              {showDevMenu && (
                <div className="absolute right-0 mt-1.5 w-60 glass-modal py-1.5 z-50 shadow-2xl">
                  <div className="px-3 py-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider border-b border-white/[0.06]">
                    Switch Player Account
                  </div>
                  {devProfiles.map((prof) => {
                    const isSelected = user?.id === prof.id || user?.username === prof.username;
                    return (
                      <button
                        key={prof.id}
                        id={`btn-select-user-${prof.username}`}
                        onClick={() => {
                          switchDevUser(prof.id);
                          setShowDevMenu(false);
                        }}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-white/[0.06] transition-colors text-xs ${
                          isSelected ? 'bg-emerald-500/15 text-emerald-300 font-bold' : 'text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]' : 'bg-slate-600'}`} />
                          <div>
                            <div className="font-bold text-slate-200">@{prof.username}</div>
                            <div className="text-[10px] text-slate-400">{prof.firstName} {prof.isAdmin ? '• (Admin)' : ''}</div>
                          </div>
                        </div>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main App Bar - Strictly Clean Mobile Target (EFL UZ | Bell | Avatar) */}
      <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 h-13 sm:h-15 flex items-center justify-between gap-2 sm:gap-4">
        {/* Brand & Logo */}
        <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-emerald-500 flex items-center justify-center text-slate-950 font-black text-base sm:text-lg tracking-tighter shrink-0">
            eF
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-black text-base sm:text-lg tracking-tight text-white truncate">
              EFL UZ
            </span>
            <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              PRO LEAGUE
            </span>
          </div>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {/* Season Selector (Desktop only) */}
          <div className="relative hidden md:block">
            <button
              id="btn-season-select"
              onClick={() => setShowSeasonMenu(!showSeasonMenu)}
              className="flex items-center gap-2 px-3 py-1.5 glass-button text-xs font-bold text-slate-200 min-h-[34px]"
            >
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <span>{activeSeason?.name || '2026/27'}</span>
              <ChevronDown className="w-3 h-3 text-slate-400" />
            </button>

            {showSeasonMenu && (
              <div className="absolute right-0 mt-1.5 w-48 glass-modal py-1.5 z-50">
                {seasons.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setActiveSeasonId(s.id);
                      setShowSeasonMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-white/[0.06] transition-colors ${
                      s.id === activeSeasonId ? 'text-emerald-400 font-bold bg-emerald-500/10' : 'text-slate-300'
                    }`}
                  >
                    <span>{s.name}</span>
                    <span className="text-[9px] uppercase font-bold text-slate-400 glass-pill px-1.5 py-0.5">
                      {s.status}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* User Club Badge (Desktop/Tablet only to keep mobile header minimal) */}
          {currentClub && (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 glass-card border-white/[0.08] max-w-[150px] min-h-[34px]">
              <ClubCrest
                clubId={currentClub.id}
                logoUrl={currentClub.logoUrl}
                name={currentClub.name}
                shortName={currentClub.shortName}
                size="xs"
                className="w-4 h-4 shrink-0"
              />
              <span className="text-xs font-bold text-slate-200 truncate">
                {currentClub.shortName || currentClub.name}
              </span>
            </div>
          )}

          {/* Telegram Diagnostics Launcher (Desktop only) */}
          {onOpenDiagnostics && (
            <button
              id="btn-open-diagnostics"
              onClick={onOpenDiagnostics}
              className="hidden md:flex p-2 glass-button text-slate-300 items-center justify-center min-w-[34px] min-h-[34px]"
              title="Telegram WebApp Diagnostics"
            >
              <Terminal className="w-4 h-4 text-indigo-400" />
            </button>
          )}

          {/* Notifications Button */}
          <button
            id="btn-notifications"
            onClick={onOpenNotifications}
            className="relative p-2 glass-button text-slate-300 flex items-center justify-center min-w-[38px] min-h-[38px] touch-manipulation active:scale-95"
            title="Tournament Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadNotificationCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full shadow-[0_0_6px_#f43f5e]" />
            )}
          </button>

          {/* User Profile Avatar */}
          <div
            onClick={onOpenProfile}
            className="flex items-center gap-2 cursor-pointer touch-manipulation active:scale-95"
          >
            <div className="w-8 h-8 rounded-full bg-[#141c2e] border border-white/[0.12] flex items-center justify-center text-slate-300 font-bold text-xs overflow-hidden shrink-0">
              {user?.photoUrl ? (
                <img src={user.photoUrl} alt={user.username} className="w-full h-full object-cover" />
              ) : (
                <UserCircle className="w-5 h-5 text-slate-400" />
              )}
            </div>
            <div className="hidden lg:block text-left">
              <div className="text-xs font-bold text-slate-200 leading-tight">@{user?.username}</div>
              <div className="text-[10px] text-emerald-400 font-medium">
                {user?.isAdmin ? 'Admin' : 'Player'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
