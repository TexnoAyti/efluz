/**
 * TEAMS (Jamoalar) Ecosystem Types & Interfaces for EFL UZ
 */

export interface TeamMember {
  id: string;
  userId?: string; // EFLUZ user ID if verified/linked
  telegramId?: string; // Telegram ID if verified/linked
  username?: string;
  displayName: string;
  role: 'ADMIN' | 'MEMBER';
  isVerifiedAccount: boolean; // false for legacy/manual text names, true for verified EFLUZ users
  joinedAt: string;
  photoUrl?: string;
}

export interface TeamStats {
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface Team {
  id: string;
  name: string;
  tag: string; // 2-4 letter tag (e.g. UZB, EFL, TBN)
  logoUrl?: string;
  description?: string;
  creatorUserId: string; // Team Administrator
  creatorTelegramId: string;
  creatorUsername?: string;
  ticketTransactionId: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'SUSPENDED';
  roster: TeamMember[];
  stats: TeamStats;
  createdAt: string;
  updatedAt: string;
}

export interface TeamTicketAccount {
  userId: string;
  telegramId: string;
  balance: number; // active team creation tickets
  totalGranted: number;
  totalSpent: number;
  totalRefunded: number;
  updatedAt: string;
}

export interface TeamTicketTransaction {
  id: string;
  userId: string;
  type: 'GRANT' | 'SPEND' | 'REFUND';
  amount: number;
  teamId?: string;
  idempotencyKey: string;
  performedByAdminId?: string; // e.g. 5209126900
  note?: string;
  createdAt: string;
}

export type TeamInvitationStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

export interface TeamInvitation {
  id: string;
  teamId: string;
  teamName: string;
  teamTag: string;
  teamLogoUrl?: string;
  inviterUserId: string;
  inviterDisplayName: string;
  inviteeUserId: string;
  inviteeTelegramId: string;
  inviteeUsername?: string;
  inviteeDisplayName: string;
  legacyRosterMemberId?: string; // if linking an existing legacy unverified slot
  status: TeamInvitationStatus;
  sentAt: string;
  respondedAt?: string;
  expiresAt: string;
}
