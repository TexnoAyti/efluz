import {
  createNotificationFirestore,
  getUserNotificationsFirestore,
  markNotificationsReadFirestore,
} from '../firebase/firestoreStore';
import { Notification } from '../../types';

export async function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  data?: Record<string, unknown>
): Promise<void> {
  await createNotificationFirestore(userId, type, title, message, data);
}

export async function getUserNotifications(userId: string, limit = 20): Promise<Notification[]> {
  return await getUserNotificationsFirestore(userId, limit);
}

export async function markNotificationsAsRead(userId: string): Promise<void> {
  await markNotificationsReadFirestore(userId);
}
