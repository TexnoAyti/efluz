/**
 * Team Creation Ticket & Quota Management Service
 *
 * Rules:
 * 1. Only Primary Owner (Telegram ID: 5209126900) can grant or revoke team tickets.
 * 2. 1 team ticket = 1 team creation.
 * 3. Atomic deduction with idempotency protection against double-charges or duplicate team creation.
 * 4. Separate and isolated from personal tournament tickets.
 * 5. Complete durable transaction audit log in Firestore / test storage.
 */

import { getFirestoreDb } from '../firebase/admin';
import { TeamTicketAccount, TeamTicketTransaction } from '../../types/team';

export const PRIMARY_OWNER_TELEGRAM_ID = '5209126900';

export function isPrimaryOwner(telegramId: string | number | undefined | null): boolean {
  if (telegramId === undefined || telegramId === null) return false;
  return String(telegramId).trim() === PRIMARY_OWNER_TELEGRAM_ID;
}

// In-memory fallback storage for offline test runs
const memoryTeamTicketAccounts = new Map<string, TeamTicketAccount>();
const memoryTeamTicketTransactions = new Map<string, TeamTicketTransaction>();

export function clearMemoryTeamTicketStore(): void {
  memoryTeamTicketAccounts.clear();
  memoryTeamTicketTransactions.clear();
}

/**
 * Gets a user's current team creation ticket balance.
 */
