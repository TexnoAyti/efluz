import { Router, Request, Response } from 'express';
import { queryAll, queryGet } from '../db';
import { Competition } from '../../types';
import { calculateCompetitionStandings } from '../tournament/standingsEngine';
import { getFixtures } from '../services/fixtureService';
import { CompetitionEngine } from '../tournament/competitionEngine';
import { requireAdmin } from '../middleware/authMiddleware';

export const competitionsRouter = Router();

competitionsRouter.get('/', (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const rows = queryAll<any>(
    'SELECT * FROM competitions WHERE season_id = ? ORDER BY type ASC, name ASC',
    [seasonId]
  );

  const competitions: Competition[] = rows.map((r) => ({
    id: r.id,
    seasonId: r.season_id,
    leagueId: r.league_id || undefined,
    name: r.name,
    type: r.type,
    scheduleMode: r.schedule_mode,
    status: r.status,
    formatConfig: r.format_config_json ? JSON.parse(r.format_config_json) : {},
    createdAt: r.created_at,
  }));

  res.json({ competitions });
});

competitionsRouter.get('/:id', (req: Request, res: Response) => {
  const row = queryGet<any>('SELECT * FROM competitions WHERE id = ?', [req.params.id]);
  if (!row) {
    res.status(404).json({ error: 'Competition not found' });
    return;
  }

  const competition: Competition = {
    id: row.id,
    seasonId: row.season_id,
    leagueId: row.league_id || undefined,
    name: row.name,
    type: row.type,
    scheduleMode: row.schedule_mode,
    status: row.status,
    formatConfig: row.format_config_json ? JSON.parse(row.format_config_json) : {},
    createdAt: row.created_at,
  };

  res.json({ competition });
});

competitionsRouter.get('/:id/standings', (req: Request, res: Response) => {
  try {
    const standings = calculateCompetitionStandings(req.params.id);
    res.json({ standings });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to calculate standings', message: err.message });
  }
});

competitionsRouter.get('/:id/fixtures', (req: Request, res: Response) => {
  const matchday = req.query.matchday ? parseInt(req.query.matchday as string, 10) : undefined;
  const status = req.query.status as string | undefined;

  const fixtures = getFixtures({
    competitionId: req.params.id,
    matchday,
    status,
  });

  res.json({ fixtures });
});

competitionsRouter.get('/:id/participants', (req: Request, res: Response) => {
  try {
    const rows = queryAll<any>(
      `SELECT 
        cp.*,
        c.name as club_name,
        c.short_name as club_short_name,
        c.logo_url as club_logo_url,
        u.username as owner_username,
        sc.name as source_competition_name
       FROM competition_participants cp
       JOIN clubs c ON cp.club_id = c.id
       LEFT JOIN users u ON cp.owner_user_id = u.id
       LEFT JOIN competitions sc ON cp.source_competition_id = sc.id
       WHERE cp.competition_id = ?
       ORDER BY cp.seed_number ASC, cp.created_at ASC`,
      [req.params.id]
    );

    const participants = rows.map((r) => ({
      id: r.id,
      competitionId: r.competition_id,
      clubId: r.club_id,
      clubName: r.club_name,
      clubShortName: r.club_short_name,
      clubLogoUrl: r.club_logo_url,
      seasonId: r.season_id,
      ownerUserId: r.owner_user_id,
      ownerUsername: r.owner_username,
      sourceCompetitionId: r.source_competition_id,
      sourceCompetitionName: r.source_competition_name,
      sourcePosition: r.source_position,
      qualificationReason: r.qualification_reason,
      qualificationTimestamp: r.qualification_timestamp,
      seedNumber: r.seed_number,
      createdAt: r.created_at,
    }));

    res.json({ participants });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch participants', message: err.message });
  }
});

competitionsRouter.post('/:id/generate-fixtures', requireAdmin, (req: Request, res: Response) => {
  try {
    const force = req.body?.force !== undefined ? Boolean(req.body.force) : true;
    const result = CompetitionEngine.generateSchedule(req.params.id, { force });
    const roundsOrMatchdays = 'matchdays' in result ? result.matchdays : 'rounds' in result ? result.rounds : 0;
    res.json({
      success: true,
      message: `Generated schedule successfully (${result.generated} fixtures across ${roundsOrMatchdays} matchdays/rounds).`,
      result,
    });
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to generate schedule', message: err.message });
  }
});

competitionsRouter.post('/:id/reset-fixtures', requireAdmin, (req: Request, res: Response) => {
  try {
    const result = CompetitionEngine.generateSchedule(req.params.id, { force: true });
    res.json({
      success: true,
      message: `Reset and regenerated schedule successfully.`,
      result,
    });
  } catch (err: any) {
    res.status(400).json({ error: 'Failed to reset schedule', message: err.message });
  }
});
