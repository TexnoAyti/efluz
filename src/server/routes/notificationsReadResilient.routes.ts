import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/authMiddleware';
import {
  getUserNotificationsFirestore,
  markNotificationsReadFirestore,
  markSingleNotificationReadFirestore,
} from '../firebase/firestoreStore';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';

export const notificationsReadResilientRouter = Router();

// Apply strict non-public caching headers to all notification endpoints
notificationsReadResilientRouter.use((req: Request, res: Response, next) => {
  res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// GET /api/me/notifications
notificationsReadResilientRouter.get('/notifications', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  try {
    const notifications = await getUserNotificationsFirestore(userId, 30);
    res.json({ notifications });
  } catch (err: any) {
    handleFirestoreError(res, err, 'GET /api/me/notifications');
  }
});

// POST /api/me/notifications/read
notificationsReadResilientRouter.post('/notifications/read', requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { notificationId } = req.body || {};
  try {
    if (notificationId && typeof notificationId === 'string') {
      await markSingleNotificationReadFirestore(userId, notificationId);
    } else {
      await markNotificationsReadFirestore(userId);
    }
    res.json({ success: true });
  } catch (err: any) {
    handleFirestoreError(res, err, 'POST /api/me/notifications/read');
  }
});
