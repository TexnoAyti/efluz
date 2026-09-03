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
  isQuota?: boolean;

  constructor(message: string, httpStatus: number, data?: any) {
    // Sanitize technical or Firestore quota messages for user-friendly UI display
    let cleanMessage = message;
    const isQuota =
      httpStatus === 429 ||
      Boolean(data?.error === 'RESOURCE_EXHAUSTED') ||
      message.includes('RESOURCE_EXHAUSTED') ||
      message.includes('Quota limit exceeded') ||
      message.includes('Quota exceeded');

    if (isQuota) {
      cleanMessage = "Couldn't load data. Please try again.";
    } else if (message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('abort')) {
      cleanMessage = "Couldn't connect to server. Please try again.";
    }

    super(cleanMessage);
    this.name = 'ApiError';
    this.httpStatus = httpStatus;
    this.data = data;
    this.isQuota = isQuota;
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
  timeoutMs?: number;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const isGet = method === 'GET';
  const cacheTtl = options.cacheTtlMs ?? (isGet ? 15000 : 0); // Default 15s cache for GETs to conserve free-tier quota
  const timeoutMs = options.timeoutMs ?? 14000; // 14s timeout prevents indefinite hangs on slow mobile/Telegram connections

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
    const maxRetries = options.retries ?? (isGet ? 1 : 0);
    let attempt = 0;

    while (true) {
      attempt++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

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
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const rawText = await response.text();

        if (!rawText || !rawText.trim()) {
          throw new ApiError(
            `Empty response body: HTTP ${response.status}`,
            response.status
          );
        }

        let data: any;
        try {
          data = JSON.parse(rawText);
        } catch {
          throw new ApiError(
            `Invalid JSON response: HTTP ${response.status}`,
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
        clearTimeout(timeoutId);

        // Stale cache preservation: If we have existing cached data for this GET request,
        // preserve and return it on network timeout or quota exhaustion rather than crashing the view
        if (isGet) {
          const staleCached = memoryCache.get(cacheKey);
          if (staleCached && staleCached.data) {
            console.warn(`[API CACHE PRESERVED] Returning cached data for ${endpoint} due to error:`, err.message);
            return staleCached.data as T;
          }
        }

        const isNetworkOr5xx = !err.httpStatus || err.httpStatus >= 500 || err.name === 'AbortError';
        if (attempt <= maxRetries && isNetworkOr5xx) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 2500);
          console.warn(`[API RETRY ${attempt}/${maxRetries}] ${endpoint} failed (${err.message}). Retrying in ${backoffMs}ms...`);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        if (err instanceof ApiError) {
          throw err;
        }
        throw new ApiError(err?.message || "Couldn't load data. Please try again.", err?.httpStatus || 0);
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

  async getMyNotifications(skipCache = false): Promise<{ notifications: Notification[] }> {
    return request('/api/me/notifications', { cacheTtlMs: 15000, skipCache });
  },

  async markNotificationsRead(notificationId?: string): Promise<{ success: boolean }> {
    invalidateClientCache('/api/me/notifications');
    return request('/api/me/notifications/read', {
      method: 'POST',
      body: JSON.stringify(notificationId ? { notificationId } : {}),
    });
  },

  // Seasons & Leagues (Catalog Data - Static TTL 30 minutes to eliminate repetitive reads)
  async getSeasons(): Promise<{ seasons: Season[] }> {
    return request('/api/seasons', { cacheTtlMs: 1800000 });
  },

  async getLeagues(): Promise<{ leagues: League[] }> {
    return request('/api/leagues', { cacheTtlMs: 1800000 });
  },

  async getLeagueClubs(leagueId: string, seasonId = 'season-2026-27', skipCache = false): Promise<{ clubs: Club[] }> {
    return request(`/api/leagues/${leagueId}/clubs?seasonId=${seasonId}`, { cacheTtlMs: 120000, skipCache });
  },

  // Clubs
  async getClub(clubId: string, seasonId = 'season-2026-27', skipCache = false): Promise<{ club: Club }> {
    return request(`/api/clubs/${clubId}?seasonId=${seasonId}`, { cacheTtlMs: 120000, skipCache });
  },

  async claimClub(clubId: string, seasonId = 'season-2026-27'): Promise<{ success: boolean; message: string; club: Club }> {
    const res = await request<{ success: boolean; message: string; club: Club }>(`/api/clubs/${clubId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ seasonId }),
    });
    // Invalidate ONLY affected club, league and user caches
    invalidateClientCache('/api/clubs');
    invalidateClientCache('/api/leagues');
    invalidateClientCache('/api/me');
    return res;
  },

  // Competitions (Static Catalog - 30 minutes TTL)
  async getCompetitions(seasonId = 'season-2026-27', skipCache = false): Promise<{ competitions: Competition[] }> {
    return request(`/api/competitions?seasonId=${seasonId}`, { cacheTtlMs: 1800000, skipCache });
  },

  async getCompetitionStandings(competitionId: string, skipCache = false): Promise<{ standings: StandingsRow[] }> {
    return request(`/api/competitions/${competitionId}/standings`, { cacheTtlMs: 120000, skipCache });
  },

  async getCompetitionParticipants(competitionId: string, skipCache = false): Promise<{ participants: any[] }> {
    return request(`/api/competitions/${competitionId}/participants`, { cacheTtlMs: 1800000, skipCache });
  },

  async getCompetitionFixtures(competitionId: string, matchday?: number, status?: string, skipCache = false): Promise<{ fixtures: Fixture[] }> {
    let url = `/api/competitions/${competitionId}/fixtures?`;
    if (matchday) url += `matchday=${matchday}&`;
    if (status) url += `status=${status}&`;
    return request(url, { cacheTtlMs: 60000, skipCache });
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
    return request(`/api/fixtures/${fixtureId}`, { cacheTtlMs: 30000, skipCache });
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
  async getAdminOverview(seasonId = 'season-2026-27', skipCache = false): Promise<{
    season: { id: string; name: string; status: string };
    counts: {
      totalClubs: number;
      occupiedClubs?: number;
      availableClubs?: number;
      domesticLeaguesCount: number;
      domesticCupsCount: number;
      europeanCompetitionsCount: number;
      totalCompetitions: number;
      totalUsers?: number;
      registeredUsers: number;
      activeOccupancies: number;
      openDisputes: number;
      pendingResultConfirmations?: number;
      recentAuditLogs: number;
    };
    systemHealth: {
      projectId: string;
      databaseId: string;
      connected: boolean;
      authMode: string;
      timestamp: string;
    };
    openDisputes: Dispute[];
    pendingFixturesPreview?: any[];
  }> {
    return request(`/api/admin/overview?seasonId=${seasonId}`, { cacheTtlMs: 15000, skipCache });
  },

  async adminReleaseClub(clubId: string, seasonId = 'season-2026-27'): Promise<{ success: boolean; message: string; club: Club }> {
    const res = await request<{ success: boolean; message: string; club: Club }>(`/api/admin/clubs/${clubId}/release`, {
      method: 'POST',
      body: JSON.stringify({ seasonId }),
    });
    invalidateClientCache('/api/admin/clubs');
    invalidateClientCache('/api/clubs');
    invalidateClientCache('/api/admin/overview');
    return res;
  },

  async adminAssignClub(clubId: string, targetUserId: string, seasonId = 'season-2026-27'): Promise<{ success: boolean; message: string; club: Club }> {
    const res = await request<{ success: boolean; message: string; club: Club }>(`/api/admin/clubs/${clubId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ targetUserId, seasonId }),
    });
    invalidateClientCache('/api/admin/clubs');
    invalidateClientCache('/api/clubs');
    invalidateClientCache('/api/admin/overview');
    return res;
  },

  async getAdminPendingResults(seasonId = 'season-2026-27', skipCache = false): Promise<{
    pendingFixtures: (Fixture & { submissions: any[] })[];
    total: number;
  }> {
    return request(`/api/admin/results/pending?seasonId=${seasonId}`, { cacheTtlMs: 10000, skipCache });
  },

  async adminApproveResult(
    fixtureId: string,
    homeScore: number,
    awayScore: number,
    notes?: string
  ): Promise<{ success: boolean; message: string; fixture: Fixture }> {
    const res = await request<{ success: boolean; message: string; fixture: Fixture }>(`/api/admin/results/${fixtureId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ homeScore, awayScore, notes }),
    });
    invalidateClientCache();
    return res;
  },

  async adminRejectResult(fixtureId: string, notes?: string): Promise<{ success: boolean; message: string }> {
    const res = await request<{ success: boolean; message: string }>(`/api/admin/results/${fixtureId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    });
    invalidateClientCache();
    return res;
  },

  async getAdminClubs(seasonId = 'season-2026-27', leagueId?: string, skipCache = false): Promise<{ clubs: Club[]; total: number }> {
    const url = `/api/admin/clubs?seasonId=${seasonId}${leagueId ? `&leagueId=${leagueId}` : ''}`;
    return request(url, { cacheTtlMs: 20000, skipCache });
  },

  async getAdminFixtures(
    seasonId = 'season-2026-27',
    competitionId?: string,
    status?: string,
    matchday?: number,
    limit = 100,
    skipCache = false
  ): Promise<{ fixtures: Fixture[]; total: number }> {
    let url = `/api/admin/fixtures?seasonId=${seasonId}&limit=${limit}`;
    if (competitionId && competitionId !== 'ALL') url += `&competitionId=${competitionId}`;
    if (status && status !== 'ALL') url += `&status=${status}`;
    if (matchday) url += `&matchday=${matchday}`;
    return request(url, { cacheTtlMs: 15000, skipCache });
  },

  async getAdminDiagnostics(): Promise<{
    projectId: string;
    databaseId: string;
    connected: boolean;
    authMode: string;
    collections: Record<string, number>;
  }> {
    return request('/api/admin/firestore-diagnostics', { skipCache: true });
  },

  async rebuildStandings(competitionId: string): Promise<{ success: boolean; message: string; standings: any[] }> {
    const res = await request<{ success: boolean; message: string; standings: any[] }>(
      `/api/admin/competitions/${competitionId}/rebuild-standings`,
      {
        method: 'POST',
      }
    );
    invalidateClientCache();
    return res;
  },

  async generateKnockoutBracket(competitionId: string): Promise<{ success: boolean; message: string; result: any }> {
    const res = await request<{ success: boolean; message: string; result: any }>('/api/admin/knockouts/generate', {
      method: 'POST',
      body: JSON.stringify({ competitionId }),
    });
    invalidateClientCache();
    return res;
  },

  async migrateSqliteToFirestore(): Promise<{ success: boolean; message: string; report: any }> {
    const res = await request<{ success: boolean; message: string; report: any }>('/api/admin/migrate-to-firestore', {
      method: 'POST',
    });
    invalidateClientCache();
    return res;
  },

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

  async overrideCompetitionMatchday(
    competitionId: string,
    overrideStatus: 'AUTO' | 'FORCE_OPEN' | 'FORCE_LOCKED' | 'PAUSED'
  ): Promise<{ success: boolean; adminOverrideStatus: string; isMatchdayOpen: boolean }> {
    const res = await request<{ success: boolean; adminOverrideStatus: string; isMatchdayOpen: boolean }>(
      `/api/admin/competitions/${competitionId}/matchday/override`,
      {
        method: 'POST',
        body: JSON.stringify({ overrideStatus }),
      }
    );
    invalidateClientCache();
    return res;
  },

  async advanceCompetitionMatchday(
    competitionId: string,
    durationHours?: number
  ): Promise<{ success: boolean; currentMatchday: number; totalMatchdays: number; isMatchdayOpen: boolean; nextMatchdayOpenAt: string }> {
    const res = await request<{ success: boolean; currentMatchday: number; totalMatchdays: number; isMatchdayOpen: boolean; nextMatchdayOpenAt: string }>(
      `/api/admin/competitions/${competitionId}/matchday/advance`,
      {
        method: 'POST',
        body: JSON.stringify({ durationHours }),
      }
    );
    invalidateClientCache();
    return res;
  },

  async openCompetitionMatchdayNow(
    competitionId: string,
    durationHours = 30
  ): Promise<{ success: boolean; currentMatchday: number; isMatchdayOpen: boolean; nextMatchdayOpenAt: string }> {
    const res = await request<{ success: boolean; currentMatchday: number; isMatchdayOpen: boolean; nextMatchdayOpenAt: string }>(
      `/api/admin/competitions/${competitionId}/matchday/open-now`,
      {
        method: 'POST',
        body: JSON.stringify({ durationHours }),
      }
    );
    invalidateClientCache();
    return res;
  },

  async setCompetitionMatchdayTimer(
    competitionId: string,
    params: { currentMatchday?: number; durationHours?: number; nextOpenAt?: string; overrideStatus?: 'AUTO' | 'FORCE_OPEN' | 'FORCE_LOCKED' | 'PAUSED' }
  ): Promise<{ success: boolean; competitionId: string }> {
    const res = await request<{ success: boolean; competitionId: string }>(
      `/api/admin/competitions/${competitionId}/matchday/set-timer`,
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    );
    invalidateClientCache();
    return res;
  },

  async getUserProfile(userId: string, seasonId = 'season-2026-27'): Promise<{
    user: {
      id: string;
      username: string;
      firstName: string;
      lastName?: string;
      photoUrl?: string;
      isAdmin?: boolean;
      createdAt?: string;
    };
    currentClub?: any;
    stats: {
      matchesPlayed: number;
      wins: number;
      draws: number;
      losses: number;
      goalsScored: number;
      goalsConceded: number;
      points: number;
    };
  }> {
    return request(`/api/users/${userId}?seasonId=${seasonId}`, { cacheTtlMs: 30000 });
  },

  async getFixtureValidationReport(seasonId = 'season-2026-27'): Promise<any> {
    return request<any>(`/api/admin/fixtures/validation?seasonId=${seasonId}`, {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
    });
  },

  async getReadMetrics(): Promise<any> {
    return request<any>('/api/admin/read-metrics', { skipCache: true });
  },

  async resetReadMetrics(): Promise<{ success: boolean; message: string }> {
    return request<{ success: boolean; message: string }>('/api/admin/read-metrics/reset', {
      method: 'POST',
    });
  },
};

