import crypto from 'crypto';
import { User } from '../../types';

export interface SessionClaims {
  id: string;
  telegramId: string;
  username: string;
  firstName: string;
  lastName?: string;
  photoUrl?: string;
  isAdmin: boolean;
  isSuspended: boolean;
  iat: number;
  exp: number;
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.TELEGRAM_BOT_TOKEN;
  if (!secret || secret.length < 24) {
    throw new Error('SESSION_SECRET_REQUIRED: configure a strong SESSION_SECRET (or TELEGRAM_BOT_TOKEN).');
  }
  return secret;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Creates a cryptographically signed session token (default 24 hours validity).
 */
export function createSessionToken(user: User, expiresInSeconds = 900): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    id: user.id,
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    photoUrl: user.photoUrl,
    isAdmin: Boolean(user.isAdmin),
    isSuspended: Boolean(user.isSuspended),
    iat: now,
    exp: now + expiresInSeconds,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const data = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', getSessionSecret())
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${data}.${signature}`;
}

/**
 * Verifies and parses a signed session token without hitting Firestore.
 */
export function verifySessionToken(token: string): {
  isValid: boolean;
  claims?: SessionClaims;
  error?: string;
} {
  if (!token || typeof token !== 'string') {
    return { isValid: false, error: 'Missing token' };
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    return { isValid: false, error: 'Malformed token structure' };
  }

  const [encodedHeader, encodedPayload, receivedSig] = parts;
  const data = `${encodedHeader}.${encodedPayload}`;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const expectedBuf = Buffer.from(expectedSig);
  const receivedBuf = Buffer.from(receivedSig);

  if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
    return { isValid: false, error: 'Invalid token signature' };
  }

  try {
    const header = JSON.parse(base64UrlDecode(encodedHeader));
    if (header?.alg !== 'HS256' || header?.typ !== 'JWT') {
      return { isValid: false, error: 'Invalid token header' };
    }
    const claims: SessionClaims = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1000);
    if (
      !claims || typeof claims.id !== 'string' || typeof claims.telegramId !== 'string' ||
      typeof claims.username !== 'string' || typeof claims.firstName !== 'string' ||
      typeof claims.iat !== 'number' || typeof claims.exp !== 'number' ||
      typeof claims.isAdmin !== 'boolean' || typeof claims.isSuspended !== 'boolean'
    ) {
      return { isValid: false, error: 'Invalid token claims' };
    }
    if (claims.iat > now + 60 || claims.exp <= now || claims.exp - claims.iat > 900) {
      return { isValid: false, error: 'Token expired' };
    }
    return { isValid: true, claims };
  } catch (err: any) {
    return { isValid: false, error: 'Invalid token claims' };
  }
}
