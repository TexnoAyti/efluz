/**
 * Custom Tournament Ticket & Quota Management Service
 *
 * Rules:
 * 1. Only Primary Owner (Telegram ID: 5209126900) can grant or refund tickets.
 * 2. 1 ticket = 1 tournament publish.
 * 3. Atomic deduction with idempotency protection against double-charges or duplicate publishes.
 * 4. A spent ticket can be refunded at most once.
 * 5. Complete durable transaction audit log in Firestore / test storage.
 */

import { getFirestoreDb } from '../firebase/admin';
import { UserTicketAccount, TicketTransaction } from '../../types/customTournament';

export const PRIMARY_OWNER_TELEGRAM_ID = '5209126900';

export function isPrimaryOwner(telegramId: string | number | undefined | null): boolean {
  if (telegramId === undefined || telegramId === null) return false;
  return String(telegramId).trim() === PRIMARY_OWNER_TELEGRAM_ID;
}

// In-memory fallback storage for offline test runs
const memoryTicketAccounts = new Map<string, UserTicketAccount>();
const memoryTicketTransactions = new Map<string, TicketTransaction>();

export function clearMemoryTicketStore(): void {
  memoryTicketAccounts.clear();
  memoryTicketTransactions.clear();
}

/**
 * Gets a user's current ticket balance and transaction summary.
 */
export async function getUserTicketBalance(userId: string): Promise<UserTicketAccount> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  if (isFallback) {
    const existing = memoryTicketAccounts.get(userId);
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
  const docRef = db.collection('user_tickets').doc(userId);
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

  return snap.data() as UserTicketAccount;
}

/**
 * Grants ticket(s) to a user. Strictly requires Primary Owner (5209126900).
 */
