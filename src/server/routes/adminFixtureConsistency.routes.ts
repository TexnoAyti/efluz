import { Router, Request, Response } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import { deleteFixture } from '../services/adminService';
import {
  getFixtureByIdFirestore,
  rebuildCompetitionStandingsFirestore,
} from '../firebase/firestoreStore';
import {
  DOMESTIC_LEAGUE_CONFIG,
  ReadModelKeys,
  getFreshKey,
  getLkgKey,
  inProcessMemoryCache,
  redisGetFresh,
  redisGetLkg,
  redisSetRaw,
} from '../readModel/readModelStore';
import type { Fixture, StandingsRow } from '../../types';

export const adminFixtureConsistencyRouter = Router();
adminFixtureConsistencyRouter.use(requireAdmin);

async function republishFixtureDatasetWithoutId(
  datasetKey: string,
  fixtureId: string,
  sourceVersion: string
): Promise<boolean> {
  const current =
    (await redisGetFresh<Fixture[]>(datasetKey)) ||
    (await redisGetLkg<Fixture[]>(datasetKey));

  if (!current || !Array.isArray(current.data)) return false;

  const next = current.data.filter((fixture) => fixture.id !== fixtureId);
  if (next.length === current.data.length) return false;

  inProcessMemoryCache.delete(datasetKey);
  inProcessMemoryCache.delete(getFreshKey(datasetKey));
  inProcessMemoryCache.delete(getLkgKey(datasetKey));

  await redisSetRaw(
    datasetKey,
    {
      ...current,
      generatedAt: new Date().toISOString(),
      sourceVersion,
      expectedCount: Math.max(0, Number(current.expectedCount || current.data.length) - 1),
      actualCount: next.length,
      data: next,
    },
    86400
  );

  return true;
}

export async function removeDeletedFixtureFromDurableReadModels(params: {
  fixtureId: string;
  competitionId?: string | null;
  seasonId?: string | null;
}): Promise<{ adminPatched: boolean; competitionPatched: boolean; standingsPatched: boolean }> {
  const seasonId = params.seasonId || 'season-2026-27';
  const competitionId = params.competitionId || '';
  const sourceVersion = `fixture-delete-${params.fixtureId}-${Date.now()}`;

  const [adminPatched, competitionPatched] = await Promise.all([
    republishFixtureDatasetWithoutId(
      ReadModelKeys.adminFixtures(seasonId),
      params.fixtureId,
      sourceVersion
    ),
    competitionId
      ? republishFixtureDatasetWithoutId(
          ReadModelKeys.competitionFixtures(competitionId, seasonId),
          params.fixtureId,
          sourceVersion
        )
      : Promise.resolve(false),
  ]);

  let standingsPatched = false;
  if (competitionId) {
    try {
      const standings = await rebuildCompetitionStandingsFirestore(competitionId);
      const expectedCount =
        DOMESTIC_LEAGUE_CONFIG[competitionId]?.expectedCount || standings.length;
      const standingsKey = ReadModelKeys.standings(competitionId, seasonId);

      inProcessMemoryCache.delete(standingsKey);
      inProcessMemoryCache.delete(getFreshKey(standingsKey));
      inProcessMemoryCache.delete(getLkgKey(standingsKey));

      await redisSetRaw<StandingsRow[]>(
        standingsKey,
        {
          schemaVersion: 'v1',
          generatedAt: new Date().toISOString(),
          sourceVersion,
          expectedCount,
          actualCount: standings.length,
          data: standings,
        },
        86400
      );
      standingsPatched = true;
    } catch (error: any) {
      console.warn(
        '[FIXTURE_DELETE_STANDINGS_REPUBLISH_FAILED]',
        JSON.stringify({
          fixtureId: params.fixtureId,
          competitionId,
          seasonId,
          error: error?.message || String(error),
        })
      );
    }
  }

  return { adminPatched, competitionPatched, standingsPatched };
}

// This route is intentionally mounted before the legacy admin router.
// Full fixture deletion is the one mutation that cannot use refreshChangedFixtureReadModel()
// because the authoritative document no longer exists after deletion. We therefore remove
// the fixture from both Fresh and durable LKG snapshots and republish standings immediately.
adminFixtureConsistencyRouter.delete('/fixtures/:id', async (req: Request, res: Response) => {
  const fixtureId = String(req.params.id || '').trim();
  const reason = String(req.body?.reason || '').trim();
  const adminUserId = req.user!.id;
  const adminUsername = req.user!.username || 'admin';

  if (!fixtureId) {
    res.status(400).json({ error: 'FIXTURE_ID_REQUIRED' });
    return;
  }
  if (reason.length < 3) {
    res.status(400).json({ error: 'Reason must be at least 3 characters' });
    return;
  }

  try {
    const before = await getFixtureByIdFirestore(fixtureId, adminUserId);
    const result = await deleteFixture(
      adminUserId,
      adminUsername,
      fixtureId,
      reason
    );

    const consistency = await removeDeletedFixtureFromDurableReadModels({
      fixtureId,
      competitionId: before?.competitionId,
      seasonId: before?.seasonId,
    });

    console.log(
      '[FIXTURE_DELETE_CONSISTENCY_APPLIED]',
      JSON.stringify({ fixtureId, ...consistency })
    );

    res.json({ ...result, consistency });
  } catch (error: any) {
    console.error(
      '[FIXTURE_DELETE_CONSISTENCY_FAILED]',
      JSON.stringify({ fixtureId, error: error?.message || String(error) })
    );
    const message = error?.message || 'Fixture deletion failed.';
    const status = message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: message });
  }
});
