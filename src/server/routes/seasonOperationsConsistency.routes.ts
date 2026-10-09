import { Router, Request, Response } from 'express';
import { getSeasonLifecycle, LifecyclePhaseId } from '../services/seasonLifecycleService';
import { getSeasonOperationsOverview, SeasonPhaseId } from '../services/seasonOperationsService';

export const seasonOperationsConsistencyRouter = Router();

const LIFECYCLE_TO_OPERATIONS: Record<LifecyclePhaseId, SeasonPhaseId> = {
  LEAGUE_1_9: 'LEAGUE_MD_1_9',
  DOMESTIC_CUPS: 'DOMESTIC_CUPS',
  LEAGUE_10_19: 'LEAGUE_MD_10_19',
  EUROPE: 'EUROPE_LEAGUE_PHASE',
};

const DOMESTIC_LEAGUES = new Set([
  'comp-premier-league-2026',
  'comp-la-liga-2026',
  'comp-serie-a-2026',
  'comp-bundesliga-2026',
  'comp-ligue-1-2026',
]);
const DOMESTIC_CUPS = new Set([
  'comp-fa-cup-2026',
  'comp-copa-del-rey-2026',
  'comp-coppa-italia-2026',
  'comp-dfb-pokal-2026',
  'comp-coupe-de-france-2026',
]);
const EUROPE = new Set(['comp-champions-league-2026', 'comp-europa-league-2026']);

function deadlinePhase(item: any): SeasonPhaseId | null {
  const md = Number(item.matchday || 0);
  if (DOMESTIC_LEAGUES.has(item.competitionId)) {
    if (md >= 1 && md <= 9) return 'LEAGUE_MD_1_9';
    if (md >= 10 && md <= 19) return 'LEAGUE_MD_10_19';
    return null;
  }
  if (DOMESTIC_CUPS.has(item.competitionId)) return 'DOMESTIC_CUPS';
  if (EUROPE.has(item.competitionId) && md <= 8) return 'EUROPE_LEAGUE_PHASE';
  return 'KNOCKOUT_RUN_IN';
}

seasonOperationsConsistencyRouter.get('/overview', async (req: Request, res: Response) => {
  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  try {
    const [overview, lifecycle] = await Promise.all([
      getSeasonOperationsOverview(seasonId),
      getSeasonLifecycle(seasonId),
    ]);

    const lifecycleByOperationId = new Map(
      lifecycle.phases.map((phase) => [LIFECYCLE_TO_OPERATIONS[phase.id], phase] as const)
    );

    // 2026/27 domestic leagues are one round only (19 matchdays max).
    // Never expose the legacy MD20+ bucket in the roadmap.
    const phases = overview.phases
      .filter((phase) => phase.id !== 'LEAGUE_MD_20_PLUS')
      .map((phase) => {
        const lifecyclePhase = lifecycleByOperationId.get(phase.id);
        if (!lifecyclePhase) return phase;
        return {
          ...phase,
          total: lifecyclePhase.total,
          confirmed: lifecyclePhase.confirmed,
          remaining: Math.max(0, lifecyclePhase.total - lifecyclePhase.confirmed),
          percent: lifecyclePhase.progress,
          status:
            lifecyclePhase.status === 'COMPLETED'
              ? 'DONE'
              : lifecyclePhase.status === 'ACTIVE'
              ? 'ACTIVE'
              : 'UPCOMING',
          currentMatchday: lifecyclePhase.currentMatchday,
        };
      });

    const currentOperationPhaseId = LIFECYCLE_TO_OPERATIONS[lifecycle.currentPhase];
    const currentPhase = phases.find((phase) => phase.id === currentOperationPhaseId) || phases.find((phase) => phase.status === 'ACTIVE') || phases[0];
    const currentLifecyclePhase = lifecycle.phases.find((phase) => phase.id === lifecycle.currentPhase);
    const currentMatchday = currentLifecyclePhase?.currentMatchday || null;

    // Only surface deadlines that users can act on now. Future matchdays and
    // any legacy domestic MD20+ fixtures are out of scope for a 19-matchday season.
    const deadlines = overview.deadlines.filter((item: any) => {
      const itemPhase = deadlinePhase(item);
      if (!itemPhase || itemPhase !== currentOperationPhaseId) return false;
      if (currentMatchday && Number(item.matchday || 0) > currentMatchday) return false;
      return true;
    });

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ...overview,
      phases,
      currentPhase,
      counters: {
        ...overview.counters,
        totalFixtures: lifecycle.phases.reduce((sum, phase) => sum + phase.total, 0),
        confirmedFixtures: lifecycle.phases.reduce((sum, phase) => sum + phase.confirmed, 0),
        overdue: deadlines.filter((item: any) => item.overdue).length,
      },
      deadlines,
      lifecycle: {
        currentPhase: lifecycle.currentPhase,
        currentMatchday,
        overridePhase: lifecycle.overridePhase,
        overrideMatchday: lifecycle.overrideMatchday,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(503).json({
      error: 'SEASON_OPERATIONS_UNAVAILABLE',
      message: error?.message || String(error),
    });
  }
});
