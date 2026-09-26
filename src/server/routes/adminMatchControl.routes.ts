import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import { getFixtureByIdFirestore } from '../firebase/firestoreStore';
import { enqueueSmartTelegramNotification } from '../services/smartNotificationService';

export const adminMatchControlRouter = Router();
adminMatchControlRouter.use(requireAdmin);

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

    if (homeUserId) {
      tasks.push(enqueueSmartTelegramNotification({
        userId: homeUserId,
        seasonId,
        eventId: `next-fixture:admin-reminder:${fixtureId}:home:${Date.now()}`,
        title: '⏰ Match reminder',
        body: `<b>${escapeHtml(competition)}</b> • ${escapeHtml(round)}\n\n⚽ <b>${escapeHtml(clubName(fixture, 'home'))}</b> vs <b>${escapeHtml(clubName(fixture, 'away'))}</b>${deadlineText ? `\n⏳ Deadline: <b>${deadlineText}</b>` : ''}\n\nAdmin reminder: o‘yinni yakunlab, natijani yuboring.`,
        replyMarkup: { inline_keyboard: [[{ text: '📸 Natijani yuborish', url: topicUrl }]] },
      }));
    }
    if (awayUserId) {
      tasks.push(enqueueSmartTelegramNotification({
        userId: awayUserId,
        seasonId,
        eventId: `next-fixture:admin-reminder:${fixtureId}:away:${Date.now()}`,
        title: '⏰ Match reminder',
        body: `<b>${escapeHtml(competition)}</b> • ${escapeHtml(round)}\n\n⚽ <b>${escapeHtml(clubName(fixture, 'home'))}</b> vs <b>${escapeHtml(clubName(fixture, 'away'))}</b>${deadlineText ? `\n⏳ Deadline: <b>${deadlineText}</b>` : ''}\n\nAdmin reminder: o‘yinni yakunlab, natijani yuboring.`,
        replyMarkup: { inline_keyboard: [[{ text: '📸 Natijani yuborish', url: topicUrl }]] },
      }));
    }

    const settled = await Promise.allSettled(tasks);
    const queued = settled.filter((item) => item.status === 'fulfilled' && item.value).length;
    res.json({ success: true, fixtureId, recipients: tasks.length, queued, skipped: tasks.length - queued });
  } catch (error: any) {
    console.error('[ADMIN_FIXTURE_REMINDER_FAILED]', JSON.stringify({ fixtureId, error: error?.message || String(error) }));
    res.status(500).json({ error: error?.message || 'Failed to queue fixture reminder.' });
  }
});
