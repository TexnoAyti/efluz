type StorageKind = 'localStorage' | 'sessionStorage';

// Telegram WebViews may deny storage access or run out of quota. Persistence
// is optional; signed authentication and in-memory state must keep working.
export function readBrowserStorage(kind: StorageKind, key: string): string | null {
  try { return typeof window === 'undefined' ? null : window[kind].getItem(key); }
  catch { return null; }
}

export function writeBrowserStorage(kind: StorageKind, key: string, value: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (value === null) window[kind].removeItem(key);
    else window[kind].setItem(key, value);
  } catch { /* Keep this tab's in-memory state when persistence is unavailable. */ }
}
