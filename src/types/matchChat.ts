export type MatchChatKind = 'fixture' | 'uzeflife';

export interface MatchChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
}

export interface MatchChatView {
  roomId: string;
  kind: MatchChatKind;
  matchId: string;
  title: string;
  subtitle: string;
  opponentId: string;
  opponentName: string;
  opponentUsername?: string | null;
  messages: MatchChatMessage[];
  unreadCount: number;
  blocked: boolean;
  blockedByMe: boolean;
  closed: boolean;
  reportedByMe: boolean;
  canSend: boolean;
  quickMessages: string[];
  updatedAt: string;
}

export interface MatchChatAdminReport {
  roomId: string;
  kind: MatchChatKind;
  matchId: string;
  title: string;
  participantNames: string[];
  reportId: string;
  reporterId: string;
  reason: string;
  createdAt: string;
  status: 'OPEN' | 'RESOLVED';
  lastMessageAt: string | null;
  blocked: boolean;
  messages: MatchChatMessage[];
}
