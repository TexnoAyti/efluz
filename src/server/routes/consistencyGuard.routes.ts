import { Router, Request, Response, NextFunction } from 'express';
import { requireAdmin } from '../middleware/authMiddleware';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';
import {
  adminDeleteFixtureFirestore,
  enrichFixturesWithAuthoritativeOwners,
} from '../firebase/firestoreStore';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';
import { queryGet, queryRun } from '../db';
import { SEED_CLUBS } from '../db/seed';
import { isDomesticCup } from '../tournament/domesticCupService';
import {
  ReadModelKeys,
  SCHEMA_VERSION,
  invalidateDataset,
  invalidateFixtureReadModels,
  redisIsDirty,
  redisSetRaw,
} from '../readModel/readModelStore';
import { createAuditLog } from '../services/adminService';
import { Fixture } from '../../types';

export const competitionConsistencyRouter = Router();
export const adminConsistencyRouter = Router();

function mapAuthoritativeFixture(doc: FirebaseFirestore.QueryDocumentSnapshot, seasonId: string): Fixture {
  const row: any = doc.data();
  const homeClubId = row.homeClubId && row.homeClubId !== 'TBD' ? row.homeClubId : null;
  const awayClubId = row.awayClubId && row.awayClubId !== 'TBD' ? row.awayClubId : null;
  const homeSeed = homeClubId ? SEED_CLUBS.find((club) => club.id === homeClubId) : undefined;
  const awaySeed = awayClubId ? SEED_CLUBS.find((club) => club.id === awayClubId) : undefined;
  const toClub = (clubId: string | null, seed: any) => clubId ? ({
    id: clubId,
    name: seed?.name || clubId,
    shortName: seed?.shortName || clubId,
    country: seed?.country || '',
    leagueId: seed?.leagueId || '',
    logoUrl: seed?.logoUrl || '',
    active: true,
    createdAt: '',
  }) : null;

  return {
    id: doc.id,
    seasonId: row.seasonId || seasonId,
    competitionId: row.competitionId,
    competitionName: row.competitionName || row.competitionId,
    matchday: Number(row.matchday || 1),
    roundName: row.roundName,
    homeClubId,
    awayClubId,
    homeClub: toClub(homeClubId, homeSeed),
    awayClub: toClub(awayClubId, awaySeed),
    sourceFixtureId: row.sourceFixtureId ?? null,
    sourceWinnerSlot: row.sourceWinnerSlot ?? null,
    homeSourceFixtureId: row.homeSourceFixtureId ?? null,
    awaySourceFixtureId: row.awaySourceFixtureId ?? null,
    homeSourceWinnerSlot: row.homeSourceWinnerSlot ?? null,
    awaySourceWinnerSlot: row.awaySourceWinnerSlot ?? null,
    scheduledAt: row.scheduledAt || new Date(0).toISOString(),
    status: row.status || 'SCHEDULED',
    homeScore: row.homeScore ?? null,
    awayScore: row.awayScore ?? null,
    winnerClubId: row.winnerClubId ?? null,
    resultConfirmedAt: row.resultConfirmedAt ?? null,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  } as Fixture;
}

/**
 * Domestic cup redraws mark the competition fixture read model dirty. The
 * generic competition reader historically read Redis LKG directly and could
 * therefore resurrect the pre-redraw bracket. Intercept only dirty domestic
 * cup reads, refresh the complete bracket from authoritative Firestore, warm
 * Fresh + LKG, and only then apply request-level filters to the response.
 */
