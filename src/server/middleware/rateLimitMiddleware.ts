import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { getUpstashClient, KEY_PREFIX } from '../readModel/readModelStore';

type LocalCounter = { count: number; resetAt: number };
const localCounters = new Map<string, LocalCounter>();

function subjectFor(req: Request): string {
  const raw = req.user?.id || req.ip || req.socket.remoteAddress || 'unknown';
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
