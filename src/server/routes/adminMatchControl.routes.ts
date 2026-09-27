import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import { getFixtureByIdFirestore } from '../firebase/firestoreStore';
import { enqueueSmartTelegramNotification } from '../services/smartNotificationService';
import {
  getAdminMatchOperations,
  resolveNoShowV4,
  resolveResultDisputeV4,
  runDeadlineSweep,
  setFixtureDeadline,
} from '../services/matchOperationsV4Service';

export const adminMatchControlRouter = Router();
adminMatchControlRouter.use(requireAdmin);

const REMINDER_WINDOW_MS = 15 * 60 * 1000;

function ownerId(fixture: any, side: 'home' | 'away'): string | undefined {
  return side === 'home'
    ? (fixture.homeOwnerId || fixture.homeOwner?.userId || fixture.homeUser?.id)
    : (fixture.awayOwnerId || fixture.awayOwner?.userId || fixture.awayUser?.id);
}

function clubName(fixture: any, side: 'home' | 'away'): string {
  return side === 'home'
    ? (fixture.homeClub?.name || fixture.homeClubId || 'Home')
    : (fixture.awayClub?.name || fixture.awayClubId || 'Away');
}

function resultTopicUrl(fixture: any): string {
  const competition = `${fixture.competitionId || ''} ${fixture.competitionName || ''}`.toLowerCase();
  if (competition.includes('super')) return 'https://t.me/efleagueuz/2335';
  if (competition.includes('champions') || competition.includes('ucl')) return 'https://t.me/efleagueuz/7';
  if (competition.includes('cup') || competition.includes('pokal') || competition.includes('copa') || competition.includes('coppa') || competition.includes('coupe')) return 'https://t.me/efleagueuz/8';
  const leagueId = fixture.homeClub?.leagueId || fixture.awayClub?.leagueId || '';
  const leagueTopics: Record<string, string> = {
    'league-premier-league': 'https://t.me/efleagueuz/2',
    'league-la-liga': 'https://t.me/efleagueuz/3',
    'league-serie-a': 'https://t.me/efleagueuz/4',
    'league-bundesliga': 'https://t.me/efleagueuz/5',
    'league-ligue-1': 'https://t.me/efleagueuz/6',
  };
  return leagueTopics[leagueId] || 'https://t.me/efleagueuz';
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

adminMatchControlRouter.get('/match-ops/control', async (req: Request, res: Response) => {
  const seasonId = String(req.query.seasonId || 'season-2026-27');
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await getAdminMatchOperations(seasonId));
  } catch (error: any) {
    res.status(503).json({ error: 'MATCH_OPERATIONS_UNAVAILABLE', message: error?.message || String(error) });
  }
});

adminMatchControlRouter.post('/fixtures/:id/deadline', async (req: Request, res: Response) => {
  const deadlineAt = String(req.body?.deadlineAt || '').trim();
  if (!deadlineAt) {
    res.status(400).json({ error: 'deadlineAt is required' });
    return;
  }
  try {
    const deadline = await setFixtureDeadline({
      fixtureId: req.params.id,
      deadlineAt,
      actorUserId: req.user!.id,
      actorUsername: req.user?.username,
      notes: req.body?.notes ? String(req.body.notes) : undefined,
    });
    res.json({ success: true, deadline });
  } catch (error: any) {
    const code = String(error?.message || 'DEADLINE_UPDATE_FAILED');
    const status = code.includes('NOT_FOUND') ? 404 : code.includes('CLOSED') ? 409 : code.includes('DEADLINE') ? 400 : 503;
    res.status(status).json({ error: code, message: code });
  }
});

adminMatchControlRouter.post('/match-ops/deadline-sweep', async (req: Request, res: Response) => {
  const seasonId = String(req.body?.seasonId || 'season-2026-27');
  try {
    res.json({ success: true, ...(await runDeadlineSweep(seasonId, true)) });
  } catch (error: any) {
    res.status(503).json({ error: 'DEADLINE_SWEEP_FAILED', message: error?.message || String(error) });
  }
});

adminMatchControlRouter.post('/match-ops/no-show/:reportId/resolve', async (req: Request, res: Response) => {
  const action = String(req.body?.action || '');
  if (!['WALKOVER_HOME', 'WALKOVER_AWAY', 'POSTPONE', 'REJECT'].includes(action)) {
    res.status(400).json({ error: 'INVALID_NO_SHOW_RESOLUTION' });
    return;
  }
  try {
    const result = await resolveNoShowV4({
      reportId: req.params.reportId,
      action: action as any,
      adminUserId: req.user!.id,
      adminUsername: req.user?.username,
      notes: req.body?.notes ? String(req.body.notes) : undefined,
      deadlineAt: req.body?.deadlineAt ? String(req.body.deadlineAt) : null,
    });
    res.json(result);
  } catch (error: any) {
    const code = String(error?.message || 'NO_SHOW_RESOLUTION_FAILED');
    const status = code.includes('NOT_FOUND') ? 404 : code.includes('DEADLINE_REQUIRED') || code.includes('INVALID') ? 400 : 503;
    res.status(status).json({ error: code, message: code });
  }
});

