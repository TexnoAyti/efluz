import { Request, Response, NextFunction } from 'express';
import { verifyTelegramWebAppData, getOrCreateTelegramUser, getOrCreateDevUser } from '../auth/telegramAuth';
import { User } from '../../types';

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

interface AuthCacheEntry {
  user: User;
  expiresAt: number;
}

// Authentication is still cryptographically verified on every request, but the
// Firestore/SQLite user lookup is cached to avoid turning normal navigation into
// repeated database reads. Keep the cache short enough for admin suspension changes.
const AUTH_CACHE_TTL_MS = Number(process.env.AUTH_USER_CACHE_TTL_MS) || 60000;
const authCache = new Map<string, AuthCacheEntry>();

function getCachedUser(key: string): User | null {
  const entry = authCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    authCache.delete(key);
    return null;
  }
  return entry.user;
}

function setCachedUser(key: string, user: User): void {
  authCache.set(key, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const isDev = process.env.ENABLE_DEV_AUTH === 'true' || process.env.NODE_ENV !== 'production';

  // 1. Check Telegram InitData header or query FIRST (authoritative production auth)
  const initData = (req.headers['x-telegram-init-data'] || req.query.initData) as string;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (initData) {
    if (botToken) {
      const verifyResult = verifyTelegramWebAppData(initData, botToken);
      if (verifyResult.isValid && verifyResult.user) {
        try {
          const cacheKey = `telegram:${String(verifyResult.user.id)}`;
          const cachedUser = getCachedUser(cacheKey);
          if (cachedUser) {
            req.user = cachedUser;
            return next();
          }

          req.user = await getOrCreateTelegramUser(verifyResult.user);
          setCachedUser(cacheKey, req.user);
          return next();
        } catch (err: any) {
          console.warn('Telegram user retrieval error:', err.message);
        }
      }
    } else if (isDev) {
      // In dev sandbox mode without a token, parse user object if available
      try {
        const urlParams = new URLSearchParams(initData);
        const userRaw = urlParams.get('user');
        if (userRaw) {
          const parsed = JSON.parse(userRaw);
          const cacheKey = `telegram-dev:${String(parsed.id)}`;
          const cachedUser = getCachedUser(cacheKey);
          if (cachedUser) {
            req.user = cachedUser;
            return next();
          }

          req.user = await getOrCreateTelegramUser(parsed);
          setCachedUser(cacheKey, req.user);
          return next();
        }
      } catch {
        // ignore
      }
    }
  }

  // 2. Check Dev User header only in dev mode if Telegram auth wasn't present
  const devUserId = req.headers['x-dev-user-id'] as string;
  if (isDev && devUserId) {
    try {
      const cacheKey = `dev:${devUserId}`;
      const cachedUser = getCachedUser(cacheKey);
      if (cachedUser) {
        req.user = cachedUser;
        return next();
      }

      const user = await getOrCreateDevUser(devUserId);
      req.user = user;
      setCachedUser(cacheKey, user);
      return next();
    } catch (err: any) {
      console.warn('Dev auth error:', err.message);
    }
  }

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'You must be authenticated via Telegram WebApp to access this resource.',
    });
    return;
  }
  if (req.user.isSuspended) {
    res.status(403).json({
      error: 'Account Suspended',
      message: 'Your account has been suspended by an administrator.',
    });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required.',
    });
    return;
  }
  if (!req.user.isAdmin) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'You do not have administrative privileges.',
    });
    return;
  }
  next();
}
