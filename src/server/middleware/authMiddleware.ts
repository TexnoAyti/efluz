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

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const isDev = process.env.ENABLE_DEV_AUTH === 'true' || process.env.NODE_ENV !== 'production';

  // 1. Check Telegram InitData header or query FIRST (authoritative production auth)
  const initData = (req.headers['x-telegram-init-data'] || req.query.initData) as string;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (initData) {
    if (botToken) {
      const verifyResult = verifyTelegramWebAppData(initData, botToken);
      if (verifyResult.isValid && verifyResult.user) {
        req.user = getOrCreateTelegramUser(verifyResult.user);
        return next();
      }
    } else if (isDev) {
      // In dev sandbox mode without a token, parse user object if available
      try {
        const urlParams = new URLSearchParams(initData);
        const userRaw = urlParams.get('user');
        if (userRaw) {
          const parsed = JSON.parse(userRaw);
          req.user = getOrCreateTelegramUser(parsed);
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
      const user = getOrCreateDevUser(devUserId);
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
