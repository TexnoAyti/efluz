import { Router, Request, Response } from 'express';
import { getAllSeasonsFirestore, getActiveSeasonFirestore } from '../firebase/firestoreStore';

export const seasonsRouter = Router();

seasonsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const seasons = await getAllSeasonsFirestore();
    res.json({ seasons });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch seasons', message: err.message });
  }
});

seasonsRouter.get('/active', async (req: Request, res: Response) => {
  try {
    const season = await getActiveSeasonFirestore();
    if (!season) {
      res.status(404).json({ error: 'Active season not found' });
      return;
    }
    res.json({ season });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch active season', message: err.message });
  }
});

seasonsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const seasons = await getAllSeasonsFirestore();
    const season = seasons.find((s) => s.id === req.params.id);
    if (!season) {
      res.status(404).json({ error: 'Season not found' });
      return;
    }
    res.json({ season });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch season', message: err.message });
  }
});
