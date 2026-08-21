import crypto from 'crypto';
import { User } from '../../types';
import { getOrCreateTelegramUserFirestore, getOrCreateDevUserFirestore } from '../firebase/firestoreStore';

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

export async function getOrCreateTelegramUser(tgUser: TelegramUserParsed): Promise<User> {
  return await getOrCreateTelegramUserFirestore(tgUser);
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

export async function getOrCreateDevUser(devUserId: string): Promise<User> {
  return await getOrCreateDevUserFirestore(devUserId);
}
