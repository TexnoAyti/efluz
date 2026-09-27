import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAuth, requireAdmin } from '../middleware/authMiddleware';
import { getFirestoreDb } from '../firebase/admin';
import {
  adminApproveFixtureResultFirestore,
  advanceCompetitionMatchdayFirestore,
  getFixturesFirestore,
  openCompetitionMatchdayNowFirestore,
  trackFirestoreRead,
  trackFirestoreWrite,
} from '../firebase/firestoreStore';
import { getOptionalCurrentClub, invalidateFixtureReadModels } from '../readModel/readModelStore';
import {
  getClubOperations,
  getHeadToHead,
  getQualificationTracker,
  getSeasonOperationsOverview,
  getSeasonRolloverPreview,
} from '../services/seasonOperationsService';
import {
  getPremiumCareerSnapshot,
  getPremiumEntitlement,
  PREMIUM_DEFAULT_SEASON_ID,
  PREMIUM_PRICE_STARS,
  isPremiumPublicEnabled,
} from '../services/premiumService';
import { createAuditLog } from '../services/adminService';

export const seasonOperationsRouter = Router();
export const adminSeasonOperationsRouter = Router();
adminSeasonOperationsRouter.use(requireAdmin);

function seasonIdFrom(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'season-2026-27';
}

seasonOperationsRouter.get('/overview', async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getSeasonOperationsOverview(seasonIdFrom(req.query.seasonId)));
  } catch (error: any) {
    res.status(503).json({ error: 'SEASON_OPERATIONS_UNAVAILABLE', message: error?.message || String(error) });
  }
});

seasonOperationsRouter.get('/club/:clubId', async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getClubOperations(req.params.clubId, seasonIdFrom(req.query.seasonId)));
  } catch (error: any) {
    const message = error?.message || String(error);
    res.status(message === 'CLUB_NOT_FOUND' ? 404 : 503).json({ error: message });
  }
});

seasonOperationsRouter.get('/h2h', async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getHeadToHead(String(req.query.clubA || ''), String(req.query.clubB || ''), seasonIdFrom(req.query.seasonId)));
  } catch (error: any) {
    res.status(400).json({ error: error?.message || String(error) });
  }
});

seasonOperationsRouter.get('/qualification', async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getQualificationTracker(seasonIdFrom(req.query.seasonId)));
  } catch (error: any) {
    res.status(503).json({ error: 'QUALIFICATION_TRACKER_UNAVAILABLE', message: error?.message || String(error) });
  }
});

seasonOperationsRouter.get('/rollover-preview', async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getSeasonRolloverPreview(seasonIdFrom(req.query.seasonId)));
  } catch (error: any) {
    res.status(503).json({ error: 'ROLLOVER_PREVIEW_UNAVAILABLE', message: error?.message || String(error) });
  }
});

seasonOperationsRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  const seasonId = seasonIdFrom(req.query.seasonId);
  try {
    const clubState = await getOptionalCurrentClub(req.user!.id, seasonId);
    const club = clubState.currentClub ? await getClubOperations(clubState.currentClub.id, seasonId) : null;
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ...clubState, club });
  } catch (error: any) {
    res.status(503).json({ error: 'MY_SEASON_OPERATIONS_UNAVAILABLE', message: error?.message || String(error) });
  }
});

seasonOperationsRouter.get('/me/career', requireAuth, async (req: Request, res: Response) => {
  const seasonId = seasonIdFrom(req.query.seasonId || PREMIUM_DEFAULT_SEASON_ID);
  try {
    const entitlement = await getPremiumEntitlement(req.user!.id, seasonId);
    const active = entitlement?.status === 'ACTIVE';
    res.setHeader('Cache-Control', 'private, no-store');
    if (!active) {
      res.json({
        locked: true,
        premiumRequired: true,
        publicPremiumEnabled: isPremiumPublicEnabled(),
        priceStars: PREMIUM_PRICE_STARS,
        seasonId,
      });
      return;
    }
    const career = await getPremiumCareerSnapshot(req.user!.id, seasonId);
    res.json({ locked: false, entitlement, career });
  } catch (error: any) {
    res.status(503).json({ error: 'CAREER_UNAVAILABLE', message: error?.message || String(error) });
  }
});

const noShowSchema = z.object({
  fixtureId: z.string().min(1),
  reason: z.string().min(3).max(1000),
});

