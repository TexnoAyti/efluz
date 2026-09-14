import { Request, Response, NextFunction } from 'express';
import { verifyTelegramWebAppData, getOrCreateTelegramUser, getOrCreateDevUser, verifySessionToken } from '../auth/telegramAuth';
import { User } from '../../types';

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// In-memory cache to prevent redundant Firestore lookups if a caller supplies initData or dev headers
const cachedUserByTelegramId = new Map<string, { user: User; expiresAt: number }>();
const cachedUserByDevId = new Map<string, { user: User; expiresAt: number }>();

export function clearAuthMiddlewareCache(): void {
  cachedUserByTelegramId.clear();
  cachedUserByDevId.clear();
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const isDev = process.env.ENABLE_DEV_AUTH === 'true' || process.env.NODE_ENV !== 'production';

  // 1. Signed session token check (authoritative, 0 Firestore reads / 0 Firestore writes)
  const authHeader = req.headers.authorization;
  const sessionTokenHeader = req.headers['x-session-token'] as string;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (sessionTokenHeader) {
    token = sessionTokenHeader.trim();
  }

  if (token) {
    const verified = verifySessionToken(token);
    if (verified.isValid && verified.claims) {
      req.user = {
        id: verified.claims.id,
        telegramId: verified.claims.telegramId,
        username: verified.claims.username,
        firstName: verified.claims.firstName,
        lastName: verified.claims.lastName,
        photoUrl: verified.claims.photoUrl,
        isAdmin: Boolean(verified.claims.isAdmin),
        isSuspended: Boolean(verified.claims.isSuspended),
        createdAt: '',
        updatedAt: '',
      };
      return next();
    }
  }

  // 2. Check Telegram InitData header or query
  const initData = (req.headers['x-telegram-init-data'] || req.query.initData) as string;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (initData) {
    if (botToken) {
      const verifyResult = verifyTelegramWebAppData(initData, botToken);
      if (verifyResult.isValid && verifyResult.user) {
        const tgId = String(verifyResult.user.id);
        const cached = cachedUserByTelegramId.get(tgId);
        if (cached && cached.expiresAt > Date.now()) {
          req.user = cached.user;
          return next();
        }

        try {
          const user = await getOrCreateTelegramUser(verifyResult.user);
          cachedUserByTelegramId.set(tgId, { user, expiresAt: Date.now() + 300000 }); // 5 min cache
          req.user = user;
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
          const tgId = String(parsed.id);
          const cached = cachedUserByTelegramId.get(tgId);
          if (cached && cached.expiresAt > Date.now()) {
            req.user = cached.user;
            return next();
          }
          const user = await getOrCreateTelegramUser(parsed);
          cachedUserByTelegramId.set(tgId, { user, expiresAt: Date.now() + 300000 });
          req.user = user;
          return next();
        }
      } catch {
        // ignore
      }
    }
  }

  // 3. Check Dev User header only in dev mode if Telegram auth wasn't present
  const devUserId = req.headers['x-dev-user-id'] as string;
  if (isDev && devUserId) {
    const cachedDev = cachedUserByDevId.get(devUserId);
    if (cachedDev && cachedDev.expiresAt > Date.now()) {
      req.user = cachedDev.user;
      return next();
    }

    try {
      const user = await getOrCreateDevUser(devUserId);
      cachedUserByDevId.set(devUserId, { user, expiresAt: Date.now() + 300000 });
      req.user = user;
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
