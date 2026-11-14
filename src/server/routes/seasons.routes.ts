import { CURRENT_SEASON_ID } from '../../lib/seasonParticipationPolicy';
import { getFirestoreDb } from '../firebase/admin';
import { getSeasonPreparation } from '../../lib/seasonPreparation';
import { previewPreparedLeagueSchedule, previewPreparedCupBracket } from '../services/seasonPreparationService';
import { Router, Request, Response } from 'express';
import { getAllSeasonsFirestore, getActiveSeasonFirestore } from '../firebase/firestoreStore';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';

export const seasonsRouter = Router();

seasonsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const seasons = await getAllSeasonsFirestore();
    const second = await getFirestoreDb().collection('seasons').doc('season-2027-28').get();
    if (second.exists) {
      const index = seasons.findIndex(s => s.id === second.id);
      const live = { ...second.data(), id: second.id } as (typeof seasons)[number];
      if (index >= 0) seasons[index] = live; else seasons.push(live);
    }
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json({ seasons });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/seasons');
  }
});

seasonsRouter.get('/active', async (req: Request, res: Response) => {
  try {
    const second = await getFirestoreDb().collection('seasons').doc('season-2027-28').get();
    const season = second.data()?.status === 'active' ? { ...second.data(), id: second.id } : await getActiveSeasonFirestore();
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

// Static preparation catalog: no database reads or season transitions. Before /:id.
seasonsRouter.get('/preparation', (req: Request, res: Response) => {
  const sourceSeasonId = String(req.query.sourceSeasonId || CURRENT_SEASON_ID);
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ preparation: getSeasonPreparation(sourceSeasonId) });
});

seasonsRouter.get('/preparation/:leagueId/fixtures', (req: Request, res: Response) => {
  const preview = previewPreparedLeagueSchedule(req.params.leagueId);
  if (!preview) {
    res.status(404).json({ error: 'PREPARED_LEAGUE_NOT_FOUND' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(preview);
});

seasonsRouter.get('/preparation/cups/:cupId/bracket', (req: Request, res: Response) => {
  const preview=previewPreparedCupBracket(req.params.cupId);
  if(!preview){res.status(404).json({error:'PREPARED_CUP_NOT_FOUND'});return;}
  res.setHeader('Cache-Control','public, max-age=300');
  res.json(preview);
});

seasonsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const seasons = await getAllSeasonsFirestore();
    const second = await getFirestoreDb().collection('seasons').doc('season-2027-28').get();
    if (second.exists) {
      const index = seasons.findIndex(s => s.id === second.id);
      const live = { ...second.data(), id: second.id } as (typeof seasons)[number];
      if (index >= 0) seasons[index] = live; else seasons.push(live);
    }
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
