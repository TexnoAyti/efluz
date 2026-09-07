import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import { dbTransaction, queryGet, queryRun } from '../db';
import { enqueueMutation } from '../sync/mutationQueue';

export const adminOfflineControlsRouter = Router();
adminOfflineControlsRouter.use(requireAdmin);

adminOfflineControlsRouter.post('/clubs/:id/release', async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const clubId = req.params.id;
  const seasonId = (req.body?.seasonId as string) || 'season-2026-27';
  const now = new Date().toISOString();

  try {
    const result = dbTransaction(() => {
      const membership = queryGet<any>(
        "SELECT * FROM club_memberships WHERE season_id = ? AND club_id = ? AND status = 'active' LIMIT 1",
        [seasonId, clubId]
      );
      if (!membership) throw new Error(`Club '${clubId}' is not currently assigned.`);

      queryRun("UPDATE club_memberships SET status = 'released', updated_at = ? WHERE id = ?", [now, membership.id]);
      queryRun("DELETE FROM active_occupancies_cache WHERE season_id = ? AND club_id = ?", [seasonId, clubId]);
      queryRun(
        `INSERT INTO audit_logs
          (id, actor_user_id, actor_username, action, entity_type, entity_id, old_value_json, new_value_json, created_at)
         VALUES (?, ?, ?, 'ADMIN_RELEASE_CLUB', 'club', ?, ?, ?, ?)`,
        [
          `audit_release_${seasonId}_${clubId}_${now}`,
          adminUserId,
          req.user!.username || 'admin',
          clubId,
          JSON.stringify({ userId: membership.user_id, seasonId, status: 'active' }),
          JSON.stringify({ userId: membership.user_id, seasonId, status: 'released' }),
          now,
        ]
      );
      enqueueMutation({
        mutationId: `admin_release_${seasonId}_${clubId}_${now}`,
        entityType: 'ADMIN_RELEASE_CLUB',
        entityId: clubId,
        operation: 'ADMIN_RELEASE_CLUB',
        payload: { adminUserId, clubId, seasonId, userId: membership.user_id, releasedAt: now },
        createdAt: now,
      });
      return { clubId, seasonId, releasedUserId: membership.user_id };
    });

    res.json({ success: true, source: 'SQLITE', syncStatus: 'PENDING_FIRESTORE_SYNC', ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Could not release club', code: 'ADMIN_RELEASE_CLUB_FAILED' });
  }
});

adminOfflineControlsRouter.post('/clubs/:id/assign', async (req: Request, res: Response) => {
  const adminUserId = req.user!.id;
  const clubId = req.params.id;
  const targetUserId = typeof req.body?.targetUserId === 'string' ? req.body.targetUserId : '';
  const seasonId = (req.body?.seasonId as string) || 'season-2026-27';
  const now = new Date().toISOString();

  if (!targetUserId) {
    res.status(400).json({ error: 'targetUserId is required', code: 'BAD_REQUEST' });
    return;
  }

  try {
    const result = dbTransaction(() => {
      const club = queryGet<any>('SELECT * FROM clubs WHERE id = ?', [clubId]);
      if (!club) throw new Error(`Club '${clubId}' does not exist.`);
      const user = queryGet<any>('SELECT * FROM users WHERE id = ?', [targetUserId]);
      if (!user) throw new Error(`User '${targetUserId}' does not exist.`);
      if (Number(user.is_suspended)) throw new Error('Cannot assign a club to a suspended user.');

      const existingUser = queryGet<any>(
        "SELECT * FROM club_memberships WHERE season_id = ? AND user_id = ? AND status = 'active' LIMIT 1",
        [seasonId, targetUserId]
      );
      if (existingUser) throw new Error('This user already has an active club in this season.');

      const existingClub = queryGet<any>(
        "SELECT * FROM club_memberships WHERE season_id = ? AND club_id = ? AND status = 'active' LIMIT 1",
        [seasonId, clubId]
      );
      if (existingClub) throw new Error('This club is already assigned in this season.');

      const membershipId = `cm-${seasonId}-${clubId}`;
      queryRun(
        `INSERT INTO club_memberships (id, season_id, club_id, user_id, claimed_at, status, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        [membershipId, seasonId, clubId, targetUserId, now, now]
      );
      queryRun(
        `INSERT OR REPLACE INTO active_occupancies_cache
          (club_id, season_id, user_id, username, display_name, status, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
        [clubId, seasonId, targetUserId, user.username || null, `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || targetUserId, now]
      );
      queryRun(
        `INSERT INTO audit_logs
          (id, actor_user_id, actor_username, action, entity_type, entity_id, new_value_json, created_at)
         VALUES (?, ?, ?, 'ADMIN_ASSIGN_CLUB', 'club', ?, ?, ?)`,
        [
          `audit_assign_${seasonId}_${clubId}_${now}`,
          adminUserId,
          req.user!.username || 'admin',
          clubId,
          JSON.stringify({ targetUserId, seasonId, status: 'active' }),
          now,
        ]
      );
      enqueueMutation({
        mutationId: `admin_assign_${seasonId}_${clubId}_${targetUserId}`,
        entityType: 'ADMIN_ASSIGN_CLUB',
        entityId: clubId,
        operation: 'ADMIN_ASSIGN_CLUB',
        payload: { adminUserId, clubId, targetUserId, seasonId, claimedAt: now },
        createdAt: now,
      });

      return { clubId, seasonId, assignedUserId: targetUserId, username: user.username || '' };
    });

    res.json({ success: true, source: 'SQLITE', syncStatus: 'PENDING_FIRESTORE_SYNC', ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Could not assign club', code: 'ADMIN_ASSIGN_CLUB_FAILED' });
  }
});

function getMatchdayState(competitionId: string) {
  const row = queryGet<any>('SELECT value_json FROM system_settings WHERE key = ?', [`matchday:${competitionId}`]);
  if (!row?.value_json) return { currentMatchday: 1, durationHours: 30, nextOpenAt: null, overrideStatus: 'AUTO' };
  try {
    const parsed = JSON.parse(row.value_json);
    return {
      currentMatchday: Number(parsed.currentMatchday || 1),
      durationHours: Number(parsed.durationHours || 30),
      nextOpenAt: parsed.nextOpenAt || null,
      overrideStatus: parsed.overrideStatus || 'AUTO',
    };
  } catch {
    return { currentMatchday: 1, durationHours: 30, nextOpenAt: null, overrideStatus: 'AUTO' };
  }
}

function persistMatchdayState(competitionId: string, state: any, now: string) {
  queryRun(
    'INSERT OR REPLACE INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?)',
    [`matchday:${competitionId}`, JSON.stringify(state), now]
  );
}

function queueMatchday(competitionId: string, operation: string, state: any, now: string) {
  enqueueMutation({
    mutationId: `matchday_${operation.toLowerCase()}_${competitionId}_${now}`,
    entityType: 'MATCHDAY_OVERRIDE',
    entityId: competitionId,
    operation,
    payload: { competitionId, ...state, updatedAt: now },
    createdAt: now,
  });
}

adminOfflineControlsRouter.get('/competitions/:id/matchday/state', async (req: Request, res: Response) => {
  res.json({ competitionId: req.params.id, source: 'SQLITE', state: getMatchdayState(req.params.id) });
});

adminOfflineControlsRouter.post('/competitions/:id/matchday/override', async (req: Request, res: Response) => {
  const competitionId = req.params.id;
  const overrideStatus = req.body?.overrideStatus as string;
  if (!['AUTO', 'FORCE_OPEN', 'FORCE_LOCKED', 'PAUSED'].includes(overrideStatus)) {
    res.status(400).json({ error: 'Valid overrideStatus is required (AUTO, FORCE_OPEN, FORCE_LOCKED, PAUSED)', code: 'BAD_REQUEST' });
    return;
  }
  const now = new Date().toISOString();
  try {
    const state = { ...getMatchdayState(competitionId), overrideStatus };
    dbTransaction(() => { persistMatchdayState(competitionId, state, now); queueMatchday(competitionId, 'SET_MATCHDAY_OVERRIDE', state, now); });
    res.json({ success: true, source: 'SQLITE', syncStatus: 'PENDING_FIRESTORE_SYNC', competitionId, state });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Could not set matchday override', code: 'MATCHDAY_OVERRIDE_FAILED' });
  }
});

adminOfflineControlsRouter.post('/competitions/:id/matchday/advance', async (req: Request, res: Response) => {
  const competitionId = req.params.id;
  const now = new Date().toISOString();
  const current = getMatchdayState(competitionId);
  const durationHours = Number(req.body?.durationHours || current.durationHours || 30);
  const state = {
    currentMatchday: Math.max(1, current.currentMatchday + 1),
    durationHours,
    nextOpenAt: new Date(Date.now() + durationHours * 3600000).toISOString(),
    overrideStatus: current.overrideStatus,
  };
  try {
    dbTransaction(() => { persistMatchdayState(competitionId, state, now); queueMatchday(competitionId, 'ADVANCE_MATCHDAY', state, now); });
    res.json({ success: true, source: 'SQLITE', syncStatus: 'PENDING_FIRESTORE_SYNC', competitionId, state });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Could not advance matchday', code: 'MATCHDAY_ADVANCE_FAILED' });
  }
});

adminOfflineControlsRouter.post('/competitions/:id/matchday/open-now', async (req: Request, res: Response) => {
  const competitionId = req.params.id;
  const now = new Date().toISOString();
  const durationHours = Number(req.body?.durationHours || 30);
  const state = { ...getMatchdayState(competitionId), nextOpenAt: new Date(Date.now() + durationHours * 3600000).toISOString(), durationHours, overrideStatus: 'FORCE_OPEN' };
  try {
    dbTransaction(() => { persistMatchdayState(competitionId, state, now); queueMatchday(competitionId, 'OPEN_MATCHDAY_NOW', state, now); });
    res.json({ success: true, source: 'SQLITE', syncStatus: 'PENDING_FIRESTORE_SYNC', competitionId, state });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Could not open matchday', code: 'MATCHDAY_OPEN_FAILED' });
  }
});

adminOfflineControlsRouter.post('/competitions/:id/matchday/set-timer', async (req: Request, res: Response) => {
  const competitionId = req.params.id;
  const now = new Date().toISOString();
  const current = getMatchdayState(competitionId);
  const state = {
    currentMatchday: Number(req.body?.currentMatchday || current.currentMatchday),
    durationHours: Number(req.body?.durationHours || current.durationHours || 30),
    nextOpenAt: req.body?.nextOpenAt || current.nextOpenAt,
    overrideStatus: req.body?.overrideStatus || current.overrideStatus,
  };
  try {
    dbTransaction(() => { persistMatchdayState(competitionId, state, now); queueMatchday(competitionId, 'SET_MATCHDAY_TIMER', state, now); });
    res.json({ success: true, source: 'SQLITE', syncStatus: 'PENDING_FIRESTORE_SYNC', competitionId, state });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Could not set matchday timer', code: 'MATCHDAY_TIMER_FAILED' });
  }
});
