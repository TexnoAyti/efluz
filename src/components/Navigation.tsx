import React from 'react';
import {
  Home,
  createLucideIcon,
  Shield,
  Swords,
  Award,
  Globe2,
  Bell,
  User,
  SlidersHorizontal,
  CalendarDays,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { GlassSurface } from './GlassSurface';
import { ElasticNavIndicator } from './ElasticNavIndicator';

// Match the other navigation icons: 24px, currentColor and inherited stroke width.
const UclTrophyIcon = createLucideIcon('UclTrophy', [
  ['path', { d: 'M7.5 8c-3 0 0-3 0-4.5C7.5.5 3.8 1 2.6 4 1.2 7.5 3.5 14.5 7.8 16.5', key: 'left-ear' }],
  ['path', { d: 'M16.5 8c3 0 0-3 0-4.5C16.5.5 20.2 1 21.4 4c1.4 3.5-.9 10.5-5.2 12.5', key: 'right-ear' }],
  ['path', { d: 'M7 6.5h10l-.3 3c.7 3.5-1 8.5-4.7 8.5s-5.4-5-4.7-8.5L7 6.5Z', key: 'cup' }],
  ['path', { d: 'M10.5 18v2c0 1-1.5 1.2-2.5 2h8c-1-.8-2.5-1-2.5-2v-2', key: 'pedestal' }],
]);

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

  // Everyone uses the same public destinations; admin access stays role-based.
  const desktopNavItems = [
    { id: 'dashboard' as TabType, label: t.navHome || 'Home', icon: Home, badge: 0 },
    { id: 'leagues' as TabType, label: t.navLeagues || 'Leagues', icon: UclTrophyIcon, badge: 0 },
    { id: 'my-club' as TabType, label: language === 'uz' ? 'Klub' : language === 'ru' ? 'Клуб' : 'Club', icon: Shield, badge: 0 },
    ...(user?.isAdmin ? [{ id: 'admin' as TabType, label: t.navAdmin || 'Admin', icon: SlidersHorizontal, badge: openDisputesCount }] : []),
  ];

  // Public mobile destinations: Home, Competitions, Club.
  const isHomeActive = currentTab === 'dashboard';
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

  const mobileItems = [
    {
      id: 'dashboard' as TabType,
      label: t.navHome || 'Home',
      icon: Home,
      isActive: isHomeActive,
    },
    {
      id: 'leagues' as TabType,
      label: t.navLeagues || 'Leagues',
      icon: UclTrophyIcon,
      isActive: isLeaguesActive,
    },
    {
      id: 'my-club' as TabType,
      label: language === 'uz' ? 'Klub' : language === 'ru' ? 'Клуб' : 'Club',
      icon: Shield,
      isActive: isClubActive,
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
                (item.id === 'dashboard' && isHomeActive) ||
                    (item.id === 'leagues' && isLeaguesActive) ||
                    (item.id === 'my-club' && isClubActive) ||
                    currentTab === item.id;
              const hasBadge = (item.badge || 0) > 0;

              return (
                <button
                  key={item.id}
                  id={`nav-tab-${item.id}`}
                  onClick={() => onTabChange(item.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 min-h-[38px] ${
                    isActive
                      ? 'bg-blue-600 text-white font-black shadow-md'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 ${
                      isActive
                        ? 'text-white'
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
        <nav
          aria-label="Mobile Navigation"
          className="lg:hidden fixed bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(90%,340px)] select-none pointer-events-auto pb-[env(safe-area-inset-bottom,0px)]"
        >
          <GlassSurface
            width="100%"
            height={62}
            borderRadius={31}
            displace={3}
            distortionScale={-35}
            redOffset={0}
            greenOffset={1}
            blueOffset={2}
            brightness={60}
            opacity={0.82}
            mixBlendMode="normal"
            className="efl-bottom-glass w-full"
          >
            <ElasticNavIndicator
              items={mobileItems}
              activeTabId={currentTab}
              onTabChange={onTabChange}
            />
          </GlassSurface>
        </nav>
    </>
  );
};
