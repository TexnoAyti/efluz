import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, Club, Season, Notification } from '../types';
import { api, getDevUserId, setDevUserId, getTelegramInitData, setTelegramInitData } from '../lib/api';

export type AuthBootstrapStatus = 'AUTH_LOADING' | 'AUTHENTICATED' | 'AUTH_ANONYMOUS' | 'AUTH_ERROR';

export const APP_BUILD_ID = 'v2026.27-prod-r4';

export interface TelegramDiagnosticsInfo {
  sdkLoaded: boolean;
  webAppAvailable: boolean;
  platform: string;
  version: string;
  initDataPresent: boolean;
  initDataUnsafeUser: any | null;
  authStatus: AuthBootstrapStatus;
  authHttpStatus: number | null;
  authError: string | null;
  telegramId: string | null;
  username: string | null;
  isAdmin: boolean;
  currentOrigin: string;
  buildId: string;
  isExpanded: boolean;
}

interface AuthContextType {
  user: User | null;
  currentClub: Club | null;
  currentSeason: Season | null;
  seasons: Season[];
  activeSeasonId: string;
  setActiveSeasonId: (seasonId: string) => void;
  isLoading: boolean;
  authStatus: AuthBootstrapStatus;
  authError: string | null;
  telegramDiagnostics: TelegramDiagnosticsInfo;
  isDevMode: boolean;
  devProfiles: Array<{ id: string; username: string; firstName: string; isAdmin: boolean }>;
  switchDevUser: (devUserId: string) => Promise<void>;
  refreshUserData: () => Promise<void>;
  notifications: Notification[];
  unreadNotificationCount: number;
  isNotificationsLoading: boolean;
  notificationsError: string | null;
  markNotificationsAsRead: (notificationId?: string) => Promise<void>;
  markNotificationAsRead: (notificationId: string) => Promise<void>;
  refreshNotifications: (skipCache?: boolean) => Promise<void>;
  toastMessage: { text: string; type: 'success' | 'error' | 'info' } | null;
  showToast: (text: string, type?: 'success' | 'error' | 'info') => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper to poll for Telegram WebApp readiness in mobile/desktop webviews
async function resolveTelegramContext(maxWaitMs = 1200): Promise<{
  tg: any | null;
  initData: string;
  unsafeUser: any | null;
  platform: string;
  version: string;
  sdkLoaded: boolean;
}> {
  const startTime = Date.now();
  let sdkLoaded = typeof window !== 'undefined' && Boolean((window as any).Telegram);
  let tg = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : null;
  let initData = getTelegramInitData();

  if (tg) {
    try {
      tg.ready();
      tg.expand();
    } catch {
      // ignore
    }
  }

  // If Telegram is partially loaded or might be initializing, wait briefly for handshake
  while ((!tg || !initData) && Date.now() - startTime < maxWaitMs) {
    if (typeof window !== 'undefined') {
      sdkLoaded = Boolean((window as any).Telegram);
      tg = (window as any).Telegram?.WebApp;
      if (tg) {
        try {
          tg.ready();
          tg.expand();
        } catch {
          // ignore
        }
      }
      initData = getTelegramInitData();
      if (initData) break;
    }
    await new Promise((r) => setTimeout(r, 60));
  }

  const unsafeUser = tg?.initDataUnsafe?.user || null;
  const platform = tg?.platform || (typeof window !== 'undefined' ? 'web-browser' : 'unknown');
  const version = tg?.version || '1.0';

  return {
    tg,
    initData,
    unsafeUser,
    platform,
    version,
    sdkLoaded,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [currentClub, setCurrentClub] = useState<Club | null>(null);
  const [clubUnavailable, setClubUnavailable] = useState(false);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [activeSeasonId, setActiveSeasonId] = useState<string>('season-2026-27');
  const [currentSeason, setCurrentSeason] = useState<Season | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authStatus, setAuthStatus] = useState<AuthBootstrapStatus>('AUTH_LOADING');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isDevMode, setIsDevMode] = useState<boolean>(false);
  const [devProfiles, setDevProfiles] = useState<Array<{ id: string; username: string; firstName: string; isAdmin: boolean }>>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isNotificationsLoading, setIsNotificationsLoading] = useState<boolean>(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const [telegramDiagnostics, setTelegramDiagnostics] = useState<TelegramDiagnosticsInfo>({
    sdkLoaded: false,
    webAppAvailable: false,
    platform: 'detecting...',
    version: '',
    initDataPresent: false,
    initDataUnsafeUser: null,
    authStatus: 'AUTH_LOADING',
    authHttpStatus: null,
    authError: null,
    telegramId: null,
    username: null,
    isAdmin: false,
    currentOrigin: typeof window !== 'undefined' ? window.location.origin : '',
    buildId: APP_BUILD_ID,
    isExpanded: false,
  });

  const showToast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage((curr) => (curr?.text === text ? null : curr));
    }, 4500);
  }, []);

  const refreshNotifications = useCallback(async (skipCache = false) => {
    setIsNotificationsLoading(true);
    setNotificationsError(null);
    try {
      const notifRes = await api.getMyNotifications(skipCache);
      setNotifications(notifRes.notifications || []);
    } catch (err: any) {
      console.warn('Failed to load notifications:', err.message);
      setNotificationsError(err.message || 'Failed to load notifications');
    } finally {
      setIsNotificationsLoading(false);
    }
  }, []);

  const fetchUserData = useCallback(async (seasonId: string) => {
    try {
      const meRes = await api.getMe(seasonId);
      setUser(meRes.user);
      setClubUnavailable(meRes.currentClubStatus === 'unavailable');
      if (meRes.currentClubStatus !== 'unavailable') setCurrentClub(meRes.currentClub);

      setTelegramDiagnostics((prev) => ({
        ...prev,
        authHttpStatus: 200,
        telegramId: meRes.user?.telegramId || prev.telegramId,
        username: meRes.user?.username || prev.username,
        isAdmin: Boolean(meRes.user?.isAdmin),
      }));

      // fetch notifications
      await refreshNotifications(false);
    } catch (err: any) {
      console.warn('Failed to load user info:', err.message);
    }
  }, [refreshNotifications]);

  // Initialize App & Telegram SDK with deterministic state transitions
  useEffect(() => {
    let isMounted = true;

    async function init() {
      setIsLoading(true);
      setAuthStatus('AUTH_LOADING');
      setAuthError(null);

      // 1. Resolve Telegram Context
      const tgCtx = await resolveTelegramContext(1200);

      const isTgSdkPresent = tgCtx.sdkLoaded;
      const isTgWebAppPresent = Boolean(tgCtx.tg);
      const isTgInitDataPresent = Boolean(tgCtx.initData && tgCtx.initData.length > 0);

      if (isMounted) {
        setTelegramDiagnostics((prev) => ({
          ...prev,
          sdkLoaded: isTgSdkPresent,
          webAppAvailable: isTgWebAppPresent,
          platform: tgCtx.platform,
          version: tgCtx.version,
          initDataPresent: isTgInitDataPresent,
          initDataUnsafeUser: tgCtx.unsafeUser,
          isExpanded: Boolean(tgCtx.tg?.isExpanded),
        }));
      }

      try {
        // 2. Load seasons metadata
        let targetSeasonId = 'season-2026-27';
        try {
          const seasonsRes = await api.getSeasons();
          if (isMounted) {
            setSeasons(seasonsRes.seasons);
            if (seasonsRes.seasons.length > 0) {
              const defaultSeason = seasonsRes.seasons.find((s) => s.status === 'registration' || s.status === 'active') || seasonsRes.seasons[0];
              targetSeasonId = defaultSeason.id;
              setActiveSeasonId(targetSeasonId);
              setCurrentSeason(defaultSeason);
            }
          }
        } catch (sErr) {
          console.error('Failed to load seasons:', sErr);
        }

        // 3. Check if development sandbox profiles are enabled on backend
        let devAvailable = false;
        try {
          const profRes = await api.getDevProfiles();
          if (profRes.profiles && profRes.profiles.length > 0) {
            if (isMounted) {
              setDevProfiles(profRes.profiles);
              setIsDevMode(true);
            }
            devAvailable = true;
          }
        } catch {
          if (isMounted) {
            setIsDevMode(false);
          }
          devAvailable = false;
        }

        // 4. Primary: Telegram WebApp Authentication
        if (isTgInitDataPresent && tgCtx.initData) {
          setTelegramInitData(tgCtx.initData);
          try {
            const authRes = await api.authenticateTelegram(tgCtx.initData);
            if (isMounted) {
              setUser(authRes.user);
              setClubUnavailable(authRes.currentClubStatus === 'unavailable');
      setCurrentClub(authRes.currentClub);
              setAuthStatus('AUTHENTICATED');
              setTelegramDiagnostics((prev) => ({
                ...prev,
                authStatus: 'AUTHENTICATED',
                authHttpStatus: 200,
                telegramId: authRes.user.telegramId,
                username: authRes.user.username,
                isAdmin: authRes.user.isAdmin,
              }));
              await fetchUserData(targetSeasonId);
            }
          } catch (tErr: any) {
            console.error('Telegram authentication failed:', tErr);
            if (isMounted) {
              const status = tErr.httpStatus || 401;
              setAuthError(tErr.message || 'Telegram authentication failed');
              setTelegramDiagnostics((prev) => ({
                ...prev,
                authStatus: 'AUTH_ERROR',
                authHttpStatus: status,
                authError: tErr.message || 'Telegram authentication failed',
              }));

              if (devAvailable) {
                // Fallback to dev profile only if server explicitly allows dev auth
                const devId = getDevUserId() || 'user-dev-a';
                const authRes = await api.authenticateDev(devId);
                setUser(authRes.user);
                setClubUnavailable(authRes.currentClubStatus === 'unavailable');
      setCurrentClub(authRes.currentClub);
                setAuthStatus('AUTHENTICATED');
                await fetchUserData(targetSeasonId);
              } else {
                setAuthStatus('AUTH_ERROR');
              }
            }
          }
        } else if (devAvailable) {
          // 5. Development sandbox mode (when opened outside Telegram during local dev)
          const devId = getDevUserId() || 'user-dev-a';
          setDevUserId(devId);
          const authRes = await api.authenticateDev(devId);
          if (isMounted) {
            setUser(authRes.user);
            setClubUnavailable(authRes.currentClubStatus === 'unavailable');
      setCurrentClub(authRes.currentClub);
            setAuthStatus('AUTHENTICATED');
            setTelegramDiagnostics((prev) => ({
              ...prev,
              authStatus: 'AUTHENTICATED',
              authHttpStatus: 200,
              telegramId: authRes.user.telegramId,
              username: authRes.user.username,
              isAdmin: authRes.user.isAdmin,
            }));
            await fetchUserData(targetSeasonId);
          }
        } else {
          // 6. Production web session outside Telegram
          try {
            const meRes = await api.getMe(targetSeasonId);
            if (isMounted) {
              setUser(meRes.user);
              setClubUnavailable(meRes.currentClubStatus === 'unavailable');
      if (meRes.currentClubStatus !== 'unavailable') setCurrentClub(meRes.currentClub);
              setAuthStatus('AUTHENTICATED');
              setTelegramDiagnostics((prev) => ({
                ...prev,
                authStatus: 'AUTHENTICATED',
                authHttpStatus: 200,
                telegramId: meRes.user?.telegramId || null,
                username: meRes.user?.username || null,
                isAdmin: Boolean(meRes.user?.isAdmin),
              }));
              await fetchUserData(targetSeasonId);
            }
          } catch {
            if (isMounted) {
              setUser(null);
              setCurrentClub(null);
              setAuthStatus('AUTH_ANONYMOUS');
              setTelegramDiagnostics((prev) => ({
                ...prev,
                authStatus: 'AUTH_ANONYMOUS',
                authHttpStatus: 401,
              }));
            }
          }
        }
      } catch (err: any) {
        console.error('Initialization error:', err);
        if (isMounted) {
          setAuthStatus('AUTH_ERROR');
          setAuthError(err.message || 'Initialization failed');
          setTelegramDiagnostics((prev) => ({
            ...prev,
            authStatus: 'AUTH_ERROR',
            authError: err.message,
          }));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    init();

    return () => {
      isMounted = false;
    };
  }, [fetchUserData]);

  const switchDevUser = async (devUserId: string) => {
    setIsLoading(true);
    setDevUserId(devUserId);
    try {
      const authRes = await api.authenticateDev(devUserId);
      setUser(authRes.user);
      setClubUnavailable(authRes.currentClubStatus === 'unavailable');
      setCurrentClub(authRes.currentClub);
      setTelegramDiagnostics((prev) => ({
        ...prev,
        telegramId: authRes.user.telegramId,
        username: authRes.user.username,
        isAdmin: authRes.user.isAdmin,
      }));
      await fetchUserData(activeSeasonId);
      showToast(`Switched active profile to @${authRes.user.username}`, 'info');
    } catch (err: any) {
      showToast(`Failed to switch user: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const refreshUserData = async () => {
    await fetchUserData(activeSeasonId);
  };

  const markNotificationAsRead = async (notificationId: string) => {
    // Optimistic UI update: immediately mark specific notification as read
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, isRead: true } : n))
    );
    try {
      await api.markNotificationsRead(notificationId);
    } catch (err: any) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  const markNotificationsAsRead = async (notificationId?: string) => {
    if (notificationId) {
      await markNotificationAsRead(notificationId);
      return;
    }
    // Optimistic UI update: mark all as read
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      await api.markNotificationsRead();
    } catch (err: any) {
      console.error('Failed to mark notifications read:', err);
    }
  };

  const unreadNotificationCount = notifications.filter((n) => !n.isRead).length;

  return (
    <AuthContext.Provider
      value={{
        user,
        currentClub,
        currentSeason,
        seasons,
        activeSeasonId,
        setActiveSeasonId,
        isLoading,
        authStatus,
        authError,
        telegramDiagnostics,
        isDevMode,
        devProfiles,
        switchDevUser,
        refreshUserData,
        notifications,
        unreadNotificationCount,
        isNotificationsLoading,
        notificationsError,
        markNotificationsAsRead,
        markNotificationAsRead,
        refreshNotifications,
        toastMessage,
        showToast,
      }}
    >
      {clubUnavailable && user && (
        <div role="status" className="bg-amber-950 text-amber-100 px-4 py-2 text-sm">
          Akkauntga kirildi. Klub ma’lumotlari vaqtincha yuklanmadi; bu klubingiz bo‘shatilganini anglatmaydi.
        </div>
      )}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
