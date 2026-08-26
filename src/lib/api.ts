import { User, Club, Season, League, Competition, Fixture, StandingsRow, Dispute, Notification, AuditLog } from '../types';

let currentDevUserId: string | null = null;
let currentTelegramInitData: string | null = null;

export function setDevUserId(id: string | null) {
  currentDevUserId = id;
  if (typeof window !== 'undefined') {
    if (id) {
      localStorage.setItem('efootball_dev_user_id', id);
    } else {
      localStorage.removeItem('efootball_dev_user_id');
    }
  }
}

export function getDevUserId(): string | null {
  if (currentDevUserId) return currentDevUserId;
  if (typeof window !== 'undefined') {
    return localStorage.getItem('efootball_dev_user_id');
  }
  return null;
}

export function setTelegramInitData(data: string | null) {
  currentTelegramInitData = data || null;
  if (typeof window !== 'undefined') {
    if (data) {
      sessionStorage.setItem('efootball_tg_init_data', data);
    } else {
      sessionStorage.removeItem('efootball_tg_init_data');
    }
  }
}

export function getTelegramInitData(): string {
  if (typeof window !== 'undefined') {
    // 1. Direct Telegram WebApp SDK
    const tgSdkData = (window as any).Telegram?.WebApp?.initData;
    if (tgSdkData && typeof tgSdkData === 'string' && tgSdkData.length > 0) {
      currentTelegramInitData = tgSdkData;
      return tgSdkData;
    }

    // 2. In-memory cached
    if (currentTelegramInitData) {
      return currentTelegramInitData;
    }

    // 3. SessionStorage cached during current tab session
    const sessionData = sessionStorage.getItem('efootball_tg_init_data');
    if (sessionData) {
      currentTelegramInitData = sessionData;
      return sessionData;
    }

    // 4. URL Hash parameter (#tgWebAppData=...)
    try {
      if (window.location.hash) {
        const hashStr = window.location.hash.startsWith('#')
          ? window.location.hash.substring(1)
          : window.location.hash;
        const hashParams = new URLSearchParams(hashStr);
        const tgData = hashParams.get('tgWebAppData');
        if (tgData) {
          currentTelegramInitData = tgData;
          return tgData;
        }
      }
    } catch {
      // ignore
    }

    // 5. URL Search query parameter (?tgWebAppData=... or ?initData=...)
    try {
      if (window.location.search) {
        const searchParams = new URLSearchParams(window.location.search);
        const searchData = searchParams.get('tgWebAppData') || searchParams.get('initData');
        if (searchData) {
          currentTelegramInitData = searchData;
          return searchData;
        }
      }
    } catch {
      // ignore
    }
  }
  return currentTelegramInitData || '';
}

export class ApiError extends Error {
  httpStatus: number;
  data?: any;

  constructor(message: string, httpStatus: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.httpStatus = httpStatus;
    this.data = data;
  }
}

// ----------------------------------------------------
// SMART CLIENT-SIDE CACHE & REQUEST DEDUPLICATION
// ----------------------------------------------------
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttlMs: number;
}

const memoryCache = new Map<string, CacheEntry<any>>();
const inFlightRequests = new Map<string, Promise<any>>();

export function invalidateClientCache(prefix?: string) {
  if (!prefix) {
    memoryCache.clear();
    return;
  }
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix) || key.includes(prefix)) {
      memoryCache.delete(key);
    }
  }
}

interface RequestOptions extends RequestInit {
  cacheTtlMs?: number; // 0 means no cache
  skipCache?: boolean;
  retries?: number;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const isGet = method === 'GET';
  const cacheTtl = options.cacheTtlMs ?? (isGet ? 15000 : 0); // Default 15s cache for GETs to conserve free-tier quota

  const cacheKey = `${endpoint}::${getDevUserId() || ''}::${getTelegramInitData().slice(0, 32)}`;

