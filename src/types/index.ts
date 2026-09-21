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

export interface ClubOccupancy {
  status: 'occupied' | 'owned' | 'available';
  userId?: string;
  username?: string;
}

export interface Club {
  id: string;
  name: string;
  shortName: string;
  country: string;
  leagueId: string;
  leagueName?: string;
  logoUrl: string;
  active: boolean;
  isTaken?: boolean;
  isCurrentUserClub?: boolean;
  occupancy?: ClubOccupancy;
  stadium?: string;
  claimedByUserId?: string | null;
  claimedByUsername?: string | null;
  managerUsername?: string;
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
  hasFixtures?: boolean;
  fixtureCount?: number;
  fixturesCount?: number;
  generationStatus?: 'not_generated' | 'generated';
  currentMatchday?: number;
  totalMatchdays?: number;
  isMatchdayOpen?: boolean;
  matchdayOpenedAt?: string;
  matchdayDurationHours?: number;
  nextMatchdayOpenAt?: string;
  adminOverrideStatus?: 'AUTO' | 'FORCE_OPEN' | 'FORCE_LOCKED' | 'PAUSED';
  formatConfig: {
    rounds?: number;
    homeAndAway?: boolean;
    pointsForWin?: number;
    pointsForDraw?: number;
    pointsForLoss?: number;
    tieBreakers?: Array<'points' | 'goalDifference' | 'goalsFor' | 'headToHead'>;
    maxTeams?: number;
    qualificationSpots?: number;
    leaguePhaseTeams?: number;
    matchesPerTeam?: number;
    directQualifiers?: number;
    playoffTeams?: number;
    knockoutTeams?: number;
    totalClubs?: number;
    teams?: number;
    singleLeg?: boolean;
    extraTime?: boolean;
    penalties?: boolean;
  };
  createdAt: string;
}

export interface FixtureOwnerInfo {
  userId: string;
  telegramId?: string;
  username: string | null;
  displayName: string;
}

export interface FixtureUserInfo {
  id: string;
  userId?: string;
  telegramId?: string;
  username: string;
  displayName: string;
}

export interface Fixture {
  id: string;
  seasonId: string;
  competitionId: string;
  competitionName?: string;
  matchday: number;
  roundName?: string;
  homeClubId: string | null;
  awayClubId: string | null;
  homeClub?: Club | null;
  awayClub?: Club | null;
  sourceFixtureId?: string | null;
  sourceWinnerSlot?: 'home' | 'away' | string | null;
  homeSourceFixtureId?: string | null;
  awaySourceFixtureId?: string | null;
  homeSourceWinnerSlot?: string | null;
  awaySourceWinnerSlot?: string | null;
  homeUser?: FixtureUserInfo | null;
  awayUser?: FixtureUserInfo | null;
  homeOwner?: FixtureOwnerInfo | null;
  awayOwner?: FixtureOwnerInfo | null;
  activeMatchday?: number;
  isPlayable?: boolean;
  nextMatchdayOpenAt?: string | null;
  matchdayOpenedAt?: string | null;
  homeOwnerId?: string;
  awayOwnerId?: string;
  scheduledAt: string;
  status: MatchStatus;
  homeScore?: number | null;
  awayScore?: number | null;
  winnerClubId?: string | null;
  proofUrl?: string | null;
  resultConfirmedAt?: string | null;
  submittedByUserId?: string | null;
  submissionsCount?: number;
  userSubmission?: MatchSubmission | ResultSubmission;
  opponentSubmission?: MatchSubmission | ResultSubmission;
  createdAt: string;
  updatedAt: string;
}

export interface MatchSubmission {
  id: string;
  fixtureId: string;
  userId?: string;
  submittedByUserId?: string;
  clubId: string;
  homeScore: number;
  awayScore: number;
  proofUrl?: string;
  createdAt: string;
}

export interface Dispute {
  id: string;
  fixtureId: string;
  seasonId?: string;
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED';
  homeSubmission?: MatchSubmission;
  awaySubmission?: MatchSubmission;
  fixture?: Fixture;
  resolutionType?: string;
  resolvedByAdminId?: string;
  resolvedByUserId?: string;
  resolvedAt?: string;
  resolutionNotes?: string;
  createdAt: string;
}

export interface StandingEntry {
  rank: number;
  clubId: string;
  club: Club;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: Array<'W' | 'D' | 'L'>;
}

export interface StandingsRow {
  position: number;
  clubId: string;
  clubName: string;
  shortName: string;
  logoUrl?: string;
  managerUserId?: string;
  managerUsername?: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: Array<'W' | 'D' | 'L'>;
}

export interface ResultSubmission {
  id: string;
  fixtureId: string;
  userId?: string;
  submittedByUserId?: string;
  clubId: string;
  homeScore: number;
  awayScore: number;
  proofUrl?: string | null;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type:
    | 'MATCH_SCHEDULED'
    | 'RESULT_SUBMITTED'
    | 'RESULT_CONFIRMED'
    | 'DISPUTE_OPENED'
    | 'DISPUTE_RESOLVED'
    | 'CLUB_ASSIGNED'
    | 'NEXT_ROUND_MATCH'
    | 'QUALIFICATION_CONFIRMED'
    | 'COMPETITION_UPDATE'
    | 'SYSTEM';
  entityType?: string;
  entityId?: string;
  fixtureId?: string;
  isRead: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorId?: string;
  actorUserId?: string;
  actorUsername?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  entityType?: string;
  entityId?: string;
  oldValue?: any;
  newValue?: any;
  ipAddress?: string;
  notes?: string;
  createdAt: string;
}

export interface UserStats {
  matchesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  goalsScored: number;
  goalsConceded: number;
  points: number;
  trophies: number;
  leaguePosition: number;
}
