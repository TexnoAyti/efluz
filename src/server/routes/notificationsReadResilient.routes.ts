import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import { queryAll } from '../db';

export const notificationsReadResilientRouter = Router();
notificationsReadResilientRouter.use(requireAuth);

notificationsReadResilientRouter.get('/notifications', (req: Request, res: Response) => {
  const userId = req.user!.id;
  const rows = queryAll<any>(
    'SELECT id, user_id, type, title, message, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30',
    [userId]
  );

  res.setHeader('Cache-Control', 'private, max-age=15, stale-while-revalidate=60');
  res.setHeader('X-EFLUZ-READ-SOURCE', 'SQLITE_LOCAL');
  res.json({
    notifications: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      type: r.type,
      title: r.title,
      message: r.message,
      isRead: Boolean(r.is_read),
      createdAt: r.created_at,
    })),
    source: 'SQLITE',
  });
});
