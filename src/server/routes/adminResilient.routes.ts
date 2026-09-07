import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/authMiddleware';
import { dbTransaction, queryAll, queryGet, queryRun } from '../db';
import { SEED_CLUBS, SEED_COMPETITIONS, SEED_LEAGUES } from '../db/seed';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { getReadMetrics } from '../firebase/firestoreStore';
import { enqueueMutation } from '../sync/mutationQueue';
import { refreshMaterializedStandingsForCompetition } from '../db/sqliteStandings';

export const adminResilientRouter = Router();
adminResilientRouter.use(requireAdmin);

adminResilientRouter.get('/overview', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const registeredUsers = Number(queryGet<any>('SELECT COUNT(*) AS count FROM users')?.count ?? 0);
  const activeOccupancies = Number(queryGet<any>(
    "SELECT COUNT(*) AS count FROM club_memberships WHERE season_id = ? AND status = 'active'",
    [seasonId]
  )?.count ?? 0);
  const openDisputes = Number(queryGet<any>(
    "SELECT COUNT(*) AS count FROM disputes WHERE season_id = ? AND status = 'OPEN'",
    [seasonId]
  )?.count ?? 0);
  const pendingResultConfirmations = Number(queryGet<any>(
    "SELECT COUNT(*) AS count FROM fixtures WHERE season_id = ? AND status IN ('PENDING_CONFIRMATION','AWAITING_RESULT','DISPUTED')",
    [seasonId]
  )?.count ?? 0);
  const recentAuditLogs = Number(queryGet<any>('SELECT COUNT(*) AS count FROM audit_logs')?.count ?? 0);
  const competitions = SEED_COMPETITIONS.filter((c) => c.seasonId === seasonId && !c.id.includes('trophee-des-champions') && !c.id.includes('conference-league') && !c.id.includes('uecl'));

  res.json({
    season: { id: seasonId, name: '2026/27 Season', status: 'ACTIVE' },
    counts: {
      totalClubs: SEED_CLUBS.length,
      occupiedClubs: activeOccupancies,
      availableClubs: Math.max(0, SEED_CLUBS.length - activeOccupancies),
      domesticLeaguesCount: SEED_LEAGUES.length,
      domesticCupsCount: competitions.filter((c: any) => c.type === 'cup').length,
      europeanCompetitionsCount: competitions.filter((c: any) => ['champions_league', 'europa_league', 'conference_league'].includes(c.type)).length,
      totalCompetitions: competitions.length,
      totalUsers: registeredUsers,
      registeredUsers,
      activeOccupancies,
      openDisputes,
      pendingResultConfirmations,
      recentAuditLogs,
    },
    systemHealth: {
      connected: firestoreCircuitBreaker.getOperationMode() === 'FIRESTORE_PRIMARY',
      databaseMode: firestoreCircuitBreaker.getOperationMode(),
      timestamp: new Date().toISOString(),
    },
    openDisputes: queryAll<any>(
      "SELECT * FROM disputes WHERE season_id = ? AND status = 'OPEN' ORDER BY created_at DESC LIMIT 10",
      [seasonId]
    ),
    pendingFixturesPreview: queryAll<any>(
      "SELECT * FROM fixtures WHERE season_id = ? AND status IN ('PENDING_CONFIRMATION','AWAITING_RESULT','DISPUTED') ORDER BY updated_at DESC LIMIT 5",
      [seasonId]
    ),
  });
});

adminResilientRouter.get('/firestore-diagnostics', async (_req: Request, res: Response) => {
  const status = firestoreCircuitBreaker.getStatus();
  const count = (table: string) => Number(queryGet<any>(`SELECT COUNT(*) AS count FROM ${table}`)?.count ?? 0);

  res.json({
    connected: status.operationMode === 'FIRESTORE_PRIMARY',
    databaseMode: status.operationMode,
    circuitBreaker: status,
    readMetrics: getReadMetrics(),
    collections: {
      users: count('users'),
      clubs: count('clubs'),
      club_occupancies: count('active_occupancies_cache'),
      user_memberships: count('club_memberships'),
      fixtures: count('fixtures'),
      competitions: count('competitions'),
      competition_standings: count('competition_standings'),
      pending_mutations: count('pending_mutations'),
    },
  });
});

adminResilientRouter.get('/users', async (_req: Request, res: Response) => {
  const users = queryAll<any>(
    'SELECT id, telegram_id AS telegramId, username, first_name AS firstName, last_name AS lastName, photo_url AS photoUrl, is_admin AS isAdmin, is_suspended AS isSuspended, created_at AS createdAt, updated_at AS updatedAt FROM users ORDER BY created_at DESC'
  );
  res.json({ users });
});

