import type { User } from '../types';
export function normalizeUserSearch(value: string): string { return value.trim().replace(/^@/, '').toLowerCase(); }
export function matchesUserSearch(user: Pick<User, 'id' | 'telegramId' | 'username' | 'firstName' | 'lastName'>, value: string): boolean {
  const query = normalizeUserSearch(value);
  return !query || [user.id, user.telegramId, user.username, user.firstName, user.lastName, [user.firstName, user.lastName].filter(Boolean).join(' ')]
    .some(field => String(field || '').toLowerCase().includes(query));
}
