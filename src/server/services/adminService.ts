import {
  getDisputesFirestore,
  resolveDisputeFirestore,
  reopenFixtureFirestore,
  getAllUsersFirestore,
  getAuditLogsFirestore,
  createAuditLogFirestore,
} from '../firebase/firestoreStore';
import { Dispute, AuditLog, User } from '../../types';

export async function createAuditLog(
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  oldValue?: any,
  newValue?: any,
  ipAddress?: string
): Promise<void> {
  await createAuditLogFirestore(actorUserId, action, entityType, entityId, oldValue, newValue, ipAddress);
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

export async function getAllAdminUsers(): Promise<User[]> {
  return await getAllUsersFirestore();
}

export async function getAuditLogs(limit = 50): Promise<AuditLog[]> {
  return await getAuditLogsFirestore(limit);
}
