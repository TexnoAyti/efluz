import { getDevUserId, getSessionToken, getTelegramInitData } from './api';

async function adminCupRequest<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
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
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
  }
  return payload as T;
}

export const adminCupDrawApi = {
  preview(cupId: string, options?: { seasonId?: string; newDraw?: boolean; drawSeed?: string }) {
    return adminCupRequest<any>(`/api/admin/cups/${cupId}/bracket/preview`, {
      method: 'POST',
      body: JSON.stringify({
        seasonId: options?.seasonId || 'season-2026-27',
        newDraw: Boolean(options?.newDraw),
        drawSeed: options?.drawSeed,
      }),
    });
  },

  confirm(cupId: string, drawSeed: string, seasonId = 'season-2026-27') {
    return adminCupRequest<any>(`/api/admin/cups/${cupId}/bracket/generate`, {
      method: 'POST',
      body: JSON.stringify({ confirmation: true, seasonId, drawSeed }),
    });
  },

  editPairing(
    cupId: string,
    fixtureId: string,
    changes: { homeClubId?: string | null; awayClubId?: string | null; seasonId?: string }
  ) {
    return adminCupRequest<any>(`/api/admin/cups/${cupId}/bracket/fixture/${fixtureId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        seasonId: changes.seasonId || 'season-2026-27',
        homeClubId: changes.homeClubId,
        awayClubId: changes.awayClubId,
      }),
    });
  },
};
