import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import {
  getSeasonLifecycle,
  setSeasonLifecycleOverride,
  LifecyclePhaseId,
} from '../services/seasonLifecycleService';

export const seasonLifecycleRouter = Router();
export const adminSeasonLifecycleRouter = Router();

seasonLifecycleRouter.get('/', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getSeasonLifecycle(seasonId));
  } catch (err: any) {
    res.status(503).json({ error: 'SEASON_LIFECYCLE_UNAVAILABLE', message: err?.message || 'Unable to load season lifecycle' });
  }
});

adminSeasonLifecycleRouter.use(requireAdmin);

adminSeasonLifecycleRouter.post('/override', async (req: Request, res: Response) => {
  const seasonId = req.body?.seasonId || 'season-2026-27';
  const phase = (req.body?.phase || null) as LifecyclePhaseId | null;
  const matchday = Number.isInteger(req.body?.matchday) ? Number(req.body.matchday) : null;
  const reason = String(req.body?.reason || 'admin lifecycle override').slice(0, 500);
  try {
    await setSeasonLifecycleOverride(seasonId, phase, reason, req.user!.id, matchday);
    res.json({ success: true, lifecycle: await getSeasonLifecycle(seasonId, true) });
  } catch (err: any) {
    res.status(400).json({ error: 'LIFECYCLE_OVERRIDE_FAILED', message: err?.message || 'Unable to update lifecycle override' });
  }
});

adminSeasonLifecycleRouter.delete('/override', async (req: Request, res: Response) => {
  const seasonId = String(req.query.seasonId || 'season-2026-27');
  try {
    await setSeasonLifecycleOverride(seasonId, null, 'admin override cleared', req.user!.id, null);
    res.json({ success: true, lifecycle: await getSeasonLifecycle(seasonId, true) });
  } catch (err: any) {
    res.status(400).json({ error: 'LIFECYCLE_OVERRIDE_CLEAR_FAILED', message: err?.message || 'Unable to clear lifecycle override' });
  }
});
