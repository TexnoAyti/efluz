import { User, Club, Season, League, Competition, Fixture, StandingsRow, Dispute, Notification, AuditLog } from '../types';

let currentDevUserId: string | null = null;
let currentTelegramInitData: string | null = null;
let currentSessionToken: string | null = null;

export function setSessionToken(token: string | null) {
  currentSessionToken = token || null;
  if (typeof window !== 'undefined') {
    if (token) sessionStorage.setItem('efootball_session_token', token);
    else sessionStorage.removeItem('efootball_session_token');
  }
}

export function getSessionToken(): string | null {
  if (currentSessionToken) return currentSessionToken;
  if (typeof window !== 'undefined') {
    currentSessionToken = sessionStorage.getItem('efootball_session_token');
  }
  return currentSessionToken;
}

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
          hashParams.delete('tgWebAppData');
          const cleanHash = hashParams.toString();
          window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${cleanHash ? `#${cleanHash}` : ''}`);
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
          searchParams.delete('tgWebAppData');
          searchParams.delete('initData');
          const cleanSearch = searchParams.toString();
          window.history.replaceState(window.history.state, '', `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ''}${window.location.hash}`);
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

  const authCacheIdentity = getSessionToken()?.slice(0, 32) || getTelegramInitData().slice(0, 32);
  const cacheKey = `${endpoint}::${getDevUserId() || ''}::${authCacheIdentity}`;

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

        const sessionToken = getSessionToken();
        const tgInitData = getTelegramInitData();
        if (sessionToken) {
          headers.Authorization = `Bearer ${sessionToken}`;
        } else if (tgInitData) {
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
  async authenticateTelegram(initData: string): Promise<{ success: boolean; user: User; currentClub: Club | null; currentClubStatus?: 'resolved' | 'unavailable'; token: string }> {
    invalidateClientCache();
    return request('/api/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({ initData }),
    });
  },

  async authenticateDev(devUserId: string): Promise<{ success: boolean; user: User; currentClub: Club | null; currentClubStatus?: 'resolved' | 'unavailable'; token: string }> {
    invalidateClientCache();
    return request('/api/auth/dev', {
      method: 'POST',
      body: JSON.stringify({ devUserId }),
    });
  },

  async getDevProfiles(): Promise<{ profiles: Array<{ id: string; username: string; firstName: string; isAdmin: boolean }> }> {
    return request('/api/auth/dev-profiles', { cacheTtlMs: 60000 });
  },

  async checkTelegramMembership(): Promise<{ isMember: boolean; status?: string; error?: string; cached?: boolean }> {
    return request('/api/telegram/check-membership', {
      method: 'POST',
      skipCache: true,
    });
  },

  // Me
  async getMe(seasonId = 'season-2026-27', skipCache = false): Promise<{
    user: User;
    currentClub: Club | null; currentClubStatus?: 'resolved' | 'unavailable';
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
    if (!clubId || clubId === 'undefined' || clubId === 'null' || !clubId.startsWith('club-')) {
      throw new Error('INVALID_CLUB_ID: Invalid club identifier provided.');
    }
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
    filterOrSeason:
      | {
          seasonId?: string;
          competitionId?: string;
          status?: string;
          matchday?: number;
          clubId?: string;
          userId?: string;
          search?: string;
          cursor?: string;
          page?: number;
          limit?: number;
        }
      | string = 'season-2026-27',
    competitionIdParam?: string | boolean,
    statusParam?: string,
    matchdayParam?: number,
    limitParam = 25,
    skipCacheParam = false
  ): Promise<{ fixtures: Fixture[]; total: number; hasMore?: boolean; nextCursor?: string; page?: number; totalPages?: number; limit?: number }> {
    let url = '/api/admin/fixtures';
    let skipCache = false;

    if (typeof filterOrSeason === 'object') {
      const p = new URLSearchParams();
      if (filterOrSeason.seasonId) p.set('seasonId', filterOrSeason.seasonId);
      if (filterOrSeason.competitionId && filterOrSeason.competitionId !== 'ALL') p.set('competitionId', filterOrSeason.competitionId);
      if (filterOrSeason.status && filterOrSeason.status !== 'ALL') p.set('status', filterOrSeason.status);
      if (filterOrSeason.matchday) p.set('matchday', String(filterOrSeason.matchday));
      if (filterOrSeason.clubId) p.set('clubId', filterOrSeason.clubId);
      if (filterOrSeason.userId) p.set('userId', filterOrSeason.userId);
      if (filterOrSeason.search) p.set('search', filterOrSeason.search);
      if (filterOrSeason.cursor) p.set('cursor', filterOrSeason.cursor);
      if (filterOrSeason.page) p.set('page', String(filterOrSeason.page));
      // Never request limit: 0, default to 25
      const safeLimit = Math.max(filterOrSeason.limit && filterOrSeason.limit > 0 ? filterOrSeason.limit : 25, 1);
      p.set('limit', String(safeLimit));
      url += `?${p.toString()}`;
      skipCache = Boolean(competitionIdParam);
    } else {
      const seasonId = filterOrSeason || 'season-2026-27';
      const competitionId = competitionIdParam as string | undefined;
      const safeLimit = Math.max(limitParam > 0 ? limitParam : 25, 1);
      let q = `seasonId=${seasonId}&limit=${safeLimit}`;
      if (competitionId && competitionId !== 'ALL') q += `&competitionId=${competitionId}`;
      if (statusParam && statusParam !== 'ALL') q += `&status=${statusParam}`;
      if (matchdayParam) q += `&matchday=${matchdayParam}`;
      url += `?${q}`;
      skipCache = skipCacheParam;
    }

    return request(url, { cacheTtlMs: 15000, skipCache });
  },

  async adminEditFixtureResult(
    fixtureId: string,
    params: {
      homeScore: number;
      awayScore: number;
      status?: string;
      notes?: string;
    }
  ): Promise<{ success: boolean; message: string; fixture: Fixture }> {
    const res = await request<{ success: boolean; message: string; fixture: Fixture }>(
      `/api/admin/fixtures/${fixtureId}/result`,
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    );
    invalidateClientCache();
    return res;
  },

  async adminDeleteFixtureResult(
    fixtureId: string,
    options?: {
      deleteSubmissions?: boolean;
      notes?: string;
    }
  ): Promise<{ success: boolean; message: string; fixture: Fixture }> {
    const res = await request<{ success: boolean; message: string; fixture: Fixture }>(
      `/api/admin/fixtures/${fixtureId}/delete-result`,
      {
        method: 'POST',
        body: JSON.stringify(options || {}),
      }
    );
    invalidateClientCache();
    return res;
  },

  async adminDeleteFixture(
    fixtureId: string,
    reason: string
  ): Promise<{ success: boolean; message: string }> {
    const res = await request<{ success: boolean; message: string }>(
      `/api/admin/fixtures/${fixtureId}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      }
    );
    invalidateClientCache();
    return res;
  },

  async adminGetUserDetail(userId: string): Promise<any> {
    return request(`/api/admin/users/${userId}/detail`, { cacheTtlMs: 10000, skipCache: true });
  },

  async adminSetUserRole(
    userId: string,
    isAdmin: boolean
  ): Promise<{ success: boolean; message: string; user: User }> {
    const res = await request<{ success: boolean; message: string; user: User }>(
      `/api/admin/users/${userId}/role`,
      {
        method: 'POST',
        body: JSON.stringify({ isAdmin }),
      }
    );
    invalidateClientCache();
    return res;
  },

  async adminSetUserSuspension(
    userId: string,
    isSuspended: boolean,
    reason?: string
  ): Promise<{ success: boolean; message: string; user: User }> {
    const res = await request<{ success: boolean; message: string; user: User }>(
      `/api/admin/users/${userId}/suspend`,
      {
        method: 'POST',
        body: JSON.stringify({ isSuspended, reason }),
      }
    );
    invalidateClientCache();
    return res;
  },

  async adminDeleteUser(
    userId: string,
    reason?: string
  ): Promise<{ success: boolean; message: string }> {
    const res = await request<{ success: boolean; message: string }>(
      `/api/admin/users/${userId}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ reason }),
      }
    );
    invalidateClientCache();
    return res;
  },

  async adminGetSubmissions(params?: {
    fixtureId?: string;
    userId?: string;
    limit?: number;
  }): Promise<{ submissions: any[]; total: number }> {
    const q = new URLSearchParams();
    if (params?.fixtureId) q.set('fixtureId', params.fixtureId);
    if (params?.userId) q.set('userId', params.userId);
    if (params?.limit) q.set('limit', String(params.limit));
    return request(`/api/admin/submissions?${q.toString()}`, { cacheTtlMs: 10000, skipCache: true });
  },

  async adminDeleteSubmission(
    submissionId: string,
    notes?: string
  ): Promise<{ success: boolean; message: string }> {
    const res = await request<{ success: boolean; message: string }>(
      `/api/admin/submissions/${submissionId}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ notes }),
      }
    );
    invalidateClientCache();
    return res;
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
    overrideStatus: 'AUTO' | 'FORCE_OPEN' | 'FORCE_LOCKED' | 'PAUSED',
    options?: { matchday?: number; seasonId?: string; durationHours?: number }
  ): Promise<{ success: boolean; adminOverrideStatus: string; isMatchdayOpen: boolean; matchdayLock?: any }> {
    const res = await request<{ success: boolean; adminOverrideStatus: string; isMatchdayOpen: boolean; matchdayLock?: any }>(
      `/api/admin/competitions/${competitionId}/matchday/override`,
      {
        method: 'POST',
        body: JSON.stringify({
          overrideStatus,
          matchday: options?.matchday,
          seasonId: options?.seasonId,
          durationHours: options?.durationHours,
        }),
      }
    );
    invalidateClientCache();
    return res;
  },

  async getCompetitionLocks(
    competitionId: string,
    seasonId = 'season-2026-27'
  ): Promise<{ locks: Record<number, any> }> {
    return await request<{ locks: Record<number, any> }>(
      `/api/competitions/${competitionId}/locks?seasonId=${encodeURIComponent(seasonId)}`
    );
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

  async getResilienceStatus(): Promise<{
    status: string;
    isOffline: boolean;
    circuitBreaker: {
      status: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
      failureCount: number;
      fallbackRequestCount: number;
      consecutiveSuccesses: number;
    };
    queueStats: {
      total: number;
      pending: number;
      syncing: number;
      synced: number;
      failed: number;
    };
  }> {
    return request('/api/health/resilience', { cacheTtlMs: 10000 });
  },

  async triggerSync(): Promise<{ success: boolean; result: any }> {
    return request('/api/health/sync', { method: 'POST', skipCache: true });
  },

  async getReadModelHealth(seasonId = 'season-2026-27'): Promise<any> {
    return request<any>(`/api/admin/read-model/health?seasonId=${seasonId}`, { skipCache: true });
  },

  async rebuildReadModels(seasonId = 'season-2026-27'): Promise<any> {
    return request<any>('/api/admin/read-model/rebuild', {
      method: 'POST',
      body: JSON.stringify({ seasonId }),
      skipCache: true,
    });
  },

  // --------------------------------------------------------------------------
  // DOMESTIC CUP ADMINISTRATION
  // --------------------------------------------------------------------------
  async getDomesticCups(): Promise<{ cups: Array<{ id: string; name: string; country: string; leagueId: string; expectedTeams: number }> }> {
    return request('/api/admin/cups', { cacheTtlMs: 30000 });
  },

  async getDomesticCupDetails(cupId: string, seasonId = 'season-2026-27'): Promise<any> {
    return request(`/api/admin/cups/${cupId}?seasonId=${seasonId}`, { skipCache: true });
  },

  async previewDomesticCupBracket(cupId: string, seasonId = 'season-2026-27'): Promise<any> {
    return request(`/api/admin/cups/${cupId}/bracket/preview`, {
      method: 'POST',
      body: JSON.stringify({ seasonId }),
      skipCache: true,
    });
  },

  async generateDomesticCupBracket(cupId: string, confirmation: boolean, seasonId = 'season-2026-27'): Promise<any> {
    const res = await request(`/api/admin/cups/${cupId}/bracket/generate`, {
      method: 'POST',
      body: JSON.stringify({ confirmation, seasonId }),
      skipCache: true,
    });
    invalidateClientCache();
    return res;
  },

  async advanceDomesticCupWinner(fixtureId: string): Promise<any> {
    const res = await request(`/api/admin/cups/matches/${fixtureId}/advance`, {
      method: 'POST',
      skipCache: true,
    });
    invalidateClientCache();
    return res;
  },

  // --------------------------------------------------------------------------
  // EUROPEAN STANDINGS & QUALIFICATION PROJECTIONS
  // --------------------------------------------------------------------------
  async getEuropeanStandings(competitionId = 'comp-champions-league-2026', seasonId = 'season-2026-27'): Promise<{
    competitionId: string;
    seasonId: string;
    standings: any[];
    source: string;
    degraded: boolean;
  }> {
    return request(`/api/admin/european/standings?competitionId=${competitionId}&seasonId=${seasonId}`, {
      skipCache: true,
    });
  },

  async rebuildEuropeanStandings(competitionId = 'comp-champions-league-2026', seasonId = 'season-2026-27'): Promise<any> {
    const res = await request('/api/admin/european/standings/rebuild', {
      method: 'POST',
      body: JSON.stringify({ competitionId, seasonId }),
      skipCache: true,
    });
    invalidateClientCache();
    return res;
  },

  async previewEuropeanQualification(seasonId = 'season-2026-27', mode: 'provisional' | 'final' = 'provisional'): Promise<any> {
    return request(`/api/admin/european/qualification/preview?seasonId=${seasonId}&mode=${mode}`, {
      skipCache: true,
    });
  },

  async applyEuropeanQualification(params: { previewToken: string; confirmation: boolean; seasonId?: string }): Promise<any> {
    const res = await request('/api/admin/european/qualification/apply', {
      method: 'POST',
      body: JSON.stringify(params),
      skipCache: true,
    });
    invalidateClientCache();
    return res;
  },

  // --------------------------------------------------------------------------
  // ADMIN TELEGRAM BOT NOTIFICATIONS
  // --------------------------------------------------------------------------
  async getNotificationRecipients(params?: { audience?: string; leagueId?: string; seasonId?: string }): Promise<{
    total: number;
    recipients: Array<{
      userId: string;
      username: string;
      displayName: string;
      clubId?: string;
      clubName?: string;
      leagueId?: string;
      leagueName?: string;
      hasTelegram: boolean;
      messageable: boolean;
    }>;
  }> {
    const query = new URLSearchParams();
    if (params?.audience) query.set('audience', params.audience);
    if (params?.leagueId) query.set('leagueId', params.leagueId);
    if (params?.seasonId) query.set('seasonId', params.seasonId);

    return request(`/api/admin/telegram-notifications/recipients?${query.toString()}`, { skipCache: true });
  },

  async sendTelegramBroadcast(params: {
    requestId?: string;
    title: string;
    body: string;
    type: string;
    targetAudience: string;
    targetLeagueId?: string;
    selectedUserIds?: string[];
    seasonId?: string;
  }): Promise<{ success: boolean; message: string; broadcast: any }> {
    return request('/api/admin/telegram-notifications/broadcast', {
      method: 'POST',
      body: JSON.stringify(params),
      skipCache: true,
    });
  },

  async getTelegramBroadcasts(limit = 20): Promise<{ broadcasts: any[] }> {
    return request(`/api/admin/telegram-notifications/broadcasts?limit=${limit}`, { skipCache: true });
  },

  async getTelegramBroadcastDetails(broadcastId: string): Promise<{ broadcast: any }> {
    return request(`/api/admin/telegram-notifications/broadcasts/${broadcastId}`, { skipCache: true });
  },

  async processTelegramQueue(): Promise<any> {
    return request('/api/admin/telegram-notifications/process-queue', { method: 'POST', skipCache: true });
  },
};
