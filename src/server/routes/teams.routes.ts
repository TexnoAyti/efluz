import { Router, Request, Response } from 'express';
import { requireAuth, requireAdmin } from '../middleware/authMiddleware';
import {
  createTeam,
  getTeams,
  getTeamById,
  updateTeam,
  createTeamInvitation,
  respondToTeamInvitation,
  cancelTeamInvitation,
  getTeamInvitations,
  getUserPendingInvitations,
} from '../services/teamService';
import {
  getUserTeamTicketBalance,
  grantUserTeamTickets,
  revokeUserTeamTickets,
  isPrimaryOwner,
  PRIMARY_OWNER_TELEGRAM_ID,
} from '../services/teamTicketService';
import { findAdminUserBySelector } from '../services/adminUserDirectory';

export const teamsRouter = Router();

// ============================================================================
// 1. TEAMS DIRECTORY & LIFECYCLE
// ============================================================================

/**
 * GET /api/teams
 * List all active teams with optional search query.
 */
teamsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string | undefined;
    const status = req.query.status as string | undefined;
    const teams = await getTeams({ search, status });
    res.json({ ok: true, teams });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message,
      code: err.code || 'TEAMS_FETCH_ERROR',
    });
  }
});

/**
 * GET /api/teams/my-invitations
 * Get pending team invitations for the authenticated user.
 */
teamsRouter.get('/my-invitations', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const telegramId = req.user!.telegramId;
    const invitations = await getUserPendingInvitations(userId, telegramId);
    res.json({ ok: true, invitations });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message,
      code: err.code || 'INVITATIONS_FETCH_ERROR',
    });
  }
});

/**
 * GET /api/teams/tickets/balance
 * Get current user's team creation ticket balance.
 */
teamsRouter.get('/tickets/balance', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const account = await getUserTeamTicketBalance(userId);
    res.json({ ok: true, account });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message,
      code: err.code || 'TICKET_BALANCE_ERROR',
    });
  }
});

/**
 * GET /api/teams/tickets/check/:userId
 * Check a user's team creation ticket balance. Owner or self only.
 */
teamsRouter.get('/tickets/check/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const targetUserId = req.params.userId;
    const isSelf = req.user!.id === targetUserId;
    const isOwner = isPrimaryOwner(req.user!.telegramId);

    if (!isSelf && !isOwner && !req.user!.isAdmin) {
      res.status(403).json({
        ok: false,
        error: 'Faqat o‘z hisobingizni yoki loyiha egasi sifatida boshqalarni tekshira olasiz.',
        code: 'FORBIDDEN',
      });
      return;
    }

    const account = await getUserTeamTicketBalance(targetUserId);
    res.json({ ok: true, account });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message,
      code: err.code || 'TICKET_CHECK_ERROR',
    });
  }
});

/**
 * POST /api/teams/tickets/grant
 * Grant team creation ticket(s). Primary Owner (5209126900) only.
 */
teamsRouter.post('/tickets/grant', requireAuth, async (req: Request, res: Response) => {
  try {
    const adminTelegramId = req.user!.telegramId;
    const { targetUserId, targetTelegramId, amount, note } = req.body;

    if (!targetUserId) {
      res.status(400).json({ ok: false, error: 'targetUserId talab qilinadi.', code: 'BAD_REQUEST' });
      return;
    }

    const result = await grantUserTeamTickets({
      targetUserId,
      targetTelegramId,
      adminTelegramId,
      amount: Number(amount) || 1,
      note,
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message,
      code: err.code || 'TICKET_GRANT_ERROR',
    });
  }
});

/**
 * POST /api/teams/tickets/revoke
 * Revoke team creation ticket(s). Primary Owner (5209126900) only.
 */
teamsRouter.post('/tickets/revoke', requireAuth, async (req: Request, res: Response) => {
  try {
    const adminTelegramId = req.user!.telegramId;
    const { targetUserId, amount, note } = req.body;

    if (!targetUserId) {
      res.status(400).json({ ok: false, error: 'targetUserId talab qilinadi.', code: 'BAD_REQUEST' });
      return;
    }

    const result = await revokeUserTeamTickets({
      targetUserId,
      adminTelegramId,
      amount: Number(amount) || 1,
      note,
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message,
      code: err.code || 'TICKET_REVOKE_ERROR',
    });
  }
});

/**
 * POST /api/teams
 * Create a new team. Consumes 1 TEAM_CREATION ticket.
 * Requires mandatory @efleagueuz group membership.
 */
teamsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, tag, logoUrl, description, idempotencyKey } = req.body;
    const user = req.user!;

    const team = await createTeam({
      name,
      tag,
      logoUrl,
      description,
      creatorUserId: user.id,
      creatorTelegramId: user.telegramId,
      creatorUsername: user.username,
      creatorDisplayName: user.firstName ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}` : user.username,
      idempotencyKey,
    });

    res.status(201).json({ ok: true, team });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message,
      code: err.code || 'TEAM_CREATE_ERROR',
      groupUsername: err.groupUsername,
      groupUrl: err.groupUrl,
    });
  }
});

/**
 * GET /api/teams/:id
 * Get single team details.
 */
teamsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const team = await getTeamById(req.params.id);
    if (!team) {
      res.status(404).json({ ok: false, error: 'Team topilmadi.', code: 'NOT_FOUND' });
      return;
    }
    res.json({ ok: true, team });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message,
      code: err.code || 'TEAM_FETCH_ERROR',
    });
  }
});

/**
 * PUT /api/teams/:id
 * Update team details (team admin or owner).
 */
teamsRouter.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const teamId = req.params.id;
    const { name, tag, logoUrl, description } = req.body;
    const user = req.user!;

    const updated = await updateTeam(
      teamId,
      { name, tag, logoUrl, description },
      user.id,
      user.telegramId,
      user.isAdmin
    );

    res.json({ ok: true, team: updated });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message,
      code: err.code || 'TEAM_UPDATE_ERROR',
    });
  }
});

// ============================================================================
// 2. INVITATIONS & ROSTER
// ============================================================================

/**
 * GET /api/teams/:id/invitations
 * Get invitations for a team (team admin or global admin).
 */
teamsRouter.get('/:id/invitations', requireAuth, async (req: Request, res: Response) => {
  try {
    const teamId = req.params.id;
    const team = await getTeamById(teamId);
    if (!team) {
      res.status(404).json({ ok: false, error: 'Team topilmadi.', code: 'NOT_FOUND' });
      return;
    }

    const canView =
      team.creatorUserId === req.user!.id ||
      isPrimaryOwner(req.user!.telegramId) ||
      Boolean(req.user!.isAdmin);

    if (!canView) {
      res.status(403).json({ ok: false, error: 'Ruxsat yo‘q.', code: 'FORBIDDEN' });
      return;
    }

    const invitations = await getTeamInvitations(teamId);
    res.json({ ok: true, invitations });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message,
      code: err.code || 'INVITATIONS_FETCH_ERROR',
    });
  }
});

/**
 * POST /api/teams/:id/invitations
 * Send an invitation to a real EFLUZ user.
 */
teamsRouter.post('/:id/invitations', requireAuth, async (req: Request, res: Response) => {
  try {
    const teamId = req.params.id;
    const { targetUserId, targetSelector, legacyRosterMemberId } = req.body;
    const inviter = req.user!;

    let invitee: { id: string; telegramId: string; username?: string; displayName: string } | null = null;

    if (targetUserId) {
      const found = await findAdminUserBySelector(targetUserId);
      if (found) {
        invitee = {
          id: found.id,
          telegramId: found.telegramId,
          username: found.username,
          displayName: found.displayName || found.username || 'Foydalanuvchi',
        };
      }
    } else if (targetSelector) {
      const found = await findAdminUserBySelector(targetSelector);
      if (found) {
        invitee = {
          id: found.id,
          telegramId: found.telegramId,
          username: found.username,
          displayName: found.displayName || found.username || 'Foydalanuvchi',
        };
      }
    }

    if (!invitee) {
      res.status(404).json({
        ok: false,
        error: 'Taklif yuboriladigan EFLUZ foydalanuvchisi topilmadi. Telegram ID yoki @username orqali qidiring.',
        code: 'USER_NOT_FOUND',
      });
      return;
    }

    const inviterDisplayName = inviter.firstName
      ? `${inviter.firstName}${inviter.lastName ? ' ' + inviter.lastName : ''}`
      : inviter.username;

    const invitation = await createTeamInvitation({
      teamId,
      inviterUserId: inviter.id,
      inviterDisplayName,
      inviterTelegramId: inviter.telegramId,
      inviteeUser: invitee,
      legacyRosterMemberId,
      isAdmin: inviter.isAdmin,
    });

    res.status(201).json({ ok: true, invitation });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message,
      code: err.code || 'INVITATION_CREATE_ERROR',
    });
  }
});

/**
 * POST /api/teams/invitations/:id/respond
 * Accept or reject a team invitation.
 * Checks mandatory @efleagueuz group membership if accepting.
 */
teamsRouter.post('/invitations/:id/respond', requireAuth, async (req: Request, res: Response) => {
  try {
    const invitationId = req.params.id;
    const accept = Boolean(req.body.accept);
    const user = req.user!;

    const result = await respondToTeamInvitation({
      invitationId,
      userId: user.id,
      telegramId: user.telegramId,
      accept,
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message,
      code: err.code || 'INVITATION_RESPOND_ERROR',
      groupUsername: err.groupUsername,
      groupUrl: err.groupUrl,
    });
  }
});

/**
 * POST /api/teams/invitations/:id/cancel
 * Cancel a pending invitation (team admin or global admin).
 */
teamsRouter.post('/invitations/:id/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const invitationId = req.params.id;
    const user = req.user!;

    await cancelTeamInvitation(invitationId, user.id, user.telegramId, user.isAdmin);
    res.json({ ok: true, message: 'Taklif bekor qilindi.' });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message,
      code: err.code || 'INVITATION_CANCEL_ERROR',
    });
  }
});
