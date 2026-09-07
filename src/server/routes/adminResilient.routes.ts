import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import { queryAll, queryGet } from '../db';
import { SEED_CLUBS, SEED_COMPETITIONS, SEED_LEAGUES } from '../db/seed';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { getReadMetrics } from '../firebase/firestoreStore';

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
