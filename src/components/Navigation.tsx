import React from 'react';
import {
  Home,
  Shield,
  Swords,
  Layers,
  Award,
  Globe2,
  Trophy,
  Bell,
  User,
  SlidersHorizontal,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';

export type TabType =
  | 'dashboard'
  | 'home'
  | 'my-club'
  | 'my-matches'
  | 'leagues'
  | 'cups'
  | 'champions-league'
  | 'standings'
  | 'notifications'
  | 'profile'
  | 'admin';

interface NavigationProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  openDisputesCount?: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onTabChange,
  openDisputesCount = 0,
}) => {
  const { user, unreadNotificationCount } = useAuth();
  const { t } = useI18n();

  const currentTab = activeTab === 'home' ? 'dashboard' : activeTab;

  const navItems = [
    { id: 'dashboard' as TabType, label: t.navHome, icon: Home },
    { id: 'my-club' as TabType, label: t.navMyClub, icon: Shield },
    { id: 'my-matches' as TabType, label: t.navMyMatches, icon: Swords },
    { id: 'leagues' as TabType, label: t.navLeagues, icon: Layers },
    { id: 'cups' as TabType, label: t.navCups, icon: Award },
    { id: 'champions-league' as TabType, label: t.navChampionsLeague, icon: Globe2 },
    { id: 'standings' as TabType, label: t.navStandings, icon: Trophy },
    { id: 'notifications' as TabType, label: t.navNotifications, icon: Bell, badge: unreadNotificationCount },
    { id: 'profile' as TabType, label: t.navProfile, icon: User },
  ];

  // Admin navigation (visible to admins or in sandbox mode)
  if (user?.isAdmin) {
    navItems.push({
      id: 'admin' as TabType,
      label: t.navAdmin,
      icon: SlidersHorizontal,
      badge: openDisputesCount,
    });
  }

  return (
    <>
      {/* Desktop Navigation Tabs (Horizontal Top Bar under Header) */}
      <nav className="hidden lg:block bg-slate-900/95 backdrop-blur-md border-b border-slate-800/80 sticky top-[73px] z-30 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center space-x-1 py-2 overflow-x-auto scrollbar-none">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              const hasBadge = (item.badge || 0) > 0;

              return (
                <button
                  key={item.id}
                  id={`nav-tab-${item.id}`}
                  onClick={() => onTabChange(item.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 ${
                    isActive
                      ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/25 font-black'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-slate-950' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                  {hasBadge && (
                    <span
                      className={`flex items-center justify-center px-1.5 py-0.5 rounded-full text-[10px] font-black leading-none ${
                        item.id === 'admin'
                          ? 'bg-amber-500 text-slate-950 animate-pulse'
                          : 'bg-rose-500 text-white'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Mobile Bottom Navigation Bar (Telegram Mini App Native Experience) */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800/80 pb-safe shadow-2xl">
        <div className="flex items-center justify-around px-1 py-1.5 overflow-x-auto scrollbar-none">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            const hasBadge = (item.badge || 0) > 0;

            return (
              <button
                key={item.id}
                id={`mobile-tab-${item.id}`}
                onClick={() => onTabChange(item.id)}
                className={`relative flex flex-col items-center justify-center py-1 px-1.5 rounded-xl transition-all flex-1 min-w-[58px] ${
                  isActive ? 'text-emerald-400 font-black scale-105' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="relative">
                  <Icon
                    className={`w-5 h-5 transition-transform ${
                      isActive ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'text-slate-400'
                    }`}
                  />
                  {hasBadge && (
                    <span
                      className={`absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-black flex items-center justify-center leading-none ${
                        item.id === 'admin'
                          ? 'bg-amber-500 text-slate-950 animate-pulse'
                          : 'bg-rose-500 text-white'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[9.5px] mt-1 tracking-tight truncate max-w-[62px] text-center">
                  {item.label}
                </span>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-0.5 shadow-[0_0_6px_#10b981]" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
