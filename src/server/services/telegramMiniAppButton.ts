/** Telegram opens inline web_app buttons inside its Mini App WebView. */
export function telegramMiniAppButton(text = '🏟 EFL UZ ilovasini ochish') {
  const url = process.env.TELEGRAM_WEBAPP_URL?.trim()
    || process.env.APP_URL?.trim()
    || 'https://efluz.vercel.app';
  return { text, web_app: { url } };
}
