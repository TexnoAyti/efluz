import { Router, Request, Response } from 'express';
import { queryAll, queryGet } from '../db';
import { Season } from '../../types';

export const seasonsRouter = Router();

seasonsRouter.get('/', (req: Request, res: Response) => {
  const rows = queryAll<any>('SELECT * FROM seasons ORDER BY start_date DESC');
  const seasons: Season[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    startDate: r.start_date,
    endDate: r.end_date,
    createdAt: r.created_at,
  }));
  res.json({ seasons });
});

seasonsRouter.get('/:id', (req: Request, res: Response) => {
  const row = queryGet<any>('SELECT * FROM seasons WHERE id = ?', [req.params.id]);
  if (!row) {
    res.status(404).json({ error: 'Season not found' });
    return;
  }
  const season: Season = {
    id: row.id,
    name: row.name,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
  };
  res.json({ season });
});