  // 1. Check in-memory cache for GET
  if (isGet && !options.skipCache && cacheTtl > 0) {
    const cached = memoryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cached.ttlMs) {
      return cached.data as T;
    }
  }

  // 2. Request deduplication (in-flight request collapsing)
  if (isGet && inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey)! as Promise<T>;
  }

  const executionPromise = (async () => {
    const maxRetries = options.retries ?? (isGet ? 2 : 0);
    let attempt = 0;

    while (true) {
      attempt++;
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string> || {}),
        };

        const tgInitData = getTelegramInitData();
        if (tgInitData) {
          headers['x-telegram-init-data'] = tgInitData;
        } else {
          const devId = getDevUserId();
          if (devId) {
            headers['x-dev-user-id'] = devId;
          }
        }

        const response = await fetch(endpoint, {
          ...options,
          headers,
        });

        const rawText = await response.text();

        if (!rawText || !rawText.trim()) {
          throw new ApiError(
            `Empty response body: HTTP ${response.status} (${response.statusText || 'No status text'})`,
            response.status
          );
        }

        let data: any;
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new ApiError(
            `Invalid JSON response: HTTP ${response.status} - "${rawText.slice(0, 80)}"`,
            response.status
          );
        }

        if (!response.ok) {
          const errorMsg = data?.error || data?.message || data?.details || `Request failed with HTTP ${response.status}`;
          throw new ApiError(errorMsg, response.status, data);
        }

        // Cache successful GET response
        if (isGet && cacheTtl > 0) {
          memoryCache.set(cacheKey, {
            data,
            timestamp: Date.now(),
            ttlMs: cacheTtl,
          });
        }

        return data as T;
      } catch (err: any) {
        const isNetworkOr5xx = !err.httpStatus || err.httpStatus >= 500;
        if (attempt <= maxRetries && isNetworkOr5xx) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 3000);
          console.warn(`[API RETRY ${attempt}/${maxRetries}] ${endpoint} failed (${err.message}). Retrying in ${backoffMs}ms...`);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }
        throw err;
      }
    }
  })();

  if (isGet) {
    inFlightRequests.set(cacheKey, executionPromise);
    try {
      const result = await executionPromise;
      return result;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  }

  return executionPromise;
}

