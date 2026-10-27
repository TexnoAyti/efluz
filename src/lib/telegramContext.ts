import { getTelegramInitData } from './api';

// Helper to poll for Telegram WebApp readiness in mobile/desktop webviews
export async function resolveTelegramContext(maxWaitMs = 1200): Promise<{
  tg: any | null;
  initData: string;
  unsafeUser: any | null;
  platform: string;
  version: string;
  sdkLoaded: boolean;
}> {
  const startTime = Date.now();
  let sdkLoaded = typeof window !== 'undefined' && Boolean((window as any).Telegram);
  let tg = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp || null : null;
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
      tg = (window as any).Telegram?.WebApp || null;
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

