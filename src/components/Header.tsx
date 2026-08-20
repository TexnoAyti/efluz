import React, { useState } from 'react';
import { useAuth, APP_BUILD_ID } from '../context/AuthContext';
import { Shield, Bell, UserCircle, ChevronDown, CheckCircle2, AlertTriangle, Trophy, Sparkles, Terminal } from 'lucide-react';

interface HeaderProps {
  onOpenNotifications: () => void;
  onOpenDiagnostics?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenNotifications, onOpenDiagnostics }) => {
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
    telegramDiagnostics,
  } = useAuth();

  const [showDevMenu, setShowDevMenu] = useState(false);
  const [showSeasonMenu, setShowSeasonMenu] = useState(false);

  const activeSeason = seasons.find((s) => s.id === activeSeasonId);

  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 text-white">
      {/* Sandbox Dev Switcher Banner */}
      {isDevMode && (
        <div className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-indigo-950/80 border-b border-emerald-500/20 px-3 py-1.5 text-xs">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-emerald-400 font-medium truncate">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0 animate-pulse" />
              <span>Multiplayer Sandbox Mode</span>
              <span className="text-slate-400 hidden sm:inline">— Switch players to simulate match score verification & disputes</span>
            </div>

            <div className="relative">
              <button
                id="btn-dev-switch"
                onClick={() => setShowDevMenu(!showDevMenu)}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-md border border-slate-700 text-slate-200 transition-colors text-xs"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span>Active: <strong className="text-white">@{user?.username}</strong></span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {showDevMenu && (
                <div className="absolute right-0 mt-1 w-64 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl py-1 z-50">
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                    Switch Sandbox Account
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
                        className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-800/80 transition-colors text-xs ${
                          isSelected ? 'bg-emerald-500/10 text-emerald-300 font-medium' : 'text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${isSelected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                          <div>
                            <div className="font-semibold text-slate-200">@{prof.username}</div>
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

      {/* Main App Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        {/* Brand & Logo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-slate-950 font-black text-xl tracking-tighter">
            eF
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-black text-base sm:text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
                eFootball Tournaments
              </h1>
              <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                PRO LEAGUE
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">Official 2026/27 European Competitions</p>
          </div>
        </div>

        {/* Center/Right Controls */}
        <div className="flex items-center gap-2.5 sm:gap-4">
          {/* Season Selector */}
          <div className="relative hidden md:block">
            <button
              id="btn-season-select"
              onClick={() => setShowSeasonMenu(!showSeasonMenu)}
              className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/80 hover:bg-slate-700/80 rounded-lg border border-slate-700 text-xs font-semibold text-slate-200 transition-colors"
            >
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              <span>Season: {activeSeason?.name || '2026/27'}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {showSeasonMenu && (
              <div className="absolute right-0 mt-1 w-48 bg-slate-900 border border-slate-700 rounded-lg shadow-xl py-1 z-50">
                {seasons.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      setActiveSeasonId(s.id);
                      setShowSeasonMenu(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-slate-800 ${
                      s.id === activeSeasonId ? 'text-emerald-400 font-bold bg-emerald-500/10' : 'text-slate-300'
                    }`}
                  >
                    <span>{s.name}</span>
                    <span className="text-[10px] uppercase font-semibold text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                      {s.status}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* User Club Badge */}
          {currentClub ? (
            <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-800/90 rounded-lg border border-slate-700/80">
              <img
                src={currentClub.logoUrl}
                alt={currentClub.name}
                className="w-5 h-5 object-contain"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <span className="text-xs font-bold text-slate-200 max-w-[90px] sm:max-w-[120px] truncate">
                {currentClub.name}
              </span>
            </div>
          ) : (
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 text-xs font-medium">
              <Shield className="w-3.5 h-3.5" />
              <span>No Club Claimed</span>
            </div>
          )}

          {/* Telegram Diagnostics Launcher */}
          {onOpenDiagnostics && (
            <button
              id="btn-open-diagnostics"
              onClick={onOpenDiagnostics}
              className="p-2 bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 rounded-lg border border-slate-700 text-slate-300 transition-colors flex items-center gap-1"
              title="Telegram WebApp Diagnostics"
            >
              <Terminal className="w-4 h-4 text-indigo-400" />
            </button>
          )}

          {/* Notifications Button */}
          <button
            id="btn-notifications"
            onClick={onOpenNotifications}
            className="relative p-2 bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 rounded-lg border border-slate-700 text-slate-300 transition-colors"
            title="Tournament Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadNotificationCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center animate-bounce">
                {unreadNotificationCount}
              </span>
            )}
          </button>

          {/* User Profile Pill */}
          <div className="flex items-center gap-2 pl-1 sm:pl-2 border-l border-slate-800">
            <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 font-bold text-xs overflow-hidden">
              {user?.photoUrl ? (
                <img src={user.photoUrl} alt={user.username} className="w-full h-full object-cover" />
              ) : (
                <UserCircle className="w-5 h-5 text-slate-400" />
              )}
            </div>
            <div className="hidden lg:block text-left">
              <div className="text-xs font-bold text-slate-200 leading-tight">@{user?.username}</div>
              <div className="text-[10px] text-slate-400">{user?.isAdmin ? 'Tournament Admin' : 'Verified Player'}</div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
