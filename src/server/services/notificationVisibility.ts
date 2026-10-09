import type { Notification } from '../../types';
import { getUpstashClient } from '../readModel/readModelStore';
import { getFirestoreDb } from '../firebase/admin';
import { COLLECTIONS } from '../firebase/collections';

export type NotificationControl = 'visible' | 'hidden' | 'deleted';
export type NotificationControls = Record<string, NotificationControl>;
const key = 'efluz:v1:notification-visibility';
const local: NotificationControls = {};
const defaults = ['MATCH_SCHEDULED', 'RESULT_SUBMITTED', 'RESULT_CONFIRMED', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED', 'CLUB_ASSIGNED', 'NEXT_ROUND_MATCH', 'QUALIFICATION_CONFIRMED', 'COMPETITION_UPDATE', 'SYSTEM'];
const postgresControls = () => getFirestoreDb().collection('runtime_settings').doc('notification-visibility');

export async function getNotificationControls(): Promise<NotificationControls> {
  if (process.env.DATABASE_PROVIDER === 'supabase') return (await postgresControls().get()).data()?.controls || {};
  const redis = getUpstashClient();
  if (redis) return await redis.hgetall<NotificationControls>(key) || {};
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.K_SERVICE) throw new Error('NOTIFICATION_CONTROLS_UNAVAILABLE');
  return { ...local };
}

async function save(field: string, value: NotificationControl): Promise<void> {
  if (process.env.DATABASE_PROVIDER === 'supabase') {
    await getFirestoreDb().runTransaction(async tx => {
      const ref = postgresControls();
      const controls = (await tx.get(ref)).data()?.controls || {};
      if (controls[field] === 'deleted' && value !== 'deleted') throw new Error('NOTIFICATION_DELETED');
      tx.set(ref, { controls: { ...controls, [field]: value }, updatedAt: new Date().toISOString() });
    });
    return;
  }
  const redis = getUpstashClient();
  if (redis) {
    const accepted = await redis.eval(`
      if redis.call('HGET', KEYS[1], ARGV[1]) == 'deleted' and ARGV[2] ~= 'deleted' then return 0 end
      redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
      return 1
    `, [key], [field, value]);
    if (Number(accepted) !== 1) throw new Error('NOTIFICATION_DELETED');
    return;
  }
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.K_SERVICE) throw new Error('NOTIFICATION_CONTROLS_UNAVAILABLE');
  if (local[field] === 'deleted' && value !== 'deleted') throw new Error('NOTIFICATION_DELETED');
  local[field] = value;
}

export function notificationVisible(notification: Notification, controls: NotificationControls): boolean {
  const broadcastId = notification.broadcastId || (notification as any).data?.broadcastId
    || (notification.id.startsWith('notif-') && notification.id.endsWith('-' + notification.userId)
      ? notification.id.slice(6, -(notification.userId.length + 1)) : undefined);
  return controls['type:' + notification.type] !== 'hidden'
    && (!broadcastId || !['hidden', 'deleted'].includes(controls['broadcast:' + broadcastId]))
    && !['hidden', 'deleted'].includes(controls['notification:' + notification.id])
    && !(notification as any).hidden && !(notification as any).deleted;
}

export async function listAdminNotificationMessages(cursor?: string) {
  const { getBroadcastHistory } = await import('./telegramNotificationQueue');
  const controls = await getNotificationControls();
  const records = (await getBroadcastHistory(Number.MAX_SAFE_INTEGER))
    .filter(record => !record.createdById?.startsWith('system:'))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const cursorIndex = cursor ? records.findIndex(record => record.id === cursor) : -1;
  if (cursor && cursorIndex < 0) throw new Error('INVALID_NOTIFICATION_CURSOR');
  const page = records.slice(cursorIndex + 1, cursorIndex + 101);
  const notifications = page.filter(record => controls['broadcast:' + record.id] !== 'deleted').map(record => ({
    id: record.id, type: record.type, title: record.title, message: record.body, createdAt: record.createdAt,
    recipientCount: record.metrics.totalRecipients, visibility: controls['broadcast:' + record.id] || 'visible',
  }));
  const types = [...new Set([...defaults, ...records.map(record => record.type), ...Object.keys(controls).filter(field => field.startsWith('type:')).map(field => field.slice(5))])].sort();
  return { notifications, types: types.map(type => ({ type, visible: controls['type:' + type] !== 'hidden' })), limit: 100, nextCursor: page.length === 100 ? page.at(-1)!.id : null };
}

export async function setBroadcastVisibility(id: string, visibility: NotificationControl): Promise<void> {
  const { getBroadcastDetails } = await import('./telegramNotificationQueue');
  const record = await getBroadcastDetails(id);
  if (!record || record.createdById?.startsWith('system:')) throw new Error('NOTIFICATION_NOT_FOUND');
  await save('broadcast:' + id, visibility);
}

export async function listAdminNotifications(cursor?: string) {
  const controls = await getNotificationControls();
  const collection = getFirestoreDb().collection(COLLECTIONS.NOTIFICATIONS);
  let query = collection.orderBy('createdAt', 'desc');
  if (cursor) {
    const previous = await collection.doc(cursor).get();
    if (!previous.exists) throw new Error('INVALID_NOTIFICATION_CURSOR');
    query = query.startAfter(previous);
  }
  const snapshot = await query.limit(100).get();
  const notifications = snapshot.docs.map(doc => {
    const data = doc.data();
    return { ...data, id: doc.id, visibility: controls['notification:' + doc.id] || (data.deleted ? 'deleted' : data.hidden ? 'hidden' : 'visible') };
  }).filter(notification => notification.visibility !== 'deleted');
  const types = [...new Set([...defaults, ...snapshot.docs.map(doc => String(doc.data().type || 'SYSTEM')), ...Object.keys(controls).filter(key => key.startsWith('type:')).map(key => key.slice(5))])].sort();
  return { notifications, types: types.map(type => ({ type, visible: controls['type:' + type] !== 'hidden' })), limit: 100, nextCursor: snapshot.docs.length === 100 ? snapshot.docs.at(-1)!.id : null };
}

export async function setNotificationTypeVisibility(type: string, visible: boolean): Promise<void> {
  await save('type:' + type, visible ? 'visible' : 'hidden');
}

export async function setNotificationVisibility(id: string, visibility: NotificationControl, actorId: string): Promise<void> {
  const ref = getFirestoreDb().collection(COLLECTIONS.NOTIFICATIONS).doc(id);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('NOTIFICATION_NOT_FOUND');
  const controls = await getNotificationControls();
  if (doc.data()?.deleted || controls['notification:' + id] === 'deleted') throw new Error('NOTIFICATION_DELETED');
  // Keep a durable tombstone so old Redis snapshots cannot restore a removed item.
  await save('notification:' + id, visibility);
  await ref.update({ hidden: visibility === 'hidden', deleted: visibility === 'deleted', moderatedAt: new Date().toISOString(), moderatedBy: actorId });
}
