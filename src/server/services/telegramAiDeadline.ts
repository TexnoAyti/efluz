import {PostgresAiStore} from './postgresAiStore';
import { Redis } from '@upstash/redis';
import { resolveRedisConfig } from '../readModel/redisConfig';

/** Dedicated AI state transport. Explicit Redis opt-in offloads AI ephemeral state from PostgreSQL. */
export function getAiRedisClient(signal?: AbortSignal): Redis | null {
  if (process.env.DATABASE_PROVIDER === 'supabase' && process.env.EFL_AI_STATE_BACKEND !== 'redis') return new PostgresAiStore(signal) as unknown as Redis;
  const config = resolveRedisConfig(process.env);
  if (!config) return null;
  const client = new Redis({
    url: config.url,
    token: config.token,
    signal: () => signal
      ? AbortSignal.any([signal, AbortSignal.timeout(1500)])
      : AbortSignal.timeout(1500),
    retry: false,
    enableAutoPipelining: false,
  });
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (['get', 'set', 'eval', 'mget'].includes(String(property)) && typeof value === 'function') {
        return (...args: unknown[]) => withinAiDeadline(signal, () => value.apply(target, args));
      }
      return value;
    },
  });
}

/** Keep previously issued match-result confirmation tokens on their original
 * durable transport during the AI-state migration. A Redis switch must not
 * invalidate an in-flight score confirmation or change the working result flow.
 */
export function getTopicResultStateClient(signal?: AbortSignal): Redis | null {
  if (process.env.DATABASE_PROVIDER === 'supabase') return new PostgresAiStore(signal) as unknown as Redis;
  return getAiRedisClient(signal);
}

/** Bounds SDK/test promises even when a transport ignores AbortSignal. */
export function withinAiDeadline<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
  if (!signal) return operation();
  if (signal.aborted) return Promise.reject(new Error('TIMEOUT_ABORTED'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error('TIMEOUT_ABORTED'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw new Error('TIMEOUT_ABORTED');
      return operation();
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
