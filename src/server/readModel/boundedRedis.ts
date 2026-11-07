import { Redis } from '@upstash/redis';
import { resolveRedisConfig } from './redisConfig';

/** Optional cache/telemetry transport: one bounded attempt, never retries. */
export function getBoundedRedisClient(): Redis | null {
  // This client is only for optional cache/telemetry work. Do not emulate
  // Redis with the Supabase runtime-state tables: those writes contend on the
  // production generation row and can delay real data reads.
  if (process.env.DATABASE_PROVIDER === 'supabase') return null;
  const config = resolveRedisConfig(process.env);
  return config ? new Redis({ url: config.url, token: config.token, retry: false, enableAutoPipelining: false, signal: () => AbortSignal.timeout(1200) }) : null;
}
