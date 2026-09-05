import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { UserProfileProvider } from './context/UserProfileContext';
import { I18nProvider, useI18n } from './i18n';
import { Header } from './components/Header';
import { Navigation, TabType } from './components/Navigation';
import { DashboardView } from './components/DashboardView';
import { MyClubView } from './components/MyClubView';
import { MyMatchesView } from './components/MyMatchesView';
import { ClubsView } from './components/ClubsView';
import { CupBracketsView } from './components/CupBracketsView';
import { ChampionsLeagueView } from './components/ChampionsLeagueView';
import { StandingsView } from './components/StandingsView';
import { NotificationsView } from './components/NotificationsView';
import { ProfileView } from './components/ProfileView';
import { AdminView } from './components/AdminView';
import { NotificationModal } from './components/NotificationModal';
import { TelegramDiagnosticsModal } from './components/TelegramDiagnosticsModal';
import { APP_BUILD_ID } from './context/AuthContext';
import { Fixture } from './types';
import { api } from './lib/api';
import { Loader2, CheckCircle2, AlertCircle, Info } from 'lucide-react';

function getInitialTab(): TabType {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname.replace(/^\/+/, '').split('/')[0] || window.location.hash.replace(/^#\/?/, '');
    const validTabs: TabType[] = [
      'dashboard',
      'home',
      'my-club',
      'my-matches',
      'leagues',
      'cups',
      'champions-league',
      'standings',
      'notifications',
      'profile',
      'admin',
    ];
    if (path === 'home') return 'dashboard';
    if (validTabs.includes(path as TabType)) {
      return path as TabType;
    }
  }
  return 'dashboard';
}

const AppContent: React.FC = () => {
  const { isLoading, user, toastMessage } = useAuth();
  const { t } = useI18n();
  const [activeTab, setActiveTabState] = useState<TabType>(getInitialTab);
  const [selectedFixture, setSelectedFixture] = useState<Fixture | null>(null);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [openDisputesCount, setOpenDisputesCount] = useState(0);

  const setActiveTab = (tab: TabType) => {
    const resolvedTab = tab === 'home' ? 'dashboard' : tab;
    setActiveTabState(resolvedTab);
    if (typeof window !== 'undefined') {
      const url = resolvedTab === 'dashboard' ? '/' : `/${resolvedTab}`;
      if (window.location.pathname !== url) {
        window.history.pushState({ tab: resolvedTab }, '', url);
      }
    }
  };

  // Sync tab with browser back/forward buttons
  useEffect(() => {
    const handlePopState = () => {
      setActiveTabState(getInitialTab());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Check open disputes count for admins (active admin tab only with visibility check, no continuous polling for passive users)
  useEffect(() => {
    async function checkDisputes() {
      if (document.hidden) return;
      try {
        const res = await api.getAdminDisputes('OPEN');
        setOpenDisputesCount(res.disputes.length);
      } catch {
        // ignore if not admin
      }
    }
    if (user?.isAdmin && activeTab === 'admin') {
      checkDisputes();
      const interval = setInterval(checkDisputes, 300000); // 5 minutes interval strictly inside admin panel
      return () => clearInterval(interval);
    }
  }, [user?.isAdmin, activeTab]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
        <div className="w-16 h-16 rounded-3xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-3xl mb-4 shadow-2xl shadow-emerald-500/20 animate-pulse">
          eF
        </div>
        <div className="flex items-center gap-2 text-slate-300 text-sm font-semibold">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
          <span>{t.loading}</span>
        </div>
      </div>
    );
  }

  const currentTab = activeTab === 'home' ? 'dashboard' : activeTab;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      {/* Toast Notification Alert */}
      {toastMessage && (
        <div className="fixed top-14 right-4 z-50 animate-in slide-in-from-top-3 fade-in duration-200">
          <div
            className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-2xl text-xs font-bold border backdrop-blur-md ${
              toastMessage.type === 'success'
                ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/40 shadow-emerald-500/10'
                : toastMessage.type === 'error'
                ? 'bg-rose-950/90 text-rose-300 border-rose-500/40 shadow-rose-500/10'
                : 'bg-slate-900/95 text-slate-200 border-slate-700 shadow-slate-900/40'
            }`}
          >
            {toastMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {toastMessage.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
            {toastMessage.type === 'info' && <Info className="w-4 h-4 text-sky-400 shrink-0" />}
            <span>{toastMessage.text}</span>
          </div>
        </div>
      )}

      {/* Top Header Bar */}
      <Header
        onOpenNotifications={() => setActiveTab('notifications')}
        onOpenProfile={() => setActiveTab('profile')}
      />

      {/* Desktop & Mobile Navigation */}
      <Navigation
        activeTab={currentTab}
        onTabChange={setActiveTab}
        openDisputesCount={openDisputesCount}
      />

      {/* Main Content Area - Mobile Optimized (12-16px padding on mobile, no horizontal overflow) */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-4 md:px-6 py-4 sm:py-6 min-w-0">
        {(currentTab === 'dashboard' || currentTab === 'home') && (
          <DashboardView
            onNavigateTab={setActiveTab}
            onSelectFixtureForMatchCenter={(fix) => {
              setSelectedFixture(fix);
              setActiveTab('my-matches');
            }}
          />
        )}
        {currentTab === 'my-club' && <MyClubView onNavigateTab={setActiveTab} />}
        {currentTab === 'my-matches' && (
          <MyMatchesView initialSelectedFixture={selectedFixture} onNavigateTab={setActiveTab} />
        )}
        {currentTab === 'leagues' && <ClubsView onNavigateTab={setActiveTab} />}
        {currentTab === 'cups' && <CupBracketsView onNavigateTab={setActiveTab} />}
        {currentTab === 'champions-league' && <ChampionsLeagueView onNavigateTab={setActiveTab} />}
        {currentTab === 'standings' && <StandingsView />}
        {currentTab === 'notifications' && (
          <NotificationsView onNavigateTab={setActiveTab} />
        )}
        {currentTab === 'profile' && <ProfileView onNavigateTab={setActiveTab} />}
        {currentTab === 'admin' && <AdminView />}
      </main>

      {/* App Footer (Safe margin for bottom nav) */}
      <footer className="border-t border-slate-900 bg-slate-950/80 px-4 py-3 pb-24 lg:pb-3 text-[11px] text-slate-400">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-300">EFL UZ</span>
            <span className="text-slate-600">•</span>
            <span>Official 2026/27 European Competitions</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-emerald-400 font-semibold">{APP_BUILD_ID}</span>
          </div>
        </div>
      </footer>

      {/* Real-time Notification Modal */}
      <NotificationModal
        isOpen={isNotificationOpen}
        onClose={() => setIsNotificationOpen(false)}
      />

      {/* Telegram Diagnostics Modal - strictly admin only */}
      {user?.isAdmin && (
        <TelegramDiagnosticsModal
          isOpen={isDiagnosticsOpen}
          onClose={() => setIsDiagnosticsOpen(false)}
          currentRoute={activeTab}
        />
      )}
    </div>
  );
};

export default function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <UserProfileProvider>
          <AppContent />
        </UserProfileProvider>
      </AuthProvider>
    </I18nProvider>
  );
}