export const api = {
  // Auth
  async authenticateTelegram(initData: string): Promise<{ success: boolean; user: User; currentClub: Club | null }> {
    invalidateClientCache();
    return request('/api/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({ initData }),
    });
  },

  async authenticateDev(devUserId: string): Promise<{ success: boolean; user: User; currentClub: Club | null }> {
    invalidateClientCache();
    return request('/api/auth/dev', {
      method: 'POST',
      body: JSON.stringify({ devUserId }),
    });
  },

  async getDevProfiles(): Promise<{ profiles: Array<{ id: string; username: string; firstName: string; isAdmin: boolean }> }> {
    return request('/api/auth/dev-profiles', { cacheTtlMs: 60000 });
  },

  // Me
  async getMe(seasonId = 'season-2026-27', skipCache = false): Promise<{
    user: User;
    currentClub: Club | null;
    stats: {
      matchesPlayed: number;
      wins: number;
      draws: number;
      losses: number;
      goalsScored: number;
      goalsConceded: number;
      points: number;
      trophies: number;
      leaguePosition: number;
    };
  }> {
    return request(`/api/me?seasonId=${seasonId}`, { cacheTtlMs: 15000, skipCache });
  },

  async getMyMatches(seasonId = 'season-2026-27', status?: string, skipCache = false): Promise<{ fixtures: Fixture[] }> {
    const url = `/api/me/matches?seasonId=${seasonId}${status ? `&status=${status}` : ''}`;
    return request(url, { cacheTtlMs: 15000, skipCache });
  },

  async getMyNotifications(): Promise<{ notifications: Notification[] }> {
    return request('/api/me/notifications', { cacheTtlMs: 20000 });
  },

  async markNotificationsRead(): Promise<{ success: boolean }> {
    invalidateClientCache('/api/me/notifications');
    return request('/api/me/notifications/read', { method: 'POST' });
  },

  // Seasons & Leagues (Catalog Data - Longer TTL to reduce database reads)
  async getSeasons(): Promise<{ seasons: Season[] }> {
    return request('/api/seasons', { cacheTtlMs: 120000 });
  },

  async getLeagues(): Promise<{ leagues: League[] }> {
    return request('/api/leagues', { cacheTtlMs: 120000 });
  },

  async getLeagueClubs(leagueId: string, seasonId = 'season-2026-27', skipCache = false): Promise<{ clubs: Club[] }> {
    return request(`/api/leagues/${leagueId}/clubs?seasonId=${seasonId}`, { cacheTtlMs: 30000, skipCache });
  },

  // Clubs
  async getClub(clubId: string, seasonId = 'season-2026-27', skipCache = false): Promise<{ club: Club }> {
    return request(`/api/clubs/${clubId}?seasonId=${seasonId}`, { cacheTtlMs: 30000, skipCache });
  },

  async claimClub(clubId: string, seasonId = 'season-2026-27'): Promise<{ success: boolean; message: string; club: Club }> {
    const res = await request<{ success: boolean; message: string; club: Club }>(`/api/clubs/${clubId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ seasonId }),
    });
    // Invalidate club, league and user caches
    invalidateClientCache('/api/clubs');
    invalidateClientCache('/api/leagues');
    invalidateClientCache('/api/me');
    return res;
  },

  // Competitions
  async getCompetitions(seasonId = 'season-2026-27', skipCache = false): Promise<{ competitions: Competition[] }> {
    return request(`/api/competitions?seasonId=${seasonId}`, { cacheTtlMs: 60000, skipCache });
  },

  async getCompetitionStandings(competitionId: string, skipCache = false): Promise<{ standings: StandingsRow[] }> {
    return request(`/api/competitions/${competitionId}/standings`, { cacheTtlMs: 20000, skipCache });
  },

  async getCompetitionParticipants(competitionId: string, skipCache = false): Promise<{ participants: any[] }> {
    return request(`/api/competitions/${competitionId}/participants`, { cacheTtlMs: 60000, skipCache });
  },

  async getCompetitionFixtures(competitionId: string, matchday?: number, status?: string, skipCache = false): Promise<{ fixtures: Fixture[] }> {
    let url = `/api/competitions/${competitionId}/fixtures?`;
    if (matchday) url += `matchday=${matchday}&`;
    if (status) url += `status=${status}&`;
    return request(url, { cacheTtlMs: 15000, skipCache });
  },

  async generateCompetitionFixtures(competitionId: string, force = true): Promise<{ success: boolean; message: string; result: any }> {
    const res = await request<{ success: boolean; message: string; result: any }>(`/api/competitions/${competitionId}/generate-fixtures`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    });
    invalidateClientCache('/api/competitions');
    invalidateClientCache('/api/fixtures');
    invalidateClientCache('/api/me/matches');
    return res;
  },

  async resetCompetitionFixtures(competitionId: string): Promise<{ success: boolean; message: string; result: any }> {
    const res = await request<{ success: boolean; message: string; result: any }>(`/api/competitions/${competitionId}/reset-fixtures`, {
      method: 'POST',
    });
    invalidateClientCache('/api/competitions');
    invalidateClientCache('/api/fixtures');
    invalidateClientCache('/api/me/matches');
    return res;
  },

  // Fixtures & Results
  async getFixture(fixtureId: string, skipCache = false): Promise<{ fixture: Fixture }> {
    return request(`/api/fixtures/${fixtureId}`, { cacheTtlMs: 10000, skipCache });
  },

  async submitFixtureResult(
    fixtureId: string,
    homeScore: number,
    awayScore: number,
    proofUrl?: string
  ): Promise<{ success: boolean; message: string; fixture: Fixture }> {
    const res = await request<{ success: boolean; message: string; fixture: Fixture }>(`/api/fixtures/${fixtureId}/result`, {
      method: 'POST',
      body: JSON.stringify({ homeScore, awayScore, proofUrl }),
    });
    invalidateClientCache('/api/fixtures');
    invalidateClientCache('/api/competitions');
    invalidateClientCache('/api/me');
    return res;
  },

  // Admin
  async getAdminDisputes(status = 'OPEN', skipCache = false): Promise<{ disputes: Dispute[] }> {
    return request(`/api/admin/disputes?status=${status}`, { cacheTtlMs: 15000, skipCache });
  },

  async resolveAdminDispute(
    disputeId: string,
    payload: {
      action: 'CONFIRM_HOME_SUBMISSION' | 'CONFIRM_AWAY_SUBMISSION' | 'MANUAL_SCORE' | 'CANCEL_MATCH';
      manualHomeScore?: number;
      manualAwayScore?: number;
      notes?: string;
    }
  ): Promise<{ success: boolean; message: string; dispute: Dispute }> {
    const res = await request<{ success: boolean; message: string; dispute: Dispute }>(`/api/admin/disputes/${disputeId}/resolve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    invalidateClientCache();
    return res;
  },

  async reopenFixture(fixtureId: string, notes?: string): Promise<{ success: boolean; message: string }> {
    const res = await request<{ success: boolean; message: string }>(`/api/admin/fixtures/${fixtureId}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    });
    invalidateClientCache();
    return res;
  },

  async getAdminAuditLogs(limit = 50, skipCache = false): Promise<{ logs: AuditLog[] }> {
    return request(`/api/admin/audit-logs?limit=${limit}`, { cacheTtlMs: 15000, skipCache });
  },

  async getAdminUsers(skipCache = false): Promise<{ users: User[] }> {
    return request('/api/admin/users', { cacheTtlMs: 30000, skipCache });
  },

  async evaluateSeasonQualifications(seasonId = 'season-2026-27'): Promise<{ success: boolean; message: string }> {
    const res = await request<{ success: boolean; message: string }>('/api/admin/qualifications/evaluate', {
      method: 'POST',
      body: JSON.stringify({ seasonId }),
    });
    invalidateClientCache();
    return res;
  },
};