adminResilientRouter.get('/clubs', async (req: Request, res: Response) => {
  const leagueId = req.query.leagueId as string | undefined;
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const target = leagueId && leagueId !== 'ALL'
    ? SEED_CLUBS.filter((club) => club.leagueId === leagueId)
    : SEED_CLUBS;

  const clubs = target.map((club) => {
    const occupancy = queryGet<any>(
      "SELECT user_id AS userId FROM club_memberships WHERE season_id = ? AND club_id = ? AND status = 'active' LIMIT 1",
      [seasonId, club.id]
    );
    return {
      id: club.id,
      name: club.name,
      shortName: club.shortName,
      country: club.country,
      leagueId: club.leagueId,
      logoUrl: club.logoUrl,
      active: true,
      isTaken: Boolean(occupancy),
      claimedByUserId: occupancy?.userId,
      seasonId,
    };
  });

  res.json({ clubs, total: clubs.length });
});

adminResilientRouter.get('/disputes', async (req: Request, res: Response) => {
  const status = (req.query.status as string) || 'OPEN';
  const disputes = queryAll<any>(
    'SELECT * FROM disputes WHERE status = ? ORDER BY created_at DESC',
    [status]
  );
  res.json({ disputes });
});

adminResilientRouter.get('/fixtures', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const competitionId = req.query.competitionId as string | undefined;
  const status = req.query.status as string | undefined;
  const matchday = req.query.matchday ? parseInt(req.query.matchday as string, 10) : undefined;
  const limit = Math.min(500, Math.max(1, req.query.limit ? parseInt(req.query.limit as string, 10) : 150));
  const where: string[] = ['season_id = ?'];
  const params: any[] = [seasonId];
  if (competitionId && competitionId !== 'ALL') { where.push('competition_id = ?'); params.push(competitionId); }
  if (status && status !== 'ALL') { where.push('status = ?'); params.push(status); }
  if (matchday) { where.push('matchday = ?'); params.push(matchday); }
  params.push(limit);
  const fixtures = queryAll<any>(
    `SELECT * FROM fixtures WHERE ${where.join(' AND ')} ORDER BY matchday ASC, scheduled_at ASC LIMIT ?`,
    params
  );
  res.json({ fixtures, total: fixtures.length });
});

adminResilientRouter.get('/results/pending', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const pendingFixtures = queryAll<any>(
    "SELECT * FROM fixtures WHERE season_id = ? AND status IN ('PENDING_CONFIRMATION','AWAITING_RESULT','DISPUTED') ORDER BY updated_at DESC",
    [seasonId]
  );
  res.json({ pendingFixtures, total: pendingFixtures.length });
});

const approveResultSchema = z.object({
  homeScore: z.number().int().min(0),
  awayScore: z.number().int().min(0),
  notes: z.string().optional(),
});

/**
 * Local-first admin result approval. The SQLite transaction commits the
 * authoritative local fixture state and materialized standings before the
 * mutation is queued for Firestore reconciliation.
 */