adminMatchControlRouter.post('/match-ops/disputes/:disputeId/resolve', async (req: Request, res: Response) => {
  const action = String(req.body?.action || '');
  if (!['CONFIRM_HOME_SUBMISSION', 'CONFIRM_AWAY_SUBMISSION', 'MANUAL_SCORE', 'CANCEL_MATCH'].includes(action)) {
    res.status(400).json({ error: 'INVALID_DISPUTE_RESOLUTION' });
    return;
  }
  try {
    const result = await resolveResultDisputeV4({
      disputeId: req.params.disputeId,
      adminUserId: req.user!.id,
      action: action as any,
      manualHomeScore: Number.isInteger(req.body?.manualHomeScore) ? req.body.manualHomeScore : undefined,
      manualAwayScore: Number.isInteger(req.body?.manualAwayScore) ? req.body.manualAwayScore : undefined,
      notes: req.body?.notes ? String(req.body.notes) : undefined,
    });
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(503).json({ error: 'DISPUTE_RESOLUTION_FAILED', message: error?.message || String(error) });
  }
});

adminMatchControlRouter.post('/fixtures/:id/remind', async (req: Request, res: Response) => {
  const fixtureId = req.params.id;
  const seasonId = String(req.body?.seasonId || 'season-2026-27');
  try {
    const fixture: any = await getFixtureByIdFirestore(fixtureId, req.user?.id);
    if (!fixture) {
      res.status(404).json({ error: 'Fixture not found.' });
      return;
    }
    if (fixture.status === 'CONFIRMED' || fixture.status === 'CANCELLED') {
      res.status(409).json({ error: `Reminder is not available for ${fixture.status} fixtures.` });
      return;
    }

    const homeUserId = ownerId(fixture, 'home');
    const awayUserId = ownerId(fixture, 'away');
    const round = fixture.roundName || `Matchday ${fixture.matchday || 1}`;
    const competition = fixture.competitionName || fixture.competitionId || 'EFL UZ';
    const scheduled = fixture.scheduledAt ? new Date(fixture.scheduledAt) : null;
    const deadlineText = scheduled && !Number.isNaN(scheduled.getTime())
      ? scheduled.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
      : null;
    const topicUrl = resultTopicUrl(fixture);
    const tasks: Array<Promise<boolean>> = [];
    const reminderWindow = Math.floor(Date.now() / REMINDER_WINDOW_MS);

    if (homeUserId) {
      tasks.push(enqueueSmartTelegramNotification({
        userId: homeUserId,
        seasonId,
        eventId: `next-fixture:admin-reminder:${fixtureId}:home:${reminderWindow}`,
        title: '⏰ Match reminder',
        body: `<b>${escapeHtml(competition)}</b> • ${escapeHtml(round)}\n\n⚽ <b>${escapeHtml(clubName(fixture, 'home'))}</b> vs <b>${escapeHtml(clubName(fixture, 'away'))}</b>${deadlineText ? `\n⏳ Deadline: <b>${deadlineText}</b>` : ''}\n\nAdmin reminder: o‘yinni yakunlab, natijani yuboring.`,
        replyMarkup: { inline_keyboard: [[{ text: '📸 Natijani yuborish', url: topicUrl }]] },
      }));
    }
    if (awayUserId) {
      tasks.push(enqueueSmartTelegramNotification({
        userId: awayUserId,
        seasonId,
        eventId: `next-fixture:admin-reminder:${fixtureId}:away:${reminderWindow}`,
        title: '⏰ Match reminder',
        body: `<b>${escapeHtml(competition)}</b> • ${escapeHtml(round)}\n\n⚽ <b>${escapeHtml(clubName(fixture, 'home'))}</b> vs <b>${escapeHtml(clubName(fixture, 'away'))}</b>${deadlineText ? `\n⏳ Deadline: <b>${deadlineText}</b>` : ''}\n\nAdmin reminder: o‘yinni yakunlab, natijani yuboring.`,
        replyMarkup: { inline_keyboard: [[{ text: '📸 Natijani yuborish', url: topicUrl }]] },
      }));
    }

    const settled = await Promise.allSettled(tasks);
    const queued = settled.filter((item) => item.status === 'fulfilled' && item.value).length;
    res.json({ success: true, fixtureId, recipients: tasks.length, queued, skipped: tasks.length - queued, dedupeWindowMinutes: 15 });
  } catch (error: any) {
    console.error('[ADMIN_FIXTURE_REMINDER_FAILED]', JSON.stringify({ fixtureId, error: error?.message || String(error) }));
    res.status(500).json({ error: error?.message || 'Failed to queue fixture reminder.' });
  }
});