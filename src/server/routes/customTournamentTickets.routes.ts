/**
 * Custom Tournament Ticket & Quota Routes
 *
 * User ticket balance & Owner-only ticket granting/refunding.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import {
  getUserTicketBalance,
  grantUserTickets,
  refundSpentTicket,
  getTicketTransactions,
  isPrimaryOwner,
} from '../services/customTournamentTicketService';

import {getFirestoreDb} from '../firebase/admin';
import {resolveAdminUserReference} from '../services/adminUserDirectory';
async function ticketRecipient(reference: unknown, expectedTelegramId?: unknown) {
 if(typeof reference!=='string'||!reference.trim()||reference.includes('/'))throw Object.assign(new Error('Foydalanuvchi ID yoki @username kiriting.'),{statusCode:400});
 const raw=reference.trim();
 let id:string;
 if(/^\d+$/.test(raw)){
  const canonical=await getFirestoreDb().collection('users').doc('user-'+raw).get();
  id=canonical.exists&&String(canonical.data()?.telegramId)===raw?canonical.id:await resolveAdminUserReference(raw);
 }else{id=await resolveAdminUserReference(raw);}
 const user=(await getFirestoreDb().collection('users').doc(id).get()).data();
 if(!user)throw Object.assign(new Error('Foydalanuvchi topilmadi.'),{statusCode:404});
 const telegramId=String(user.telegramId||'');
 if(expectedTelegramId&&String(expectedTelegramId).trim()!==telegramId)throw Object.assign(new Error('Telegram ID tanlangan foydalanuvchiga mos emas.'),{statusCode:400});
 return {id,telegramId};
}
export const customTournamentTicketsRouter = Router();

// GET /api/custom-tournaments/tickets/balance
customTournamentTicketsRouter.get('/balance', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const account = await getUserTicketBalance(user.id);
    res.json({ ok: true, account });
  } catch (err: any) {
    res.status(err.statusCode || (['USER_NOT_FOUND','AMBIGUOUS_USER_REFERENCE'].includes(err.message)?400:500)).json({ ok: false, error: err.message });
  }
});

// POST /api/admin/custom-tournaments/tickets/grant (Primary Owner only)
customTournamentTicketsRouter.post('/grant', requireAuth, async (req: Request, res: Response) => {
  try {
    const adminUser = req.user!;
    if (!isPrimaryOwner(adminUser.telegramId)) {
      res.status(403).json({ ok: false, error: 'Faqat asosiy admin (5209126900) chipta bera oladi.' });
      return;
    }

    const { targetUserId, targetTelegramId, amount, note, idempotencyKey } = req.body;
    if (!targetUserId || !amount) {
      res.status(400).json({ ok: false, error: 'targetUserId va amount talab qilinadi.' });
      return;
    }

    if(idempotencyKey!==undefined&&(typeof idempotencyKey!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(idempotencyKey)))throw Object.assign(new Error('INVALID_IDEMPOTENCY_KEY'),{statusCode:400});
    const recipient=await ticketRecipient(targetUserId,targetTelegramId);
    const result = await grantUserTickets({
      targetUserId:recipient.id,
      targetTelegramId:recipient.telegramId,
      idempotencyKey,
      adminTelegramId: adminUser.telegramId || '',
      amount: Number(amount),
      note,
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(err.statusCode || (['USER_NOT_FOUND','AMBIGUOUS_USER_REFERENCE'].includes(err.message)?400:500)).json({ ok: false, error: err.message });
  }
});

// POST /api/admin/custom-tournaments/tickets/refund (Primary Owner only)
customTournamentTicketsRouter.post('/refund', requireAuth, async (req: Request, res: Response) => {
  try {
    const adminUser = req.user!;
    if (!isPrimaryOwner(adminUser.telegramId)) {
      res.status(403).json({ ok: false, error: 'Faqat asosiy admin (5209126900) chiptani qaytara oladi.' });
      return;
    }

    const { targetUserId, tournamentId, note } = req.body;
    if (!targetUserId || !tournamentId) {
      res.status(400).json({ ok: false, error: 'targetUserId va tournamentId talab qilinadi.' });
      return;
    }

    const recipient=await ticketRecipient(targetUserId);
    const result = await refundSpentTicket({
      targetUserId:recipient.id,
      tournamentId,
      adminTelegramId: adminUser.telegramId || '',
      note,
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message, code: err.code });
  }
});

// GET /api/admin/custom-tournaments/tickets/transactions (Primary Owner only)
customTournamentTicketsRouter.get('/transactions', requireAuth, async (req: Request, res: Response) => {
  try {
    const adminUser = req.user!;
    if (!isPrimaryOwner(adminUser.telegramId)) {
      res.status(403).json({ ok: false, error: 'Ruxsat etilmagan.' });
      return;
    }

    const reference = req.query.userId;
    const userId = reference ? (await ticketRecipient(reference)).id : undefined;
    const transactions = await getTicketTransactions(userId);
    res.json({ ok: true, transactions });
  } catch (err: any) {
    res.status(err.statusCode || (['USER_NOT_FOUND','AMBIGUOUS_USER_REFERENCE'].includes(err.message)?400:500)).json({ ok: false, error: err.message });
  }
});
