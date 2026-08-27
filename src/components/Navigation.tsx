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

  // Mobile STRICT 5-Item SofaScore-style Bottom Navigation Bar
  // Exactly 5 destinations: HOME, MATCHES, LEAGUES, TABLE, PROFILE
  const mobileNavItems = [
    {
      id: 'dashboard' as TabType,
      label: t.navHome || 'Home',
      icon: Home,
      isActive: currentTab === 'dashboard',
    },
    {
      id: 'my-matches' as TabType,
      label: t.navMyMatches || 'Matches',
      icon: Swords,
      isActive: currentTab === 'my-matches',
    },
    {
      id: 'leagues' as TabType,
      label: t.navLeagues || 'Leagues',
      icon: Layers,
      isActive: currentTab === 'leagues' || currentTab === 'cups' || currentTab === 'champions-league',
    },
    {
      id: 'standings' as TabType,
      label: t.navStandings || 'Table',
      icon: Trophy,
      isActive: currentTab === 'standings',
    },
    {
      id: 'profile' as TabType,
      label: t.navProfile || 'Profile',
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
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 min-h-[38px] ${
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

      {/* Mobile EXACT 5-Item Fixed Clean Bottom Navigation Bar */}
      {/* Optimized for 360px+ viewports without horizontal scroll */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-50 glass-nav-bottom bottom-nav-safe"
      >
        <div className="grid grid-cols-5 items-center w-full max-w-md mx-auto px-1 py-1">
          {mobileNavItems.map((item) => {
            const Icon = item.icon;
            const hasBadge = (item.badge || 0) > 0;

            return (
              <button
                key={item.id}
                id={`mobile-tab-${item.id}`}
                onClick={() => onTabChange(item.id)}
                className={`relative flex flex-col items-center justify-center py-1 px-1 rounded-lg transition-colors min-h-[46px] touch-manipulation select-none ${
                  item.isActive
                    ? 'text-emerald-400 font-bold'
                    : 'text-slate-400 active:text-slate-200'
                }`}
              >
                <div className="relative flex items-center justify-center">
                  <div
                    className={`p-1 rounded-md transition-colors duration-150 ${
                      item.isActive
                        ? 'text-emerald-400 bg-emerald-500/10'
                        : 'text-slate-400'
                    }`}
                  >
                    <Icon className="w-5 h-5 stroke-[2]" />
                  </div>
                  {hasBadge && (
                    <span className="absolute -top-0.5 -right-1 min-w-[14px] h-[14px] px-1 rounded-full text-[8px] font-black bg-rose-500 text-white flex items-center justify-center">
                      {item.badge}
                    </span>
                  )}
                </div>
                <span
                  className={`text-[10px] mt-0.5 tracking-tight truncate max-w-[58px] leading-tight ${
                    item.isActive ? 'text-emerald-400 font-bold' : 'text-slate-400 font-normal'
                  }`}
                >
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
