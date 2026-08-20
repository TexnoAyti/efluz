import { Router, Request, Response } from 'express';
import { getDb } from '../db';

export const healthRouter = Router();

healthRouter.get('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = db.exec('SELECT 1 as alive;');
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: result.length > 0 ? 'connected' : 'error',
      version: '1.0.0',
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});
