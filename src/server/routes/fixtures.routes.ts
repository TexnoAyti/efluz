import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import {
  getFixtureByIdFirestore,
  submitFixtureResultFirestore,
} from '../firebase/firestoreStore';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';
import { invalidateFixtureReadModels, invalidateStandingsReadModels, refreshChangedFixtureReadModel } from '../readModel/readModelStore';

export const fixturesRouter = Router();
export const fixturesResilientRouter = fixturesRouter;

const resultSubmissionSchema = z.object({
  homeScore: z.number().int().min(0, 'Home score must be >= 0').max(99, 'Home score must be <= 99'),
  awayScore: z.number().int().min(0, 'Away score must be >= 0').max(99, 'Away score must be <= 99'),
  proofUrl: z.string().url().max(2048).refine((value) => new URL(value).protocol === 'https:', {
    message: 'Proof URL must use HTTPS',
  }).optional(),
});

fixturesRouter.get('/:id', async (req: Request, res: Response) => {
  const currentUserId = req.user?.id;
  try {
    const fixture = await getFixtureByIdFirestore(req.params.id, currentUserId);
    if (!fixture) {
      res.status(404).json({ error: 'Fixture not found', code: 'NOT_FOUND', message: `Fixture '${req.params.id}' not found` });
      return;
    }
    res.json({ fixture });
  } catch (err: any) {
    handleFirestoreError(res, err, `GET /api/fixtures/${req.params.id}`);
  }
});

fixturesRouter.post('/:id/result', requireAuth, validateBody(resultSubmissionSchema), async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const fixtureId = req.params.id;
  const { homeScore, awayScore, proofUrl } = req.body;

  try {
    const updatedFixture = await submitFixtureResultFirestore(userId, fixtureId, homeScore, awayScore, proofUrl);
    await refreshChangedFixtureReadModel(fixtureId).catch(() => invalidateFixtureReadModels(updatedFixture.competitionId, updatedFixture.seasonId || 'season-2026-27')).catch(() => {});
    res.json({
      success: true,
      message:
        updatedFixture.status === 'CONFIRMED'
          ? 'Match result confirmed!'
          : updatedFixture.status === 'DISPUTED'
          ? 'Scores differ! Match has been marked DISPUTED and sent to admin.'
          : 'Score submitted! Awaiting opponent confirmation.',
      fixture: updatedFixture,
    });
  } catch (err: any) {
    handleFirestoreError(res, err, `POST /api/fixtures/${fixtureId}/result`);
  }
});
