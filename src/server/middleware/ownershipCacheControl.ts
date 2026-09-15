import { Request, Response, NextFunction } from 'express';

/**
 * Sets strict anti-caching HTTP headers on dynamic ownership-sensitive endpoints.
 * Prevents intermediate proxies, CDNs, and browsers from returning HTTP 304 or stale cached data
 * after club assignment, release, claim, or recovery.
 */
export function setOwnershipSensitiveHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Vary', 'Authorization, X-Session-Token, X-Telegram-Init-Data');
}

export function ownershipNoStoreMiddleware(req: Request, res: Response, next: NextFunction): void {
  setOwnershipSensitiveHeaders(res);
  next();
}
