import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/authMiddleware';
import { handleFirestoreError } from '../firebase/firestoreErrorHandler';
import { listAdminNotifications, listAdminNotificationMessages, setBroadcastVisibility, setNotificationTypeVisibility, setNotificationVisibility } from '../services/notificationVisibility';

export const adminNotificationsRouter = Router();
adminNotificationsRouter.use(requireAdmin);
adminNotificationsRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
adminNotificationsRouter.get('/league-reminder-health', async (_req, res) => {
  try {
    const {getFirestoreDb} = await import('../firebase/admin');
    const {CURRENT_SEASON_ID} = await import('../../lib/seasonParticipationPolicy');
    const state = (await getFirestoreDb().collection('league_reminder_workers').doc(CURRENT_SEASON_ID).get()).data();
    const {getBroadcastHistory} = await import('../services/telegramNotificationQueue');
    const records = state ? (await getBroadcastHistory(Number.MAX_SAFE_INTEGER)).filter(r => r.leagueReminder?.day === state.day && r.leagueReminder?.seasonId === CURRENT_SEASON_ID) : [];
    const delivery = {sent:0,failed:0,pending:0,skipped:0,uncertain:0};
    for (const r of records) for (const recipient of r.recipients) {
      if (recipient.status === 'SENT') delivery.sent++;
      else if (recipient.status === 'FAILED') { delivery.failed++; if (recipient.error?.includes('DELIVERY_UNKNOWN')) delivery.uncertain++; }
      else if (recipient.status === 'SKIPPED_NO_TELEGRAM') delivery.skipped++;
      else delivery.pending++;
    }
    res.json(state ? {delivery,day:state.day,status:state.status,queued:state.queued,skipped:state.skipped,updatedAt:state.updatedAt,lastSliceMs:state.lastSliceMs,lastError:state.lastError,finishedAt:state.finishedAt} : {status:'NOT_RUN'});
  } catch (error) { handleFirestoreError(res,error,'GET league reminder health'); }
});
adminNotificationsRouter.get('/messages', async (req, res) => {
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  if (cursor && (cursor.length > 256 || cursor.includes('/'))) { res.status(400).json({ error: 'INVALID_NOTIFICATION_CURSOR' }); return; }
  try { res.json(await listAdminNotificationMessages(cursor)); }
  catch (error: any) {
    if (error.message === 'INVALID_NOTIFICATION_CURSOR') { res.status(400).json({ error: error.message }); return; }
    handleFirestoreError(res, error, 'GET admin notification messages');
  }
});
adminNotificationsRouter.patch('/messages/:id', async (req, res) => {
  const body = z.object({ visibility: z.enum(['visible', 'hidden', 'deleted']) }).strict().safeParse(req.body);
  if (!body.success || req.params.id.length > 256 || req.params.id.includes('/')) { res.status(400).json({ error: 'INVALID_NOTIFICATION_CONTROL' }); return; }
  try { await setBroadcastVisibility(req.params.id, body.data.visibility); res.json({ success: true }); }
  catch (error: any) {
    if (error.message === 'NOTIFICATION_NOT_FOUND') { res.status(404).json({ error: error.message }); return; }
    if (error.message === 'NOTIFICATION_DELETED') { res.status(409).json({ error: error.message }); return; }
    handleFirestoreError(res, error, 'PATCH notification message visibility');
  }
});
adminNotificationsRouter.get('/', async (req, res) => {
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  if (cursor && (cursor.length > 256 || cursor.includes('/'))) { res.status(400).json({ error: 'INVALID_NOTIFICATION_CURSOR' }); return; }
  try { res.json(await listAdminNotifications(cursor)); }
  catch (error: any) {
    if (error.message === 'INVALID_NOTIFICATION_CURSOR') { res.status(400).json({ error: error.message }); return; }
    handleFirestoreError(res, error, 'GET admin notifications');
  }
});
adminNotificationsRouter.patch('/types/:type', async (req, res) => {
  const body = z.object({ visible: z.boolean() }).strict().safeParse(req.body);
  if (!body.success || !/^[A-Z_]{1,80}$/.test(req.params.type)) { res.status(400).json({ error: 'INVALID_NOTIFICATION_CONTROL' }); return; }
  try { await setNotificationTypeVisibility(req.params.type, body.data.visible); res.json({ success: true }); }
  catch (error) { handleFirestoreError(res, error, 'PATCH notification type'); }
});
adminNotificationsRouter.patch('/:id', async (req, res) => {
  const body = z.object({ visibility: z.enum(['visible', 'hidden', 'deleted']) }).strict().safeParse(req.body);
  if (!body.success || req.params.id.length > 256 || req.params.id.includes('/')) { res.status(400).json({ error: 'INVALID_NOTIFICATION_CONTROL' }); return; }
  try { await setNotificationVisibility(req.params.id, body.data.visibility, req.user!.id); res.json({ success: true }); }
  catch (error: any) {
    if (error.message === 'NOTIFICATION_NOT_FOUND') { res.status(404).json({ error: error.message }); return; }
    if (error.message === 'NOTIFICATION_DELETED') { res.status(409).json({ error: error.message }); return; }
    handleFirestoreError(res, error, 'PATCH notification visibility');
  }
});
