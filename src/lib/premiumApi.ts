import { getDevUserId, getSessionToken, getTelegramInitData } from './api';

export interface PremiumEntitlementDto {
  id: string;
  userId: string;
  seasonId: string;
  status: 'ACTIVE' | 'REVOKED';
  source: 'ADMIN' | 'TELEGRAM_STARS';
  activatedAt: string;
  updatedAt: string;
  updatedBy?: string;
  revokedAt?: string | null;
  revokedBy?: string | null;
  note?: string | null;
  paymentChargeId?: string | null;
}

export interface PremiumCareerDto {
  userId: string;
  seasonId: string;
  currentClub: { id: string; name: string; shortName?: string; leagueId?: string } | null;
  overall: {
    matches: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
    points: number;
    winRate: number;
    pointsPerMatch: number;
    goalsPerMatch: number;
    cleanSheets: number;
    longestUnbeatenRun: number;
    longestWinStreak: number;
  };
  form: Array<'W' | 'D' | 'L'>;
  competitions: Array<{
    competitionId: string;
    name: string;
    matches: number;
    wins: number;
    draws: number;
    losses: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
    winRate: number;
  }>;
  achievements: Array<{ id: string; label: string; description: string; unlocked: boolean }>;
  generatedAt: string;
  source: 'sqlite' | 'empty';
}

export interface PremiumAdminUser {
  id: string;
  telegramId?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  photoUrl?: string;
  isAdmin?: boolean;
  isSuspended?: boolean;
  createdAt?: string;
}

async function premiumRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  const token = getSessionToken();
  const initData = getTelegramInitData();
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (initData) headers['x-telegram-init-data'] = initData;
  else {
    const devUserId = getDevUserId();
    if (devUserId) headers['x-dev-user-id'] = devUserId;
  }

  const response = await fetch(endpoint, { ...options, headers });
  const raw = await response.text();
  let data: any = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Premium request failed (${response.status})`);
  }
  return data as T;
}

export const premiumApi = {
  getAdminUsers: () => premiumRequest<{ users: PremiumAdminUser[]; total?: number }>('/api/admin/users?limit=100'),

  getOverview: (seasonId = 'season-2026-27') => premiumRequest<{
    seasonId: string;
    priceStars: number;
    publicEnabled: boolean;
    counts: { totalRecords: number; active: number; revoked: number; stars: number; admin: number };
    entitlements: PremiumEntitlementDto[];
  }>(`/api/telegram/premium/admin/overview?seasonId=${encodeURIComponent(seasonId)}`),

  getCareer: (userId: string, seasonId = 'season-2026-27') => premiumRequest<{
    career: PremiumCareerDto;
    entitlement: PremiumEntitlementDto | null;
    seasonId: string;
    priceStars: number;
  }>(`/api/telegram/premium/admin/career/${encodeURIComponent(userId)}?seasonId=${encodeURIComponent(seasonId)}`),

  grant: (userId: string, seasonId = 'season-2026-27', note?: string) => premiumRequest<{
    success: true;
    entitlement: PremiumEntitlementDto;
  }>('/api/telegram/premium/admin/grant', {
    method: 'POST',
    body: JSON.stringify({ userId, seasonId, note }),
  }),

  revoke: (userId: string, seasonId = 'season-2026-27', note?: string) => premiumRequest<{
    success: true;
    entitlement: PremiumEntitlementDto;
  }>('/api/telegram/premium/admin/revoke', {
    method: 'POST',
    body: JSON.stringify({ userId, seasonId, note }),
  }),

  createInvoice: (seasonId = 'season-2026-27') => premiumRequest<{
    success: true;
    orderId: string;
    invoiceLink: string;
    priceStars: number;
    seasonId: string;
  }>('/api/telegram/premium/invoice', {
    method: 'POST',
    body: JSON.stringify({ seasonId }),
  }),
};
