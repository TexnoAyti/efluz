/**
 * Custom Tournaments Express Router
 *
 * Implements tournament creation, publishing, atomic club claiming,
 * match reporting, standings, and participant controls.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import {
  createTournamentDraft,
  publishTournament,
  claimTournamentClub,
  startTournament,
  submitCustomMatchResult,
  getPublicTournaments,
  getMyTournaments,
  getTournamentByIdWithAccess,
  leaveTournamentClub,
  updateAssistantAdmins,
  correctCustomMatchScore,
  getTournamentAuditLogs,
} from '../services/customTournamentService';
import { generateTournamentPreview } from '../services/customTournamentEngine';

export const customTournamentsRouter = Router();

// GET /api/custom-tournaments - public catalog (strictly hides private tournaments)
customTournamentsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const tournaments = await getPublicTournaments(limit);
    res.json({ ok: true, tournaments });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/custom-tournaments/my - tournaments organized or joined by current user
customTournamentsRouter.get('/my', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const tournaments = await getMyTournaments(user.id);
    res.json({ ok: true, tournaments });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/custom-tournaments/preview - instant structure preview
customTournamentsRouter.get('/preview', (req: Request, res: Response) => {
  try {
    const format = (req.query.format as any) || 'LEAGUE';
    const participantsCount = Number(req.query.participantsCount) || 8;
    const roundsCount = Number(req.query.roundsCount) === 2 ? 2 : 1;
    const playoffLegMode = (req.query.playoffLegMode as any) || 'SINGLE_LEG';
    const playoffQualifiersCount = Number(req.query.playoffQualifiersCount) || undefined;
    const groupStageMode = (req.query.groupStageMode as any) || 'SINGLE_TABLE';
    const groupsCount = Number(req.query.groupsCount) || undefined;

    const preview = generateTournamentPreview(format, participantsCount, {
      roundsCount,
      playoffLegMode,
      playoffQualifiersCount: playoffQualifiersCount as any,
      groupStageMode,
      groupsCount: groupsCount as any,
    });

    res.json({ ok: true, preview });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// GET /api/custom-tournaments/:id - details with privacy access token check
customTournamentsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const tournamentId = req.params.id;
    const token = (req.query.token as string) || undefined;
    const userId = req.user?.id;

    const data = await getTournamentByIdWithAccess(tournamentId, userId, token);
    res.json({ ok: true, ...data });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message, code: err.code });
  }
});

// POST /api/custom-tournaments/draft - create draft (0 tickets)
customTournamentsRouter.post('/draft', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const {
      name,
      description,
      format,
      leagueScope,
      selectedLeagueId,
      maxParticipants,
      rules,
      visibility,
      spectatorAccess,
    } = req.body;

    if (!name?.trim()) {
      res.status(400).json({ ok: false, error: 'Turnir nomi kiritilishi shart.' });
      return;
    }

    const tournament = await createTournamentDraft({
      name,
      description,
      organizerUserId: user.id,
      organizerTelegramId: user.telegramId || '',
      organizerUsername: user.username,
      format: format || 'LEAGUE',
      leagueScope: leagueScope || 'TOP5_ALL',
      selectedLeagueId,
      maxParticipants: Number(maxParticipants) || 8,
      rules: rules || { roundsCount: 1, playoffLegMode: 'SINGLE_LEG', matchDurationHours: 36 },
      visibility,
      spectatorAccess,
    });

    res.json({ ok: true, tournament });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/custom-tournaments/:id/publish - spends 1 ticket, opens registration
customTournamentsRouter.post('/:id/publish', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const tournamentId = req.params.id;
    const idempotencyKey = (req.body.idempotencyKey as string) || `pub_${tournamentId}_${user.id}`;

    const tournament = await publishTournament({
      tournamentId,
      userId: user.id,
      idempotencyKey,
    });

    res.json({ ok: true, tournament });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message, code: err.code });
  }
});

// POST /api/custom-tournaments/:id/join - claim club atomically
customTournamentsRouter.post('/:id/join', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const tournamentId = req.params.id;
    const { clubId } = req.body;

    if (!clubId) {
      res.status(400).json({ ok: false, error: 'Klub tanlanishi shart.' });
      return;
    }

    const participant = await claimTournamentClub({
      tournamentId,
      userId: user.id,
      telegramId: user.telegramId || '',
      username: user.username,
      firstName: user.firstName,
      clubId,
    });

    res.json({ ok: true, participant });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message, code: err.code });
  }
});

// POST /api/custom-tournaments/:id/start - organizer starts tournament
customTournamentsRouter.post('/:id/start', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const tournamentId = req.params.id;

    const result = await startTournament({
      tournamentId,
      userId: user.id,
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message, code: err.code });
  }
});

// POST /api/custom-tournaments/:id/matches/:matchId/result - submit or confirm match result
customTournamentsRouter.post('/:id/matches/:matchId/result', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const tournamentId = req.params.id;
    const fixtureId = req.params.matchId;
    const { homeScore, awayScore, penaltyHomeScore, penaltyAwayScore, proofUrl } = req.body;

    if (homeScore === undefined || awayScore === undefined) {
      res.status(400).json({ ok: false, error: 'Hisob ko‘rsatilishi shart.' });
      return;
    }

    const result = await submitCustomMatchResult({
      tournamentId,
      fixtureId,
      userId: user.id,
      homeScore: Number(homeScore),
      awayScore: Number(awayScore),
      penaltyHomeScore: penaltyHomeScore !== undefined ? Number(penaltyHomeScore) : undefined,
      penaltyAwayScore: penaltyAwayScore !== undefined ? Number(penaltyAwayScore) : undefined,
      proofUrl,
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message, code: err.code });
  }
});

// POST /api/custom-tournaments/:id/leave - participant leaves before tournament starts
customTournamentsRouter.post('/:id/leave', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const tournamentId = req.params.id;

    const result = await leaveTournamentClub({
      tournamentId,
      userId: user.id,
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message, code: err.code });
  }
});

// POST /api/custom-tournaments/:id/assistants - add assistant admin
customTournamentsRouter.post('/:id/assistants', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const tournamentId = req.params.id;
    const { assistantUserId } = req.body;

    if (!assistantUserId) {
      res.status(400).json({ ok: false, error: 'assistantUserId talab qilinadi.' });
      return;
    }

    const result = await updateAssistantAdmins({
      tournamentId,
      organizerUserId: user.id,
      assistantUserId,
      action: 'ADD',
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/custom-tournaments/:id/assistants/:assistantId - remove assistant admin
customTournamentsRouter.delete('/:id/assistants/:assistantId', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const tournamentId = req.params.id;
    const assistantUserId = req.params.assistantId;

    const result = await updateAssistantAdmins({
      tournamentId,
      organizerUserId: user.id,
      assistantUserId,
      action: 'REMOVE',
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

// POST /api/custom-tournaments/:id/matches/:matchId/correct - manual score correction / dispute resolution
customTournamentsRouter.post('/:id/matches/:matchId/correct', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const tournamentId = req.params.id;
    const fixtureId = req.params.matchId;
    const { homeScore, awayScore, penaltyHomeScore, penaltyAwayScore, note } = req.body;

    if (homeScore === undefined || awayScore === undefined) {
      res.status(400).json({ ok: false, error: 'Hisob ko‘rsatilishi shart.' });
      return;
    }

    const result = await correctCustomMatchScore({
      tournamentId,
      fixtureId,
      adminUserId: user.id,
      homeScore: Number(homeScore),
      awayScore: Number(awayScore),
      penaltyHomeScore: penaltyHomeScore !== undefined ? Number(penaltyHomeScore) : undefined,
      penaltyAwayScore: penaltyAwayScore !== undefined ? Number(penaltyAwayScore) : undefined,
      note,
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

// GET /api/custom-tournaments/:id/audit-logs - get tournament audit log history
customTournamentsRouter.get('/:id/audit-logs', requireAuth, async (req: Request, res: Response) => {
  try {
    const tournamentId = req.params.id;
    const logs = await getTournamentAuditLogs(tournamentId);
    res.json({ ok: true, logs });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ ok: false, error: err.message });
  }
});

