export interface TournamentLaunch { tournamentId: string; token?: string }
const validId = /^ct_[A-Za-z0-9_-]{1,100}$/;
const validToken = /^[A-Za-z0-9_-]{1,160}$/;

export function tournamentStartParam(tournamentId: string, token?: string): string {
  if (!validId.test(tournamentId) || (token && !validToken.test(token))) throw new Error('INVALID_TOURNAMENT_LINK');
  return `ct1_${btoa(JSON.stringify([tournamentId, token || ''])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
export function parseTournamentStartParam(value?: string | null): TournamentLaunch | null {
  if (!value?.startsWith('ct1_') || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const [tournamentId, token, ...extra] = JSON.parse(atob(value.slice(4).replace(/-/g, '+').replace(/_/g, '/')));
    return !extra.length && typeof tournamentId === 'string' && validId.test(tournamentId) && typeof token === 'string' && (!token || validToken.test(token)) ? { tournamentId, token: token || undefined } : null;
  } catch { return null; }
}
export function tournamentTelegramLink(tournamentId: string, token?: string): string {
  return `https://t.me/efluzbot?startapp=${tournamentStartParam(tournamentId, token)}`;
}
/** A launch target is navigation input only; server authentication/access still apply. */
export function readTournamentLaunch(): TournamentLaunch | null {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  const webapp = (window as any).Telegram?.WebApp;
  let storedData = '';
  try { storedData = sessionStorage.getItem('efootball_tg_init_data') || ''; } catch {}
  const signedData = webapp?.initData || storedData;
  return parseTournamentStartParam(webapp?.initDataUnsafe?.start_param || new URLSearchParams(signedData).get('start_param') || query.get('tgWebAppStartParam') || query.get('startapp'));
}
