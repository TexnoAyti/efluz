import { getDevUserId, getSessionToken, getTelegramInitData } from './api';

async function seasonRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
  const session = getSessionToken();
  const devUser = getDevUserId();
  const telegramInitData = getTelegramInitData();
  if (session) headers.set('x-session-token', session);
  if (devUser) headers.set('x-dev-user-id', devUser);
  if (telegramInitData) headers.set('x-telegram-init-data', telegramInitData);
  const response = await fetch(path, { ...init, headers, cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
  return payload as T;
}

export const seasonOpsApi = {
  overview: (seasonId: string) => seasonRequest<any>(`/api/season-ops/overview?seasonId=${encodeURIComponent(seasonId)}`),
  myOverview: (seasonId: string) => seasonRequest<any>(`/api/season-ops/me?seasonId=${encodeURIComponent(seasonId)}`),
  career: (seasonId: string) => seasonRequest<any>(`/api/season-ops/me/career?seasonId=${encodeURIComponent(seasonId)}`),
  qualification: (seasonId: string) => seasonRequest<any>(`/api/season-ops/qualification?seasonId=${encodeURIComponent(seasonId)}`),
  rolloverPreview: (seasonId: string) => seasonRequest<any>(`/api/season-ops/rollover-preview?seasonId=${encodeURIComponent(seasonId)}`),
  history: () => seasonRequest<{ seasons: Array<{ seasonId: string; archivedAt: string; trophyCount: number }> }>('/api/season-ops/history'),
  archive: (seasonId: string) => seasonRequest<any>(`/api/season-ops/history/${encodeURIComponent(seasonId)}`),
  club: (clubId: string, seasonId: string) => seasonRequest<any>(`/api/season-ops/club/${encodeURIComponent(clubId)}?seasonId=${encodeURIComponent(seasonId)}`),
  h2h: (clubA: string, clubB: string, seasonId: string) => seasonRequest<any>(`/api/season-ops/h2h?clubA=${encodeURIComponent(clubA)}&clubB=${encodeURIComponent(clubB)}&seasonId=${encodeURIComponent(seasonId)}`),
  reportNoShow: (fixtureId: string, reason: string, seasonId: string) => seasonRequest<any>('/api/season-ops/no-show', {
    method: 'POST',
    body: JSON.stringify({ fixtureId, reason, seasonId }),
  }),
  adminControl: (seasonId: string) => seasonRequest<any>(`/api/admin/season-ops/control?seasonId=${encodeURIComponent(seasonId)}`),
  advance: (competitionId: string, seasonId: string, durationHours = 30) => seasonRequest<any>(`/api/admin/season-ops/competitions/${encodeURIComponent(competitionId)}/advance`, {
    method: 'POST', body: JSON.stringify({ seasonId, durationHours }),
  }),
  openNow: (competitionId: string, seasonId: string, matchday?: number, durationHours = 30) => seasonRequest<any>(`/api/admin/season-ops/competitions/${encodeURIComponent(competitionId)}/open-now`, {
    method: 'POST', body: JSON.stringify({ seasonId, matchday, durationHours }),
  }),
  resolveNoShow: (reportId: string, action: 'WALKOVER_HOME' | 'WALKOVER_AWAY' | 'POSTPONE' | 'REJECT', notes?: string) => seasonRequest<any>(`/api/admin/season-ops/no-show/${encodeURIComponent(reportId)}/resolve`, {
    method: 'POST', body: JSON.stringify({ action, notes }),
  }),
  createNextSeasonShell: (seasonId: string) => seasonRequest<any>('/api/admin/season-ops/rollover', {
    method: 'POST', body: JSON.stringify({ seasonId, confirmation: 'CREATE_NEXT_SEASON_SHELL' }),
  }),
  archiveCompletedSeason: (seasonId: string) => seasonRequest<any>('/api/admin/season-ops/archive', {
    method: 'POST', body: JSON.stringify({ seasonId, confirmation: 'ARCHIVE_COMPLETED_SEASON' }),
  }),
};
