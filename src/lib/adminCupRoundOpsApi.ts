import { getDevUserId, getSessionToken, getTelegramInitData } from './api';

async function request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> || {}),
  };
  const sessionToken = getSessionToken();
  const telegramInitData = getTelegramInitData();
  const devUserId = getDevUserId();
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  else if (telegramInitData) headers['x-telegram-init-data'] = telegramInitData;
  else if (devUserId) headers['x-dev-user-id'] = devUserId;

  const response = await fetch(endpoint, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
  return payload as T;
}

export interface CupBracketHealth {
  competitionId: string;
  healthy: boolean;
  fixtures: number;
  confirmed: number;
  currentRound: number;
  issues: Array<{
    code: string;
    severity: 'warning' | 'error';
    fixtureId: string;
    slot?: 'home' | 'away';
    message: string;
  }>;
  rounds: Array<{
    roundNumber: number;
    roundName: string;
    matches: number;
    confirmed: number;
    readyToAdvance: boolean;
  }>;
}

export const adminCupRoundOpsApi = {
  health(cupId: string) {
    return request<CupBracketHealth>(`/api/admin/cups/${cupId}/health`);
  },
  reconcile(cupId: string) {
    return request<{ success: boolean; changed: number; blocked: number; health: CupBracketHealth }>(`/api/admin/cups/${cupId}/reconcile`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'admin-bracket-health-repair' }),
    });
  },
  setRound(cupId: string, roundNumber: number, action: 'OPEN' | 'LOCK') {
    return request<any>(`/api/admin/cups/${cupId}/round`, {
      method: 'POST',
      body: JSON.stringify({ roundNumber, action }),
    });
  },
  advanceRound(cupId: string) {
    return request<any>(`/api/admin/cups/${cupId}/round/advance`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },
};
