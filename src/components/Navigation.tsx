import React from 'react';
import {
  Home,
  Shield,
  Swords,
  Layers,
  Award,
  Globe2,
  Bell,
  User,
  SlidersHorizontal,
  CalendarDays,
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
  | 'season-hub'
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
  const { t, language } = useI18n();

  const currentTab = activeTab === 'home' ? 'dashboard' : activeTab;

  // Desktop navigation items
  const desktopNavItems = user?.isAdmin
    ? [
        { id: 'dashboard' as TabType, label: t.navHome || 'Home', icon: Home },
        { id: 'leagues' as TabType, label: t.navLeagues || 'Leagues', icon: Layers },
        { id: 'my-club' as TabType, label: language === 'uz' ? 'Klub' : language === 'ru' ? 'Клуб' : 'Club', icon: Shield },
        { id: 'admin' as TabType, label: t.navAdmin || 'Admin', icon: SlidersHorizontal, badge: openDisputesCount },
      ]
    : [
        { id: 'dashboard' as TabType, label: t.navHome, icon: Home },
        { id: 'my-club' as TabType, label: t.navMyClub, icon: Shield },
        { id: 'my-matches' as TabType, label: t.navMyMatches, icon: Swords },
        { id: 'season-hub' as TabType, label: 'Season Hub', icon: CalendarDays },
        { id: 'leagues' as TabType, label: t.navLeagues, icon: Layers },
        { id: 'cups' as TabType, label: t.navCups, icon: Award },
        { id: 'champions-league' as TabType, label: t.navChampionsLeague, icon: Globe2 },
        { id: 'notifications' as TabType, label: t.navNotifications, icon: Bell, badge: unreadNotificationCount },
        { id: 'profile' as TabType, label: t.navProfile, icon: User },
      ];

  // Admin Mobile Nav: STRICTLY 3 DESTINATIONS: HOME, LEAGUES, CLUB (NO TEXT LABELS, ONLY ICONS)
  const isHomeActive = currentTab === 'dashboard' || currentTab === 'home';
  const isLeaguesActive =
    currentTab === 'leagues' ||
    currentTab === 'cups' ||
    currentTab === 'champions-league' ||
    currentTab === 'standings' ||
    currentTab === 'season-hub';
  const isClubActive =
    currentTab === 'my-club' ||
    currentTab === 'profile' ||
    currentTab === 'my-matches';

  const adminMobileItems = [
    {
      id: 'dashboard' as TabType,
      label: 'Home',
      icon: Home,
      isActive: isHomeActive,
    },
    {
      id: 'leagues' as TabType,
      label: 'Leagues',
      icon: Layers,
      isActive: isLeaguesActive,
    },
    {
      id: 'my-club' as TabType,
      label: 'Club',
      icon: Shield,
      isActive: isClubActive,
      badge: unreadNotificationCount > 0 ? unreadNotificationCount : 0,
    },
  ];

  // Normal player mobile nav (preserved with 4 items and text labels)
  const standardMobileItems = [
    {
      id: 'dashboard' as TabType,
      label: t.navHome || 'Home',
      icon: Home,
      isActive: currentTab === 'dashboard',
    },
    {
      id: 'my-matches' as TabType,
      label: language === 'uz' ? 'O‘yinlar' : language === 'ru' ? 'Матчи' : 'Matches',
      icon: Swords,
      isActive: currentTab === 'my-matches',
    },
    {
      id: 'leagues' as TabType,
      label: t.navLeagues || 'Leagues',
      icon: Layers,
      isActive: isLeaguesActive,
    },
    {
      id: 'profile' as TabType,
      label: t.navProfile || 'Profile',
      icon: User,
      isActive: currentTab === 'profile' || currentTab === 'my-club' || currentTab === 'notifications',
      badge: unreadNotificationCount > 0 ? unreadNotificationCount : 0,
    },
  ];

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden lg:block bg-[#080d16]/85 backdrop-blur-2xl border-b border-white/[0.08] sticky top-[61px] z-30 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center space-x-1.5 py-2 overflow-x-auto scrollbar-none">
            {desktopNavItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                user?.isAdmin
                  ? (item.id === 'dashboard' && isHomeActive) ||
                    (item.id === 'leagues' && isLeaguesActive) ||
                    (item.id === 'my-club' && isClubActive) ||
                    currentTab === item.id
                  : currentTab === item.id;
              const hasBadge = (item.badge || 0) > 0;

              return (
                <button
                  key={item.id}
                  id={`nav-tab-${item.id}`}
                  onClick={() => onTabChange(item.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 min-h-[38px] ${
                    isActive
                      ? user?.isAdmin
                        ? 'bg-blue-600 text-white font-black shadow-md'
                        : 'btn-glass-primary shadow-emerald-500/25 font-black scale-[1.02]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 ${
                      isActive
                        ? user?.isAdmin
                          ? 'text-white'
                          : 'text-slate-950 stroke-[2.5]'
                        : 'text-slate-400'
                    }`}
                  />
                  <span>{item.label}</span>
                  {hasBadge && (
                    <span
                      className={`flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full text-[9px] font-black leading-none ${
                        item.id === 'admin'
                          ? 'bg-amber-500 text-slate-950 animate-pulse'
                          : 'bg-rose-500 text-white'
                      }`}
                    >
                      {item.badge && item.badge > 9 ? '9+' : item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Mobile Navigation */}
      {user?.isAdmin ? (
        /* ADMIN ONLY: Liquid Glass Floating Bottom Capsule - EXACTLY 3 ICONS (NO LABELS) */
        <nav
          aria-label="Admin Broadcast Navigation"
          className="lg:hidden fixed bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(90%,340px)] select-none pointer-events-auto"
        >
          <div className="liquid-glass-nav w-full h-[62px] px-3 flex items-center justify-around">
            {adminMobileItems.map((item) => {
              const Icon = item.icon;
              const hasBadge = (item.badge || 0) > 0;

              return (
                <button
                  key={item.id}
                  id={`admin-tab-${item.id}`}
                  onClick={() => onTabChange(item.id)}
                  aria-label={item.label}
                  aria-current={item.isActive ? 'page' : undefined}
                  className={`relative flex items-center justify-center w-14 h-12 rounded-2xl transition-all duration-200 active:scale-90 ${
                    item.isActive ? 'liquid-nav-active text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {/* Subtle liquid lens highlight behind active icon */}
                  {item.isActive && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-1 rounded-xl bg-blue-500/15 dark:bg-blue-500/20 shadow-[inset_0_1px_1px_rgba(255,255,255,0.4)] pointer-events-none"
                    />
                  )}

                  <Icon
                    className={`w-6 h-6 transition-transform duration-200 ${
                      item.isActive ? 'scale-110 stroke-[2.3]' : 'stroke-[1.8]'
                    }`}
                  />

                  {/* Badge */}
                  {hasBadge && (
                    <span className="absolute top-2 right-2 min-w-[7px] h-[7px] bg-rose-500 rounded-full shadow-[0_0_6px_rgba(244,63,94,0.8)]" />
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      ) : (
        /* NORMAL PLAYER: Untouched Existing Bottom Nav */
        <nav
          aria-label="Mobile Navigation"
          className="lg:hidden fixed bottom-0 left-0 right-0 z-50 glass-nav-bottom bottom-nav-safe"
        >
          <div className="grid grid-cols-4 items-center w-full max-w-md mx-auto px-1 py-1">
            {standardMobileItems.map((item) => {
              const Icon = item.icon;
              const hasBadge = (item.badge || 0) > 0;

              return (
                <button
                  key={item.id}
                  id={`mobile-tab-${item.id}`}
                  onClick={() => onTabChange(item.id)}
                  aria-current={item.isActive ? 'page' : undefined}
                  className={`relative flex flex-col items-center justify-center py-1 px-1 rounded-lg transition-colors min-h-[46px] touch-manipulation select-none ${
                    item.isActive
                      ? 'nav-item-active text-emerald-400 font-bold'
                      : 'text-slate-400 active:text-slate-200'
                  }`}
                >
                  <div className="relative flex items-center justify-center">
                    <div
                      className={`glass-nav-icon p-1 rounded-md transition-colors duration-150 ${
                        item.isActive ? 'bg-emerald-500/20 text-emerald-300' : ''
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    {hasBadge && (
                      <span className="absolute -top-1 -right-2 min-w-[15px] h-[15px] px-1 bg-rose-500 text-white text-[8px] font-black rounded-full flex items-center justify-center shadow-lg leading-none">
                        {item.badge && item.badge > 9 ? '9+' : item.badge}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] tracking-tight mt-0.5 truncate max-w-full font-medium">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
};
