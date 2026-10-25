/**
 * Client API wrapper for TEAMS (Jamoalar) Ecosystem
 */

import { Team, TeamInvitation, TeamTicketAccount } from '../types/team';

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.method && options.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }

  // Ensure authorization header is passed from localStorage if present
  const token = localStorage.getItem('efl:auth_token') || localStorage.getItem('token');
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error: any = new Error(data.error || data.message || `Request failed with status ${res.status}`);
    error.status = res.status;
    error.statusCode = res.status;
    error.code = data.code;
    error.data = data;
    error.groupUsername = data.groupUsername;
    error.groupUrl = data.groupUrl;
    throw error;
  }

  return data;
}

export const teamsApi = {
  // Teams directory
  async getTeams(search?: string): Promise<Team[]> {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';
    const res = await request<{ ok: boolean; teams: Team[] }>(`/api/teams${query}`);
    return res.teams || [];
  },

  async getTeamById(id: string): Promise<Team> {
    const res = await request<{ ok: boolean; team: Team }>(`/api/teams/${id}`);
    return res.team;
  },

  async createTeam(params: {
    name: string;
    tag: string;
    logoUrl?: string;
    description?: string;
    idempotencyKey?: string;
  }): Promise<Team> {
    const res = await request<{ ok: boolean; team: Team }>('/api/teams', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return res.team;
  },

  async updateTeam(id: string, updates: Partial<Pick<Team, 'name' | 'tag' | 'logoUrl' | 'description'>>): Promise<Team> {
    const res = await request<{ ok: boolean; team: Team }>(`/api/teams/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    return res.team;
  },

  // Tickets
  async getMyTicketBalance(): Promise<TeamTicketAccount> {
    const res = await request<{ ok: boolean; account: TeamTicketAccount }>('/api/teams/tickets/balance');
    return res.account;
  },

  async checkUserTickets(userId: string): Promise<TeamTicketAccount> {
    const res = await request<{ ok: boolean; account: TeamTicketAccount }>(`/api/teams/tickets/check/${userId}`);
    return res.account;
  },

  // Invitations
  async getMyPendingInvitations(): Promise<TeamInvitation[]> {
    const res = await request<{ ok: boolean; invitations: TeamInvitation[] }>('/api/teams/my-invitations');
    return res.invitations || [];
  },

  async getTeamInvitations(teamId: string): Promise<TeamInvitation[]> {
    const res = await request<{ ok: boolean; invitations: TeamInvitation[] }>(`/api/teams/${teamId}/invitations`);
    return res.invitations || [];
  },

  async inviteUser(teamId: string, params: { targetUserId?: string; targetSelector?: string; legacyRosterMemberId?: string }): Promise<TeamInvitation> {
    const res = await request<{ ok: boolean; invitation: TeamInvitation }>(`/api/teams/${teamId}/invitations`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return res.invitation;
  },

  async respondToInvitation(invitationId: string, accept: boolean): Promise<{ success: boolean; message: string; team?: Team }> {
    return request<{ success: boolean; message: string; team?: Team }>(`/api/teams/invitations/${invitationId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ accept }),
    });
  },

  async cancelInvitation(invitationId: string): Promise<void> {
    await request(`/api/teams/invitations/${invitationId}/cancel`, {
      method: 'POST',
    });
  },
};
