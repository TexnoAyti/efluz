import { getDevUserId, getSessionToken, getTelegramInitData } from './api';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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

export const matchOpsApi = {
  my: (seasonId: string) => request<any>(`/api/me/match-ops?seasonId=${encodeURIComponent(seasonId)}`),
  reportNoShow: (fixtureId: string, reason: string, evidenceUrl: string | null, seasonId: string) => request<any>('/api/me/match-ops/no-show', {
    method: 'POST',
    body: JSON.stringify({ fixtureId, reason, evidenceUrl: evidenceUrl || undefined, seasonId }),
  }),
  adminControl: (seasonId: string) => request<any>(`/api/admin/match-ops/control?seasonId=${encodeURIComponent(seasonId)}`),
  setDeadline: (fixtureId: string, deadlineAt: string, notes?: string) => request<any>(`/api/admin/fixtures/${encodeURIComponent(fixtureId)}/deadline`, {
    method: 'POST',
    body: JSON.stringify({ deadlineAt, notes }),
  }),
  runDeadlineSweep: (seasonId: string) => request<any>('/api/admin/match-ops/deadline-sweep', {
    method: 'POST',
    body: JSON.stringify({ seasonId }),
  }),
  resolveNoShow: (reportId: string, action: 'WALKOVER_HOME' | 'WALKOVER_AWAY' | 'POSTPONE' | 'REJECT', notes?: string, deadlineAt?: string | null) => request<any>(`/api/admin/match-ops/no-show/${encodeURIComponent(reportId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ action, notes, deadlineAt: deadlineAt || undefined }),
  }),
  resolveDispute: (disputeId: string, action: 'CONFIRM_HOME_SUBMISSION' | 'CONFIRM_AWAY_SUBMISSION' | 'MANUAL_SCORE' | 'CANCEL_MATCH', params: { manualHomeScore?: number; manualAwayScore?: number; notes?: string } = {}) => request<any>(`/api/admin/match-ops/disputes/${encodeURIComponent(disputeId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ action, ...params }),
  }),
  remindFixture: (fixtureId: string, seasonId: string) => request<any>(`/api/admin/fixtures/${encodeURIComponent(fixtureId)}/remind`, {
    method: 'POST',
    body: JSON.stringify({ seasonId }),
  }),
};
