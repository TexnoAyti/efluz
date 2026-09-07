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
  maxAgeSeconds = 86400
): { isValid: boolean; user?: TelegramUserParsed; authDate?: number; error?: string } {
  if (!initData || !botToken) return { isValid: false, error: 'Missing initData or botToken' };
  const cleanToken = botToken.trim();
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return { isValid: false, error: 'Missing hash in initData' };
    const paramsList: string[] = [];
    urlParams.forEach((val, key) => { if (key !== 'hash') paramsList.push(`${key}=${val}`); });
    paramsList.sort();
    const dataCheckString = paramsList.join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(cleanToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    const calculatedHashBuf = Buffer.from(calculatedHash, 'hex');
    const receivedHashBuf = Buffer.from(hash, 'hex');
    if (calculatedHashBuf.length !== receivedHashBuf.length || !crypto.timingSafeEqual(calculatedHashBuf, receivedHashBuf)) {
      return { isValid: false, error: 'Invalid HMAC signature' };
    }
    const authDateStr = urlParams.get('auth_date');
    const authDate = authDateStr ? parseInt(authDateStr, 10) : 0;
    if (maxAgeSeconds > 0 && authDate > 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (nowSec - authDate > maxAgeSeconds) return { isValid: false, error: 'Authentication data expired (auth_date is too old)' };
    }
    const userRaw = urlParams.get('user');
    const user = userRaw ? JSON.parse(userRaw) as TelegramUserParsed : undefined;
    return { isValid: true, user, authDate };
  } catch (err: any) {
    return { isValid: false, error: err.message || 'Telegram verification failed' };
  }
}

export const DEV_PROFILES = [
  { id: 'user-dev-a', telegramId: '10001', username: 'arsenal_pro', firstName: 'John (User A)', lastName: 'Arsenal', isAdmin: false },
  { id: 'user-dev-b', telegramId: '10002', username: 'chelsea_king', firstName: 'David (User B)', lastName: 'Chelsea', isAdmin: false },
  { id: 'user-dev-admin', telegramId: '99999', username: 'superadmin', firstName: 'Admin', lastName: 'Officer', isAdmin: true },
] as const;

export const LEGACY_TEST_USER_IDS = new Set<string>(DEV_PROFILES.map((profile) => profile.id));

function isHostedProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1' || Boolean(process.env.K_SERVICE);
}

export function isDevAuthEnabled(): boolean {
  return process.env.ENABLE_DEV_AUTH === 'true' && !isHostedProductionRuntime();
}

export async function getOrCreateTelegramUser(tgUser: TelegramUserParsed): Promise<User> {
  return await getOrCreateTelegramUserFirestore(tgUser);
}

export async function getOrCreateDevUser(devUserId: string): Promise<User> {
  if (!isDevAuthEnabled()) throw new Error('Development authentication is disabled outside local development.');
  if (!LEGACY_TEST_USER_IDS.has(devUserId)) throw new Error('Unknown development profile.');
  return await getOrCreateDevUserFirestore(devUserId);
}
