import crypto from 'crypto';
import { queryGet, queryRun } from '../db';
import { User } from '../../types';

export interface TelegramUserParsed {
  id: number | string;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
}

export function verifyTelegramWebAppData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86400 // Default 24 hours
): { isValid: boolean; user?: TelegramUserParsed; authDate?: number; error?: string } {
  if (!initData || !botToken) {
    return { isValid: false, error: 'Missing initData or botToken' };
  }

  const cleanToken = botToken.trim();

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) {
      return { isValid: false, error: 'Missing hash in initData' };
    }

    // Sort parameters alphabetically, excluding hash
    const paramsList: string[] = [];
    urlParams.forEach((val, key) => {
      if (key !== 'hash') {
        paramsList.push(`${key}=${val}`);
      }
    });
    paramsList.sort();
    const dataCheckString = paramsList.join('\n');

    // HMAC-SHA256 calculation
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(cleanToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const calculatedHashBuf = Buffer.from(calculatedHash, 'hex');
    const receivedHashBuf = Buffer.from(hash, 'hex');

    if (calculatedHashBuf.length !== receivedHashBuf.length || !crypto.timingSafeEqual(calculatedHashBuf, receivedHashBuf)) {
      return { isValid: false, error: 'Invalid HMAC signature' };
    }

    const authDateStr = urlParams.get('auth_date');
    const authDate = authDateStr ? parseInt(authDateStr, 10) : 0;

    // Check expiration if maxAgeSeconds is set
    if (maxAgeSeconds > 0 && authDate > 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec - authDate > maxAgeSeconds) {
        return { isValid: false, error: 'Authentication data expired (auth_date is too old)' };
      }
    }

    const userRaw = urlParams.get('user');
    let user: TelegramUserParsed | undefined;
    if (userRaw) {
      user = JSON.parse(userRaw);
    }

    return { isValid: true, user, authDate };
  } catch (err: any) {
    return { isValid: false, error: err.message || 'Telegram verification failed' };
  }
}

export function getOrCreateTelegramUser(tgUser: TelegramUserParsed): User {
  const telegramId = String(tgUser.id);
  const username = tgUser.username || `tg_${telegramId}`;
  const firstName = tgUser.first_name || 'Player';
  const lastName = tgUser.last_name || '';
  const photoUrl = tgUser.photo_url || '';

  // Check admin telegram IDs
  const adminIds = (process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map((s) => s.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  const isAdmin =
    adminIds.includes(telegramId.toLowerCase()) ||
    (Boolean(username) && adminIds.includes(username.toLowerCase()))
      ? 1
      : 0;

  const now = new Date().toISOString();

  let existing = queryGet<any>('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);

  if (!existing) {
    const newId = `user-${telegramId}`;
    queryRun(
      'INSERT INTO users (id, telegram_id, username, first_name, last_name, photo_url, is_admin, is_suspended, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
      [newId, telegramId, username, firstName, lastName, photoUrl, isAdmin, now, now]
    );
    existing = queryGet<any>('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
  } else {
    // Update profile info
    queryRun(
      'UPDATE users SET username = ?, first_name = ?, last_name = ?, photo_url = ?, is_admin = CASE WHEN is_admin = 1 THEN 1 ELSE ? END, updated_at = ? WHERE telegram_id = ?',
      [username, firstName, lastName, photoUrl, isAdmin, now, telegramId]
    );
    existing = queryGet<any>('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
  }

  return {
    id: existing.id,
    telegramId: existing.telegram_id,
    username: existing.username,
    firstName: existing.first_name,
    lastName: existing.last_name,
    photoUrl: existing.photo_url,
    isAdmin: Boolean(existing.is_admin),
    isSuspended: Boolean(existing.is_suspended),
    createdAt: existing.created_at,
    updatedAt: existing.updated_at,
  };
}

export const DEV_PROFILES = [
  {
    id: 'user-dev-a',
    telegramId: '10001',
    username: 'arsenal_pro',
    firstName: 'John (User A)',
    lastName: 'Arsenal',
    isAdmin: false,
  },
  {
    id: 'user-dev-b',
    telegramId: '10002',
    username: 'chelsea_king',
    firstName: 'David (User B)',
    lastName: 'Chelsea',
    isAdmin: false,
  },
  {
    id: 'user-dev-admin',
    telegramId: '99999',
    username: 'superadmin',
    firstName: 'Admin',
    lastName: 'Officer',
    isAdmin: true,
  },
];

export function getOrCreateDevUser(devUserId: string): User {
  const isDevAuthEnabled = process.env.ENABLE_DEV_AUTH === 'true' || process.env.NODE_ENV !== 'production';
  if (!isDevAuthEnabled) {
    throw new Error('Development sandbox authentication is disabled in production.');
  }

  const profile = DEV_PROFILES.find((p) => p.id === devUserId || p.username === devUserId) || DEV_PROFILES[0];
  const now = new Date().toISOString();

  let existing = queryGet<any>('SELECT * FROM users WHERE telegram_id = ?', [profile.telegramId]);

  if (!existing) {
    queryRun(
      'INSERT INTO users (id, telegram_id, username, first_name, last_name, photo_url, is_admin, is_suspended, created_at, updated_at) VALUES (?, ?, ?, ?, ?, "", ?, 0, ?, ?)',
      [profile.id, profile.telegramId, profile.username, profile.firstName, profile.lastName, profile.isAdmin ? 1 : 0, now, now]
    );
    existing = queryGet<any>('SELECT * FROM users WHERE telegram_id = ?', [profile.telegramId]);
  }

  return {
    id: existing.id,
    telegramId: existing.telegram_id,
    username: existing.username,
    firstName: existing.first_name,
    lastName: existing.last_name,
    photoUrl: existing.photo_url,
    isAdmin: Boolean(existing.is_admin),
    isSuspended: Boolean(existing.is_suspended),
    createdAt: existing.created_at,
    updatedAt: existing.updated_at,
  };
}
