/**
 * Custom Tournaments Client API
 */

import {
  CustomTournament,
  CustomTournamentParticipant,
  CustomTournamentFixture,
  CustomTournamentStandingsRow,
  CustomTournamentAuditLog,
  UserTicketAccount,
  TicketTransaction,
  TournamentFormatPreview,
} from '../types/customTournament';

function getAuthHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('efootball_session_token') : null;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const devUserId = typeof window !== 'undefined' ? localStorage.getItem('efootball_dev_user_id') : null;
  if (devUserId) headers['x-dev-user-id'] = devUserId;

  const tgData = typeof window !== 'undefined'
    ? (window as any).Telegram?.WebApp?.initData || sessionStorage.getItem('efootball_tg_init_data')
    : null;
  if (tgData) headers['x-telegram-init-data'] = tgData;

  return headers;
}

export const customTournamentApi = {
  async getPublicTournaments(limit = 20): Promise<CustomTournament[]> {
    const res = await fetch(`/api/custom-tournaments?limit=${limit}`, {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Turnirlarni yuklab bo‘lmadi.');
    return data.tournaments || [];
  },

  async getMyTournaments(): Promise<CustomTournament[]> {
    const res = await fetch('/api/custom-tournaments/my', {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Mening turnirlarimni yuklab bo‘lmadi.');
    return data.tournaments || [];
  },

  async getTournamentPreview(params: {
    format: string;
    participantsCount: number;
    roundsCount?: number;
    playoffLegMode?: string;
    playoffQualifiersCount?: number;
    groupStageMode?: string;
    groupsCount?: number;
  }): Promise<TournamentFormatPreview> {
    const search = new URLSearchParams({
      format: params.format,
      participantsCount: String(params.participantsCount),
      roundsCount: String(params.roundsCount || 1),
      playoffLegMode: params.playoffLegMode || 'SINGLE_LEG',
      ...(params.playoffQualifiersCount ? { playoffQualifiersCount: String(params.playoffQualifiersCount) } : {}),
      ...(params.groupStageMode ? { groupStageMode: params.groupStageMode } : {}),
      ...(params.groupsCount ? { groupsCount: String(params.groupsCount) } : {}),
    });
    const res = await fetch(`/api/custom-tournaments/preview?${search.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Preview generatsiya qilib bo‘lmadi.');
    return data.preview;
  },

  async getTournamentDetails(id: string, token?: string): Promise<{
    tournament: CustomTournament;
    participants: CustomTournamentParticipant[];
    fixtures: CustomTournamentFixture[];
    standings?: CustomTournamentStandingsRow[];
    canManage: boolean;
  }> {
    const search = token ? `?token=${encodeURIComponent(token)}` : '';
    const res = await fetch(`/api/custom-tournaments/${id}${search}`, {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Turnir ma’lumotlarini yuklab bo‘lmadi.');
    return data;
  },

  async createDraft(payload: any): Promise<CustomTournament> {
    const res = await fetch('/api/custom-tournaments/draft', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Qoralamani yaratib bo‘lmadi.');
    return data.tournament;
  },

  async publishTournament(id: string, idempotencyKey?: string): Promise<CustomTournament> {
    const res = await fetch(`/api/custom-tournaments/${id}/publish`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ idempotencyKey }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Turnirni e’lon qilib bo‘lmadi.');
    return data.tournament;
  },

  async joinClub(tournamentId: string, clubId: string): Promise<CustomTournamentParticipant> {
    const res = await fetch(`/api/custom-tournaments/${tournamentId}/join`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ clubId }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Klubni band qilib bo‘lmadi.');
    return data.participant;
  },

  async leaveTournament(tournamentId: string): Promise<{ success: boolean; freedClubId: string }> {
    const res = await fetch(`/api/custom-tournaments/${tournamentId}/leave`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Turnirdan chiqib bo‘lmadi.');
    return data;
  },

  async startTournament(tournamentId: string): Promise<{ tournament: CustomTournament; fixturesCount: number }> {
    const res = await fetch(`/api/custom-tournaments/${tournamentId}/start`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Turnirni boshlab bo‘lmadi.');
    return data;
  },

  async submitMatchResult(
    tournamentId: string,
    matchId: string,
    payload: {
      homeScore: number;
      awayScore: number;
      penaltyHomeScore?: number;
      penaltyAwayScore?: number;
      proofUrl?: string;
    }
  ): Promise<{ fixture: CustomTournamentFixture }> {
    const res = await fetch(`/api/custom-tournaments/${tournamentId}/matches/${matchId}/result`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Natijani yuborib bo‘lmadi.');
    return data;
  },

  async correctMatchScore(
    tournamentId: string,
    matchId: string,
    payload: {
      homeScore: number;
      awayScore: number;
      penaltyHomeScore?: number;
      penaltyAwayScore?: number;
      note?: string;
    }
  ): Promise<{ fixture: CustomTournamentFixture }> {
    const res = await fetch(`/api/custom-tournaments/${tournamentId}/matches/${matchId}/correct`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Natijani tuzatib bo‘lmadi.');
    return data;
  },

  async updateAssistants(
    tournamentId: string,
    assistantUserId: string,
    action: 'ADD' | 'REMOVE'
  ): Promise<{ assistantAdminIds: string[] }> {
    if (action === 'ADD') {
      const res = await fetch(`/api/custom-tournaments/${tournamentId}/assistants`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ assistantUserId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Yordamchi adminni qo‘shib bo‘lmadi.');
      return data;
    } else {
      const res = await fetch(`/api/custom-tournaments/${tournamentId}/assistants/${assistantUserId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'Yordamchi adminni o‘chirib bo‘lmadi.');
      return data;
    }
  },

  async getAuditLogs(tournamentId: string): Promise<CustomTournamentAuditLog[]> {
    const res = await fetch(`/api/custom-tournaments/${tournamentId}/audit-logs`, {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Audit tarixini yuklab bo‘lmadi.');
    return data.logs || [];
  },

  // Tickets
  async getTicketBalance(): Promise<UserTicketAccount> {
    const res = await fetch('/api/custom-tournaments/tickets/balance', {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Balansni yuklab bo‘lmadi.');
    return data.account;
  },

  async grantTickets(payload: {
    targetUserId: string;
    targetTelegramId?: string;
    amount: number;
    note?: string;
  }): Promise<{ account: UserTicketAccount; transactionId: string }> {
    const res = await fetch('/api/admin/custom-tournaments/tickets/grant', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Chipta berib bo‘lmadi.');
    return data;
  },

  async refundTicket(payload: {
    targetUserId: string;
    tournamentId: string;
    note?: string;
  }): Promise<{ account: UserTicketAccount; transactionId: string }> {
    const res = await fetch('/api/admin/custom-tournaments/tickets/refund', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Chiptani qaytarib bo‘lmadi.');
    return data;
  },

  async getTicketTransactions(userId?: string): Promise<TicketTransaction[]> {
    const search = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    const res = await fetch(`/api/admin/custom-tournaments/tickets/transactions${search}`, {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Tranzaksiyalarni yuklab bo‘lmadi.');
    return data.transactions || [];
  },
};
