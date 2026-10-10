import React, { lazy, useState, useEffect, useMemo } from 'react';
import { WelcomeScreen } from './components/WelcomeScreen';
import { AuthProvider, useAuth } from './context/AuthContext';
import { UserProfileProvider } from './context/UserProfileContext';
import { I18nProvider, useI18n } from './i18n';
import { AppTheme, Header } from './components/Header';
import { Navigation, TabType } from './components/Navigation';
import { MatchdayHomeView } from './components/MatchdayHomeView';
import { ContentBoundary } from './components/ContentBoundary';
import { APP_BUILD_ID } from './context/AuthContext';
import { Fixture, AdminPermissions } from './types';
import { api } from './lib/api';
import { isDesignPreview } from './designPreview';
import { EFL_2_DESIGN_ENABLED, WELCOME_STORAGE_VERSION } from './releaseDesign';
import { Loader2, CheckCircle2, AlertCircle, Info } from 'lucide-react';

const NotificationsView = lazy(() => import('./components/NotificationsView').then(module => ({ default: module.NotificationsView })));
const AdminView = lazy(() => import('./components/AdminView').then(module => ({ default: module.AdminView })));
const AdminMatchOperationsV4Panel = lazy(() => import('./components/admin/AdminMatchOperationsV4Panel').then(module => ({ default: module.AdminMatchOperationsV4Panel })));
const NotificationModal = lazy(() => import('./components/NotificationModal').then(module => ({ default: module.NotificationModal })));
const TelegramDiagnosticsModal = lazy(() => import('./components/TelegramDiagnosticsModal').then(module => ({ default: module.TelegramDiagnosticsModal })));
const OfflineSyncBanner = lazy(() => import('./components/OfflineSyncBanner').then(module => ({ default: module.OfflineSyncBanner })));
const CompetitionHubView = lazy(() => import('./components/CompetitionHubView').then(module => ({ default: module.CompetitionHubView })));
const ClubHubView = lazy(() => import('./components/ClubHubView').then(module => ({ default: module.ClubHubView })));
const MatchOperationsV4Panel = lazy(() => import('./components/MatchOperationsV4Panel').then(module => ({ default: module.MatchOperationsV4Panel })));
const SeasonLifecyclePanel = lazy(() => import('./components/SeasonLifecyclePanel').then(module => ({ default: module.SeasonLifecyclePanel })));
const GlobalSearchModal = lazy(() => import('./components/GlobalSearchModal').then(module => ({ default: module.GlobalSearchModal })));

function getInitialTab(): TabType {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname.replace(/^\/+/, '').split('/')[0] || window.location.hash.replace(/^#\/?/, '');
    const validTabs: TabType[] = ['dashboard','home','my-club','my-matches','leagues','cups','champions-league','standings','season-hub','notifications','profile','admin'];
    if (path === 'home') return 'dashboard';
    if (validTabs.includes(path as TabType)) return path as TabType;
  }
  return 'dashboard';
}

