import {PostgresAiStore} from './postgresAiStore';
import { Redis } from '@upstash/redis';
import { resolveRedisConfig } from '../readModel/redisConfig';

/** Dedicated AI state transport. Explicit Redis opt-in offloads AI ephemeral state from PostgreSQL. */
export function getAiRedisClient(signal?: AbortSignal): Redis | null {
  if (process.env.DATABASE_PROVIDER === 'supabase' && process.env.EFL_AI_STATE_BACKEND !== 'redis') return new PostgresAiStore(signal) as unknown as Redis;
  const config = resolveRedisConfig(process.env);
  if (!config) return null;
  // Vercel preview and production can share one Upstash integration. Never
  // share their AI state keys. The opt-in must provide a stable namespace.
  const scoped = process.env.DATABASE_PROVIDER === 'supabase' && process.env.EFL_AI_STATE_BACKEND === 'redis';
  const scope = String(process.env.EFL_AI_STATE_NAMESPACE || '').trim();
  if (scoped && !/^[a-zA-Z0-9_-]{3,64}$/.test(scope)) return null;
  const prefix = scoped ? 'efluz:ai:state:' + scope + ':' : '';
  const key = (value:unknown):unknown => prefix && typeof value === 'string' ? prefix + value : value;
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
      if (typeof value === 'function' && ['get', 'set', 'eval', 'mget', 'del',
        'exists', 'expire', 'pexpire', 'ttl', 'pttl', 'incr', 'incrby',
        'setex', 'getdel'].includes(String(property))) {
        return (...args: unknown[]) => {
          let scopedArgs = args;
          if (prefix) {
            if (property === 'eval') {
              scopedArgs = [args[0], Array.isArray(args[1]) ? (args[1] as unknown[]).map(key) : args[1], ...args.slice(2)];
            } else if (property === 'mget' || property === 'del' || property === 'exists') {
              scopedArgs = args.map(key);
            } else {
              scopedArgs = [key(args[0]), ...args.slice(1)];
            }
          }
          return withinAiDeadline(signal, () => value.apply(target, scopedArgs));
        };
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