seasonOperationsRouter.post('/no-show', requireAuth, async (req: Request, res: Response) => {
  const parsed = noShowSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_NO_SHOW_REPORT', details: parsed.error.flatten() });
    return;
  }
  const seasonId = seasonIdFrom(req.body?.seasonId);
  try {
    const fixtures = await getFixturesFirestore({ userId: req.user!.id, seasonId });
    const fixture = fixtures.find((item) => item.id === parsed.data.fixtureId);
    if (!fixture) {
      res.status(403).json({ error: 'FIXTURE_NOT_OWNED_BY_USER' });
      return;
    }
    if (['CONFIRMED', 'CANCELLED'].includes(fixture.status)) {
      res.status(409).json({ error: 'FIXTURE_ALREADY_CLOSED' });
      return;
    }
    const db = getFirestoreDb();
    const id = `${parsed.data.fixtureId}__${req.user!.id}`;
    const ref = db.collection('no_show_reports').doc(id);
    const previous = await ref.get();
    trackFirestoreRead('no_show_reports', 1, 'createNoShowReport');
    if (previous.exists && ['OPEN', 'UNDER_REVIEW'].includes(String(previous.data()?.status))) {
      res.json({ success: true, duplicate: true, report: { id: previous.id, ...previous.data() } });
      return;
    }
    const now = new Date().toISOString();
    const report = {
      id,
      seasonId,
      fixtureId: fixture.id,
      competitionId: fixture.competitionId,
      matchday: fixture.matchday,
      reporterUserId: req.user!.id,
      reporterUsername: req.user!.username || null,
      homeClubId: fixture.homeClubId,
      awayClubId: fixture.awayClubId,
      reason: parsed.data.reason.trim(),
      status: 'OPEN',
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(report, { merge: false });
    trackFirestoreWrite('no_show_reports', 1, 'createNoShowReport');
    res.status(201).json({ success: true, report });
  } catch (error: any) {
    res.status(503).json({ error: 'NO_SHOW_REPORT_FAILED', message: error?.message || String(error) });
  }
});

adminSeasonOperationsRouter.get('/control', async (req: Request, res: Response) => {
  const seasonId = seasonIdFrom(req.query.seasonId);
  try {
    const [overview, rollover, qualification] = await Promise.all([
      getSeasonOperationsOverview(seasonId),
      getSeasonRolloverPreview(seasonId),
      getQualificationTracker(seasonId),
    ]);
    const db = getFirestoreDb();
    const noShows = await db.collection('no_show_reports').where('seasonId', '==', seasonId).limit(100).get().catch(() => null);
    if (noShows) trackFirestoreRead('no_show_reports', noShows.size, 'adminSeasonOperationsControl');
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      overview,
      rollover,
      qualification,
      noShowReports: noShows?.docs.map((doc) => ({ id: doc.id, ...doc.data() })) || [],
    });
  } catch (error: any) {
    res.status(503).json({ error: 'SEASON_CONTROL_UNAVAILABLE', message: error?.message || String(error) });
  }
});

adminSeasonOperationsRouter.post('/competitions/:competitionId/advance', async (req: Request, res: Response) => {
  try {
    const result = await advanceCompetitionMatchdayFirestore(req.params.competitionId, {
      durationHours: Number(req.body?.durationHours || 30),
    });
    res.json({ success: true, result });
  } catch (error: any) {
    res.status(409).json({ error: error?.message || 'MATCHDAY_ADVANCE_BLOCKED' });
  }
});

adminSeasonOperationsRouter.post('/competitions/:competitionId/open-now', async (req: Request, res: Response) => {
  try {
    const result = await openCompetitionMatchdayNowFirestore(
      req.params.competitionId,
      Number(req.body?.durationHours || 30),
      Number.isInteger(req.body?.matchday) ? req.body.matchday : undefined,
      seasonIdFrom(req.body?.seasonId)
    );
    res.json({ success: true, result });
  } catch (error: any) {
    res.status(409).json({ error: error?.message || 'MATCHDAY_OPEN_BLOCKED' });
  }
});

const resolveNoShowSchema = z.object({
  action: z.enum(['WALKOVER_HOME', 'WALKOVER_AWAY', 'POSTPONE', 'REJECT']),
  notes: z.string().max(1000).optional(),
});