const AppContent: React.FC = () => {
  const { isLoading, user, toastMessage, authStatus, authError, activeSeasonId, currentClub } = useAuth();
  const { t } = useI18n();
  const [activeTab, setActiveTabState] = useState<TabType>(getInitialTab);
  const [selectedFixture, setSelectedFixture] = useState<Fixture | null>(null);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchNavigationRevision, setSearchNavigationRevision] = useState(0);
  const [openDisputesCount, setOpenDisputesCount] = useState(0);
  const [adminAccess, setAdminAccess] = useState<{ userId: string; permissions: AdminPermissions } | null>(null);
  const canUseGlobalAdminTools = Boolean(user?.isAdmin && adminAccess?.userId === user.id && adminAccess.permissions.scope === 'ALL');
  useEffect(() => {
    let cancelled = false;
    setAdminAccess(null);
    if (user?.isAdmin && !isDesignPreview) {
      api.getAdminAccess().then(result => {
        if (!cancelled) setAdminAccess({ userId: user.id, permissions: result.adminPermissions });
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [user?.id, user?.isAdmin, user?.adminPermissions?.scope, activeTab]);

  const [welcomeCompletedFor, setWelcomeCompletedFor] = useState<string | null>(null);
  const welcomeCompleted = useMemo(() => {
    if (!user) return false;
    if (welcomeCompletedFor === user.id) return true;
    // Force only the existing, build-gated visual preview; never bypass Telegram auth.
    if (isDesignPreview && new URLSearchParams(window.location.search).get('welcome') === '1') return false;
    try { return window.localStorage.getItem(`efluz-welcome-${WELCOME_STORAGE_VERSION}:${user.id}`) === 'done'; }
    catch { return false; }
  }, [user?.id, welcomeCompletedFor]);

  const completeWelcome = () => {
    if (!user) return;
    try { window.localStorage.setItem(`efluz-welcome-${WELCOME_STORAGE_VERSION}:${user.id}`, 'done'); } catch {}
    setWelcomeCompletedFor(user.id);
  };

  // EFL UZ Broadcast Redesign: Light and Dark mode only
  const [theme, setTheme] = useState<AppTheme>(() => {
    if (typeof window === 'undefined') return 'dark';
    const saved = window.localStorage.getItem('efluz-theme-mode') as AppTheme | null;
    return saved === 'light' || saved === 'dark' ? saved : 'dark';
  });

  const changeTheme = (nextTheme: AppTheme) => {
    setTheme(nextTheme);
    window.localStorage.setItem('efluz-theme-mode', nextTheme);
  };

  const setActiveTab = (tab: TabType) => {
    const resolvedTab = tab === 'home' ? 'dashboard' : tab;
    setActiveTabState(resolvedTab);
    if (typeof window !== 'undefined') {
      const url = resolvedTab === 'dashboard' ? '/' : `/${resolvedTab}`;
      const nextUrl = isDesignPreview ? `${url}?designPreview=1` : url;
      if (window.location.pathname !== url) window.history.pushState({ tab: resolvedTab }, '', nextUrl);
    }
  };

  useEffect(() => {
    const handlePopState = () => setActiveTabState(getInitialTab());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [activeTab]);

  useEffect(() => {
    if (!user) return;
    const previousBackground = document.body.style.backgroundColor;
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousThemeColor = themeColor?.content;
    const background = theme === 'dark' ? '#070b14' : '#f8fafc';
    document.body.style.backgroundColor = background;
    if (themeColor) themeColor.content = background;
    return () => {
      document.body.style.backgroundColor = previousBackground;
      if (themeColor && previousThemeColor !== undefined) themeColor.content = previousThemeColor;
    };
  }, [user?.id, theme]);

  useEffect(() => {
    async function checkDisputes() {
      if (document.hidden) return;
      try { const res = await api.getAdminDisputes('OPEN'); setOpenDisputesCount(res.disputes.length); } catch {}
    }
    if (canUseGlobalAdminTools && !isDesignPreview && activeTab === 'admin') {
      checkDisputes();
      const interval = setInterval(checkDisputes, 300000);
      return () => clearInterval(interval);
    }
  }, [canUseGlobalAdminTools, activeTab]);

  if (isLoading) return <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white"><div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-3xl mb-4 shadow-2xl shadow-emerald-500/20 animate-pulse">eF</div><div className="flex items-center gap-2 text-slate-300 text-sm font-semibold"><Loader2 className="w-4 h-4 animate-spin text-emerald-400" /><span>{t.loading}</span></div></div>;

  if (authStatus === 'AUTH_ANONYMOUS' || authStatus === 'AUTH_ERROR') return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-5"><div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/80 p-7 text-center shadow-2xl"><div className="mx-auto mb-5 h-16 w-16 rounded-2xl bg-emerald-400 text-slate-950 flex items-center justify-center text-2xl font-black">eF</div><h1 className="text-2xl font-black mb-2">EFL UZ</h1><p className="text-slate-300 text-sm leading-6">{authStatus === 'AUTH_ERROR' ? 'Telegram orqali kirish tasdiqlanmadi. Mini Appni Telegram ichidan qayta oching.' : 'Bu turnir platformasi Telegram Mini App orqali ishlaydi. Davom etish uchun uni Telegram ichidan oching.'}</p>{authError && <p className="mt-3 text-xs text-rose-300">{authError}</p>}<a href="https://t.me/efleagueuz" target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-black text-slate-950 hover:bg-emerald-300">Telegram kanaliga o‘tish</a></div></div>;

  if (user && !welcomeCompleted) return <WelcomeScreen theme={theme} onThemeChange={changeTheme} onStart={completeWelcome} />;

  const currentTab = activeTab === 'home' ? 'dashboard' : activeTab;
  return (
    <div
      className={`min-h-screen flex flex-col font-sans selection:bg-blue-600 selection:text-white ${
        EFL_2_DESIGN_ENABLED
          ? `efl-preview theme-${theme} ${theme === 'dark' ? 'dark' : ''}`
          : 'bg-slate-950 text-slate-100'
      }`}
    >
      {isDesignPreview && <div className="sticky top-0 z-[60] bg-amber-100 px-3 py-1.5 text-center text-[11px] font-bold text-amber-950">DESIGN PREVIEW · test ko‘rinishi, hisobga kirilmagan</div>}
      {toastMessage && (
        <div className="fixed top-14 right-4 z-50 animate-in slide-in-from-top-3 fade-in duration-200">
          <div
            className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-2xl text-xs font-bold border backdrop-blur-md ${
              EFL_2_DESIGN_ENABLED
                ? toastMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300 shadow-emerald-500/10 dark:bg-emerald-950/90 dark:text-emerald-300 dark:border-emerald-500/40'
                  : toastMessage.type === 'error'
                  ? 'bg-rose-50 text-rose-800 border-rose-300 shadow-rose-500/10 dark:bg-rose-950/90 dark:text-rose-300 dark:border-rose-500/40'
                  : 'bg-blue-50 text-blue-800 border-blue-300 shadow-blue-500/10 dark:bg-blue-950/90 dark:text-blue-300 dark:border-blue-500/40'
                : toastMessage.type === 'success'
                ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/40 shadow-emerald-500/10'
                : toastMessage.type === 'error'
                ? 'bg-rose-950/90 text-rose-300 border-rose-500/40 shadow-rose-500/10'
                : 'bg-slate-900/95 text-slate-200 border-slate-700 shadow-slate-900/40'
            }`}
          >
            {toastMessage.type === 'success' && <CheckCircle2 className={`w-4 h-4 shrink-0 ${EFL_2_DESIGN_ENABLED ? 'text-emerald-600 dark:text-emerald-400' : 'text-emerald-400'}`} />}
            {toastMessage.type === 'error' && <AlertCircle className={`w-4 h-4 shrink-0 ${EFL_2_DESIGN_ENABLED ? 'text-rose-600 dark:text-rose-400' : 'text-rose-400'}`} />}
            {toastMessage.type === 'info' && <Info className={`w-4 h-4 shrink-0 ${EFL_2_DESIGN_ENABLED ? 'text-blue-600 dark:text-sky-400' : 'text-sky-400'}`} />}
            <span>{toastMessage.text}</span>
          </div>
        </div>
      )}
      <Header
        theme={theme}
        onThemeChange={changeTheme}
        onOpenNotifications={() => setActiveTab('notifications')}
        onOpenProfile={() => setActiveTab('my-club')}
        onOpenSearch={() => setIsSearchOpen(true)}
      />
      <Navigation activeTab={currentTab} onTabChange={setActiveTab} openDisputesCount={openDisputesCount} />
      {!isDesignPreview && canUseGlobalAdminTools && <ContentBoundary><OfflineSyncBanner /></ContentBoundary>}
      <main data-preview-page={EFL_2_DESIGN_ENABLED ? currentTab : undefined} className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 min-w-0">
          <ContentBoundary key={currentTab}>
            {currentTab === 'admin' && canUseGlobalAdminTools && <div className="mb-5"><AdminMatchOperationsV4Panel /></div>}

            {/* HOME: Active Club Broadcast Hub with Hero Match Card */}
            {currentTab === 'dashboard' && (
              <MatchdayHomeView
                onNavigateTab={setActiveTab}
                onSelectFixtureForMatchCenter={(fix) => {
                  setSelectedFixture(fix);
                  setActiveTab('my-club');
                }}
                onOpenSearch={() => setIsSearchOpen(true)}
              />
            )}

            {/* LEAGUES: Unified Competition Hub (Domestic Leagues, Cups, European, Season) */}
            {(currentTab === 'leagues' || currentTab === 'cups' || currentTab === 'champions-league' || currentTab === 'standings' || currentTab === 'season-hub') && (
              <CompetitionHubView
                key={searchNavigationRevision}
                onNavigateTab={setActiveTab}
                initialSubTab={
                  currentTab === 'cups'
                    ? 'cups'
                    : currentTab === 'champions-league'
                    ? 'european'
                    : currentTab === 'season-hub'
                    ? 'season'
                    : 'leagues'
                }
              />
            )}

            {/* CLUB: Replaces Profile & Matches - Active Club, Switcher, Matches, Stats, Settings */}
            {(currentTab === 'my-club' || currentTab === 'profile' || currentTab === 'my-matches') && (
              <>
              <ClubHubView
                onNavigateTab={setActiveTab}
                onSelectFixtureForMatchCenter={(fix) => setSelectedFixture(fix)}
                initialSelectedFixture={selectedFixture}
                theme={theme}
                onThemeChange={changeTheme}
              />
              {currentClub && <details className="preview-surface rounded-3xl border border-[var(--efl-border)] p-4 mb-5">
                <summary className="cursor-pointer font-bold text-sm text-[var(--efl-text)]">O‘yin bo‘yicha yordam · Muddat · H2H · Dalillar</summary>
                <div className="mt-4 space-y-4">
                  <MatchOperationsV4Panel />
                  <SeasonLifecyclePanel seasonId={activeSeasonId} />
                </div>
              </details>}
              </>
            )}

            {currentTab === 'notifications' && <NotificationsView onNavigateTab={setActiveTab} />}
            {currentTab === 'admin' && user?.isAdmin && <AdminView />}
          </ContentBoundary>
      </main>
      <footer className="border-t border-slate-900 bg-slate-950/80 px-4 py-3 pb-24 lg:pb-3 text-[11px] text-slate-400"><div className="max-w-7xl mx-auto flex items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="font-bold text-slate-300">EFL UZ</span><span className="text-slate-600">•</span><span>Official 2026/27 European Competitions</span></div><div className="flex items-center gap-3"><span className="font-mono text-emerald-400 font-semibold">{APP_BUILD_ID}</span></div></div></footer>
      {isNotificationOpen && <ContentBoundary><NotificationModal isOpen onClose={() => setIsNotificationOpen(false)} /></ContentBoundary>}
      {canUseGlobalAdminTools && isDiagnosticsOpen && <ContentBoundary><TelegramDiagnosticsModal isOpen onClose={() => setIsDiagnosticsOpen(false)} currentRoute={activeTab} /></ContentBoundary>}
      {isSearchOpen && <ContentBoundary><GlobalSearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onNavigateTab={(tab) => {
          setSearchNavigationRevision((revision) => revision + 1);
          setActiveTab(tab);
        }}
        onSelectFixture={(fix) => {
          setSelectedFixture(fix);
          setActiveTab('my-club');
        }}
      /></ContentBoundary>}
    </div>
  );
};

export default function App() { return <I18nProvider><AuthProvider><UserProfileProvider><AppContent /></UserProfileProvider></AuthProvider></I18nProvider>; }
