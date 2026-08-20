import { queryRun, queryAll } from '../db';
import { Notification } from '../../types';

export function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  data?: Record<string, unknown>
): void {
  const id = `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();
  const dataJson = data ? JSON.stringify(data) : null;

  queryRun(
    'INSERT INTO notifications (id, user_id, type, title, message, data_json, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
    [id, userId, type, title, message, dataJson, now]
  );
}

export function getUserNotifications(userId: string, limit = 20): Notification[] {
  const rows = queryAll<any>(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [userId, limit]
  );

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    type: r.type,
    title: r.title,
    message: r.message,
    data: r.data_json ? JSON.parse(r.data_json) : undefined,
    isRead: Boolean(r.is_read),
    createdAt: r.created_at,
  }));
}

export function markNotificationsAsRead(userId: string): void {
  queryRun('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [userId]);
}
