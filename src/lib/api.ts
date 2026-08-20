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

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
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

  const isAuthOrMe = endpoint.startsWith('/api/auth') || endpoint.startsWith('/api/me');
  if (isAuthOrMe) {
    console.log(`[REQUEST] ${options.method || 'GET'} ${endpoint} | initData: ${tgInitData ? `YES (length: ${tgInitData.length})` : 'NO'}`);
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      ...options,
      headers,
    });
  } catch (netErr: any) {
    console.error(`[NETWORK ERROR] ${options.method || 'GET'} ${endpoint}:`, netErr.message);
    throw new ApiError(`Network connection failed: ${netErr.message}`, 0);
  }

  const rawText = await response.text();

  if (isAuthOrMe) {
    const safePreview = rawText.length > 100 ? `${rawText.slice(0, 100)}...` : rawText;
    console.log(`[RESPONSE] ${response.status} ${endpoint} | bytes: ${rawText.length} | preview: ${safePreview}`);
  }

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

  return data as T;
}

export const api = {
  // Auth
  async authenticateTelegram(initData: string): Promise<{ success: boolean; user: User; currentClub: Club | null }> {
    return request('/api/auth/telegram', {
      method: 'POST',
      body: JSON.stringify({ initData }),
    });
  },

  async authenticateDev(devUserId: string): Promise<{ success: boolean; user: User; currentClub: Club | null }> {
    return request('/api/auth/dev', {
      method: 'POST',
      body: JSON.stringify({ devUserId }),
    });
  },

  async getDevProfiles(): Promise<{ profiles: Array<{ id: string; username: string; firstName: string; isAdmin: boolean }> }> {
    return request('/api/auth/dev-profiles');
  },

  // Me
  async getMe(seasonId = 'season-2026-27'): Promise<{
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
    return request(`/api/me?seasonId=${seasonId}`);
  },

  async getMyMatches(seasonId = 'season-2026-27', status?: string): Promise<{ fixtures: Fixture[] }> {
    const url = `/api/me/matches?seasonId=${seasonId}${status ? `&status=${status}` : ''}`;
    return request(url);
  },

  async getMyNotifications(): Promise<{ notifications: Notification[] }> {
    return request('/api/me/notifications');
  },

  async markNotificationsRead(): Promise<{ success: boolean }> {
    return request('/api/me/notifications/read', { method: 'POST' });
  },

  // Seasons & Leagues
  async getSeasons(): Promise<{ seasons: Season[] }> {
    return request('/api/seasons');
  },

  async getLeagues(): Promise<{ leagues: League[] }> {
    return request('/api/leagues');
  },

  async getLeagueClubs(leagueId: string, seasonId = 'season-2026-27'): Promise<{ clubs: Club[] }> {
    return request(`/api/leagues/${leagueId}/clubs?seasonId=${seasonId}`);
  },

  // Clubs
  async getClub(clubId: string, seasonId = 'season-2026-27'): Promise<{ club: Club }> {
    return request(`/api/clubs/${clubId}?seasonId=${seasonId}`);
  },

  async claimClub(clubId: string, seasonId = 'season-2026-27'): Promise<{ success: boolean; message: string; club: Club }> {
    return request(`/api/clubs/${clubId}/claim`, {
      method: 'POST',
      body: JSON.stringify({ seasonId }),
    });
  },

  // Competitions
  async getCompetitions(seasonId = 'season-2026-27'): Promise<{ competitions: Competition[] }> {
    return request(`/api/competitions?seasonId=${seasonId}`);
  },

  async getCompetitionStandings(competitionId: string): Promise<{ standings: StandingsRow[] }> {
    return request(`/api/competitions/${competitionId}/standings`);
  },

  async getCompetitionParticipants(competitionId: string): Promise<{ participants: any[] }> {
    return request(`/api/competitions/${competitionId}/participants`);
  },

  async getCompetitionFixtures(competitionId: string, matchday?: number, status?: string): Promise<{ fixtures: Fixture[] }> {
    let url = `/api/competitions/${competitionId}/fixtures?`;
    if (matchday) url += `matchday=${matchday}&`;
    if (status) url += `status=${status}&`;
    return request(url);
  },

  async generateCompetitionFixtures(competitionId: string, force = true): Promise<{ success: boolean; message: string; result: any }> {
    return request(`/api/competitions/${competitionId}/generate-fixtures`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    });
  },

  async resetCompetitionFixtures(competitionId: string): Promise<{ success: boolean; message: string; result: any }> {
    return request(`/api/competitions/${competitionId}/reset-fixtures`, {
      method: 'POST',
    });
  },

  // Fixtures & Results
  async getFixture(fixtureId: string): Promise<{ fixture: Fixture }> {
    return request(`/api/fixtures/${fixtureId}`);
  },

  async submitFixtureResult(
    fixtureId: string,
    homeScore: number,
    awayScore: number,
    proofUrl?: string
  ): Promise<{ success: boolean; message: string; fixture: Fixture }> {
    return request(`/api/fixtures/${fixtureId}/result`, {
      method: 'POST',
      body: JSON.stringify({ homeScore, awayScore, proofUrl }),
    });
  },

  // Admin
  async getAdminDisputes(status = 'OPEN'): Promise<{ disputes: Dispute[] }> {
    return request(`/api/admin/disputes?status=${status}`);
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
    return request(`/api/admin/disputes/${disputeId}/resolve`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async reopenFixture(fixtureId: string, notes?: string): Promise<{ success: boolean; message: string }> {
    return request(`/api/admin/fixtures/${fixtureId}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    });
  },

  async getAdminAuditLogs(limit = 50): Promise<{ logs: AuditLog[] }> {
    return request(`/api/admin/audit-logs?limit=${limit}`);
  },

  async getAdminUsers(): Promise<{ users: User[] }> {
    return request('/api/admin/users');
  },

  async evaluateSeasonQualifications(seasonId = 'season-2026-27'): Promise<{ success: boolean; message: string }> {
    return request('/api/admin/qualifications/evaluate', {
      method: 'POST',
      body: JSON.stringify({ seasonId }),
    });
  },
};
