/**
 * EFL UZ Authoritative Database Repository Abstraction
 * Production source of truth: FirestoreRepository (Firebase Firestore Admin SDK)
 */

import {
  getAllSeasonsFirestore,
  getActiveSeasonFirestore,
  getAllLeaguesFirestore,
  getClubsByLeagueFirestore,
  getAvailableClubsFirestore,
  getClubByIdFirestore,
  getUserActiveClubFirestore,
  claimClubAtomicFirestore,
  getAllCompetitionsFirestore,
  getCompetitionByIdFirestore,
  getFixturesFirestore,
  getFixtureByIdFirestore,
  generateCompetitionFixturesFirestore,
  submitFixtureResultFirestore,
  calculateCompetitionStandingsFirestore,
  getDisputesFirestore,
  resolveDisputeFirestore,
  reopenFixtureFirestore,
  getAllUsersFirestore,
  getAuditLogsFirestore,
  createAuditLogFirestore,
  createNotificationFirestore,
  getUserNotificationsFirestore,
  markNotificationsReadFirestore,
} from '../firebase/firestoreStore';
import { Club, Competition, Fixture, League, Season, StandingsRow, User, Dispute, AuditLog, Notification } from '../../types';

export interface IDatabaseRepository {
  readonly name: string;
  
  // Seasons & Leagues
  getSeasons(): Promise<Season[]>;
  getActiveSeason(): Promise<Season | null>;
  getLeagues(): Promise<League[]>;

  // Clubs & Occupancy
  getClubsByLeague(leagueId: string, seasonId?: string, currentUserId?: string): Promise<Club[]>;
  getAvailableClubs(seasonId?: string, currentUserId?: string): Promise<Club[]>;
  getClubById(clubId: string, seasonId?: string, currentUserId?: string): Promise<Club | null>;
  getUserActiveClub(userId: string, seasonId?: string): Promise<Club | null>;
  claimClubAtomic(userId: string, clubId: string, seasonId?: string): Promise<{ success: boolean; club: Club }>;

  // Competitions & Fixtures
  getCompetitions(seasonId?: string): Promise<Competition[]>;
  getCompetitionById(id: string): Promise<Competition | null>;
  getFixtures(filter: { competitionId?: string; seasonId?: string; matchday?: number; status?: string; userId?: string; clubId?: string; limit?: number }): Promise<Fixture[]>;
  getFixtureById(id: string, currentUserId?: string): Promise<Fixture | null>;
  generateFixtures(competitionId: string, options?: { force?: boolean }): Promise<{ generated: number; matchdays: number }>;
  
  // Results & Standings
  submitResult(userId: string, fixtureId: string, homeScore: number, awayScore: number, proofUrl?: string): Promise<Fixture>;
  getStandings(competitionId: string): Promise<StandingsRow[]>;

  // Admin & Auditing
  getDisputes(status?: string): Promise<Dispute[]>;
  resolveDispute(adminUserId: string, disputeId: string, params: any): Promise<{ success: boolean; dispute: any }>;
  reopenFixture(adminUserId: string, fixtureId: string, notes?: string): Promise<{ success: boolean }>;
  getUsers(): Promise<User[]>;
  getAuditLogs(limit?: number): Promise<AuditLog[]>;
  createAuditLog(actorUserId: string, action: string, entityType: string, entityId: string, oldValue?: any, newValue?: any, ipAddress?: string): Promise<void>;

  // Notifications
  getNotifications(userId: string, limit?: number): Promise<Notification[]>;
  createNotification(userId: string, type: string, title: string, message: string, data?: Record<string, unknown>): Promise<void>;
  markNotificationsRead(userId: string): Promise<void>;
}

export class FirestoreRepository implements IDatabaseRepository {
  readonly name = 'FirestoreRepository (Authoritative Production DB)';

  getSeasons = getAllSeasonsFirestore;
  getActiveSeason = getActiveSeasonFirestore;
  getLeagues = getAllLeaguesFirestore;

  getClubsByLeague = getClubsByLeagueFirestore;
  getAvailableClubs = getAvailableClubsFirestore;
  getClubById = getClubByIdFirestore;
  getUserActiveClub = getUserActiveClubFirestore;
  claimClubAtomic = claimClubAtomicFirestore;

  getCompetitions = getAllCompetitionsFirestore;
  getCompetitionById = getCompetitionByIdFirestore;
  getFixtures = getFixturesFirestore;
  getFixtureById = getFixtureByIdFirestore;
  generateFixtures = generateCompetitionFixturesFirestore;

  submitResult = submitFixtureResultFirestore;
  getStandings = calculateCompetitionStandingsFirestore;

  getDisputes = getDisputesFirestore;
  resolveDispute = resolveDisputeFirestore;
  reopenFixture = reopenFixtureFirestore;
  getUsers = getAllUsersFirestore;
  getAuditLogs = getAuditLogsFirestore;
  createAuditLog = createAuditLogFirestore;

  getNotifications = getUserNotificationsFirestore;
  createNotification = createNotificationFirestore;
  markNotificationsRead = markNotificationsReadFirestore;
}

// Singleton Production Repository
export const dbRepository: IDatabaseRepository = new FirestoreRepository();
