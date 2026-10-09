import { Router, Request, Response } from 'express';
import { getAllSeasonsFirestore, getActiveSeasonFirestore } from '../firebase/firestoreStore';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';

export const seasonsRouter = Router();

seasonsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const seasons = await getAllSeasonsFirestore();
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json({ seasons });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/seasons');
  }
});

seasonsRouter.get('/active', async (req: Request, res: Response) => {
  try {
    const season = await getActiveSeasonFirestore();
    if (!season) {
      res.status(404).json({ error: 'Active season not found', code: 'NOT_FOUND', message: 'Active season not found' });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json({ season });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/seasons/active');
  }
});

seasonsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const seasons = await getAllSeasonsFirestore();
    const season = seasons.find((s) => s.id === req.params.id);
    if (!season) {
      res.status(404).json({ error: 'Season not found', code: 'NOT_FOUND', message: `Season '${req.params.id}' not found` });
      return;
    }
    res.json({ season });
  } catch (err: any) {
    handleFirestoreError(res, err, `GET /api/seasons/${req.params.id}`);
  }
});
