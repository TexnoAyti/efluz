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

  // Desktop complete navigation
  const desktopNavItems = [
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

  if (user?.isAdmin) {
    desktopNavItems.push({
      id: 'admin' as TabType,
      label: t.navAdmin,
      icon: SlidersHorizontal,
      badge: openDisputesCount,
    });
  }

  // Mobile 5-Item SofaScore-style Bottom Navigation Bar
  const mobileNavItems = [
    {
      id: 'dashboard' as TabType,
      label: t.navHome,
      icon: Home,
      isActive: currentTab === 'dashboard',
    },
    {
      id: 'my-matches' as TabType,
      label: t.navMyMatches,
      icon: Swords,
      isActive: currentTab === 'my-matches',
    },
    {
      id: 'leagues' as TabType,
      label: t.navLeagues,
      icon: Layers,
      isActive: currentTab === 'leagues' || currentTab === 'cups' || currentTab === 'champions-league',
    },
    {
      id: 'standings' as TabType,
      label: t.navStandings,
      icon: Trophy,
      isActive: currentTab === 'standings',
    },
    {
      id: 'profile' as TabType,
      label: t.navProfile,
      icon: User,
      isActive: currentTab === 'profile' || currentTab === 'my-club' || currentTab === 'admin' || currentTab === 'notifications',
      badge: (user?.isAdmin && openDisputesCount > 0) ? openDisputesCount : (unreadNotificationCount > 0 ? unreadNotificationCount : 0),
    },
  ];

  return (
    <>
      {/* Desktop Navigation Tabs (Horizontal Top Glass Bar) */}
      <nav className="hidden lg:block bg-[#080d16]/85 backdrop-blur-2xl border-b border-white/[0.08] sticky top-[61px] z-30 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center space-x-1.5 py-2 overflow-x-auto scrollbar-none">
            {desktopNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              const hasBadge = (item.badge || 0) > 0;

              return (
                <button
                  key={item.id}
                  id={`nav-tab-${item.id}`}
                  onClick={() => onTabChange(item.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                    isActive
                      ? 'btn-glass-primary shadow-emerald-500/25 font-black scale-[1.02]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-slate-950 stroke-[2.5]' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                  {hasBadge && (
                    <span
                      className={`flex items-center justify-center px-1.5 py-0.5 rounded-full text-[9px] font-black leading-none ${
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

      {/* Mobile 5-Item Fixed Liquid Glass Bottom Navigation Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 glass-nav-bottom bottom-nav-safe">
        <div className="flex items-center justify-around px-2 py-1 max-w-lg mx-auto">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const hasBadge = (item.badge || 0) > 0;

            return (
              <button
                key={item.id}
                id={`mobile-tab-${item.id}`}
                onClick={() => onTabChange(item.id)}
                className={`relative flex flex-col items-center justify-center py-1.5 px-2 rounded-2xl transition-all flex-1 min-h-[48px] ${
                  item.isActive
                    ? 'text-emerald-400 font-black'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="relative">
                  <div
                    className={`p-1 rounded-xl transition-all ${
                      item.isActive
                        ? 'bg-emerald-500/15 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.3)] scale-110'
                        : 'text-slate-400'
                    }`}
                  >
                    <Icon className="w-5 h-5 stroke-[2.2]" />
                  </div>
                  {hasBadge && (
                    <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-black bg-rose-500 text-white flex items-center justify-center shadow-[0_0_8px_rgba(244,63,94,0.6)] animate-pulse">
                      {item.badge}
                    </span>
                  )}
                </div>
                <span className={`text-[10px] mt-0.5 tracking-tight font-bold truncate max-w-[64px] ${item.isActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
};
