import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { UserProfileProvider } from './context/UserProfileContext';
import { I18nProvider, useI18n } from './i18n';
import { AppTheme, Header } from './components/Header';
import { Navigation, TabType } from './components/Navigation';
import { DashboardView } from './components/DashboardView';
import { MatchdayHomeView } from './components/MatchdayHomeView';
import { MyClubView } from './components/MyClubView';
import { MyMatchesView } from './components/MyMatchesView';
import { MatchOperationsV4Panel } from './components/MatchOperationsV4Panel';
import { ClubsView } from './components/ClubsView';
import { CupBracketsView } from './components/CupBracketsView';
import { ChampionsLeagueView } from './components/ChampionsLeagueView';
import { StandingsView } from './components/StandingsView';
import { SeasonHubView } from './components/SeasonHubView';
import { NotificationsView } from './components/NotificationsView';
import { ProfileView } from './components/ProfileView';
import { AdminView } from './components/AdminView';
import { AdminMatchOperationsV4Panel } from './components/admin/AdminMatchOperationsV4Panel';
import { NotificationModal } from './components/NotificationModal';
import { TelegramDiagnosticsModal } from './components/TelegramDiagnosticsModal';
import { OfflineSyncBanner } from './components/OfflineSyncBanner';
import { SeasonLifecyclePanel } from './components/SeasonLifecyclePanel';
import { APP_BUILD_ID } from './context/AuthContext';
import { Fixture } from './types';
import { api } from './lib/api';
import { isDesignPreview } from './designPreview';
import { Loader2, CheckCircle2, AlertCircle, Info } from 'lucide-react';

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
  const { isLoading, user, toastMessage, authStatus, authError, activeSeasonId } = useAuth();
  const { t } = useI18n();
  const [activeTab, setActiveTabState] = useState<TabType>(getInitialTab);
  const [selectedFixture, setSelectedFixture] = useState<Fixture | null>(null);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [openDisputesCount, setOpenDisputesCount] = useState(0);
  const [theme, setTheme] = useState<AppTheme>(() => {
    if (typeof window === 'undefined') return 'mint';
    const saved = window.localStorage.getItem('efluz-preview-theme-v2') as AppTheme | null;
    return saved === 'coral' || saved === 'mint' || saved === 'blue' || saved === 'dark' ? saved : 'mint';
  });

  const changeTheme = (nextTheme: AppTheme) => {
    setTheme(nextTheme);
    window.localStorage.setItem('efluz-preview-theme-v2', nextTheme);
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
    if (!user?.isAdmin) return;
    const previousBackground = document.body.style.backgroundColor;
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousThemeColor = themeColor?.content;
    const background = theme === 'dark' ? '#0d1424' : '#f5f7fa';
    document.body.style.backgroundColor = background;
    if (themeColor) themeColor.content = background;
    return () => {
      document.body.style.backgroundColor = previousBackground;
      if (themeColor && previousThemeColor !== undefined) themeColor.content = previousThemeColor;
    };
  }, [user?.isAdmin, theme]);

  useEffect(() => {
    async function checkDisputes() {
      if (document.hidden) return;
      try { const res = await api.getAdminDisputes('OPEN'); setOpenDisputesCount(res.disputes.length); } catch {}
    }
    if (user?.isAdmin && !isDesignPreview && activeTab === 'admin') {
      checkDisputes();
      const interval = setInterval(checkDisputes, 300000);
      return () => clearInterval(interval);
    }
  }, [user?.isAdmin, activeTab]);

  if (isLoading) return <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white"><div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-3xl mb-4 shadow-2xl shadow-emerald-500/20 animate-pulse">eF</div><div className="flex items-center gap-2 text-slate-300 text-sm font-semibold"><Loader2 className="w-4 h-4 animate-spin text-emerald-400" /><span>{t.loading}</span></div></div>;

  if (authStatus === 'AUTH_ANONYMOUS' || authStatus === 'AUTH_ERROR') return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-5"><div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/80 p-7 text-center shadow-2xl"><div className="mx-auto mb-5 h-16 w-16 rounded-2xl bg-emerald-400 text-slate-950 flex items-center justify-center text-2xl font-black">eF</div><h1 className="text-2xl font-black mb-2">EFL UZ</h1><p className="text-slate-300 text-sm leading-6">{authStatus === 'AUTH_ERROR' ? 'Telegram orqali kirish tasdiqlanmadi. Mini Appni Telegram ichidan qayta oching.' : 'Bu turnir platformasi Telegram Mini App orqali ishlaydi. Davom etish uchun uni Telegram ichidan oching.'}</p>{authError && <p className="mt-3 text-xs text-rose-300">{authError}</p>}<a href="https://t.me/efleagueuz" target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-emerald-400 px-5 py-3 text-sm font-black text-slate-950 hover:bg-emerald-300">Telegram kanaliga o‘tish</a></div></div>;

  const currentTab = activeTab === 'home' ? 'dashboard' : activeTab;
  return (
    <div className={`min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950 ${user?.isAdmin ? `efl-preview theme-${theme}` : ''}`}>
      {isDesignPreview && <div className="sticky top-0 z-[60] bg-amber-100 px-3 py-1.5 text-center text-[11px] font-bold text-amber-950">DESIGN PREVIEW · test ko‘rinishi, hisobga kirilmagan</div>}
      {toastMessage && <div className="fixed top-14 right-4 z-50 animate-in slide-in-from-top-3 fade-in duration-200"><div className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-2xl text-xs font-bold border backdrop-blur-md ${toastMessage.type === 'success' ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/40 shadow-emerald-500/10' : toastMessage.type === 'error' ? 'bg-rose-950/90 text-rose-300 border-rose-500/40 shadow-rose-500/10' : 'bg-slate-900/95 text-slate-200 border-slate-700 shadow-slate-900/40'}`}>{toastMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}{toastMessage.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}{toastMessage.type === 'info' && <Info className="w-4 h-4 text-sky-400 shrink-0" />}<span>{toastMessage.text}</span></div></div>}
      <Header theme={theme} onThemeChange={changeTheme} onOpenNotifications={() => setActiveTab('notifications')} onOpenProfile={() => setActiveTab('profile')} />
      <Navigation activeTab={currentTab} onTabChange={setActiveTab} openDisputesCount={openDisputesCount} />
      <OfflineSyncBanner />
      <main data-preview-page={user?.isAdmin ? currentTab : undefined} className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 min-w-0">
        {currentTab === 'my-matches' && <div className="mb-5"><SeasonLifecyclePanel seasonId={activeSeasonId} /></div>}
        {currentTab === 'my-matches' && <div className="mb-5"><MatchOperationsV4Panel /></div>}
        {currentTab === 'admin' && user?.isAdmin && <div className="mb-5"><AdminMatchOperationsV4Panel /></div>}
        {(currentTab === 'dashboard' || currentTab === 'home') && (user?.isAdmin ? <MatchdayHomeView onNavigateTab={setActiveTab} onSelectFixtureForMatchCenter={(fix) => { setSelectedFixture(fix); setActiveTab('my-matches'); }} /> : <DashboardView onNavigateTab={setActiveTab} onSelectFixtureForMatchCenter={(fix) => { setSelectedFixture(fix); setActiveTab('my-matches'); }} />)}
        {currentTab === 'my-club' && <MyClubView onNavigateTab={setActiveTab} />}
        {currentTab === 'my-matches' && <MyMatchesView initialSelectedFixture={selectedFixture} onNavigateTab={setActiveTab} />}
        {currentTab === 'season-hub' && <SeasonHubView onNavigateTab={setActiveTab} />}
        {currentTab === 'leagues' && <ClubsView onNavigateTab={setActiveTab} />}
        {currentTab === 'cups' && <CupBracketsView onNavigateTab={setActiveTab} />}
        {currentTab === 'champions-league' && <ChampionsLeagueView onNavigateTab={setActiveTab} />}
        {currentTab === 'standings' && <StandingsView />}
        {currentTab === 'notifications' && <NotificationsView onNavigateTab={setActiveTab} />}
        {currentTab === 'profile' && <ProfileView onNavigateTab={setActiveTab} />}
        {currentTab === 'admin' && <AdminView />}
      </main>
      <footer className="border-t border-slate-900 bg-slate-950/80 px-4 py-3 pb-24 lg:pb-3 text-[11px] text-slate-400"><div className="max-w-7xl mx-auto flex items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="font-bold text-slate-300">EFL UZ</span><span className="text-slate-600">•</span><span>Official 2026/27 European Competitions</span></div><div className="flex items-center gap-3"><span className="font-mono text-emerald-400 font-semibold">{APP_BUILD_ID}</span></div></div></footer>
      <NotificationModal isOpen={isNotificationOpen} onClose={() => setIsNotificationOpen(false)} />
      {user?.isAdmin && <TelegramDiagnosticsModal isOpen={isDiagnosticsOpen} onClose={() => setIsDiagnosticsOpen(false)} currentRoute={activeTab} />}
    </div>
  );
};

export default function App() { return <I18nProvider><AuthProvider><UserProfileProvider><AppContent /></UserProfileProvider></AuthProvider></I18nProvider>; }