competitionConsistencyRouter.get('/:id/fixtures', async (req: Request, res: Response, next: NextFunction) => {
  const competitionId = req.params.id;
  if (!isDomesticCup(competitionId)) return next();

  const seasonId = (req.query.seasonId as string) || 'season-2026-27';
  const key = ReadModelKeys.competitionFixtures(competitionId, seasonId);

  try {
    const dirty = await redisIsDirty(key);
    if (!dirty) return next();

    const db = getFirestoreDb();
    const snap = await db.collection(COLLECTIONS.FIXTURES)
      .where('competitionId', '==', competitionId)
      .get();

    let fullFixtures = snap.docs
      .filter((doc) => {
        const row: any = doc.data();
        return !row.seasonId || row.seasonId === seasonId;
      })
      .map((doc) => mapAuthoritativeFixture(doc, seasonId));
    fullFixtures = await enrichFixturesWithAuthoritativeOwners(fullFixtures, seasonId);
    fullFixtures.sort((a, b) => Number(a.matchday) - Number(b.matchday) || a.id.localeCompare(b.id));

    await redisSetRaw(key, {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      sourceVersion: 'cup-redraw-authoritative-refresh',
      expectedCount: fullFixtures.length,
      actualCount: fullFixtures.length,
      data: fullFixtures,
    }, 86400);

    let fixtures = fullFixtures;
    if (req.query.matchday !== undefined) {
      const matchday = Number(req.query.matchday);
      if (Number.isInteger(matchday) && matchday > 0) {
        fixtures = fixtures.filter((fixture) => Number(fixture.matchday) === matchday);
      }
    }
    if (typeof req.query.status === 'string' && req.query.status && req.query.status !== 'ALL') {
      fixtures = fixtures.filter((fixture) => fixture.status === req.query.status);
    }

    const snapshotAt = new Date().toISOString();
    res.json({
      fixtures,
      source: 'firestore_redraw_refresh',
      stale: false,
      degraded: false,
      snapshotAt,
    });
  } catch (error: any) {
    console.warn('[CUP_DIRTY_REFRESH_FAILED]', competitionId, error?.message || error);
    next();
  }
});

adminConsistencyRouter.use(requireAdmin);

/**
 * Make fixture deletion idempotent. A stale admin snapshot can contain a
 * fixture already removed from Firestore (for example after a cup redraw or
 * roster repair). Purging that stale row should be success, not HTTP 500.
 */
adminConsistencyRouter.delete('/fixtures/:id', async (req: Request, res: Response) => {
  const fixtureId = req.params.id;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (reason.length < 3) {
    res.status(400).json({ error: 'A reason of at least 3 characters is required to delete a fixture.' });
    return;
  }

  const local = queryGet<any>('SELECT * FROM fixtures WHERE id = ?', [fixtureId]);
  const seasonId = local?.season_id || 'season-2026-27';
  const competitionId = local?.competition_id || '';

  const invalidateFixtureCaches = async () => {
    await invalidateDataset(ReadModelKeys.adminFixtures(seasonId)).catch(() => {});
    if (competitionId) {
      await invalidateDataset(ReadModelKeys.competitionFixtures(competitionId, seasonId)).catch(() => {});
      await invalidateDataset(`cup:bracket:${competitionId}:${seasonId}`).catch(() => {});
      await invalidateFixtureReadModels(competitionId, seasonId).catch(() => {});
    }
  };

  try {
    const result = await adminDeleteFixtureFirestore(
      req.user!.id,
      req.user!.username || 'admin',
      fixtureId,
      reason
    );
    await invalidateFixtureCaches();
    res.json(result);
  } catch (error: any) {
    const message = String(error?.message || '');
    if (!message.includes('not found')) {
      handleFirestoreError(res, error, `DELETE /api/admin/fixtures/${fixtureId}`);
      return;
    }

    try {
      queryRun('DELETE FROM result_submissions WHERE fixture_id = ?', [fixtureId]);
      queryRun('DELETE FROM disputes WHERE fixture_id = ?', [fixtureId]);
      queryRun('DELETE FROM fixtures WHERE id = ?', [fixtureId]);
      await invalidateFixtureCaches();

      await createAuditLog(
        req.user!.id,
        'ADMIN_PURGE_STALE_FIXTURE',
        'fixture',
        fixtureId,
        local || undefined,
        null,
        undefined,
        req.user!.username || 'admin',
        `${reason} (authoritative fixture already absent; stale read-model/local residue purged)`
      ).catch(() => {});

      res.json({
        success: true,
        stalePurged: true,
        message: `Fixture '${fixtureId}' was already absent from Firestore; stale cached/local references were purged successfully.`,
      });
    } catch (cleanupError: any) {
      handleFirestoreError(res, cleanupError, `DELETE /api/admin/fixtures/${fixtureId}`);
    }
  }
});
