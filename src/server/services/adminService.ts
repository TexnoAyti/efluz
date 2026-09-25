import {
  getDisputesFirestore,
  resolveDisputeFirestore,
  reopenFixtureFirestore,
  getAllUsersFirestore,
  getAuditLogsFirestore,
  createAuditLogFirestore,
  adminEditFixtureResultFirestore,
  adminDeleteFixtureResultFirestore,
  adminDeleteFixtureFirestore,
  adminSetUserAdminFirestore,
  adminSetUserSuspensionFirestore,
  adminDeleteUserFirestore,
  adminGetUserDetailFirestore,
  adminGetResultSubmissionsFirestore,
  adminDeleteResultSubmissionFirestore,
} from '../firebase/firestoreStore';
import { Dispute, AuditLog, User, Fixture } from '../../types';

export async function createAuditLog(
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  oldValue?: any,
  newValue?: any,
  ipAddress?: string,
  actorUsername?: string,
  notes?: string
): Promise<void> {
  await createAuditLogFirestore(actorUserId, action, entityType, entityId, oldValue, newValue, ipAddress, actorUsername, notes);
}

export async function getDisputes(status = 'OPEN'): Promise<Dispute[]> {
  return await getDisputesFirestore(status);
}

export async function resolveDispute(
  adminUserId: string,
  disputeId: string,
  params: {
    action: 'CONFIRM_HOME_SUBMISSION' | 'CONFIRM_AWAY_SUBMISSION' | 'MANUAL_SCORE' | 'CANCEL_MATCH';
    manualHomeScore?: number;
    manualAwayScore?: number;
    notes?: string;
  }
): Promise<{ success: boolean; dispute: Dispute }> {
  return await resolveDisputeFirestore(adminUserId, disputeId, params);
}

export async function reopenFixture(
  adminUserId: string,
  fixtureId: string,
  notes?: string
): Promise<{ success: boolean }> {
  return await reopenFixtureFirestore(adminUserId, fixtureId, notes);
}

export async function editFixtureResult(
  adminUserId: string,
  adminUsername: string,
  fixtureId: string,
  params: {
    homeScore: number;
    awayScore: number;
    status?: string;
    notes?: string;
    idempotencyKey?: string;
  }
): Promise<{ success: boolean; message: string; fixture: Fixture; pendingSync?: boolean }> {
  return await adminEditFixtureResultFirestore(adminUserId, adminUsername, fixtureId, params);
}

export async function deleteFixtureResult(
  adminUserId: string,
  adminUsername: string,
  fixtureId: string,
  options?: {
    deleteSubmissions?: boolean;
    notes?: string;
    idempotencyKey?: string;
  }
): Promise<{ success: boolean; message: string; fixture: Fixture; pendingSync?: boolean }> {
  return await adminDeleteFixtureResultFirestore(adminUserId, adminUsername, fixtureId, options);
}


export async function deleteFixture(
  adminUserId: string,
  adminUsername: string,
  fixtureId: string,
  reason: string
): Promise<{ success: boolean; message: string }> {
  return await adminDeleteFixtureFirestore(adminUserId, adminUsername, fixtureId, reason);
}

export async function getAllAdminUsers(): Promise<User[]> {
  return await getAllUsersFirestore();
}

export async function getUserDetail(targetUserId: string): Promise<any> {
  return await adminGetUserDetailFirestore(targetUserId);
}

export async function setUserAdminRole(
  adminUserId: string,
  adminUsername: string,
  targetUserId: string,
  isAdmin: boolean
): Promise<{ success: boolean; message: string; user: User }> {
  return await adminSetUserAdminFirestore(adminUserId, adminUsername, targetUserId, isAdmin);
}

export async function setUserSuspension(
  adminUserId: string,
  adminUsername: string,
  targetUserId: string,
  isSuspended: boolean,
  reason?: string
): Promise<{ success: boolean; message: string; user: User }> {
  return await adminSetUserSuspensionFirestore(adminUserId, adminUsername, targetUserId, isSuspended, reason);
}

export async function deleteUser(
  adminUserId: string,
  adminUsername: string,
  targetUserId: string,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  return await adminDeleteUserFirestore(adminUserId, adminUsername, targetUserId, reason);
}

export async function getResultSubmissions(filter?: {
  fixtureId?: string;
  userId?: string;
  limit?: number;
}): Promise<any[]> {
  return await adminGetResultSubmissionsFirestore(filter);
}

export async function deleteResultSubmission(
  adminUserId: string,
  adminUsername: string,
  submissionId: string,
  notes?: string
): Promise<{ success: boolean; message: string }> {
  return await adminDeleteResultSubmissionFirestore(adminUserId, adminUsername, submissionId, notes);
}

export async function getAuditLogs(limit = 50): Promise<AuditLog[]> {
  return await getAuditLogsFirestore(limit);
}

