import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validationMiddleware';
import { getFixtureById } from '../services/fixtureService';
import { submitFixtureResult, ResultSubmissionError } from '../services/resultService';

export const fixturesRouter = Router();

const resultSubmissionSchema = z.object({
  homeScore: z.number().int().min(0, 'Home score must be >= 0'),
  awayScore: z.number().int().min(0, 'Away score must be >= 0'),
  proofUrl: z.string().optional(),
});

fixturesRouter.get('/:id', (req: Request, res: Response) => {
  const currentUserId = req.user?.id;
  const fixture = getFixtureById(req.params.id, currentUserId);
  if (!fixture) {
    res.status(404).json({ error: 'Fixture not found' });
    return;
  }
  res.json({ fixture });
});

fixturesRouter.post('/:id/result', requireAuth, validateBody(resultSubmissionSchema), (req: Request, res: Response) => {
  const userId = req.user!.id;
  const fixtureId = req.params.id;
  const { homeScore, awayScore, proofUrl } = req.body;

  try {
    const updatedFixture = submitFixtureResult(userId, fixtureId, homeScore, awayScore, proofUrl);
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
    if (err instanceof ResultSubmissionError) {
      res.status(400).json({ error: 'Bad Request', message: err.message });
      return;
    }
    console.error('Error submitting result:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to submit result.' });
  }
});
