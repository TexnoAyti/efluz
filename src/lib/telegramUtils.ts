/**
 * Safely opens a user's Telegram profile/chat.
 * Adheres strictly to Telegram WebApp SDK and security rules:
 * - Sanitizes username to prevent arbitrary untrusted URLs.
 * - Uses Telegram.WebApp.openTelegramLink when available in WebApp context.
 * - Falls back to safe window.open with noopener,noreferrer.
 */
export function openTelegramChat(username?: string | null): void {
  if (!username) return;
  const clean = username.replace(/^@+/, '').trim();
  if (!clean || !/^[a-zA-Z0-9_]{3,32}$/.test(clean)) {
    console.warn('Invalid Telegram username provided for chat opening:', username);
    return;
  }

  const url = `https://t.me/${clean}`;
  const tgWebApp = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : null;

  if (tgWebApp && typeof tgWebApp.openTelegramLink === 'function') {
    try {
      tgWebApp.openTelegramLink(url);
      return;
    } catch (err) {
      console.warn('Telegram.WebApp.openTelegramLink failed, falling back to window.open:', err);
    }
  }

  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