adminResilientRouter.post('/results/:fixtureId/approve', async (req: Request, res: Response) => {
  const parsed = approveResultSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid result payload', code: 'BAD_REQUEST', details: parsed.error.flatten() });
    return;
  }

  const adminUserId = req.user!.id;
  const fixtureId = req.params.fixtureId;
  const { homeScore, awayScore, notes } = parsed.data;
  const now = new Date().toISOString();

  try {
    const result = dbTransaction(() => {
      const fixture = queryGet<any>('SELECT * FROM fixtures WHERE id = ?', [fixtureId]);
      if (!fixture) throw new Error(`Fixture '${fixtureId}' not found.`);

      let winnerClubId: string | null = null;
      if (homeScore > awayScore) winnerClubId = fixture.home_club_id;
      else if (awayScore > homeScore) winnerClubId = fixture.away_club_id;

      queryRun(
        `UPDATE fixtures
            SET status = 'CONFIRMED', home_score = ?, away_score = ?, winner_club_id = ?,
                result_confirmed_at = ?, updated_at = ?
          WHERE id = ?`,
        [homeScore, awayScore, winnerClubId, now, now, fixtureId]
      );

      queryRun(
        `UPDATE disputes
            SET status = 'RESOLVED', resolved_by_user_id = ?, resolution_notes = ?, resolved_at = ?
          WHERE fixture_id = ? AND status = 'OPEN'`,
        [adminUserId, notes || 'Approved by tournament administrator', now, fixtureId]
      );

      queryRun(
        `INSERT INTO audit_logs
          (id, actor_user_id, actor_username, action, entity_type, entity_id, old_value_json, new_value_json, created_at)
         VALUES (?, ?, ?, 'ADMIN_APPROVE_RESULT', 'fixture', ?, ?, ?, ?)`,
        [
          `audit_${fixtureId}_${now}`,
          adminUserId,
          req.user!.username || 'admin',
          fixtureId,
          JSON.stringify({ status: fixture.status, homeScore: fixture.home_score, awayScore: fixture.away_score }),
          JSON.stringify({ status: 'CONFIRMED', homeScore, awayScore, winnerClubId, notes: notes || null }),
          now,
        ]
      );

      const standings = refreshMaterializedStandingsForCompetition(fixture.competition_id);

      enqueueMutation({
        mutationId: `admin_approve_${fixtureId}_${homeScore}_${awayScore}`,
        entityType: 'ADMIN_APPROVE_RESULT',
        entityId: fixtureId,
        operation: 'ADMIN_APPROVE_RESULT',
        payload: { adminUserId, fixtureId, homeScore, awayScore, notes: notes || null },
        createdAt: now,
      });

      return { fixtureId, competitionId: fixture.competition_id, standings };
    });

    res.json({
      success: true,
      source: 'SQLITE',
      syncStatus: 'PENDING_FIRESTORE_SYNC',
      ...result,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Could not approve fixture result', code: 'ADMIN_APPROVE_FAILED' });
  }
});

/** Local-first rejection: reset the fixture and queue a Firestore mutation. */
adminResilientRouter.post('/results/:fixtureId/reject', async (req: Request, res: Response) => {
  const fixtureId = req.params.fixtureId;
  const adminUserId = req.user!.id;
  const notes = typeof req.body?.notes === 'string' && req.body.notes.trim()
    ? req.body.notes.trim()
    : 'Rejected by tournament administrator';
  const now = new Date().toISOString();

  try {
    const result = dbTransaction(() => {
      const fixture = queryGet<any>('SELECT * FROM fixtures WHERE id = ?', [fixtureId]);
      if (!fixture) throw new Error(`Fixture '${fixtureId}' not found.`);

      queryRun(
        `UPDATE fixtures
            SET status = 'SCHEDULED', home_score = NULL, away_score = NULL, winner_club_id = NULL,
                result_confirmed_at = NULL, updated_at = ?
          WHERE id = ?`,
        [now, fixtureId]
      );

      queryRun(
        `DELETE FROM result_submissions WHERE fixture_id = ?`,
        [fixtureId]
      );

      queryRun(
        `UPDATE disputes
            SET status = 'CANCELLED', resolved_by_user_id = ?, resolution_notes = ?, resolved_at = ?
          WHERE fixture_id = ? AND status = 'OPEN'`,
        [adminUserId, notes, now, fixtureId]
      );

      queryRun(
        `INSERT INTO audit_logs
          (id, actor_user_id, actor_username, action, entity_type, entity_id, old_value_json, new_value_json, created_at)
         VALUES (?, ?, ?, 'ADMIN_REJECT_RESULT', 'fixture', ?, ?, ?, ?)`,
        [
          `audit_reject_${fixtureId}_${now}`,
          adminUserId,
          req.user!.username || 'admin',
          fixtureId,
          JSON.stringify({ status: fixture.status, homeScore: fixture.home_score, awayScore: fixture.away_score }),
          JSON.stringify({ status: 'SCHEDULED', notes }),
          now,
        ]
      );

      const standings = refreshMaterializedStandingsForCompetition(fixture.competition_id);

      enqueueMutation({
        mutationId: `admin_reject_${fixtureId}_${now}`,
        entityType: 'ADMIN_REJECT_RESULT',
        entityId: fixtureId,
        operation: 'ADMIN_REJECT_RESULT',
        payload: { adminUserId, fixtureId, notes },
        createdAt: now,
      });

      return { fixtureId, competitionId: fixture.competition_id, standings };
    });

    res.json({
      success: true,
      source: 'SQLITE',
      syncStatus: 'PENDING_FIRESTORE_SYNC',
      ...result,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Could not reject fixture result', code: 'ADMIN_REJECT_FAILED' });
  }
});

adminResilientRouter.get('/audit-logs', async (req: Request, res: Response) => {
  const limit = Math.min(200, Math.max(1, req.query.limit ? parseInt(req.query.limit as string, 10) : 50));
  const logs = queryAll<any>(
    'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?',
    [limit]
  );
  res.json({ logs });
});

adminResilientRouter.get('/read-metrics', (_req: Request, res: Response) => {
  res.json({ metrics: getReadMetrics(), circuitBreaker: firestoreCircuitBreaker.getStatus(), timestamp: new Date().toISOString() });
});
