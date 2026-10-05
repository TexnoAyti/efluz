import crypto from 'crypto';
import { isIP } from 'node:net';
import { NextFunction, Request, Response } from 'express';
import { getUpstashClient, KEY_PREFIX } from '../readModel/readModelStore';
import { verifySessionToken } from '../auth/sessionToken';
import { verifyTelegramWebAppData } from '../auth/telegramAuth';

type LocalCounter = { count: number; resetAt: number };
const localCounters = new Map<string, LocalCounter>();

function subjectFor(req: Request): string {
  // This limiter also runs BEFORE authMiddleware. Resolve only cryptographically
  // verified identity here, without reading accounts or granting any permissions.
  let identity = req.user?.telegramId;
  try {
    const bearer = req.get('authorization');
    const token = bearer?.startsWith('Bearer ') ? bearer.slice(7).trim() : req.get('x-session-token');
    if (!identity && token) {
      const verified = verifySessionToken(token);
      if (verified.isValid) identity = verified.claims?.telegramId;
    }
    if (!identity) {
      const loginBody = req.method === 'POST' && req.originalUrl.split('?')[0] === '/api/auth/telegram'
        ? req.body?.initData : undefined;
      const initData = req.get('x-telegram-init-data') || req.query.initData || loginBody;
      if (typeof initData === 'string' && process.env.TELEGRAM_BOT_TOKEN) {
        const verified = verifyTelegramWebAppData(initData, process.env.TELEGRAM_BOT_TOKEN);
        if (verified.isValid && verified.user && verified.authDate &&
            verified.authDate <= Math.floor(Date.now() / 1000) + 60) identity = String(verified.user.id);
      }
    }
  } catch { /* Invalid/missing auth configuration keeps the anonymous IP budget. */ }
  // Only Vercel's platform-controlled header is trusted; never enable generic
  // Express trust-proxy or allow an arbitrary X-Forwarded-For to rotate budgets.
  const forwarded = process.env.VERCEL === '1' ? req.get('x-vercel-forwarded-for')?.trim() : undefined;
  const ip = forwarded && isIP(forwarded) ? forwarded : req.ip || req.socket.remoteAddress || 'unknown';
  const raw = identity && /^\d+$/.test(identity) ? `telegram:${identity}` : `ip:${ip}`;
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

export function rateLimit(name: string, limit: number, windowSeconds: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const windowId = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `${KEY_PREFIX}:ratelimit:${name}:${subjectFor(req)}:${windowId}`;
    let count = 0;

    try {
      const client = getUpstashClient();
      if (client) {
        count = Number(await client.eval(
          "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
          [key],
          [windowSeconds]
        ));
      } else {
        const now = Date.now();
        const current = localCounters.get(key);
        if (!current || current.resetAt <= now) {
          count = 1;
          localCounters.set(key, { count, resetAt: now + windowSeconds * 1000 });
        } else {
          current.count += 1;
          count = current.count;
        }
        if (localCounters.size > 5000) {
          for (const [localKey, value] of localCounters) if (value.resetAt <= now) localCounters.delete(localKey);
        }
      }
    } catch {
      // Availability fallback: do not turn a Redis outage into a full API outage.
      return next();
    }

    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - count)));
    if (count > limit) {
      res.setHeader('Retry-After', String(windowSeconds));
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }
    next();
  };
}