adminSeasonOperationsRouter.post('/no-show/:reportId/resolve', async (req: Request, res: Response) => {
  const parsed = resolveNoShowSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'INVALID_NO_SHOW_RESOLUTION', details: parsed.error.flatten() });
    return;
  }
  try {
    const db = getFirestoreDb();
    const ref = db.collection('no_show_reports').doc(req.params.reportId);
    const snap = await ref.get();
    trackFirestoreRead('no_show_reports', 1, 'resolveNoShowReport');
    if (!snap.exists) {
      res.status(404).json({ error: 'NO_SHOW_REPORT_NOT_FOUND' });
      return;
    }
    const report: any = snap.data();
    let result: any = null;
    if (parsed.data.action === 'WALKOVER_HOME') {
      result = await adminApproveFixtureResultFirestore(req.user!.id, report.fixtureId, 3, 0, parsed.data.notes || '3–0 walkover');
    } else if (parsed.data.action === 'WALKOVER_AWAY') {
      result = await adminApproveFixtureResultFirestore(req.user!.id, report.fixtureId, 0, 3, parsed.data.notes || '0–3 walkover');
    } else if (parsed.data.action === 'POSTPONE') {
      const fixtureRef = db.collection('fixtures').doc(report.fixtureId);
      await fixtureRef.set({ status: 'POSTPONED', updatedAt: new Date().toISOString() }, { merge: true });
      trackFirestoreWrite('fixtures', 1, 'resolveNoShowPostpone');
      await invalidateFixtureReadModels(report.competitionId || '', report.seasonId || 'season-2026-27').catch(() => {});
    }
    const now = new Date().toISOString();
    const resolution = {
      status: 'RESOLVED',
      resolutionAction: parsed.data.action,
      resolutionNotes: parsed.data.notes || null,
      resolvedAt: now,
      resolvedBy: req.user!.id,
      updatedAt: now,
    };
    await ref.set(resolution, { merge: true });
    trackFirestoreWrite('no_show_reports', 1, 'resolveNoShowReport');
    await createAuditLog(
      req.user!.id,
      'NO_SHOW_RESOLVED',
      'FIXTURE',
      report.fixtureId,
      report,
      { ...report, ...resolution },
      undefined,
      req.user?.username || 'admin',
      parsed.data.notes
    ).catch(() => {});
    res.json({ success: true, resolution, result });
  } catch (error: any) {
    res.status(503).json({ error: 'NO_SHOW_RESOLUTION_FAILED', message: error?.message || String(error) });
  }
});

const rolloverSchema = z.object({ confirmation: z.literal('CREATE_NEXT_SEASON_SHELL') });

adminSeasonOperationsRouter.post('/rollover', async (req: Request, res: Response) => {
  const parsed = rolloverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'EXPLICIT_ROLLOVER_CONFIRMATION_REQUIRED' });
    return;
  }
  const seasonId = seasonIdFrom(req.body?.seasonId);
  try {
    const preview = await getSeasonRolloverPreview(seasonId);
    if (!preview.canRollover) {
      res.status(409).json({ error: 'SEASON_ROLLOVER_BLOCKED', blockers: preview.blockers });
      return;
    }
    const db = getFirestoreDb();
    const nextRef = db.collection('seasons').doc(preview.nextSeasonId);
    const existing = await nextRef.get();
    trackFirestoreRead('seasons', 1, 'rolloverSeasonShell');
    if (!existing.exists) {
      const now = new Date().toISOString();
      await nextRef.set({
        id: preview.nextSeasonId,
        name: preview.nextSeasonId.replace('season-', '').replace('-', '/'),
        status: 'upcoming',
        sourceSeasonId: seasonId,
        createdAt: now,
        createdBy: req.user!.id,
        rolloverMode: 'SHELL_ONLY_NON_DESTRUCTIVE',
      });
      trackFirestoreWrite('seasons', 1, 'rolloverSeasonShell');
    }
    await createAuditLog(
      req.user!.id,
      'SEASON_ROLLOVER_SHELL_CREATED',
      'SEASON',
      preview.nextSeasonId,
      undefined,
      { sourceSeasonId: seasonId, nextSeasonId: preview.nextSeasonId },
      undefined,
      req.user?.username || 'admin',
      'Non-destructive next-season shell created; current season preserved.'
    ).catch(() => {});
    res.json({ success: true, nextSeasonId: preview.nextSeasonId, destructiveActions: false });
  } catch (error: any) {
    res.status(503).json({ error: 'SEASON_ROLLOVER_FAILED', message: error?.message || String(error) });
  }
});
