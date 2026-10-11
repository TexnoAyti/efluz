import {getFirestoreDb} from '../firebase/admin';
import type {RecipientDirectoryEntry} from './telegramNotificationQueue';

/** Delivery authorization comes from the current user, never an admin's old directory snapshot. */
export async function getPostgresNotificationRecipient(userId: string): Promise<RecipientDirectoryEntry | null> {
  const user = (await getFirestoreDb().collection('users').doc(userId).get()).data();
  if (!user) return null;
  return {
    userId, username: user.username || '',
    displayName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'EFL Player',
    telegramId: user.telegramId || null,
    messageable: Boolean(String(user.telegramId || '').trim()) && !user.isSuspended,
    updatedAt: user.updatedAt || '',
  };
}
