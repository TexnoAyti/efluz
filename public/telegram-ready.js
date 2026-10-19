// Dismiss Telegram's native loading overlay without waiting for the React bundle.
(() => {
  const ready = () => {
    try {
      const app = window.Telegram?.WebApp;
      if (app) { app.ready(); app.expand(); }
    } catch { /* React will retry the SDK handshake. */ }
  };
  document.getElementById('telegram-web-app-sdk')?.addEventListener('load', ready, { once: true });
  ready();
})();
