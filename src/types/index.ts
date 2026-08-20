export type SeasonStatus = 'upcoming' | 'registration' | 'active' | 'completed';

export type MatchStatus =
  | 'SCHEDULED'
  | 'READY'
  | 'PLAYING'
  | 'AWAITING_RESULT'
  | 'PENDING_CONFIRMATION'
  | 'CONFIRMED'
  | 'DISPUTED'
  | 'CANCELLED'
  | 'POSTPONED'
  | 'OVERDUE';

export type CompetitionType =
  | 'LEAGUE'
  | 'KNOCKOUT'
  | 'SUPER_CUP'
  | 'EUROPEAN_LEAGUE_PHASE'
  | 'EUROPEAN_KNOCKOUT';

export type ScheduleMode = 'REAL_SCHEDULE' | 'OFFICIAL_IMPORT' | 'GENERATED_SCHEDULE';

export interface User {
  id: string;
  telegramId: string;
  username: string;
  firstName: string;
  lastName?: string;
  photoUrl?: string;
  isAdmin: boolean;
  isSuspended: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Season {
  id: string;
  name: string;
  status: SeasonStatus;
  startDate: string;
  endDate?: string;
  createdAt: string;
}

export interface League {
  id: string;
  name: string;
  country: string;
  tier: number;
  logoUrl: string;
  totalClubs?: number;
  createdAt: string;
}

export interface Club {
  id: string;
  name: string;
  shortName: string;
  country: string;
  leagueId: string;
  logoUrl: string;
  active: boolean;
  stadium?: string;
  claimedByUserId?: string | null;
  claimedByUsername?: string | null;
  owner?: {
    userId: string;
    username: string;
    firstName: string;
    claimedAt: string;
  } | null;
  createdAt: string;
}

export interface ClubMembership {
  id: string;
  seasonId: string;
  clubId: string;
  userId: string;
  claimedAt: string;
  status: 'active' | 'released' | 'archived';
}

export interface Competition {
  id: string;
  seasonId: string;
  leagueId?: string;
  name: string;
  type: CompetitionType;
  scheduleMode: ScheduleMode;
  status: 'upcoming' | 'active' | 'completed';
  totalTeams?: number;
  formatConfig: {
    rounds?: number;
    homeAndAway?: boolean;
    pointsForWin?: number;
    pointsForDraw?: number;
    pointsForLoss?: number;
    tieBreakers?: Array<'points' | 'goalDifference' | 'goalsFor' | 'headToHead'>;
    maxTeams?: number;
    qualificationSpots?: number;
  };
  createdAt: string;
}

export interface Fixture {
  id: string;
  seasonId: string;
  competitionId: string;
  competitionName?: string;
  matchday: number;
  roundName?: string;
  homeClubId: string;
  awayClubId: string;
  homeClub?: Club;
  awayClub?: Club;
  homeOwnerId?: string;
  awayOwnerId?: string;
  scheduledAt: string;
  status: MatchStatus;
  homeScore?: number | null;
  awayScore?: number | null;
  winnerClubId?: string | null;
  resultConfirmedAt?: string | null;
  submissionsCount?: number;
  userSubmission?: ResultSubmission | null;
  opponentSubmission?: ResultSubmission | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResultSubmission {
  id: string;
  fixtureId: string;
  submittedByUserId: string;
  clubId: string;
  homeScore: number;
  awayScore: number;
  proofUrl?: string;
  createdAt: string;
}

export interface Dispute {
  id: string;
  fixtureId: string;
  seasonId: string;
  fixture?: Fixture;
  homeSubmission?: ResultSubmission;
  awaySubmission?: ResultSubmission;
  status: 'OPEN' | 'RESOLVED' | 'CANCELLED';
  resolvedByUserId?: string;
  resolutionNotes?: string;
  resolvedAt?: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  fixtureId?: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

export interface StandingsRow {
  position: number;
  clubId: string;
  clubName: string;
  shortName: string;
  logoUrl: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  managerUsername?: string;
  form?: Array<'W' | 'D' | 'L'>;
}

export interface AuditLog {
  id: string;
  actorUserId?: string;
  actorUsername?: string;
  actorId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  targetType?: string;
  targetId?: string;
  oldValue?: string;
  newValue?: string;
  notes?: string;
  ipAddress?: string;
  createdAt: string;
}

export interface TelegramAuthPayload {
  initData?: string;
  devUserId?: string;
}
