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

// Contours traced from the UCL trophy cutout, including both handle openings.
const UclTrophyIcon = createLucideIcon('UclTrophy', [
  ['path', { d: 'M14.36 4.08L14.15 3.60L14.10 2.87L14.47 2.08L15.25 1.66L16.20 1.71L16.93 2.08L17.67 2.92L18.09 3.87L18.35 5.29L18.35 6.44L18.14 8.01L17.30 11.11L15.41 15.37L15.25 15.47L14.68 16.57L14.52 16.57L13.79 17.94L13.79 18.36L13.57 18.46L13.42 18.78L13.47 19.41L13.68 19.72L14.36 20.19L14.89 20.30L15.46 20.61L15.68 20.88L15.73 21.30L15.46 21.61L15.04 21.82L13.05 22.19L10.43 22.14L9.53 21.98L8.64 21.66L8.32 21.30L8.43 20.82L9.06 20.35L9.95 20.04L10.48 19.56L10.63 19.09L10.48 18.51L10.27 18.36L10.21 17.88L9.64 16.83L9.16 16.31L8.27 14.68L7.22 12.37L6.49 10.38L6.02 8.59L5.70 6.49L5.70 5.29L5.91 4.08L6.23 3.24L6.59 2.66L7.33 1.98L8.12 1.66L8.96 1.71L9.38 1.92L9.85 2.55L9.95 3.39L9.48 4.39L8.85 4.92L8.32 5.13L8.06 5.44L8.01 5.71L8.12 6.02L8.54 6.33L8.64 6.54L8.75 6.18L8.43 5.91L8.43 5.55L8.54 5.49L11.00 5.44L15.41 5.49L15.57 5.55L15.62 5.81L15.57 5.97L15.31 6.12L15.36 6.54L15.99 5.91L15.99 5.44L15.73 5.13L15.10 4.87L14.78 4.60Z', strokeWidth: '0.7', key: 'contour-0' }],
  ['path', { d: 'M17.36 9.33L17.72 8.01L17.93 6.54L17.93 5.44L17.72 4.18L17.30 3.13L17.04 2.76L16.46 2.29L16.04 2.13L15.25 2.13L14.62 2.55L14.47 3.18L14.73 3.92L15.04 4.23L15.78 4.60L16.15 4.97L16.36 5.39L16.36 5.81L16.15 6.28L15.68 6.65L15.52 6.96L15.62 7.38L16.52 8.17L16.41 10.59L15.73 13.84L16.73 11.53Z', strokeWidth: '0.7', key: 'contour-1' }],
  ['path', { d: 'M6.75 9.59L7.22 11.27L8.22 13.63L7.54 10.12L7.49 8.17L8.27 7.54L8.54 7.17L8.54 6.91L7.80 6.12L7.70 5.91L7.75 5.34L7.96 4.92L8.22 4.65L9.01 4.23L9.48 3.60L9.53 2.82L9.16 2.29L8.80 2.13L8.06 2.13L7.38 2.45L6.80 3.08L6.28 4.39L6.12 5.44L6.17 7.07Z', strokeWidth: '0.7', key: 'contour-2' }],
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
