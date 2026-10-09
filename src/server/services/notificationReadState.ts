import type { Notification } from '../../types';
import { getUpstashClient } from '../readModel/readModelStore';
import { getFirestoreDb } from '../firebase/admin';

type ReadState = Record<string, string>;
const localState = new Map<string, ReadState>();
const stateKey = (userId: string) => `efluz:v1:user:${userId}:notification-read-state`;
const postgresRef = (userId: string) => getFirestoreDb().collection('notification_read_state').doc(userId);

function localAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' && !process.env.VERCEL && !process.env.K_SERVICE;
}

export async function getNotificationReadState(userId: string): Promise<ReadState> {
  if (process.env.DATABASE_PROVIDER === 'supabase') return (await postgresRef(userId).get()).data()?.state || {};
  const client = getUpstashClient();
  if (client) return await client.hgetall<ReadState>(stateKey(userId)) || {};
  if (!localAllowed()) throw new Error('REDIS_REQUIRED_FOR_NOTIFICATION_READ_STATE');
  return { ...localState.get(userId) };
}

export async function persistNotificationReadState(userId: string, readAt: string, notificationId?: string): Promise<void> {
  const field = notificationId ? `notification:${notificationId}` : 'all';
  if (process.env.DATABASE_PROVIDER === 'supabase') {
    await getFirestoreDb().runTransaction(async tx => {
      const ref = postgresRef(userId);
      const state = (await tx.get(ref)).data()?.state || {};
      if (!state[field] || state[field] < readAt) tx.set(ref, { state: { ...state, [field]: readAt } });
    });
    return;
  }
  const client = getUpstashClient();
  if (client) {
    // Concurrent read acknowledgements cannot move the timestamp backwards.
    await client.eval(`
      local old = redis.call('HGET', KEYS[1], ARGV[1])
      if not old or old < ARGV[2] then redis.call('HSET', KEYS[1], ARGV[1], ARGV[2]) end
      return 1
    `, [stateKey(userId)], [field, readAt]);
    return;
  }
  if (!localAllowed()) throw new Error('REDIS_REQUIRED_FOR_NOTIFICATION_READ_STATE');
  const state = localState.get(userId) || {};
  if (!state[field] || state[field] < readAt) state[field] = readAt;
  localState.set(userId, state);
}

export function applyNotificationReadState(notifications: Notification[], state: ReadState): Notification[] {
  return notifications.map(notification => {
    const readAt = [state.all, state[`notification:${notification.id}`]].filter(Boolean).sort().at(-1);
    const createdAt = Date.parse(notification.createdAt);
    const read = readAt && Number.isFinite(createdAt) && Date.parse(readAt) >= createdAt;
    return read && !notification.isRead ? { ...notification, isRead: true } : notification;
  });
}
