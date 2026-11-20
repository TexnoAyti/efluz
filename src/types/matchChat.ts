export type MatchChatKind = 'fixture' | 'uzeflife';

export interface MatchChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
  avatarUrl?: string | null;
  replyTo?: { id: string; senderName: string; text: string } | null;
  replyToId?: string;
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
  viewerSide?: 'home' | 'away';
  opponentPhotoUrl?: string | null;
  messages: MatchChatMessage[];
  unreadCount: number;
  blocked: boolean;
  blockedByMe: boolean;
  closed: boolean;
  reportedByMe: boolean;
  canSend: boolean;
  quickMessages: string[];
  updatedAt: string;
  pinnedMessage?: MatchChatMessage | null;
  pinnedMessageId?: string | null;
  opponentReadThroughId?: string | null;
  opponentTyping?: boolean;
  matchInfo?: {homeName:string;awayName:string;homeLogoUrl?:string|null;awayLogoUrl?:string|null;homeScore:number|null;awayScore:number|null;status:string;matchday:number;viewerSide?:'home'|'away'} | null;
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