export async function getUserTeamTicketBalance(userId: string): Promise<TeamTicketAccount> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  if (isFallback) {
    const existing = memoryTeamTicketAccounts.get(userId);
    if (existing) return { ...existing };
    return {
      userId,
      telegramId: '',
      balance: 0,
      totalGranted: 0,
      totalSpent: 0,
      totalRefunded: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  const db = getFirestoreDb();
  const docRef = db.collection('team_ticket_accounts').doc(userId);
  const snap = await docRef.get();

  if (!snap.exists) {
    return {
      userId,
      telegramId: '',
      balance: 0,
      totalGranted: 0,
      totalSpent: 0,
      totalRefunded: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  return snap.data() as TeamTicketAccount;
}

/**
 * Grants team creation ticket(s) to a user. Strictly requires Primary Owner (5209126900).
 */
export async function grantUserTeamTickets(params: {
  targetUserId: string;
  targetTelegramId?: string;
  adminTelegramId: string | number;
  amount: number;
  note?: string;
}): Promise<{ success: boolean; account: TeamTicketAccount; transactionId: string }> {
  if (!isPrimaryOwner(params.adminTelegramId)) {
    throw Object.assign(new Error('Faqat loyiha egasi (Telegram ID: 5209126900) team ochish uchun ticket bera oladi.'), {
      statusCode: 403,
      code: 'OWNER_ONLY_UNAUTHORIZED',
    });
  }

  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw Object.assign(new Error('Chipta miqdori musbat butun son bo‘lishi kerak.'), {
      statusCode: 400,
      code: 'INVALID_AMOUNT',
    });
  }

  const now = new Date().toISOString();
  const txId = `tx_team_grant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const idempotencyKey = `team_grant_${params.targetUserId}_${txId}`;

  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  if (isFallback) {
    const current = memoryTeamTicketAccounts.get(params.targetUserId) || {
      userId: params.targetUserId,
      telegramId: params.targetTelegramId || '',
      balance: 0,
      totalGranted: 0,
      totalSpent: 0,
      totalRefunded: 0,
      updatedAt: now,
    };

    current.balance += params.amount;
    current.totalGranted += params.amount;
    current.updatedAt = now;
    if (params.targetTelegramId) current.telegramId = params.targetTelegramId;

    memoryTeamTicketAccounts.set(params.targetUserId, current);

    const tx: TeamTicketTransaction = {
      id: txId,
      userId: params.targetUserId,
      type: 'GRANT',
      amount: params.amount,
      idempotencyKey,
      performedByAdminId: String(params.adminTelegramId),
      note: params.note || 'Team ticket grant by primary owner',
      createdAt: now,
    };
    memoryTeamTicketTransactions.set(txId, tx);

    return { success: true, account: { ...current }, transactionId: txId };
  }

  const db = getFirestoreDb();
  const userRef = db.collection('team_ticket_accounts').doc(params.targetUserId);
  const txRef = db.collection('team_ticket_transactions').doc(txId);

  const updatedAccount = await db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    const existing: TeamTicketAccount = userDoc.exists
      ? (userDoc.data() as TeamTicketAccount)
      : {
          userId: params.targetUserId,
          telegramId: params.targetTelegramId || '',
          balance: 0,
          totalGranted: 0,
          totalSpent: 0,
          totalRefunded: 0,
          updatedAt: now,
        };

    const nextBalance = existing.balance + params.amount;
    const nextTotalGranted = existing.totalGranted + params.amount;

    const accountData: TeamTicketAccount = {
      ...existing,
      balance: nextBalance,
      totalGranted: nextTotalGranted,
      updatedAt: now,
    };
    if (params.targetTelegramId) accountData.telegramId = params.targetTelegramId;

    transaction.set(userRef, accountData, { merge: true });

    const txData: TeamTicketTransaction = {
      id: txId,
      userId: params.targetUserId,
      type: 'GRANT',
      amount: params.amount,
      idempotencyKey,
      performedByAdminId: String(params.adminTelegramId),
      note: params.note || 'Team ticket grant by primary owner',
      createdAt: now,
    };
    transaction.set(txRef, txData);

    return accountData;
  });

  return { success: true, account: updatedAccount, transactionId: txId };
}

/**
 * Revokes unused team creation ticket(s) from a user. Strictly requires Primary Owner (5209126900).
 */
export async function revokeUserTeamTickets(params: {
  targetUserId: string;
  adminTelegramId: string | number;
  amount: number;
  note?: string;
}): Promise<{ success: boolean; account: TeamTicketAccount; transactionId: string }> {
  if (!isPrimaryOwner(params.adminTelegramId)) {
    throw Object.assign(new Error('Faqat loyiha egasi (Telegram ID: 5209126900) team ticketini qaytarib ola oladi.'), {
      statusCode: 403,
      code: 'OWNER_ONLY_UNAUTHORIZED',
    });
  }

  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw Object.assign(new Error('Qaytarib olinadigan ticket miqdori musbat butun son bo‘lishi kerak.'), {
      statusCode: 400,
      code: 'INVALID_AMOUNT',
    });
  }

  const now = new Date().toISOString();
  const txId = `tx_team_revoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const idempotencyKey = `team_revoke_${params.targetUserId}_${txId}`;

  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  if (isFallback) {
    const current = memoryTeamTicketAccounts.get(params.targetUserId);
    if (!current || current.balance < params.amount) {
      throw Object.assign(new Error(`Foydalanuvchida qaytarib olish uchun yetarli foydalanilmagan team ticketi yo‘q (Mavjud: ${current?.balance || 0}).`), {
        statusCode: 400,
        code: 'INSUFFICIENT_UNUSED_TICKETS',
      });
    }

    current.balance -= params.amount;
    current.totalRefunded += params.amount;
    current.updatedAt = now;
    memoryTeamTicketAccounts.set(params.targetUserId, current);

    const tx: TeamTicketTransaction = {
      id: txId,
      userId: params.targetUserId,
      type: 'REFUND',
      amount: params.amount,
      idempotencyKey,
      performedByAdminId: String(params.adminTelegramId),
      note: params.note || 'Team ticket revoke by primary owner',
      createdAt: now,
    };
    memoryTeamTicketTransactions.set(txId, tx);

    return { success: true, account: { ...current }, transactionId: txId };
  }

  const db = getFirestoreDb();
  const userRef = db.collection('team_ticket_accounts').doc(params.targetUserId);
  const txRef = db.collection('team_ticket_transactions').doc(txId);

  const updatedAccount = await db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) {
      throw Object.assign(new Error('Foydalanuvchining team ticket hisobi topilmadi.'), {
        statusCode: 404,
        code: 'ACCOUNT_NOT_FOUND',
      });
    }

    const existing = userDoc.data() as TeamTicketAccount;
    if (existing.balance < params.amount) {
      throw Object.assign(new Error(`Foydalanuvchida qaytarib olish uchun yetarli foydalanilmagan team ticketi yo‘q (Mavjud: ${existing.balance}).`), {
        statusCode: 400,
        code: 'INSUFFICIENT_UNUSED_TICKETS',
      });
    }

    const nextBalance = existing.balance - params.amount;
    const nextTotalRefunded = (existing.totalRefunded || 0) + params.amount;

    const accountData: TeamTicketAccount = {
      ...existing,
      balance: nextBalance,
      totalRefunded: nextTotalRefunded,
      updatedAt: now,
    };

    transaction.update(userRef, {
      balance: nextBalance,
      totalRefunded: nextTotalRefunded,
      updatedAt: now,
    });

    const txData: TeamTicketTransaction = {
      id: txId,
      userId: params.targetUserId,
      type: 'REFUND',
      amount: params.amount,
      idempotencyKey,
      performedByAdminId: String(params.adminTelegramId),
      note: params.note || 'Team ticket revoke by primary owner',
      createdAt: now,
    };
    transaction.set(txRef, txData);

    return accountData;
  });

  return { success: true, account: updatedAccount, transactionId: txId };
}