export async function grantUserTickets(params: {
  targetUserId: string;
  targetTelegramId?: string;
  adminTelegramId: string | number;
  amount: number;
  idempotencyKey?: string;
  note?: string;
}): Promise<{ success: boolean; account: UserTicketAccount; transactionId: string }> {
  if (!isPrimaryOwner(params.adminTelegramId)) {
    throw Object.assign(new Error('Only primary owner (5209126900) can grant tournament tickets.'), {
      statusCode: 403,
      code: 'OWNER_ONLY_UNAUTHORIZED',
    });
  }

  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw Object.assign(new Error('Grant amount must be a positive integer.'), {
      statusCode: 400,
      code: 'INVALID_AMOUNT',
    });
  }

  const now = new Date().toISOString();
  const txId = `tx_grant_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const idempotencyKey = params.idempotencyKey || `grant_${params.targetUserId}_${txId}`;

  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  if (isFallback) {
    const previous=[...memoryTicketTransactions.values()].find(tx=>tx.type==='GRANT'&&tx.idempotencyKey===idempotencyKey);
    if(previous){
      if(previous.userId!==params.targetUserId||previous.amount!==params.amount)throw Object.assign(new Error('IDEMPOTENCY_CONFLICT'),{statusCode:409});
      return {success:true,account:{...memoryTicketAccounts.get(params.targetUserId)!},transactionId:previous.id};
    }
    const current = memoryTicketAccounts.get(params.targetUserId) || {
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

    memoryTicketAccounts.set(params.targetUserId, current);

    const tx: TicketTransaction = {
      id: txId,
      userId: params.targetUserId,
      type: 'GRANT',
      amount: params.amount,
      idempotencyKey,
      performedByAdminId: String(params.adminTelegramId),
      note: params.note || 'Ticket grant by primary owner',
      createdAt: now,
    };
    memoryTicketTransactions.set(txId, tx);

    return { success: true, account: { ...current }, transactionId: txId };
  }

  const db = getFirestoreDb();
  const userRef = db.collection('user_tickets').doc(params.targetUserId);
  const txRef = db.collection('ticket_transactions').doc(txId);

  const updatedAccount = await db.runTransaction(async (transaction) => {
    const dedupeRef=db.collection('ticket_grant_idempotency').doc(idempotencyKey);
    const previous=await transaction.get(dedupeRef);
    const userDoc = await transaction.get(userRef);
    if(previous.exists){
      const saved=previous.data()!;
      if(saved.userId!==params.targetUserId||saved.amount!==params.amount)throw Object.assign(new Error('IDEMPOTENCY_CONFLICT'),{statusCode:409});
      return {account:userDoc.data() as UserTicketAccount,transactionId:saved.transactionId};
    }
    const existing: UserTicketAccount = userDoc.exists
      ? (userDoc.data() as UserTicketAccount)
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

    const accountData: UserTicketAccount = {
      ...existing,
      balance: nextBalance,
      totalGranted: nextTotalGranted,
      updatedAt: now,
    };
    if (params.targetTelegramId) accountData.telegramId = params.targetTelegramId;

    transaction.set(userRef, accountData, { merge: true });

    const txData: TicketTransaction = {
      id: txId,
      userId: params.targetUserId,
      type: 'GRANT',
      amount: params.amount,
      idempotencyKey,
      performedByAdminId: String(params.adminTelegramId),
      note: params.note || 'Ticket grant by primary owner',
      createdAt: now,
    };
    transaction.set(txRef, txData);

    transaction.set(dedupeRef,{userId:params.targetUserId,amount:params.amount,transactionId:txId});
    return {account:accountData,transactionId:txId};
  });

  return { success: true, account: updatedAccount.account, transactionId: updatedAccount.transactionId };
}

/**
 * Atomically spends 1 ticket to publish a tournament.
 * Enforces idempotency via idempotencyKey: if repeated with same key, returns existing transaction without double charge.
 */
export async function spendTicketForTournament(params: {
  userId: string;
  tournamentId: string;
  idempotencyKey: string;
}): Promise<{ success: boolean; transactionId: string; newBalance: number }> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';
  const now = new Date().toISOString();

  if (isFallback) {
    // Check if transaction with this idempotencyKey already exists
    for (const tx of memoryTicketTransactions.values()) {
      if (tx.idempotencyKey === params.idempotencyKey) {
        const acc = memoryTicketAccounts.get(params.userId);
        return { success: true, transactionId: tx.id, newBalance: acc ? acc.balance : 0 };
      }
    }

    const current = memoryTicketAccounts.get(params.userId);
    if (!current || current.balance < 1) {
      throw Object.assign(new Error('Sizda yetarli turnir chiptasi (ticket) mavjud emas. Chipta olish uchun @texnoadmin bilan bog‘laning.'), {
        statusCode: 402,
        code: 'INSUFFICIENT_TICKETS',
      });
    }

    current.balance -= 1;
    current.totalSpent += 1;
    current.updatedAt = now;
    memoryTicketAccounts.set(params.userId, current);

    const txId = `tx_spend_${params.tournamentId}_${Date.now()}`;
    const tx: TicketTransaction = {
      id: txId,
      userId: params.userId,
      type: 'SPEND',
      amount: 1,
      tournamentId: params.tournamentId,
      idempotencyKey: params.idempotencyKey,
      createdAt: now,
    };
    memoryTicketTransactions.set(txId, tx);

    return { success: true, transactionId: txId, newBalance: current.balance };
  }

  const db = getFirestoreDb();
  const userRef = db.collection('user_tickets').doc(params.userId);
  const dedupeRef = db.collection('ticket_transactions_idempotency').doc(params.idempotencyKey);

  const result = await db.runTransaction(async (transaction) => {
    // 1. Check idempotency record
    const dedupeDoc = await transaction.get(dedupeRef);
    if (dedupeDoc.exists) {
      const data = dedupeDoc.data();
      const userDoc = await transaction.get(userRef);
      const balance = userDoc.exists ? (userDoc.data() as UserTicketAccount).balance : 0;
      return { success: true, transactionId: data?.transactionId, newBalance: balance };
    }

    // 2. Check user balance
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) {
      throw Object.assign(new Error('Chipta hisobi topilmadi. Chipta olish uchun @texnoadmin bilan bog‘laning.'), {
        statusCode: 402,
        code: 'INSUFFICIENT_TICKETS',
      });
    }

    const account = userDoc.data() as UserTicketAccount;
    if (account.balance < 1) {
      throw Object.assign(new Error('Sizda yetarli turnir chiptasi (ticket) mavjud emas. Chipta olish uchun @texnoadmin bilan bog‘laning.'), {
        statusCode: 402,
        code: 'INSUFFICIENT_TICKETS',
      });
    }

    const nextBalance = account.balance - 1;
    const nextTotalSpent = (account.totalSpent || 0) + 1;
    const txId = `tx_spend_${params.tournamentId}_${Date.now()}`;

    transaction.update(userRef, {
      balance: nextBalance,
      totalSpent: nextTotalSpent,
      updatedAt: now,
    });

    const txData: TicketTransaction = {
      id: txId,
      userId: params.userId,
      type: 'SPEND',
      amount: 1,
      tournamentId: params.tournamentId,
      idempotencyKey: params.idempotencyKey,
      createdAt: now,
    };
    transaction.set(db.collection('ticket_transactions').doc(txId), txData);
    transaction.set(dedupeRef, { transactionId: txId, tournamentId: params.tournamentId, createdAt: now });

    return { success: true, transactionId: txId, newBalance: nextBalance };
  });

  return result;
}

/**
 * Refunds a spent ticket. Strictly requires Primary Owner (5209126900).
 * Can only be executed once per tournament spend transaction.
 */
export async function refundSpentTicket(params: {
  targetUserId: string;
  tournamentId: string;
  adminTelegramId: string | number;
  note?: string;
}): Promise<{ success: boolean; transactionId: string; newBalance: number }> {
  if (!isPrimaryOwner(params.adminTelegramId)) {
    throw Object.assign(new Error('Only primary owner (5209126900) can refund tickets.'), {
      statusCode: 403,
      code: 'OWNER_ONLY_UNAUTHORIZED',
    });
  }

  const now = new Date().toISOString();
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  if (isFallback) {
    // Check if spend exists and not already refunded
    let spendTx: TicketTransaction | undefined;
    for (const tx of memoryTicketTransactions.values()) {
      if (tx.userId === params.targetUserId && tx.tournamentId === params.tournamentId && tx.type === 'SPEND') {
        spendTx = tx;
        break;
      }
    }

    for (const tx of memoryTicketTransactions.values()) {
      if (tx.userId === params.targetUserId && tx.tournamentId === params.tournamentId && tx.type === 'REFUND') {
        throw Object.assign(new Error('Bu turnir uchun chipta allaqachon qaytarilgan.'), {
          statusCode: 409,
          code: 'ALREADY_REFUNDED',
        });
      }
    }

    if (!spendTx) throw Object.assign(new Error('Bu turnir uchun sarflangan chipta topilmadi.'), {statusCode:404,code:'TICKET_SPEND_NOT_FOUND'});

    const current = memoryTicketAccounts.get(params.targetUserId);
    if (!current) {
      throw Object.assign(new Error('User ticket account not found.'), { statusCode: 404 });
    }

    current.balance += 1;
    current.totalRefunded += 1;
    current.updatedAt = now;
    memoryTicketAccounts.set(params.targetUserId, current);

    const refundTxId = `tx_refund_${params.tournamentId}_${Date.now()}`;
    const refundTx: TicketTransaction = {
      id: refundTxId,
      userId: params.targetUserId,
      type: 'REFUND',
      amount: 1,
      tournamentId: params.tournamentId,
      idempotencyKey: `refund_${params.tournamentId}`,
      performedByAdminId: String(params.adminTelegramId),
      note: params.note || 'Ticket refunded by primary owner',
      createdAt: now,
    };
    memoryTicketTransactions.set(refundTxId, refundTx);

    return { success: true, transactionId: refundTxId, newBalance: current.balance };
  }

  const db = getFirestoreDb();
  const userRef = db.collection('user_tickets').doc(params.targetUserId);
  const refundDedupeRef = db.collection('ticket_transactions_refunds').doc(params.tournamentId);

  const result = await db.runTransaction(async (transaction) => {
    const refundDoc = await transaction.get(refundDedupeRef);
    if (refundDoc.exists) {
      throw Object.assign(new Error('Ushbu turnir uchun chipta allaqachon qaytarilgan.'), {
        statusCode: 409,
        code: 'ALREADY_REFUNDED',
      });
    }

    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) {
      throw Object.assign(new Error('User ticket account not found.'), { statusCode: 404 });
    }

    const spend = await transaction.get(db.collection('ticket_transactions')
      .where('userId','==',params.targetUserId)
      .where('tournamentId','==',params.tournamentId)
      .where('type','==','SPEND').limit(1));
    if (spend.empty) throw Object.assign(new Error('Bu turnir uchun sarflangan chipta topilmadi.'), {statusCode:404,code:'TICKET_SPEND_NOT_FOUND'});

    const account = userDoc.data() as UserTicketAccount;
    const nextBalance = account.balance + 1;
    const nextTotalRefunded = (account.totalRefunded || 0) + 1;
    const refundTxId = `tx_refund_${params.tournamentId}_${Date.now()}`;

    transaction.update(userRef, {
      balance: nextBalance,
      totalRefunded: nextTotalRefunded,
      updatedAt: now,
    });

    const refundTxData: TicketTransaction = {
      id: refundTxId,
      userId: params.targetUserId,
      type: 'REFUND',
      amount: 1,
      tournamentId: params.tournamentId,
      idempotencyKey: `refund_${params.tournamentId}`,
      performedByAdminId: String(params.adminTelegramId),
      note: params.note || 'Ticket refunded by primary owner',
      createdAt: now,
    };
    transaction.set(db.collection('ticket_transactions').doc(refundTxId), refundTxData);
    transaction.set(refundDedupeRef, { transactionId: refundTxId, refundedAt: now });

    return { success: true, transactionId: refundTxId, newBalance: nextBalance };
  });

  return result;
}

/**
 * Lists ticket transactions for audit purposes.
 */
export async function getTicketTransactions(userId?: string): Promise<TicketTransaction[]> {
  const isFallback = process.env.FIREBASE_FORCE_LOCAL_FALLBACK === 'true' || process.env.NODE_ENV === 'test';

  if (isFallback) {
    const list = Array.from(memoryTicketTransactions.values());
    if (userId) return list.filter((tx) => tx.userId === userId);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  const db = getFirestoreDb();
  let query = db.collection('ticket_transactions').orderBy('createdAt', 'desc').limit(50);
  if (userId) {
    query = db.collection('ticket_transactions').where('userId', '==', userId).orderBy('createdAt', 'desc').limit(50);
  }

  const snap = await query.get();
  return snap.docs.map((d) => d.data() as TicketTransaction);
}
