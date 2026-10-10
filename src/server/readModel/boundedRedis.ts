import { Redis } from '@upstash/redis';
import { resolveRedisConfig } from './redisConfig';
import { createPostgresRuntimeStore } from '../services/postgresRuntimeStore';

/** Optional cache/telemetry transport: one bounded attempt, never retries. */
export function getBoundedRedisClient(): Redis | null {
  if (process.env.DATABASE_PROVIDER === 'supabase') return createPostgresRuntimeStore() as unknown as Redis;
  const config = resolveRedisConfig(process.env);
  return config ? new Redis({ url: config.url, token: config.token, retry: false, enableAutoPipelining: false, signal: () => AbortSignal.timeout(1200) }) : null;
}