/**
 * Atomically spends 1 team ticket to create a team.
 * Enforces idempotency via idempotencyKey: if repeated with same key, returns existing transaction without double charge.
 */
export async function spendTeamTicket(params: {
  userId: string;
  teamId: string;
  idempotencyKey: string;
}): Promise<{ success: boolean; transactionId: string; newBalance: number }> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  const now = new Date().toISOString();

  if (isFallback) {
    // Check if transaction with this idempotencyKey already exists
    for (const tx of memoryTeamTicketTransactions.values()) {
      if (tx.idempotencyKey === params.idempotencyKey) {
        const acc = memoryTeamTicketAccounts.get(params.userId);
        return { success: true, transactionId: tx.id, newBalance: acc ? acc.balance : 0 };
      }
    }

    const current = memoryTeamTicketAccounts.get(params.userId);
    if (!current || current.balance < 1) {
      throw Object.assign(new Error('Sizda team ochish uchun yetarli ticket mavjud emas. Chipta olish uchun loyiha egasi (@texnoadmin yoki Telegram ID: 5209126900) bilan bog‘laning.'), {
        statusCode: 402,
        code: 'INSUFFICIENT_TEAM_TICKETS',
      });
    }

    current.balance -= 1;
    current.totalSpent += 1;
    current.updatedAt = now;
    memoryTeamTicketAccounts.set(params.userId, current);

    const txId = `tx_team_spend_${params.teamId}_${Date.now()}`;
    const tx: TeamTicketTransaction = {
      id: txId,
      userId: params.userId,
      type: 'SPEND',
      amount: 1,
      teamId: params.teamId,
      idempotencyKey: params.idempotencyKey,
      createdAt: now,
    };
    memoryTeamTicketTransactions.set(txId, tx);

    return { success: true, transactionId: txId, newBalance: current.balance };
  }

  const db = getFirestoreDb();
  const userRef = db.collection('team_ticket_accounts').doc(params.userId);
  const dedupeRef = db.collection('team_ticket_idempotency').doc(params.idempotencyKey);

  const result = await db.runTransaction(async (transaction) => {
    // 1. Check idempotency record
    const dedupeDoc = await transaction.get(dedupeRef);
    if (dedupeDoc.exists) {
      const data = dedupeDoc.data();
      const userDoc = await transaction.get(userRef);
      const balance = userDoc.exists ? (userDoc.data() as TeamTicketAccount).balance : 0;
      return { success: true, transactionId: data?.transactionId, newBalance: balance };
    }

    // 2. Check user balance
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) {
      throw Object.assign(new Error('Team ochish uchun chipta hisobi topilmadi. Chipta olish uchun loyiha egasi (@texnoadmin yoki Telegram ID: 5209126900) bilan bog‘laning.'), {
        statusCode: 402,
        code: 'INSUFFICIENT_TEAM_TICKETS',
      });
    }

    const account = userDoc.data() as TeamTicketAccount;
    if (account.balance < 1) {
      throw Object.assign(new Error('Sizda team ochish uchun yetarli ticket mavjud emas. Chipta olish uchun loyiha egasi (@texnoadmin yoki Telegram ID: 5209126900) bilan bog‘laning.'), {
        statusCode: 402,
        code: 'INSUFFICIENT_TEAM_TICKETS',
      });
    }

    const nextBalance = account.balance - 1;
    const nextTotalSpent = (account.totalSpent || 0) + 1;
    const txId = `tx_team_spend_${params.teamId}_${Date.now()}`;

    transaction.update(userRef, {
      balance: nextBalance,
      totalSpent: nextTotalSpent,
      updatedAt: now,
    });

    const txData: TeamTicketTransaction = {
      id: txId,
      userId: params.userId,
      type: 'SPEND',
      amount: 1,
      teamId: params.teamId,
      idempotencyKey: params.idempotencyKey,
      createdAt: now,
    };
    transaction.set(db.collection('team_ticket_transactions').doc(txId), txData);
    transaction.set(dedupeRef, { transactionId: txId, teamId: params.teamId, createdAt: now });

    return { success: true, transactionId: txId, newBalance: nextBalance };
  });

  return result;
}
