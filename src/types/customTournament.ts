/**
 * Custom Tournaments Types & Interfaces (Foydalanuvchilar Turnirlari)
 */

export type CustomTournamentFormat = 'LEAGUE' | 'PLAYOFF' | 'LEAGUE_AND_PLAYOFF';
export type CustomTournamentStatus = 'DRAFT' | 'REGISTRATION_OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type CustomTournamentVisibility = 'PRIVATE' | 'PUBLIC_OPEN' | 'PUBLIC_MODERATED';
export type CustomTournamentSpectatorAccess = 'MEMBERS_ONLY' | 'PUBLIC_LINK';
export type CustomTournamentLeagueScope = 'TOP5_ALL' | 'SINGLE_LEAGUE';
export type CustomTournamentPlayoffLegMode = 'SINGLE_LEG' | 'TWO_LEG';
export type CustomTournamentGroupStageMode = 'SINGLE_TABLE' | 'GROUPS';

export interface UserTicketAccount {
  userId: string;
  telegramId: string;
  balance: number;
  totalGranted: number;
  totalSpent: number;
  totalRefunded: number;
  updatedAt: string;
}

export interface TicketTransaction {
  id: string;
  userId: string;
  type: 'GRANT' | 'SPEND' | 'REFUND';
  amount: number;
  tournamentId?: string;
  idempotencyKey: string;
  performedByAdminId?: string;
  note?: string;
  createdAt: string;
}

export interface CustomTournamentRulesConfig {
  roundsCount: 1 | 2;
  playoffLegMode: CustomTournamentPlayoffLegMode;
  playoffQualifiersCount?: 2 | 4 | 8 | 16;
  groupStageMode?: CustomTournamentGroupStageMode;
  groupsCount?: 2 | 4;
  matchDurationHours: number;
}

export interface CustomTournament {
  id: string;
  name: string;
  description?: string;
  organizerUserId: string;
  organizerTelegramId: string;
  organizerUsername?: string;
  assistantAdminIds: string[];
  status: CustomTournamentStatus;
  visibility: CustomTournamentVisibility;
  spectatorAccess: CustomTournamentSpectatorAccess;
  inviteToken: string;
  spectatorToken: string;

  format: CustomTournamentFormat;
  leagueScope: CustomTournamentLeagueScope;
  selectedLeagueId?: string;
  maxParticipants: number;
  currentParticipantsCount: number;

  rules: CustomTournamentRulesConfig;

  ticketSpentTransactionId?: string;
  isRefunded?: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  winnerClubId?: string;
  winnerClubName?: string;
  winnerUserId?: string;
}

export interface CustomTournamentParticipant {
  id: string;
  tournamentId: string;
  userId: string;
  telegramId: string;
  username?: string;
  firstName?: string;
  clubId: string;
  clubName: string;
  clubShortName: string;
  clubLogoUrl: string;
  status: 'REGISTERED' | 'DISQUALIFIED' | 'LEFT';
  groupIndex?: number;
  seedNumber?: number;
  joinedAt: string;
}

export type CustomTournamentFixtureStage =
  | 'LEAGUE'
  | 'GROUP_STAGE'
  | 'PLAYOFF_R32'
  | 'PLAYOFF_R16'
  | 'PLAYOFF_QF'
  | 'PLAYOFF_SF'
  | 'PLAYOFF_FINAL'
  | 'PLAYOFF_THIRD_PLACE';

export interface CustomTournamentFixture {
  id: string;
  tournamentId: string;
  stage: CustomTournamentFixtureStage;
  groupIndex?: number;
  roundOrMatchday: number;
  matchIndex: number;
  leg: 1 | 2;
  homeClubId: string | 'BYE';
  awayClubId: string | 'BYE';
  homeClubName: string;
  awayClubName: string;
  homeClubLogoUrl?: string;
  awayClubLogoUrl?: string;
  homeUserId?: string;
  awayUserId?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  penaltyHomeScore?: number | null;
  penaltyAwayScore?: number | null;
  status: 'SCHEDULED' | 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'DISPUTED' | 'BYE_AUTO_ADVANCED';
  winnerClubId?: string | null;
  proofUrl?: string | null;
  submittedByUserId?: string | null;
  confirmedAt?: string | null;
  deadlineAt: string;
  nextMatchFixtureId?: string | null;
}

export interface CustomTournamentStandingsRow {
  position: number;
  clubId: string;
  clubName: string;
  clubShortName: string;
  clubLogoUrl: string;
  userId?: string;
  groupIndex?: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface CustomTournamentAuditLog {
  id: string;
  tournamentId: string;
  action:
    | 'TOURNAMENT_CREATED'
    | 'TOURNAMENT_PUBLISHED'
    | 'TOURNAMENT_STARTED'
    | 'TOURNAMENT_CANCELLED'
    | 'PARTICIPANT_JOINED'
    | 'PARTICIPANT_LEFT'
    | 'PARTICIPANT_DISQUALIFIED'
    | 'ASSISTANT_ADDED'
    | 'ASSISTANT_REMOVED'
    | 'RESULT_OVERRIDDEN'
    | 'DISPUTE_RESOLVED';
  performedByUserId: string;
  details?: Record<string, any>;
  createdAt: string;
}

export interface TournamentFormatPreview {
  format: CustomTournamentFormat;
  participantsCount: number;
  totalMatches: number;
  totalStagesOrRounds: number;
  stagesDescription: string;
  byeCount?: number;
  groupBreakdown?: Array<{
    groupName: string;
    teamsCount: number;
    qualifiersCount: number;
  }>;
}
