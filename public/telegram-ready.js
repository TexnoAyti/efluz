// Dismiss Telegram's native loading overlay without waiting for the React bundle.
(() => {
  try {
    const root = document.documentElement;
    if (root) root.dataset.eflBootTheme = window.localStorage?.getItem('efluz-theme-mode') === 'light' ? 'light' : 'dark';
  } catch { /* Restricted storage must never delay the first frame. */ }
  const ready = () => {
    try {
      const app = window.Telegram?.WebApp;
      if (app) { app.ready(); app.expand(); }
    } catch { /* React will retry the SDK handshake. */ }
  };
  document.getElementById('telegram-web-app-sdk')?.addEventListener('load', ready, { once: true });
  ready();
})();
