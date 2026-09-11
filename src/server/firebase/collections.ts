export const COLLECTIONS = {
  USERS: 'users',
  SEASONS: 'seasons',
  LEAGUES: 'leagues',
  CLUBS: 'clubs',
  SEASON_LEAGUE_CLUBS: 'season_league_clubs',
  CLUB_MEMBERSHIPS: 'club_memberships',
  CLUB_OCCUPANCIES: 'club_occupancies',
  USER_MEMBERSHIPS: 'user_memberships',
  COMPETITIONS: 'competitions',
  COMPETITION_PARTICIPANTS: 'competition_participants',
  FIXTURES: 'fixtures',
  RESULT_SUBMISSIONS: 'result_submissions',
  DISPUTES: 'disputes',
  STANDINGS: 'standings',
  NOTIFICATIONS: 'notifications',
  AUDIT_LOGS: 'audit_logs',
  MATCHDAY_LOCKS: 'matchday_locks',
} as const;

export interface FirestoreUserDoc {
  id: string;
  telegramId: string;
  username: string;
  firstName: string;
  lastName: string;
  photoUrl?: string;
  isAdmin: boolean;
  isSuspended: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FirestoreSeasonDoc {
  id: string;
  name: string;
  status: 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  startDate?: string;
  endDate?: string;
  createdAt: string;
}

export interface FirestoreLeagueDoc {
  id: string;
  name: string;
  country: string;
  tier: number;
  logo: string;
  createdAt: string;
}

export interface FirestoreClubDoc {
  id: string;
  name: string;
  shortName: string;
  leagueId: string;
  country: string;
  logo: string;
  isActive: boolean;
  createdAt: string;
  isTaken?: boolean;
  claimedByUserId?: string;
  managerUsername?: string;
}

export interface FirestoreClubMembershipDoc {
  id: string;
  seasonId: string;
  clubId: string;
  userId: string;
  claimedAt: string;
  status: 'active' | 'revoked' | 'transferred';
  updatedAt?: string;
}

export interface FirestoreCompetitionDoc {
  id: string;
  seasonId: string;
  leagueId?: string;
  name: string;
  type: string;
  scheduleMode: string;
  status: string;
  formatConfig?: any;
  hasFixtures?: boolean;
  fixtureCount?: number;
  fixturesCount?: number;
  generationStatus?: string;
  currentMatchday?: number;
  totalMatchdays?: number;
  isMatchdayOpen?: boolean;
  matchdayOpenedAt?: string;
  matchdayDurationHours?: number;
  nextMatchdayOpenAt?: string;
  adminOverrideStatus?: 'AUTO' | 'FORCE_OPEN' | 'FORCE_LOCKED' | 'PAUSED';
  createdAt: string;
  updatedAt?: string;
}

export interface FirestoreMatchdayLockDoc {
  id: string; // Formatted strictly as: `${seasonId}*${competitionId}*${matchday}`
  seasonId: string;
  competitionId: string;
  matchday: number;
  isLocked: boolean;
  isOpen: boolean;
  overrideStatus: 'AUTO' | 'FORCE_OPEN' | 'FORCE_LOCKED' | 'PAUSED';
  openedAt?: string;
  lockedAt?: string;
  expiresAt?: string;
  durationHours?: number;
  updatedAt: string;
  updatedByUserId?: string;
}

export interface FirestoreCompetitionParticipantDoc {
  id: string;
  competitionId: string;
  clubId: string;
  seasonId: string;
  ownerUserId?: string;
  ownerUsername?: string;
  sourceCompetitionId?: string;
  sourceCompetitionName?: string;
  sourcePosition?: number;
  qualificationReason?: string;
  qualificationTimestamp?: string;
  seedNumber?: number;
  createdAt: string;
}

export interface FirestoreFixtureDoc {
  id: string;
  competitionId: string;
  competitionName?: string;
  seasonId: string;
  matchday: number;
  roundName: string;
  homeClubId: string;
  awayClubId: string;
  scheduledAt: string;
  status: string;
  homeScore?: number | null;
  awayScore?: number | null;
  winnerClubId?: string | null;
  resultConfirmedAt?: string | null;
  homeOwnerId?: string;
  awayOwnerId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FirestoreResultSubmissionDoc {
  id: string;
  fixtureId: string;
  submittedByUserId: string;
  clubId: string;
  homeScore: number;
  awayScore: number;
  proofUrl?: string | null;
  createdAt: string;
}

export interface FirestoreDisputeDoc {
  id: string;
  fixtureId: string;
  seasonId: string;
  homeSubmissionId?: string;
  awaySubmissionId?: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'CANCELLED';
  resolutionNotes?: string;
  resolvedByUserId?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface FirestoreNotificationDoc {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface FirestoreStandingsDoc {
  competitionId: string;
  seasonId?: string;
  updatedAt: string;
  rows: import('../../types').StandingsRow[];
  confirmedFixtureIds?: string[];
  totalPlayed?: number;
}

export interface FirestoreAuditLogDoc {
  id: string;
  actorUserId: string;
  actorUsername: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValueJson?: string | null;
  newValueJson?: string | null;
  ipAddress?: string | null;
  createdAt: string;
}
