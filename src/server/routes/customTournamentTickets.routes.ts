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

export const customTournamentTicketsRouter = Router();

// GET /api/custom-tournaments/tickets/balance
customTournamentTicketsRouter.get('/balance', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const account = await getUserTicketBalance(user.id);
    res.json({ ok: true, account });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
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

    const { targetUserId, targetTelegramId, amount, note } = req.body;
    if (!targetUserId || !amount) {
      res.status(400).json({ ok: false, error: 'targetUserId va amount talab qilinadi.' });
      return;
    }

    const result = await grantUserTickets({
      targetUserId,
      targetTelegramId,
      adminTelegramId: adminUser.telegramId || '',
      amount: Number(amount),
      note,
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
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

    const result = await refundSpentTicket({
      targetUserId,
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

    const userId = req.query.userId as string | undefined;
    const transactions = await getTicketTransactions(userId);
    res.json({ ok: true, transactions });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});
