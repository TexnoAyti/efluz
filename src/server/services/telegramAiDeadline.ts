import { Redis } from '@upstash/redis';
import { resolveRedisConfig } from '../readModel/redisConfig';

/** Dedicated AI transport: cancellation never changes the shared payment/cache client. */
export function getAiRedisClient(signal?: AbortSignal): Redis | null {
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
